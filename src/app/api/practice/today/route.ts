import { NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

export const runtime = 'nodejs';

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
  created_at: string;
}

/** GET /api/practice/today 今日待背队列：练习中 > 待开始 > 已完成，返回进度统计 */
export async function GET() {
  try {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('words')
      .select('id, word, pos, translation, translation_source, source_file, batch_id, correct_round, recite_count, total_typed, status, created_at')
      .order('id', { ascending: true })
      .limit(200);
    if (error) throw new Error(`查询队列失败: ${error.message}`);

    const words = (data ?? []) as WordRow[];

    const done = words.filter((w) => w.recite_count >= 1).length;
    return NextResponse.json({
      words,
      stats: { total: words.length, done },
    });
  } catch (error) {
    console.error('[practice/today] 查询失败', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : '查询失败' }, { status: 500 });
  }
}
