import { NextRequest, NextResponse } from 'next/server';
import { getLLM } from '@/lib/word-app';
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

/** 联网逐字验证原句真实性：任一探针片段在搜索结果中完整出现才算通过；搜索通道异常按未通过处理（宁缺毋滥） */
async function verifySentenceOnline(sentence: string, forwardHeaders: Record<string, string>): Promise<boolean> {
  const fragments = extractProbeFragments(sentence);
  if (fragments.length === 0) return false;
  const client = new SearchClient(new Config(), forwardHeaders);
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
      // 继续尝试下一个片段；全部失败则按未验证处理
    }
  }
  return false;
}

/** POST /api/word-detail 生成单词的词源、词根与一句经过联网核验的真实英文原句 */
export async function POST(request: NextRequest) {
  try {
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

    // LLM 输出偶发不稳定：词源必须拿到；原句缺失时再给一次机会（换选材），最多两轮
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

    // 联网核验：探针片段在搜索结果中逐字命中才放行；否则丢弃台词（宁缺毋滥，绝不输出未经核验的引用）
    if (detail.sentence) {
      const verified = await verifySentenceOnline(detail.sentence, forwardHeaders);
      if (!verified) {
        console.log(`[word-detail] "${word}" 的原句未通过联网核验，已丢弃`);
        detail = { ...detail, sentence: '', play: '', character: '', sentenceTranslation: '', context: '' };
      }
    }

    return NextResponse.json({ detail });
  } catch (error) {
    console.error('[word-detail] 生成失败', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : '生成失败' }, { status: 500 });
  }
}
