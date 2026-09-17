import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

export const dynamic = 'force-dynamic';

/** 站长管理密钥：优先 FEEDBACK_ADMIN_KEY，其次部署平台注入的 APP_ 前缀变量 */
function adminKey(): string {
  return process.env.FEEDBACK_ADMIN_KEY || process.env.APP_FEEDBACK_ADMIN_KEY || 'jelly-words-admin';
}

/**
 * POST：站长审核接口（header x-admin-key 鉴权）
 * action=list    返回全部留言（含联系方式与待审核状态）
 * action=approve 置为 approved（公开可见）
 * action=hide    置回 pending（下架）
 * action=delete  删除
 */
export async function POST(request: NextRequest) {
  const key = request.headers.get('x-admin-key') ?? '';
  if (key !== adminKey()) {
    return NextResponse.json({ error: '管理密钥不正确' }, { status: 401 });
  }
  let body: { action?: unknown; id?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 });
  }

  const client = getSupabaseClient();

  if (body.action === 'list') {
    const { data, error } = await client
      .from('feedback_messages')
      .select('id, nickname, contact, content, status, created_at')
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) {
      return NextResponse.json({ error: `读取失败：${error.message}` }, { status: 500 });
    }
    return NextResponse.json({ messages: data ?? [] });
  }

  const id = typeof body.id === 'number' ? body.id : Number(body.id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: '无效的留言 id' }, { status: 400 });
  }

  if (body.action === 'approve' || body.action === 'hide') {
    const status = body.action === 'approve' ? 'approved' : 'pending';
    const { error } = await client.from('feedback_messages').update({ status }).eq('id', id);
    if (error) {
      return NextResponse.json({ error: `操作失败：${error.message}` }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }
  if (body.action === 'delete') {
    const { error } = await client.from('feedback_messages').delete().eq('id', id);
    if (error) {
      return NextResponse.json({ error: `删除失败：${error.message}` }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: '未知操作' }, { status: 400 });
}
