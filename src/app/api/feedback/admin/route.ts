import { NextRequest, NextResponse } from 'next/server';
import { requireAccount } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/** 留言管理（仅站长，会话鉴权，替代旧的 x-admin-key 模式）：list / approve / hide / delete */
export async function POST(request: NextRequest) {
  const ctx = await requireAccount();
  if (!ctx) return NextResponse.json({ error: '未登录' }, { status: 401 });
  if (ctx.account.role !== 'admin') return NextResponse.json({ error: '仅站长可操作' }, { status: 403 });

  let body: { action?: unknown; id?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 });
  }

  const c = ctx.supabase;

  if (body.action === 'list') {
    const { data, error } = await c
      .from('feedback_messages')
      .select('id, nickname, contact, content, status, user_id, created_at')
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) return NextResponse.json({ error: `读取失败：${error.message}` }, { status: 500 });
    return NextResponse.json({ messages: data ?? [] });
  }

  const id = typeof body.id === 'number' ? body.id : Number(body.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: '无效的留言 id' }, { status: 400 });

  if (body.action === 'approve' || body.action === 'hide') {
    const status = body.action === 'approve' ? 'approved' : 'pending';
    const { error } = await c.from('feedback_messages').update({ status }).eq('id', id);
    if (error) return NextResponse.json({ error: `操作失败：${error.message}` }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (body.action === 'delete') {
    const { error } = await c.from('feedback_messages').delete().eq('id', id);
    if (error) return NextResponse.json({ error: `删除失败：${error.message}` }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: '未知操作' }, { status: 400 });
}
