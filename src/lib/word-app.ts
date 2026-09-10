import { Config, FetchClient, LLMClient, SearchClient, S3Storage } from 'coze-coding-dev-sdk';
import type { Message } from 'coze-coding-dev-sdk';

export type RecognizedWord = { word: string; pos?: string };

/**
 * SDK 客户端一律惰性初始化（首次请求时才创建）。
 * 原因：Next.js 生产构建收集页面数据时会执行 API 路由模块的顶层代码，
 * 构建环境没有 COZE_API_TOKEN，顶层 new 会导致构建失败（Failed to collect page data）。
 */
let sdkConfig: Config | null = null;
let storageInstance: S3Storage | null = null;
let llmInstance: LLMClient | null = null;
let fetchClientInstance: FetchClient | null = null;
let searchClientInstance: SearchClient | null = null;

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

/** 搜索客户端（无释义单词的中文释义匹配） */
export function getSearchClient(): SearchClient {
  if (!searchClientInstance) searchClientInstance = new SearchClient(getSdkConfig());
  return searchClientInstance;
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

/** 通过搜索引擎 + LLM 提炼 1-2 个简洁中文释义（; 分隔） */
export async function refineTranslation(word: string): Promise<string> {
  let searchContext = '';
  try {
    const result = await getSearchClient().webSearch(`${word} 英语单词 中文意思 释义`, 5);
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
  const response = await getLLM().invoke(messages, {
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
