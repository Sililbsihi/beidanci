import { NextRequest, NextResponse } from 'next/server';
import { getLLM } from '@/lib/word-app';

export const runtime = 'nodejs';
export const maxDuration = 60;

interface WordDetail {
  etymology: string;
  roots: string[];
  sentence: string;
  play: string;
  character: string;
  sentenceTranslation: string;
}

const EMPTY_DETAIL: WordDetail = { etymology: '', roots: [], sentence: '', play: '', character: '', sentenceTranslation: '' };

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
    };
  } catch {
    return EMPTY_DETAIL;
  }
}

/** POST /api/word-detail 生成单词的词源、词根与一段话剧/音乐剧台词 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { word?: string };
    const word = (body.word ?? '').trim().toLowerCase();
    if (!word || word.length > 40) {
      return NextResponse.json({ error: '缺少有效的单词' }, { status: 400 });
    }

    const messages = [
      { role: 'system' as const, content: '你是一位词源学教授，同时是话剧与音乐剧百科全书。只输出 JSON，不要输出任何其他文字。' },
      {
        role: 'user' as const,
        content:
          `请为英文单词 "${word}" 生成以下内容：\n` +
          '1) etymology：用中文写 1-2 句这个词的词源故事（来自哪种语言、原始含义、如何演变至今），简洁有趣\n' +
          '2) roots：词根/词缀拆解数组，每项格式如 "ser-（捆绑、连在一起）"，若无明显词根可给出记忆联想拆解\n' +
          '3) sentence：一句包含该单词的英文台词，必须出自一部真实存在的话剧或音乐剧（莎士比亚剧作、百老汇或西区音乐剧等），语言要有台词的韵味\n' +
          '4) play：该剧目的中文译名\n' +
          '5) character：说出这句台词的角色名\n' +
          '6) sentenceTranslation：台词的中文翻译\n' +
          '只输出 JSON 对象：{"etymology":"","roots":[""],"sentence":"","play":"","character":"","sentenceTranslation":""}',
      },
    ];

    const response = await getLLM().invoke(messages, {
      model: 'doubao-seed-2-0-mini-260215',
      temperature: 0.7,
    });

    const detail = parseDetailJson(String(response.content ?? ''));
    if (!detail.etymology && !detail.sentence) {
      return NextResponse.json({ error: '词源生成失败，请稍后再试' }, { status: 502 });
    }
    return NextResponse.json({ detail });
  } catch (error) {
    console.error('[word-detail] 生成失败', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : '生成失败' }, { status: 500 });
  }
}
