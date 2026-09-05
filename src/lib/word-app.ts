import { Config, FetchClient, LLMClient, SearchClient, S3Storage } from 'coze-coding-dev-sdk';
import type { Message } from 'coze-coding-dev-sdk';

const config = new Config();

/** 对象存储客户端（临时文件上传 / 读取 / 删除） */
export const storage = new S3Storage({
  endpointUrl: process.env.COZE_BUCKET_ENDPOINT_URL,
  accessKey: '',
  secretKey: '',
  bucketName: process.env.COZE_BUCKET_NAME,
  region: 'cn-beijing',
});

/** LLM 客户端（图片 OCR / 文本选词 / 释义提炼） */
export const llm = new LLMClient(config);

/** URL 内容抓取客户端（PDF / Office 文档解析） */
export const fetchClient = new FetchClient(config);

/** 搜索客户端（无释义单词的中文释义匹配） */
export const searchClient = new SearchClient(config);

export type RecognizedWord = { word: string; pos?: string };

const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'];

/** 根据文件名与 MIME 判定业务文件类型 */
export function detectFileType(filename: string, mime?: string): 'image' | 'pdf' | 'word' | 'ppt' | 'excel' | 'text' | null {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  if (IMAGE_EXTS.includes(ext) || mime?.startsWith('image/')) return 'image';
  if (ext === 'pdf' || mime === 'application/pdf') return 'pdf';
  if (['doc', 'docx'].includes(ext)) return 'word';
  if (['ppt', 'pptx'].includes(ext)) return 'ppt';
  if (['xls', 'xlsx', 'csv'].includes(ext)) return 'excel';
  if (['txt', 'text', 'md'].includes(ext) || mime?.startsWith('text/')) return 'text';
  return null;
}

/** 从 LLM 输出中容错解析单词 JSON */
export function parseWordsJson(content: string): RecognizedWord[] {
  if (!content) return [];
  let raw = content.trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) raw = fenced[1].trim();
  const start = raw.search(/[[{]/);
  if (start === -1) return [];
  raw = raw.slice(start);
  const endBrace = raw.lastIndexOf('}');
  const endBracket = raw.lastIndexOf(']');
  const end = Math.max(endBrace, endBracket);
  if (end > -1) raw = raw.slice(0, end + 1);
  try {
    const parsed = JSON.parse(raw) as { words?: RecognizedWord[] } | RecognizedWord[];
    const list = Array.isArray(parsed) ? parsed : parsed.words;
    if (!Array.isArray(list)) return [];
    const seen = new Set<string>();
    const result: RecognizedWord[] = [];
    for (const item of list) {
      const w = typeof item === 'string' ? item : item?.word;
      if (typeof w !== 'string') continue;
      const cleaned = w
        .trim()
        .toLowerCase()
        .replace(/[^a-z\s'-]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (cleaned.length < 2 || cleaned.length > 40) continue;
      const letterCount = (cleaned.match(/[a-z]/g) ?? []).length;
      if (letterCount < 2) continue;
      if (seen.has(cleaned)) continue;
      seen.add(cleaned);
      result.push({ word: cleaned, pos: typeof item === 'object' ? item?.pos : undefined });
    }
    return result;
  } catch {
    return [];
  }
}

/** 图片识别：多模态 LLM 精准提取图片中的英文单词 */
export async function extractWordsFromImage(base64: string, mime: string): Promise<RecognizedWord[]> {
  const messages: Message[] = [
    {
      role: 'system',
      content:
        '你是专业的英文 OCR 与词汇提取助手，尤其擅长识别多栏排版的英文词汇列表。只输出 JSON，不要输出任何其他文字。',
    },
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text:
            '请精准识别图片中的英文词汇（图片很可能是多栏排版的单词/短语列表，也可能是文章或笔记）。要求：' +
            '1) 逐栏逐条完整识别，从左到右、自上而下，不遗漏任何条目，列表可能包含 200 个以上条目；' +
            '2) 多词短语（如 ocean energy、fossil fuels、ocean thermal energy conversion）必须完整保留为一个条目，禁止拆分或合并；' +
            '3) 保留图片中的原始拼写，宁可整词也不要漏词；条目统一小写；' +
            '4) 忽略纯数字条目、页码、装饰符号与 URL；' +
            '5) 若条目自带词性标注（如 n. v. adj.）则输出 pos 字段，否则省略；' +
            '6) 完整输出全部条目（最多 300 个），禁止中途截断、省略或输出"其余同理"之类总结。' +
            '只输出 JSON：{"words":[{"word":"ocean energy"},{"word":"fossil fuels"}]}',
        },
        { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}`, detail: 'high' } },
      ],
    },
  ];
  const response = await llm.invoke(messages, {
    model: 'doubao-seed-2-0-pro-260215',
    temperature: 0.05,
  });
  return parseWordsJson(response.content);
}

/** 文本选词：从文档文本中筛选值得学习的英文单词（LLM 优先，失败降级为本地分词） */
export async function extractWordsFromText(text: string): Promise<RecognizedWord[]> {
  const trimmed = text.slice(0, 12000);
  const messages: Message[] = [
    {
      role: 'system',
      content:
        '你是专业的英文词汇整理助手。你需要从英文材料中挑选值得学习的单词，只输出 JSON，不要输出任何其他文字。',
    },
    {
      role: 'user',
      content:
        '以下是一份英文学习材料的内容。请提取其中值得背诵学习的英文单词，要求：' +
        '1) 优先选取实义词汇（名词、动词、形容词、副词），忽略 a/the/is/of 等常见虚词与基础高频词；' +
        '2) 去重并统一小写；' +
        '3) 最多输出 200 个，按原文出现顺序；' +
        '4) 为每个单词标注最常见词性（n./v./adj./adv./prep. 之一，不确定则省略）。' +
        '只输出 JSON：{"words":[{"word":"example","pos":"n."}]}\n\n材料内容：\n' +
        trimmed,
    },
  ];
  try {
    const response = await llm.invoke(messages, {
      model: 'doubao-seed-2-0-mini-260215',
      temperature: 0.2,
    });
    const parsed = parseWordsJson(response.content);
    if (parsed.length > 0) return parsed;
    console.warn('[recognize] LLM 文本选词结果为空，降级为本地分词');
  } catch (error) {
    console.error('[recognize] LLM 文本选词失败，降级为本地分词', error);
  }
  return extractWordsLocally(trimmed);
}

/** 本地分词降级：正则提取英文单词（基于真实文本内容，过滤常见虚词） */
const LOCAL_STOP_WORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'any', 'can', 'had', 'her', 'was', 'one',
  'our', 'out', 'day', 'get', 'has', 'him', 'his', 'how', 'its', 'new', 'now', 'old', 'see', 'two',
  'way', 'who', 'did', 'why', 'she', 'they', 'them', 'then', 'there', 'these', 'those', 'their',
  'from', 'have', 'this', 'that', 'with', 'what', 'when', 'will', 'your', 'which', 'into', 'only',
  'some', 'than', 'make', 'made', 'more', 'most', 'such', 'over', 'also', 'about', 'after', 'before',
  'a', 'i', 'is', 'it', 'of', 'on', 'or', 'to', 'in', 'be', 'an', 'as', 'at', 'by', 'do', 'he', 'if',
  'no', 'so', 'up', 'us', 'we', 'me', 'my', 'am',
]);

export function extractWordsLocally(text: string): RecognizedWord[] {
  const matches = text.toLowerCase().match(/[a-z][a-z'-]{1,}/g) ?? [];
  const seen = new Set<string>();
  const words: RecognizedWord[] = [];
  for (const raw of matches) {
    const clean = raw.replace(/^['-]+|['-]+$/g, '');
    if (clean.length < 3 || seen.has(clean) || LOCAL_STOP_WORDS.has(clean)) continue;
    seen.add(clean);
    words.push({ word: clean });
    if (words.length >= 250) break;
  }
  return words;
}

/** 通过搜索引擎 + LLM 提炼 1-2 个简洁中文释义（; 分隔） */
export async function refineTranslation(word: string): Promise<string> {
  let searchContext = '';
  try {
    const result = await searchClient.webSearch(`${word} 英语单词 中文意思 释义`, 5);
    if (result?.web_items?.length) {
      searchContext = result.web_items
        .slice(0, 5)
        .map((item) => `${item.title ?? ''} ${item.snippet ?? ''}`.trim())
        .filter(Boolean)
        .join('\n')
        .slice(0, 2500);
      console.info(`[translate] word=${word} 搜索成功, context长度=${searchContext.length}`);
    } else {
      console.warn(`[translate] word=${word} 搜索无结果`);
    }
  } catch (error) {
    console.error(`[translate] 搜索失败 word=${word}`, error);
  }

  const messages: Message[] = [
    {
      role: 'system',
      content: '你是英汉词典编辑，负责给出权威简洁的中文释义。只输出释义文本，不要解释。',
    },
    {
      role: 'user',
      content:
        `请为英文单词 "${word}" 给出 1-2 个最常见的中文释义。要求：\n` +
        '1) 每个释义尽量 2-6 个字，简洁准确；\n' +
        '2) 多个释义之间用「;」分隔，写在一行内；\n' +
        '3) 不要带词性标注，不要序号，不要句号。\n' +
        (searchContext ? `参考搜索结果：\n${searchContext}` : '无搜索结果，请依据你的词典知识给出。'),
    },
  ];
  const response = await llm.invoke(messages, {
    model: 'doubao-seed-2-0-mini-260215',
    temperature: 0.2,
  }).catch(async (error: unknown) => {
    console.error(`[translate] word=${word} LLM 释义提炼失败`, error);
    return { content: '' };
  });
  const translation = (response.content ?? '').trim().split('\n')[0].trim();
  if (translation) return translation.slice(0, 80);
  // LLM 不可用时，从真实搜索结果中直接提取释义
  const fallback = extractTranslationFromSearch(searchContext);
  if (fallback) {
    console.info(`[translate] word=${word} 使用搜索结果提取释义: ${fallback}`);
  }
  return fallback;
}

/** 从搜索结果文本中直接提取中文释义（降级路径，基于真实搜索数据） */
export function extractTranslationFromSearch(searchContext: string): string {
  if (!searchContext) return '';
  for (const line of searchContext.split('\n')) {
    // 匹配词典式释义片段，如 "n. 意外发现；机缘巧合" / "adj. 短暂的, 朝生暮死的"
    const posMatch = line.match(/\b(?:n|v|adj|adv|vt|vi|prep)\.\s*([\u4e00-\u9fa5][\u4e00-\u9fa5;；、,，\s]{1,30})/);
    if (posMatch) {
      return posMatch[1]
        .replace(/[;；]\s*/g, '; ')
        .replace(/[、,，]\s*/g, '; ')
        .replace(/[\s;]+$/, '')
        .slice(0, 40);
    }
  }
  return '';
}

/** 从 FetchClient 响应中提取纯文本 */
export function extractTextFromFetchResponse(content: Array<{ type: string; text?: string }>): string {
  return content
    .filter((item) => item.type === 'text' && item.text)
    .map((item) => item.text as string)
    .join('\n');
}

/** 当天 0 点（本地时区） */
export function startOfToday(): Date {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now;
}

/** 日期键（YYYY-MM-DD，本地时区），用于历史记录分组与连续天数 */
export function dayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
