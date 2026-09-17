import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { SESSION_COOKIE, heartbeat } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/** 心跳：刷新在线状态并判断是否放行（满员时前端展示"暂时客满，正在排队等待～"） */
export async function POST(_request: NextRequest) {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return NextResponse.json({ error: '未登录' }, { status: 401 });
  try {
    const result = await heartbeat(token);
    // 会话失效（过期/被站长踢下线/已登出）→ 401，前端跳转登录页
    if (result.invalid) return NextResponse.json({ error: '未登录' }, { status: 401 });
    return NextResponse.json({ admitted: result.admitted });
    // 注意：不回传 online 数字，避免暴露在线人数与上限
  } catch {
    // 心跳异常不拦截用户（宁可放行不可误伤）
    return NextResponse.json({ admitted: true });
  }
}
