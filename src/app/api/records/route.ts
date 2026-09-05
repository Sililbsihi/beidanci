import { NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { startOfToday, dayKey } from '@/lib/word-app';

export const runtime = 'nodejs';

interface WordRow {
  id: number;
  word: string;
  pos: string | null;
  translation: string | null;
  recite_count: number;
  total_typed: number;
  recited_at: string | null;
}

interface RecordRow {
  word: string;
  session_no: number;
  created_at: string;
}

interface UploadFileRow {
  filename: string;
  status: string;
}

/** GET /api/records 背诵统计 + 今日记录 + 历史记录（按日期分组） + 临时文件状态 */
export async function GET() {
  try {
    const client = getSupabaseClient();

    const [wordsRes, recordsRes, filesRes] = await Promise.all([
      client
        .from('words')
        .select('id, word, pos, translation, recite_count, total_typed, recited_at')
        .order('created_at', { ascending: false })
        .limit(500),
      client
        .from('practice_records')
        .select('word, session_no, created_at')
        .eq('round_index', 3)
        .order('created_at', { ascending: false })
        .limit(300),
      client
        .from('upload_files')
        .select('filename, status')
        .order('created_at', { ascending: false })
        .limit(30),
    ]);
    if (wordsRes.error) throw new Error(`查询单词失败: ${wordsRes.error.message}`);
    if (recordsRes.error) throw new Error(`查询记录失败: ${recordsRes.error.message}`);
    if (filesRes.error) throw new Error(`查询临时文件失败: ${filesRes.error.message}`);

    const words = (wordsRes.data ?? []) as WordRow[];
    const records = (recordsRes.data ?? []) as RecordRow[];
    const files = (filesRes.data ?? []) as UploadFileRow[];

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

    return NextResponse.json({
      stats: {
        totalWords: words.length,
        totalRecites,
        streakDays: streak,
        todayCount: todayWords.length,
      },
      today: todayWords.slice(0, 50),
      history: history.slice(0, 10),
      files: files.slice(0, 10),
    });
  } catch (error) {
    console.error('[records] 查询失败', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : '查询失败' }, { status: 500 });
  }
}
