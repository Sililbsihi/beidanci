import { NextResponse } from 'next/server';
import { ONLINE_WINDOW_SEC, requireAccount } from '@/lib/auth';
import { getSupabaseClient } from '@/storage/database/supabase-client';

export const dynamic = 'force-dynamic';

/** 全站统计（仅站长）：账号数/在线数/总词数/总背诵/今日识别/待审留言 */
export async function GET() {
  const ctx = await requireAccount();
  if (!ctx) return NextResponse.json({ error: '未登录' }, { status: 401 });
  if (ctx.account.role !== 'admin') return NextResponse.json({ error: '仅站长可查看' }, { status: 403 });

  const c = getSupabaseClient();
  const nowIso = new Date().toISOString();
  const windowStart = new Date(Date.now() - ONLINE_WINDOW_SEC * 1000).toISOString();
  const today = new Date().toLocaleDateString('en-CA');
  const todayStart = `${today}T00:00:00`;

  const countOf = async (table: string, filters?: Array<[string, string]>) => {
    let q = c.from(table).select('*', { count: 'exact', head: true });
    for (const [col, val] of filters ?? []) q = q.eq(col, val);
    const { count, error } = await q;
    return error ? -1 : count || 0;
  };

  const [accounts, online, words, recites, pendingFeedback, adminRows] = await Promise.all([
    countOf('accounts', [['status', 'active']]),
    countOf('sessions', []),
    countOf('words'),
    countOf('practice_records', [['round_index', '3']]),
    countOf('feedback_messages', [['status', 'pending']]),
    c
      .from('accounts')
      .select('id, username, role, status, display_name, recognize_date, recognize_count')
      .order('id', { ascending: true })
      .limit(200),
  ]);

  const rows = (adminRows.data ?? []) as Array<{ id: number; recognize_date: string | null; recognize_count: number | null }>;
  const recognizedToday = rows.reduce((sum, r) => sum + (r.recognize_date === today ? r.recognize_count || 0 : 0), 0);

  // 今日完成背诵轮数（recited_at 今天）
  const { count: todayRecites, error: trErr } = await c
    .from('practice_records')
    .select('*', { count: 'exact', head: true })
    .eq('round_index', 3)
    .gte('created_at', todayStart);

  return NextResponse.json({
    accounts,
    online: trErr ? -1 : online,
    totalWords: words,
    totalRecites: recites,
    todayRecites: todayRecites || 0,
    recognizedToday,
    pendingFeedback,
  });
}
