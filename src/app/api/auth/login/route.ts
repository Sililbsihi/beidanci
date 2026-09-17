import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  SESSION_COOKIE,
  SESSION_TTL_DAYS,
  createSession,
  hashPassword,
  probeAuthReady,
  verifyPassword,
  invalidateAuthReadyCache,
  isOnlineFull,
} from '@/lib/auth';
import { getSupabaseClient } from '@/storage/database/supabase-client';

export const dynamic = 'force-dynamic';

/** 账号体系状态：未初始化（accounts 为空 => 需创建站长账号）/ 正常 */
export async function GET() {
  const ready = await probeAuthReady();
  if (!ready) {
    return NextResponse.json({ mode: 'unready', message: '账号系统初始化中：请站长在 Supabase 执行初始化 SQL 后刷新' });
  }
  const c = getSupabaseClient();
  const { count, error } = await c.from('accounts').select('id', { count: 'exact', head: true });
  if (error) return NextResponse.json({ mode: 'unready', message: '账号系统初始化中' });
  return NextResponse.json({ mode: (count || 0) === 0 ? 'setup' : 'login' });
}

export async function POST(request: NextRequest) {
  let body: { username?: unknown; password?: unknown; mode?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 });
  }

  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const mode = body.mode === 'setup' ? 'setup' : 'login';

  if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) {
    return NextResponse.json({ error: '用户名需为 3-20 位字母/数字/下划线' }, { status: 400 });
  }
  if (password.length < 6 || password.length > 60) {
    return NextResponse.json({ error: '密码需为 6-60 位' }, { status: 400 });
  }

  const ready = await probeAuthReady();
  if (!ready) {
    return NextResponse.json({ error: '账号系统初始化中：请站长在 Supabase 执行初始化 SQL 后再试' }, { status: 503 });
  }

  const c = getSupabaseClient();
  const { data: row, error } = await c
    .from('accounts')
    .select('id, username, password_hash, role, status, display_name')
    .eq('username', username)
    .limit(1)
    .maybeSingle();

  if (mode === 'setup') {
    // 初始化模式：仅当账号表为空时允许创建站长账号（自动成为 admin 并接管全部历史数据）
    const { count, error: cErr } = await c.from('accounts').select('id', { count: 'exact', head: true });
    if (cErr) return NextResponse.json({ error: '账号系统暂不可用' }, { status: 503 });
    if ((count || 0) > 0) {
      return NextResponse.json({ error: '站长账号已存在，请直接登录' }, { status: 409 });
    }
    const { data: created, error: iErr } = await c
      .from('accounts')
      .insert({ username, password_hash: hashPassword(password), role: 'admin', status: 'active', display_name: '站长' })
      .select('id')
      .single();
    if (iErr || !created) {
      invalidateAuthReadyCache();
      return NextResponse.json({ error: '创建站长账号失败，请重试' }, { status: 500 });
    }
    const adminId = (created as { id: number }).id;

    // 历史数据整体划归站长名下
    const [w, p, u, f] = await Promise.all([
      c.from('words').update({ user_id: adminId }).is('user_id', null),
      c.from('practice_records').update({ user_id: adminId }).is('user_id', null),
      c.from('upload_files').update({ user_id: adminId }).is('user_id', null),
      c.from('feedback_messages').update({ user_id: adminId }).is('user_id', null),
    ]);
    for (const r of [w, p, u, f]) if (r.error) console.warn('[setup] 历史数据归属迁移告警:', r.error.message);

    const { token } = await createSession(adminId);
    const jar = await cookies();
    jar.set(SESSION_COOKIE, token, cookieOptions());
    return NextResponse.json({ ok: true, role: 'admin' });
  }

  // 登录模式
  if (error || !row) {
    return NextResponse.json({ error: '用户名或密码不正确' }, { status: 401 });
  }
  const account = row as { id: number; password_hash: string; status: string | null };
  if (!verifyPassword(password, account.password_hash)) {
    return NextResponse.json({ error: '用户名或密码不正确' }, { status: 401 });
  }
  if (account.status === 'disabled') {
    return NextResponse.json({ error: '该账号已被停用，请联系站长' }, { status: 403 });
  }

  // 在线满员时拒绝新进入（排队：文案不出现数字）
  if (await isOnlineFull()) {
    return NextResponse.json({ error: '暂时客满，正在排队等待～', queued: true }, { status: 429 });
  }

  const { token } = await createSession(account.id);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, cookieOptions());
  return NextResponse.json({ ok: true });
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: SESSION_TTL_DAYS * 24 * 3600,
    secure: process.env.COZE_PROJECT_ENV === 'PROD',
  };
}
