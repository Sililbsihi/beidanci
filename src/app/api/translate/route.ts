import { NextRequest, NextResponse } from 'next/server';
import { refineTranslation } from '@/lib/word-app';

export const runtime = 'nodejs';
export const maxDuration = 120;

interface TranslationResult {
  word: string;
  translation: string;
  source: 'search' | 'none';
}

/** POST /api/translate 批量为无释义单词搜索中文释义（1-2 个，; 分隔） */
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

    // 分批并发（每批 4 个），避免并发过高触发限流
    const results: TranslationResult[] = [];
    for (let i = 0; i < words.length; i += 4) {
      const batch = words.slice(i, i + 4);
      const settled = await Promise.allSettled(batch.map((word) => refineTranslation(word)));
      settled.forEach((item, index) => {
        const word = batch[index];
        if (item.status === 'rejected') {
          console.error(`[translate] word=${word} 释义提炼失败:`, item.reason);
        }
        const translation = item.status === 'fulfilled' ? item.value : '';
        if (!translation) {
          console.warn(`[translate] word=${word} 释义为空 (status=${item.status})`);
        }
        results.push({ word, translation, source: translation ? 'search' : 'none' });
      });
    }

    return NextResponse.json({ translations: results });
  } catch (error) {
    console.error('[translate] 释义匹配失败', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : '释义匹配失败' }, { status: 500 });
  }
}
