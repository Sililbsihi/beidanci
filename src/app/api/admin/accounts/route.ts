import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { ACCOUNTS_LIMIT, hashPassword, requireAccount } from '@/lib/auth';

export const dynamic = 'force-dynamic';

interface AdminAccountRow {
  id: number;
  username: string;
  role: string | null;
  status: string | null;
  display_name: string | null;
  recognize_date: string | null;
  recognize_count: number | null;
  created_at: string;
}

async function requireAdmin() {
  const ctx = await requireAccount();
  if (!ctx) return { error: NextResponse.json({ error: '未登录' }, { status: 401 }) };
  if (ctx.account.role !== 'admin') return { error: NextResponse.json({ error: '仅站长可操作' }, { status: 403 }) };
  return { ctx };
}

const todayStr = () => new Date().toLocaleDateString('en-CA');

/** 账号管理：list / create / disable / enable / delete（仅站长） */
export async function POST(request: NextRequest) {
  const guard = await requireAdmin();
  if (guard.error) return guard.error;
  const { ctx } = guard;

  let body: { action?: unknown; id?: unknown; displayName?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 });
  }

  const c = ctx.supabase;

  if (body.action === 'list') {
    const { data, error } = await c
      .from('accounts')
      .select('id, username, role, status, display_name, recognize_date, recognize_count, created_at')
      .order('id', { ascending: true })
      .limit(200);
    if (error) return NextResponse.json({ error: `读取账号失败: ${error.message}` }, { status: 500 });
    const today = todayStr();
    const accounts = (data as AdminAccountRow[]).map((r) => ({
      id: r.id,
      username: r.username,
      role: r.role === 'admin' ? 'admin' : 'user',
      status: r.status === 'disabled' ? 'disabled' : 'active',
      displayName: r.display_name || r.username,
      recognizedToday: r.recognize_date === today ? r.recognize_count || 0 : 0,
      createdAt: r.created_at,
    }));
    return NextResponse.json({ accounts, total: accounts.length, limit: ACCOUNTS_LIMIT });
  }

  if (body.action === 'create') {
    const displayName = typeof body.displayName === 'string' ? body.displayName.trim().slice(0, 20) : '';
    const { count, error: cErr } = await c.from('accounts').select('id', { count: 'exact', head: true });
    if (cErr) return NextResponse.json({ error: '账号系统暂不可用' }, { status: 503 });
    if ((count || 0) >= ACCOUNTS_LIMIT) {
      return NextResponse.json({ error: `账号数量已达上限（${ACCOUNTS_LIMIT} 个），请先删除不用的账号` }, { status: 409 });
    }

    // 生成易读账号：字母开头随机 6 位 + 可读随机密码（去掉易混淆字符）
    const username = `word${randomBytes(3).toString('hex')}`; // 6 位十六进制
    const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
    let password = '';
    for (let i = 0; i < 8; i += 1) password += alphabet[randomBytes(1)[0] % alphabet.length];

    const { data, error } = await c
      .from('accounts')
      .insert({ username, password_hash: hashPassword(password), role: 'user', status: 'active', display_name: displayName || username })
      .select('id, username')
      .single();
    if (error || !data) return NextResponse.json({ error: `创建失败: ${error?.message ?? ''}` }, { status: 500 });

    return NextResponse.json({ ok: true, username, password, id: (data as { id: number }).id });
  }

  const id = typeof body.id === 'number' ? body.id : Number(body.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: '无效的账号 id' }, { status: 400 });

  if (body.action === 'disable' || body.action === 'enable') {
    if (id === ctx.account.id) return NextResponse.json({ error: '不能停用自己的账号' }, { status: 400 });
    const { error } = await c
      .from('accounts')
      .update({ status: body.action === 'disable' ? 'disabled' : 'active' })
      .eq('id', id);
    if (error) return NextResponse.json({ error: `操作失败: ${error.message}` }, { status: 500 });
    // 停用同时踢下线
    if (body.action === 'disable') await c.from('sessions').delete().eq('account_id', id);
    return NextResponse.json({ ok: true });
  }

  if (body.action === 'delete') {
    if (id === ctx.account.id) return NextResponse.json({ error: '不能删除自己的站长账号' }, { status: 400 });
    // 代码级联清理该账号全部数据（sessions/词/流水/上传记录）
    const [s, w, p, u] = await Promise.all([
      c.from('sessions').delete().eq('account_id', id),
      c.from('words').delete().eq('user_id', id),
      c.from('practice_records').delete().eq('user_id', id),
      c.from('upload_files').delete().eq('user_id', id),
    ]);
    for (const r of [s, w, p, u]) if (r.error) console.warn('[admin] 级联清理告警:', r.error.message);
    const { error } = await c.from('accounts').delete().eq('id', id);
    if (error) return NextResponse.json({ error: `删除失败: ${error.message}` }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: '未知操作' }, { status: 400 });
}
