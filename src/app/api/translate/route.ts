import { NextRequest, NextResponse } from 'next/server';
import { translateWordsBatch } from '@/lib/word-app';

export const runtime = 'nodejs';
export const maxDuration = 120;

interface TranslationResult {
  word: string;
  translation: string;
  source: 'search' | 'none';
}

/** POST /api/translate 批量 LLM 直译补齐缺失释义（1-2 个，; 分隔） */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { words?: string[] };
    const words = (body.words ?? [])
      .filter((w) => typeof w === 'string')
      .map((w) => w.trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 30);
    if (words.length === 0) {
      return NextResponse.json({ translations: [] });
    }

    // 一次调用批量直译（每批 40 词并行），替代旧的逐词搜索+提炼
    const map = await translateWordsBatch(words);
    const results: TranslationResult[] = words.map((word) => {
      const translation = map.get(word) ?? '';
      if (!translation) console.warn(`[translate] word=${word} 释义为空`);
      return { word, translation, source: translation ? 'search' : 'none' };
    });

    return NextResponse.json({ translations: results });
  } catch (error) {
    console.error('[translate] 释义匹配失败', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : '释义匹配失败' }, { status: 500 });
  }
}
