import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { SESSION_COOKIE, requireAccount } from '@/lib/auth';
import { getSupabaseClient } from '@/storage/database/supabase-client';

export const dynamic = 'force-dynamic';

export async function POST() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    try {
      await getSupabaseClient().from('sessions').delete().eq('token', token);
    } catch {
      // 注销失败不阻塞，cookie 仍会被清除
    }
  }
  jar.delete(SESSION_COOKIE);
  return NextResponse.json({ ok: true });
}

// GET 保持占位：未登录时返回 401 供前端判断
export async function GET() {
  const ctx = await requireAccount();
  if (!ctx) return NextResponse.json({ error: '未登录' }, { status: 401 });
  return NextResponse.json({ ok: true, account: ctx.account });
}
