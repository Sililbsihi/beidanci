import { NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { startOfToday, dayKey, probeWordsNewColumns } from '@/lib/word-app';

export const runtime = 'nodejs';

interface WordRow {
  id: number;
  word: string;
  pos: string | null;
  translation: string | null;
  recite_count: number;
  total_typed: number;
  import_count?: number;
  recited_at: string | null;
}

interface RecordRow {
  word: string;
  session_no: number;
  created_at: string;
}

/** 近 7 天每天：完成背诵轮次数 + 去重单词列表 */
function buildWeekly(records: Array<{ word: string; created_at: string }>): Array<{ date: string; count: number; words: string[] }> {
  const buckets = new Map<string, Set<string>>();
  const counts = new Map<string, number>();
  // 预填最近 7 天，保证趋势图每天都有柱位
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    buckets.set(dayKey(d), new Set());
    counts.set(dayKey(d), 0);
  }
  for (const record of records) {
    const key = dayKey(new Date(record.created_at));
    if (!counts.has(key)) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    buckets.get(key)?.add(record.word);
  }
  return [...counts.entries()].map(([date, count]) => ({
    date,
    count,
    words: [...(buckets.get(date) ?? [])],
  }));
}

/** GET /api/records 背诵统计 + 今日记录 + 历史记录 + 近 7 天趋势 + 趣味排行榜 */
export async function GET() {
  try {
    const client = getSupabaseClient();
    const hasNewColumns = await probeWordsNewColumns(client);

    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 6);
    weekAgo.setHours(0, 0, 0, 0);

    const wordCols = hasNewColumns
      ? 'id, word, pos, translation, recite_count, total_typed, import_count, recited_at'
      : 'id, word, pos, translation, recite_count, total_typed, recited_at';

    const [wordsRes, recordsRes, weekRes, mistakesRes] = await Promise.all([
      client.from('words').select(wordCols).order('created_at', { ascending: false }),
      client.from('practice_records').select('word, session_no, created_at').eq('round_index', 3).order('created_at', { ascending: false }).limit(300),
      client.from('practice_records').select('word, created_at').eq('round_index', 3).gte('created_at', weekAgo.toISOString()).order('created_at', { ascending: false }).limit(2000),
      client.from('practice_records').select('word, created_at').eq('round_index', 0).order('created_at', { ascending: false }).limit(3000),
    ]);
    if (wordsRes.error) throw new Error(`查询单词失败: ${wordsRes.error.message}`);
    if (recordsRes.error) throw new Error(`查询记录失败: ${recordsRes.error.message}`);
    if (weekRes.error) throw new Error(`查询周趋势失败: ${weekRes.error.message}`);
    if (mistakesRes.error) throw new Error(`查询错误记录失败: ${mistakesRes.error.message}`);

    const words = (wordsRes.data ?? []) as unknown as WordRow[];
    const records = (recordsRes.data ?? []) as RecordRow[];
    const weekRecords = (weekRes.data ?? []) as Array<{ word: string; created_at: string }>;
    const mistakeRecords = (mistakesRes.data ?? []) as Array<{ word: string; created_at: string }>;

    const today = startOfToday();
    const todayWords = words.filter((w) => w.recited_at && new Date(w.recited_at).getTime() >= today.getTime());
    const totalRecites = words.reduce((sum, w) => sum + (w.recite_count ?? 0), 0);

    // 连续背诵天数：从今天（或昨天）起按完成轮次记录的日期连续计数
    const recordDays = new Set(records.map((r) => dayKey(new Date(r.created_at))));
    let streak = 0;
    const cursor = new Date();
    if (!recordDays.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
    while (recordDays.has(dayKey(cursor))) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    }

    // 历史记录按日期分组（每天每轮一条）
    const wordMeta = new Map(words.map((w) => [w.word, w]));
    const history: Array<{ date: string; count: number; items: Array<{ word: string; pos: string | null; translation: string | null; session_no: number }> }> = [];
    for (const record of records) {
      const date = dayKey(new Date(record.created_at));
      let group = history.find((g) => g.date === date);
      if (!group) {
        group = { date, count: 0, items: [] };
        history.push(group);
      }
      const exists = group.items.some((i) => i.word === record.word && i.session_no === record.session_no);
      if (!exists) {
        const meta = wordMeta.get(record.word);
        group.items.push({
          word: record.word,
          pos: meta?.pos ?? null,
          translation: meta?.translation ?? null,
          session_no: record.session_no,
        });
        group.count += 1;
      }
      if (history.length >= 30) break;
    }

    // 排行榜 1：犯错最多（practice_records round_index=0 错误流水按词聚合）
    const mistakeCounts = new Map<string, number>();
    for (const m of mistakeRecords) {
      mistakeCounts.set(m.word, (mistakeCounts.get(m.word) ?? 0) + 1);
    }
    const mistakes = [...mistakeCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([word, count]) => ({ word, count }));

    // 排行榜 2：最长的单词
    const longest = [...words]
      .sort((a, b) => b.word.length - a.word.length)
      .slice(0, 5)
      .map((w) => ({ word: w.word, length: w.word.length }));

    // 排行榜 3：导入重复次数最多（import_count > 1）
    const reimported = hasNewColumns
      ? words
          .filter((w) => (w.import_count ?? 1) > 1)
          .sort((a, b) => (b.import_count ?? 1) - (a.import_count ?? 1))
          .slice(0, 5)
          .map((w) => ({ word: w.word, count: w.import_count ?? 1 }))
      : [];

    return NextResponse.json({
      stats: {
        totalWords: words.length,
        totalRecites,
        streakDays: streak,
        todayCount: todayWords.length,
      },
      today: todayWords.slice(0, 50),
      history: history.slice(0, 10),
      weekly: buildWeekly(weekRecords),
      rankings: { mistakes, longest, reimported },
    });
  } catch (error) {
    console.error('[records] 查询失败', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : '查询失败' }, { status: 500 });
  }
}
