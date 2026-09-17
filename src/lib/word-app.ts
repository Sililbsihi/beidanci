import { Config, FetchClient, LLMClient, S3Storage } from 'coze-coding-dev-sdk';
import type { Message } from 'coze-coding-dev-sdk';

export type RecognizedWord = { word: string; pos?: string; translation?: string };

/**
 * SDK 客户端一律惰性初始化（首次请求时才创建）。
 * 原因：Next.js 生产构建收集页面数据时会执行 API 路由模块的顶层代码，
 * 构建环境没有 COZE_API_TOKEN，顶层 new 会导致构建失败（Failed to collect page data）。
 */
let sdkConfig: Config | null = null;
let storageInstance: S3Storage | null = null;
let llmInstance: LLMClient | null = null;
let fetchClientInstance: FetchClient | null = null;

function getSdkConfig(): Config {
  if (!sdkConfig) sdkConfig = new Config();
  return sdkConfig;
}

/** 对象存储客户端（临时文件上传 / 读取 / 删除） */
export function getStorage(): S3Storage {
  if (!storageInstance) {
    storageInstance = new S3Storage({
      endpointUrl: process.env.COZE_BUCKET_ENDPOINT_URL,
      accessKey: '',
      secretKey: '',
      bucketName: process.env.COZE_BUCKET_NAME,
      region: 'cn-beijing',
    });
  }
  return storageInstance;
}

/** LLM 客户端（图片 OCR / 文本选词 / 释义提炼） */
export function getLLM(): LLMClient {
  if (!llmInstance) llmInstance = new LLMClient(getSdkConfig());
  return llmInstance;
}

/** URL 内容抓取客户端（PDF / Office 文档解析） */
export function getFetchClient(): FetchClient {
  if (!fetchClientInstance) fetchClientInstance = new FetchClient(getSdkConfig());
  return fetchClientInstance;
}

/**
 * words 表新列（target_recite / import_count）探测缓存：null=未探测，true/false=结果。
 * 进程内缓存，重新部署/重启后自动重新探测——用户在 Supabase 执行过 ALTER TABLE 后自动启用新功能。
 */
let wordsNewColumns: boolean | null = null;

export function wordsNewColumnsReady(): boolean {
  return wordsNewColumns === true;
}

/** 探测 words 表是否已包含重复导入/导入次数统计所需的新列，未建列时调用方走旧逻辑降级 */
export async function probeWordsNewColumns(client: unknown): Promise<boolean> {
  const c = client as {
    from: (table: string) => { select: (cols: string) => { limit: (n: number) => Promise<{ error: { message: string } | null }> } };
  };
  if (wordsNewColumns !== null) return wordsNewColumns;
  try {
    const { error } = await c.from('words').select('target_recite, import_count').limit(1);
    wordsNewColumns = !error;
  } catch {
    wordsNewColumns = false;
  }
  if (!wordsNewColumns) {
    console.warn('[schema] words 表缺少 target_recite/import_count 列，重复导入与导入次数统计降级为旧行为');
  }
  return wordsNewColumns;
}

let wordsStarred: boolean | null = null;

/** 星标字段就绪（用户在 Supabase 执行过 starred 迁移 SQL 后为 true） */
export function wordsStarredReady(): boolean {
  return wordsStarred === true;
}

/** 探测 words 表是否已包含 starred 列，未建列时星标功能降级隐藏 */
export async function probeWordsStarred(client: unknown): Promise<boolean> {
  const c = client as {
    from: (table: string) => { select: (cols: string) => { limit: (n: number) => Promise<{ error: { message: string } | null }> } };
  };
  if (wordsStarred !== null) return wordsStarred;
  try {
    const { error } = await c.from('words').select('starred').limit(1);
    wordsStarred = !error;
  } catch {
    wordsStarred = false;
  }
  if (!wordsStarred) {
    console.warn('[schema] words 表缺少 starred 列，星标功能降级隐藏');
  }
  return wordsStarred;
}

let wordsPhonetic: boolean | null = null;

/** 音标字段就绪（用户在 Supabase 执行过 phonetic 迁移 SQL 后为 true） */
export function wordsPhoneticReady(): boolean {
  return wordsPhonetic === true;
}

/** 探测 words 表是否已包含 phonetic 列，未建列时音标功能降级隐藏（不显示、不回写） */
export async function probeWordsPhonetic(client: unknown): Promise<boolean> {
  const c = client as {
    from: (table: string) => { select: (cols: string) => { limit: (n: number) => Promise<{ error: { message: string } | null }> } };
  };
  if (wordsPhonetic !== null) return wordsPhonetic;
  try {
    const { error } = await c.from('words').select('phonetic').limit(1);
    wordsPhonetic = !error;
  } catch {
    wordsPhonetic = false;
  }
  if (!wordsPhonetic) {
    console.warn('[schema] words 表缺少 phonetic 列，音标功能降级隐藏');
  }
  return wordsPhonetic;
}

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
        .replace(/[^a-z0-9\s'-]/g, '')
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

/** 词表图片 OCR 单次调用：紧凑字符串数组输出，降低长列表 token 消耗与解析断裂风险 */
async function imageOcrOnce(dataUri: string, partLabel: string): Promise<string[]> {
  const messages: Message[] = [
    {
      role: 'system',
      content:
        '你是专业的英文 OCR 词汇提取助手，尤其擅长识别多栏排版的英文词汇列表。只输出 JSON 数组，不要输出任何其他文字。',
    },
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text:
            `这是${partLabel}英文词汇列表图片（常见为 3-4 栏排版）。请逐栏逐条精准识别：` +
            '1) 从左到右、自上而下，不遗漏任何条目；' +
            '2) 多词短语（如 ocean energy、4 times、fossil fuels）必须整体保留为一个条目；' +
            '3) 数字开头的短语（如 4 times、150,000 homes）保留数字；' +
            '4) 条目统一小写，保留原始拼写，宁多勿漏；' +
            '5) 忽略页码、装饰符号与纯数字条目。' +
            '只输出 JSON 字符串数组（不要对象、不要词性）：["apple","ocean energy","4 times"]',
        },
        { type: 'image_url', image_url: { url: dataUri, detail: 'high' } },
      ],
    },
  ];
  const response = await getLLM().invoke(messages, {
    model: 'doubao-seed-2-0-pro-260215',
    temperature: 0.05,
  });
  return parseWordsArray(response.content);
}

/** 解析紧凑字符串数组（兼容对象数组与裸文本兜底） */
function parseWordsArray(content: string): string[] {
  try {
    const text = String(content ?? '');
    const start = text.indexOf('[');
    const end = text.lastIndexOf(']');
    if (start === -1 || end === -1 || end <= start) return [];
    const parsed: unknown = JSON.parse(text.slice(start, end + 1));
    if (!Array.isArray(parsed)) return [];
    const out: string[] = [];
    for (const item of parsed) {
      if (typeof item === 'string') out.push(item);
      else if (item && typeof item === 'object' && typeof (item as { word?: unknown }).word === 'string') {
        out.push((item as { word: string }).word);
      }
    }
    return out;
  } catch {
    return [];
  }
}

/** 清洗单个词条：保留字母/数字/空格/连字符/撇号；至少 2 个字母；过滤纯数字 */
function sanitizeWord(raw: string): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length < 2 || cleaned.length > 40) return '';
  const letterCount = (cleaned.match(/[a-z]/g) ?? []).length;
  if (letterCount < 2) return '';
  return cleaned;
}

/** 图片识别：整图 + 上下分块三路并行 OCR，并集合并去重 + 1.5x 上采样，最大化密集词表的识别完整率 */
export async function extractWordsFromImage(base64: string, mime: string): Promise<RecognizedWord[]> {
  const seen = new Set<string>();
  const words: RecognizedWord[] = [];
  const addWords = (items: string[]) => {
    for (const raw of items) {
      const cleaned = sanitizeWord(raw);
      if (!cleaned || seen.has(cleaned)) continue;
      seen.add(cleaned);
      words.push({ word: cleaned });
    }
  };

  // 生成识别分块：整图 + 上下两块（14% 重叠避免切断行）；统一 1.5x 上采样增强小字清晰度（原图较宽则跳过放大）
  const chunks: { dataUri: string; label: string }[] = [];
  try {
    const { default: sharp } = await import('sharp');
    const buffer = Buffer.from(base64, 'base64');
    const meta = await sharp(buffer).metadata();
    const targetWidth = meta.width && meta.width < 1200 ? Math.round(meta.width * 1.5) : meta.width;
    const upscale = async (buf: Buffer) => {
      const png = await sharp(buf).png().toBuffer();
      const resized = targetWidth && targetWidth !== meta.width ? await sharp(png).resize({ width: targetWidth }).png().toBuffer() : png;
      return `data:image/png;base64,${resized.toString('base64')}`;
    };
    chunks.push({ dataUri: await upscale(buffer), label: '整图' });
    if (meta.height && meta.height >= 480 && meta.width) {
      const cut = Math.round(meta.height * 0.57);
      const overlap = Math.round(meta.height * 0.14);
      const topBuf = await sharp(buffer).extract({ left: 0, top: 0, width: meta.width, height: cut + overlap }).png().toBuffer();
      const bottomBuf = await sharp(buffer)
        .extract({ left: 0, top: Math.max(0, cut - overlap), width: meta.width, height: meta.height - (cut - overlap) })
        .png()
        .toBuffer();
      chunks.push({ dataUri: await upscale(topBuf), label: '上半部分' });
      chunks.push({ dataUri: await upscale(bottomBuf), label: '下半部分' });
    }
  } catch (error) {
    console.warn('[recognize] 图片分块失败，仅整图识别', error);
    if (chunks.length === 0) chunks.push({ dataUri: `data:${mime};base64,${base64}`, label: '整图' });
  }

  // 三路并行识别，并集合并去重
  const results = await Promise.allSettled(chunks.map((c) => imageOcrOnce(c.dataUri, c.label)));
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') addWords(r.value);
    else console.error(`[recognize] ${chunks[i].label} OCR 失败`, r.reason);
  });

  if (words.length === 0) {
    throw new Error('未能从图片中识别出英文词条，请确认图片清晰且包含英文词汇');
  }
  return words;
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
    const response = await getLLM().invoke(messages, {
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

export interface TranslationEntry {
  translation: string;
  phonetic: string;
}

/** 批量 LLM 直译：小批次 + 并发池（单批输出 ~10 条释义保证秒级返回，N/12 批最多 16 路并发），同时输出美式 IPA 音标 */
export async function translateWordsBatch(words: string[]): Promise<Map<string, TranslationEntry>> {
  const result = new Map<string, TranslationEntry>();
  // 去重 + 归一化：重复词只翻一次
  const unique = Array.from(
    new Set(words.map((w) => w.trim().toLowerCase()).filter(Boolean)),
  );
  if (unique.length === 0) return result;

  const CHUNK = 12;
  const batches: string[][] = [];
  for (let i = 0; i < unique.length; i += CHUNK) {
    batches.push(unique.slice(i, i + CHUNK));
  }

  // 并发池：固定 worker 数消费批次队列，避免大批量时无上限并发触发限流
  let cursor = 0;
  const worker = async () => {
    while (cursor < batches.length) {
      const batch = batches[cursor];
      cursor += 1;
      try {
        const pairs = await translateChunk(batch);
        for (const [word, entry] of pairs) {
          if (entry.translation || entry.phonetic) result.set(word, entry);
        }
      } catch (error) {
        console.warn('[translate] 批量释义批次失败:', error);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(batches.length, 16) }, () => worker()));
  return result;
}

/** 单批直译：一次 LLM 调用输出该批全部释义与音标 */
async function translateChunk(batch: string[]): Promise<Map<string, TranslationEntry>> {
  const messages: Message[] = [
    { role: 'system', content: '你是英汉词典数据库，只输出 JSON 数组，不要输出任何其他文字。' },
    {
      role: 'user',
      content:
        `为下列 ${batch.length} 个英文单词或短语各给出 1-2 个最常见的简体中文释义和美式音标。要求：\n` +
        '1) 每个释义 2-6 个字，简洁准确；多词短语给出整体含义（如 fossil fuels → 化石燃料）；\n' +
        '2) 多个释义用「;」分隔，不带词性标注、不带序号、不带句号；\n' +
        '3) phonetic 为该词的美式 IPA 音标，不含斜杠、不含空格分隔的强调点可保留（如 ˈ）；不确定时给空字符串，严禁编造；\n' +
        '4) 只输出 JSON 数组，格式：[{"word":"原词","translation":"释义","phonetic":"音标"}]，word 必须与输入完全一致，不得遗漏。\n' +
        `词表：${JSON.stringify(batch)}`,
    },
  ];
  const response = await getLLM().invoke(messages, {
    model: 'doubao-seed-2-0-mini-260215',
    temperature: 0.1,
  });
  return parseTranslationPairs(String(response.content ?? ''));
}

/** 解析批量释义+音标 JSON 输出（兼容围栏代码块与截断容错；phonetic 为可选字段，兼容旧格式输出） */
function parseTranslationPairs(content: string): Map<string, TranslationEntry> {
  const map = new Map<string, TranslationEntry>();
  let raw = String(content ?? '').trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) raw = fenced[1].trim();
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) return map;
  try {
    const parsed: unknown = JSON.parse(raw.slice(start, end + 1));
    if (!Array.isArray(parsed)) return map;
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const rec = item as { word?: unknown; translation?: unknown; phonetic?: unknown };
      if (typeof rec.word !== 'string') continue;
      const key = rec.word.trim().toLowerCase();
      const translation = typeof rec.translation === 'string' ? rec.translation.trim() : '';
      const phonetic =
        typeof rec.phonetic === 'string' ? rec.phonetic.trim().replace(/^\/+|\/+$/g, '').slice(0, 60) : '';
      if (key && (translation || phonetic)) map.set(key, { translation, phonetic });
    }
  } catch {
    // JSON 解析失败：返回空 Map，调用方按无释义兜底
  }
  return map;
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
