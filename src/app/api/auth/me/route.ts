import { NextResponse } from 'next/server';
import { requireAccount } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/** 当前登录账号 + 识别配额余量（前端导航、上传页配额提示、管理员判断都靠它） */
export async function GET() {
  const ctx = await requireAccount();
  if (!ctx) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const { account, recognizeQuota } = ctx;
  return NextResponse.json({
    account: {
      id: account.id,
      username: account.username,
      role: account.role,
      displayName: account.displayName,
    },
    recognize: {
      used: recognizeQuota.used,
      limit: recognizeQuota.limit, // admin 为 null = 不限
      remaining: recognizeQuota.limit === null ? null : Math.max(0, recognizeQuota.limit - recognizeQuota.used),
    },
  });
}
