import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

export const runtime = 'nodejs';

interface WordItem {
  word: string;
  pos?: string;
  translation?: string;
  translation_source?: string;
  source_file?: string;
  batchId?: string;
}

interface WordRow {
  id: number;
  word: string;
  pos: string | null;
  translation: string | null;
  translation_source: string;
  source_file: string | null;
  batch_id: string | null;
  correct_round: number;
  recite_count: number;
  total_typed: number;
  status: string;
  recited_at: string | null;
  created_at: string;
}

/** GET /api/words 全部单词列表（识别校对页使用） */
export async function GET() {
  try {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('words')
      .select('id, word, pos, translation, translation_source, source_file, batch_id, correct_round, recite_count, total_typed, status, recited_at, created_at')
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) throw new Error(`查询单词失败: ${error.message}`);
    return NextResponse.json({ words: (data ?? []) as WordRow[] });
  } catch (error) {
    console.error('[words:GET] 查询失败', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : '查询失败' }, { status: 500 });
  }
}

/** POST /api/words 校对完成，批量加入背诵（相同单词自动去重） */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { batchId?: string; items?: WordItem[] };
    const items = body.items ?? [];
    if (items.length === 0) {
      return NextResponse.json({ error: '没有可加入的单词' }, { status: 400 });
    }

    const client = getSupabaseClient();

    // 规范化 + 去重
    const normalized = new Map<string, WordItem>();
    for (const item of items) {
      // 保留空格与连字符，支持多词短语（如 ocean energy）
      const word = typeof item.word === 'string' ? item.word.trim().toLowerCase().replace(/[^a-z\s'-]/g, '').replace(/\s+/g, ' ').trim() : '';
      if (word.length < 1 || word.length > 40 || normalized.has(word)) continue;
      normalized.set(word, { ...item, word });
    }
    if (normalized.size === 0) {
      return NextResponse.json({ error: '没有有效的英文单词' }, { status: 400 });
    }

    // 查重：词库中已存在的单词跳过（避免重复背诵队列冗余）
    const wordList = [...normalized.keys()];
    const { data: existing, error: existError } = await client
      .from('words')
      .select('word')
      .in('word', wordList);
    if (existError) throw new Error(`查重失败: ${existError.message}`);
    const existingSet = new Set((existing ?? []).map((row) => (row as { word: string }).word));

    const toInsert = [...normalized.values()]
      .filter((item) => !existingSet.has(item.word))
      .map((item) => ({
        word: item.word,
        pos: item.pos?.slice(0, 20) ?? null,
        translation: item.translation?.slice(0, 200) || null,
        translation_source: ['search', 'manual'].includes(item.translation_source ?? '') ? (item.translation_source as string) : 'upload',
        source_file: item.source_file?.slice(0, 250) ?? null,
        batch_id: (item.batchId ?? body.batchId)?.slice(0, 36) ?? null,
        status: 'pending',
      }));

    if (toInsert.length > 0) {
      const { error: insertError } = await client.from('words').insert(toInsert);
      if (insertError) throw new Error(`加入背诵失败: ${insertError.message}`);
    }

    return NextResponse.json({ added: toInsert.length, skipped: normalized.size - toInsert.length });
  } catch (error) {
    console.error('[words:POST] 加入失败', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : '加入失败' }, { status: 500 });
  }
}
