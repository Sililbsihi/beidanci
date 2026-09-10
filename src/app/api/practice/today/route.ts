import { NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { probeWordsNewColumns } from '@/lib/word-app';

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
  target_recite?: number;
  created_at: string;
  /** 服务端计算的完成态：recite_count 是否达到本轮目标（重复导入后目标提升，需再背一遍） */
  _done: boolean;
}

/**
 * GET /api/practice/today 今日待背队列
 * - 排序：未背完的（practicing/pending）在前且新加入的排最上方（id 降序），已背完的排最后
 * - 全量返回：limit 会把最新加入的词（id 最大、排在末尾）截掉，导致"加入后背诵页看不到"
 * - stats：total/done/remaining + 最近一次导入批次（导入词数、其中已背数）
 */
export async function GET() {
  try {
    const client = getSupabaseClient();
    const hasNewColumns = await probeWordsNewColumns(client);

    const selectCols = hasNewColumns
      ? 'id, word, pos, translation, translation_source, source_file, batch_id, correct_round, recite_count, total_typed, status, target_recite, created_at'
      : 'id, word, pos, translation, translation_source, source_file, batch_id, correct_round, recite_count, total_typed, status, created_at';

    const { data, error } = await client.from('words').select(selectCols).order('id', { ascending: true });
    if (error) throw new Error(`查询队列失败: ${error.message}`);

    const rows = (data ?? []) as unknown as WordRow[];

    // 完成判定：新列就绪时比较本轮目标遍数（重复导入会提升目标），旧结构按"至少背完一遍"
    const isDone = (w: WordRow) => (hasNewColumns ? w.recite_count >= (w.target_recite ?? 1) : w.recite_count >= 1);
    const words: WordRow[] = rows.map((w) => ({ ...w, _done: isDone(w) }));

    // 未背完的在前（新加入的 id 最大排最上方），已背完的排最后
    words.sort((a, b) => Number(a._done) - Number(b._done) || b.id - a.id);

    const done = words.filter((w) => w._done).length;

    // 最近一次导入批次：按 created_at 最新的词所属 batch，统计该批词数与已背数
    let latestBatch: { total: number; done: number } | null = null;
    const withBatch = words.filter((w) => w.batch_id);
    if (withBatch.length > 0) {
      const latest = withBatch.reduce((acc, w) => (new Date(w.created_at) > new Date(acc.created_at) ? w : acc), withBatch[0]);
      const batchWords = words.filter((w) => w.batch_id === latest.batch_id);
      latestBatch = { total: batchWords.length, done: batchWords.filter((w) => w._done).length };
    }

    return NextResponse.json({
      words,
      stats: { total: words.length, done, remaining: words.length - done, latestBatch },
    });
  } catch (error) {
    console.error('[practice/today] 查询失败', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : '查询失败' }, { status: 500 });
  }
}
