import { NextRequest, NextResponse } from 'next/server';
import { translateWordsBatch, probeWordsPhonetic } from '@/lib/word-app';
import { requireAccount, type AuthContext } from '@/lib/auth';

export const runtime = 'nodejs';
export const maxDuration = 120;

interface TranslationResult {
  word: string;
  translation: string;
  phonetic: string;
  source: 'search' | 'none';
}

/** POST /api/translate 批量 LLM 直译补齐缺失释义（1-2 个，; 分隔）与美式音标，完成后直接回写 words 表 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAccount();
    if (!ctx) return NextResponse.json({ error: '未登录' }, { status: 401 });
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
      const entry = map.get(word);
      const translation = entry?.translation ?? '';
      const phonetic = entry?.phonetic ?? '';
      if (!translation) console.warn(`[translate] word=${word} 释义为空`);
      return { word, translation, phonetic, source: translation ? 'search' : 'none' };
    });

    // 默认把结果直接回写 words 表（只补空字段，不覆盖已有内容），前端无需逐词 PATCH
    if (body.persist !== false) {
      void persistTranslations(results, ctx);
    }

    return NextResponse.json({ translations: results });
  } catch (error) {
    console.error('[translate] 释义匹配失败', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : '释义匹配失败' }, { status: 500 });
  }
}

/** 把有释义/音标的词写回 words 表：先读当前值只补空字段（缺 phonetic 列时自动降级为仅释义），每波 20 个并发 */
async function persistTranslations(results: TranslationResult[], ctx: AuthContext): Promise<void> {
  const hits = results.filter((r) => r.translation || r.phonetic);
  if (hits.length === 0) return;
  const client = ctx.supabase;
  const uid = ctx.account.id;
  const hasPhonetic = await probeWordsPhonetic(client);

  // 读取现有值：仅回填空字段（不覆盖已有释义/音标）
  const existing = new Map<string, { translation: string | null; phonetic?: string | null }>();
  const wordList = hits.map((h) => h.word);
  const READ_WAVE = 100;
  for (let i = 0; i < wordList.length; i += READ_WAVE) {
    const wave = wordList.slice(i, i + READ_WAVE);
    const { data, error } = await client
      .from('words')
      .select(hasPhonetic ? 'word, translation, phonetic' : 'word, translation')
      .eq('user_id', uid)
      .in('word', wave);
    if (error) {
      console.warn('[translate] 读取现有释义失败:', error.message);
      return;
    }
    for (const row of (data ?? []) as unknown as Array<{ word: string; translation: string | null; phonetic?: string | null }>) {
      existing.set(row.word, row);
    }
  }

  const WAVE = 20;
  for (let i = 0; i < hits.length; i += WAVE) {
    const wave = hits.slice(i, i + WAVE);
    const settled = await Promise.allSettled(
      wave.map((hit) => {
        const cur = existing.get(hit.word);
        const patch: Record<string, string> = {};
        if (hit.translation && (!cur || !cur.translation)) {
          patch.translation = hit.translation;
          patch.translation_source = 'search';
        }
        if (hasPhonetic && hit.phonetic && (!cur || !cur.phonetic)) {
          patch.phonetic = hit.phonetic;
        }
        if (Object.keys(patch).length === 0) return Promise.resolve();
        return client.from('words').update(patch).eq('word', hit.word).eq('user_id', uid);
      }),
    );
    for (const item of settled) {
      if (item.status === 'rejected') {
        console.warn('[translate] 释义回写失败:', item.reason);
      }
    }
  }
}
