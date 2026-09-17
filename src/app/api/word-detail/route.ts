import { NextRequest, NextResponse } from 'next/server';
import { getLLM } from '@/lib/word-app';
import { requireAccount } from '@/lib/auth';
import { SearchClient, Config, HeaderUtils } from 'coze-coding-dev-sdk';

export const runtime = 'nodejs';
export const maxDuration = 60;

interface WordDetail {
  etymology: string;
  roots: string[];
  sentence: string;
  play: string;
  character: string;
  sentenceTranslation: string;
  context: string;
}

const EMPTY_DETAIL: WordDetail = { etymology: '', roots: [], sentence: '', play: '', character: '', sentenceTranslation: '', context: '' };

/** 从 LLM 输出中容错解析词详情 JSON（兼容围栏代码块） */
function parseDetailJson(content: string): WordDetail {
  let raw = String(content ?? '').trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) raw = fenced[1].trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return EMPTY_DETAIL;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as Partial<WordDetail>;
    return {
      etymology: typeof parsed.etymology === 'string' ? parsed.etymology.trim() : '',
      roots: Array.isArray(parsed.roots) ? parsed.roots.filter((r): r is string => typeof r === 'string' && r.trim().length > 0).slice(0, 6) : [],
      sentence: typeof parsed.sentence === 'string' ? parsed.sentence.trim() : '',
      play: typeof parsed.play === 'string' ? parsed.play.trim() : '',
      character: typeof parsed.character === 'string' ? parsed.character.trim() : '',
      sentenceTranslation: typeof parsed.sentenceTranslation === 'string' ? parsed.sentenceTranslation.trim() : '',
      context: typeof parsed.context === 'string' ? parsed.context.trim() : '',
    };
  } catch {
    return EMPTY_DETAIL;
  }
}

/** 归一化英文文本：小写、统一撇号、去标点、压缩空白（用于原句逐字匹配） */
function normalizeText(text: string): string {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[\u2018\u2019\u02bc`]/g, "'")
    .replace(/[^a-z0-9']+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** 从原句中取 2 个不同的 6 词探针片段（中部与偏移），用于搜索验证 */
function extractProbeFragments(sentence: string): string[] {
  const words = normalizeText(sentence).split(' ').filter(Boolean);
  if (words.length < 5) return words.length >= 4 ? [words.join(' ')] : [];
  const win = 6;
  const mid = Math.floor((words.length - win) / 2);
  const fragments = new Set<string>();
  fragments.add(words.slice(mid, mid + win).join(' '));
  const alt = mid >= 3 ? mid - 3 : mid + 3;
  if (alt >= 0 && alt + win <= words.length) fragments.add(words.slice(alt, alt + win).join(' '));
  return [...fragments];
}

/** 联网逐字验证原句真实性：任一探针片段在搜索结果中完整出现才算通过；搜索通道异常按未通过处理 */
async function verifySentenceOnline(sentence: string, client: SearchClient): Promise<boolean> {
  const fragments = extractProbeFragments(sentence);
  if (fragments.length === 0) return false;
  for (const fragment of fragments) {
    try {
      const response = await client.webSearch(fragment, 8, false);
      const haystack = (response.web_items ?? [])
        .map((item) => `${item.title ?? ''} ${item.snippet ?? ''} ${item.content ?? ''}`)
        .map(normalizeText)
        .join(' ');
      if (haystack && haystack.includes(fragment)) return true;
    } catch (error) {
      console.error('[word-detail] 台词搜索验证失败', error);
    }
  }
  return false;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 从网页文本中摘取包含目标单词的完整句子（换行+句号双重切分、词边界匹配、长度适中、非中文残留） */
function extractSentenceWithWord(text: string, word: string): string | null {
  if (!text) return null;
  const wordRe = new RegExp(`\\b${escapeRegExp(word)}\\b`, 'i');
  const cjkRe = /[\u4e00-\u9fff]/;
  for (const line of text.split(/\n+/)) {
    for (const rawPart of line.split(/(?<=[.!?])\s+/)) {
      const part = rawPart.trim().replace(/^["'"“”«»\s]+/, '').replace(/["'"“”«»\s]+$/, '').trim();
      const words = part.split(/\s+/).filter(Boolean);
      if (!part || words.length < 6 || words.length > 40) continue;
      if (cjkRe.test(part)) continue;
      if (!/^[A-Za-z"']/.test(part)) continue;
      if (!wordRe.test(part)) continue;
      return part;
    }
  }
  return null;
}

interface Harvested {
  sentence: string;
  sourceName: string;
}

/** 第二层兜底：直接从真实网页（新闻/杂志/文学站点）摘取包含该单词的原句——句子天然真实 */
async function harvestRealSentence(word: string, client: SearchClient): Promise<Harvested | null> {
  const queries = [`"${word}" example sentence`, `"${word}" news quote`];
  for (const query of queries) {
    try {
      const response = await client.advancedSearch(query, { count: 10, needContent: true, needSummary: false });
      for (const item of response.web_items ?? []) {
        const text = `${item.snippet ?? ''} ${item.content ?? ''}`;
        const sentence = extractSentenceWithWord(text, word);
        if (sentence) {
          const sourceName = (item.site_name ?? '').trim() || (item.url ?? '').replace(/^https?:\/\//, '').split('/')[0];
          if (sourceName) return { sentence, sourceName };
        }
      }
    } catch (error) {
      console.error('[word-detail] 真实例句搜索失败', query, error);
    }
  }
  return null;
}

/** 第三层兜底：搜索通道不可用时生成通用例句，并诚实标注非真实出处 */
async function buildGenericSentence(word: string): Promise<Partial<WordDetail>> {
  const response = await getLLM().invoke(
    [
      { role: 'system' as const, content: '你是英语教学例句编写专家。只输出 JSON，不要输出任何其他文字。' },
      {
        role: 'user' as const,
        content:
          `为单词 "${word}" 写一句清晰自然、便于记忆的英文例句（15-25 词，日常或新闻风格，必须自然用到该单词）：\n` +
          '只输出 JSON 对象：{"sentence":"","sentenceTranslation":""}\n' +
          'sentence 为英文例句，sentenceTranslation 为它的中文翻译。',
      },
    ],
    { model: 'doubao-seed-2-0-mini-260215', temperature: 0.5 },
  );
  return parseDetailJson(String(response.content ?? ''));
}

/** POST /api/word-detail 生成单词的词源、词根与一句真实例句（三级兜底保证有句可用） */
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAccount();
    if (!ctx) return NextResponse.json({ error: '未登录' }, { status: 401 });
    void ctx;
    const body = (await request.json()) as { word?: string };
    const word = (body.word ?? '').trim().toLowerCase();
    if (!word || word.length > 40) {
      return NextResponse.json({ error: '缺少有效的单词' }, { status: 400 });
    }

    const messages = [
      { role: 'system' as const, content: '你是一位词源学教授，同时是话剧、音乐剧与英美文学百科全书。你极度厌恶编造：宁可承认找不到，也绝不允许输出任何不确定的引用。只输出 JSON，不要输出任何其他文字。' },
      {
        role: 'user' as const,
        content:
          `请为英文单词 "${word}" 生成以下内容：\n` +
          '1) etymology：用中文写 1-2 句这个词的词源故事（来自哪种语言、原始含义、如何演变至今），简洁有趣\n' +
          '2) roots：词根/词缀拆解数组，每项格式如 "ser-（捆绑、连在一起）"，若无明显词根可给出记忆联想拆解\n' +
          '3) sentence：一句包含该单词的真实英文原句，按以下优先级选取：\n' +
          '   ① 话剧或音乐剧台词（英文原文，逐字出自真实剧作）\n' +
          '   ② 经典英美文学作品原句（小说、戏剧、诗歌）\n' +
          '   ③ 权威英文新闻或杂志中出现过的句子\n' +
          '   铁律：只能输出你 100% 确定逐字准确、且能给出可靠出处的句子。严禁拼凑、改写、杜撰、凭印象默写。若没有 100% 的把握，sentence 必须输出空字符串 ""\n' +
          '4) play：该句的出处，双语格式 "英文名 中文名"，如 "Romeo and Juliet 罗密欧与朱丽叶" 或 "The New York Times 纽约时报"；sentence 为空时此字段输出 ""\n' +
          '5) character：说出该句的角色或作者，双语格式 "英文名 中文名"；出处为新闻杂志等无角色场景时输出 ""；sentence 为空时输出 ""\n' +
          '6) sentenceTranslation：该句的中文翻译；sentence 为空时输出 ""\n' +
          '7) context：用中文一句话概括该句出现的情节与背景（谁、什么场景、为什么）；sentence 为空时输出 ""\n' +
          '只输出 JSON 对象：{"etymology":"","roots":[""],"sentence":"","play":"","character":"","sentenceTranslation":"","context":""}',
      },
    ];

    const forwardHeaders = HeaderUtils.extractForwardHeaders(request.headers);
    const searchClient = new SearchClient(new Config(), forwardHeaders);

    // 第一层：凭知识生成（词源必须拿到；原句缺失时再给一次机会，最多两轮）
    let detail = EMPTY_DETAIL;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await getLLM().invoke(messages, {
        model: 'doubao-seed-2-0-mini-260215',
        temperature: 0.3,
      });
      const parsed = parseDetailJson(String(response.content ?? ''));
      if (parsed.etymology) detail = parsed;
      if (detail.etymology && detail.sentence) break;
    }
    if (!detail.etymology) {
      return NextResponse.json({ error: '词源生成失败，请稍后再试' }, { status: 502 });
    }

    // 核验第一层的原句：探针片段在搜索结果中逐字命中才放行
    if (detail.sentence) {
      const verified = await verifySentenceOnline(detail.sentence, searchClient);
      if (!verified) {
        console.log(`[word-detail] "${word}" 第一层原句未通过联网核验，降级到真实网页摘句`);
        detail = { ...detail, sentence: '', play: '', character: '', sentenceTranslation: '', context: '' };
      }
    }

    // 第二层：从真实网页摘取包含该单词的原句（句子天然真实），AI 仅负责翻译与背景说明
    if (!detail.sentence) {
      const harvested = await harvestRealSentence(word, searchClient);
      if (harvested) {
        const enrichResponse = await getLLM().invoke(
          [
            { role: 'system' as const, content: '你是双语编辑，负责为真实英文例句补充准确的出处信息与中文说明。只输出 JSON，不要输出任何其他文字。' },
            {
              role: 'user' as const,
              content:
                `下面是从网页 "${harvested.sourceName}" 摘录的真实英文句子（包含单词 "${word}"）：\n` +
                `"${harvested.sentence}"\n\n` +
                '请基于这个句子本身生成：\n' +
                '1) play：来源媒体或作品的双语名称，格式 "英文名 中文名"。若能识别知名媒体/作品（如 BBC、《纽约时报》、某小说）给出规范双语名；无法识别时给出域名与中文音译/意译\n' +
                '2) character：该句的作者或角色（双语，格式同上）；无从确定时输出 ""\n' +
                '3) sentenceTranslation：该句的中文翻译\n' +
                '4) context：用中文一句话说明这句话的内容与出现的语境（基于句子本身，不要编造额外情节）\n' +
                '只输出 JSON 对象：{"play":"","character":"","sentenceTranslation":"","context":""}',
            },
          ],
          { model: 'doubao-seed-2-0-mini-260215', temperature: 0.3 },
        );
        const enriched = parseDetailJson(String(enrichResponse.content ?? ''));
        detail = {
          ...detail,
          sentence: harvested.sentence,
          play: enriched.play || harvested.sourceName,
          character: enriched.character,
          sentenceTranslation: enriched.sentenceTranslation,
          context: enriched.context || `摘自 ${harvested.sourceName} 的真实用例`,
        };
        console.log(`[word-detail] "${word}" 使用第二层真实网页摘句（来源 ${harvested.sourceName}）`);
      }
    }

    // 第三层：搜索通道不可用时生成通用例句，诚实标注非真实出处（保证学习不中断）
    if (!detail.sentence) {
      const generic = await buildGenericSentence(word);
      if (generic.sentence) {
        detail = {
          ...detail,
          sentence: generic.sentence,
          play: '通用例句 General Example',
          character: '',
          sentenceTranslation: generic.sentenceTranslation ?? '',
          context: '未能核验到真实出处的参考例句，仅辅助记忆',
        };
        console.log(`[word-detail] "${word}" 使用第三层通用例句兜底`);
      }
    }

    return NextResponse.json({ detail });
  } catch (error) {
    console.error('[word-detail] 生成失败', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : '生成失败' }, { status: 500 });
  }
}
