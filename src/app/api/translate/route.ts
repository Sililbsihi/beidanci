import { NextRequest, NextResponse } from 'next/server';
import { translateWordsBatch } from '@/lib/word-app';
import { getSupabaseClient } from '@/storage/database/supabase-client';

export const runtime = 'nodejs';
export const maxDuration = 120;

interface TranslationResult {
  word: string;
  translation: string;
  source: 'search' | 'none';
}

/** POST /api/translate 批量 LLM 直译补齐缺失释义（1-2 个，; 分隔），完成后直接回写 words 表 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { words?: string[]; persist?: boolean };
    const words = (body.words ?? [])
      .filter((w) => typeof w === 'string')
      .map((w) => w.trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 600);
    if (words.length === 0) {
      return NextResponse.json({ translations: [] });
    }

    // 小批次 + 16 路并发池直译：100 词约 9 批并发 ≈ 3 秒，500 词约 42 批 ≈ 5 秒
    const map = await translateWordsBatch(words);
    const results: TranslationResult[] = words.map((word) => {
      const translation = map.get(word) ?? '';
      if (!translation) console.warn(`[translate] word=${word} 释义为空`);
      return { word, translation, source: translation ? 'search' : 'none' };
    });

    // 默认把翻译结果直接回写 words 表（只补空释义，不覆盖已有内容），前端无需逐词 PATCH
    if (body.persist !== false) {
      void persistTranslations(results);
    }

    return NextResponse.json({ translations: results });
  } catch (error) {
    console.error('[translate] 释义匹配失败', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : '释义匹配失败' }, { status: 500 });
  }
}

/** 把有释义的词写回 words 表：每波 20 个并发，不阻塞响应（响应先行，回写异步收尾） */
async function persistTranslations(results: TranslationResult[]): Promise<void> {
  const hits = results.filter((r) => r.translation);
  if (hits.length === 0) return;
  const client = getSupabaseClient();
  const WAVE = 20;
  for (let i = 0; i < hits.length; i += WAVE) {
    const wave = hits.slice(i, i + WAVE);
    const settled = await Promise.allSettled(
      wave.map((hit) =>
        client
          .from('words')
          .update({ translation: hit.translation, translation_source: 'search' })
          .eq('word', hit.word)
          // 只补空释义（库里无释义时为 NULL 或空串），不覆盖已有内容
          .or('translation.is.null,translation.eq.'),
      ),
    );
    for (const item of settled) {
      if (item.status === 'rejected') {
        console.warn('[translate] 释义回写失败:', item.reason);
      }
    }
  }
}
