import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { requireAccount } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/** 判断错误是否为表尚不存在（未执行 DDL 时优雅降级） */
function isMissingTable(msg: string): boolean {
  return msg.includes('does not exist') || msg.includes('Could not find the table') || msg.includes('schema cache');
}

/** GET：公开留言列表——仅返回已通过审核（approved）的留言，联系方式永不下发 */
export async function GET() {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('feedback_messages')
    .select('id, nickname, content, created_at')
    .eq('status', 'approved')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) {
    if (isMissingTable(error.message)) {
      return NextResponse.json({ ready: false, messages: [] });
    }
    console.error('[feedback] 读取留言失败:', error.message);
    return NextResponse.json({ error: '留言读取失败' }, { status: 500 });
  }
  return NextResponse.json({ ready: true, messages: data ?? [] });
}

/** POST：提交留言（需登录；昵称与联系方式必填；进入待审核队列，联系方式仅站长可见） */
export async function POST(request: NextRequest) {
  const ctx = await requireAccount();
  if (!ctx) return NextResponse.json({ error: '请先登录后再留言' }, { status: 401 });
  let body: { nickname?: unknown; contact?: unknown; content?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 });
  }
  const nickname = typeof body.nickname === 'string' ? body.nickname.trim() : '';
  const contact = typeof body.contact === 'string' ? body.contact.trim() : '';
  const content = typeof body.content === 'string' ? body.content.trim() : '';
  if (!nickname || nickname.length > 20) {
    return NextResponse.json({ error: '请填写 20 字以内的昵称' }, { status: 400 });
  }
  if (!contact || contact.length > 100) {
    return NextResponse.json({ error: '请填写 100 字以内的联系方式' }, { status: 400 });
  }
  if (!content || content.length > 300) {
    return NextResponse.json({ error: '留言内容需在 300 字以内' }, { status: 400 });
  }
  const client = getSupabaseClient();
  const { error } = await client.from('feedback_messages').insert({ nickname, contact, content, status: 'pending', user_id: ctx.account.id });
  if (error) {
    if (isMissingTable(error.message)) {
      return NextResponse.json({ error: '评论功能正在配置中，请稍后再试' }, { status: 503 });
    }
    console.error('[feedback] 写入留言失败:', error.message);
    return NextResponse.json({ error: '提交失败，请稍后再试' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
