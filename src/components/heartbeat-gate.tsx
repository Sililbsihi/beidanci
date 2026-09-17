'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { BookOpen, Loader2 } from 'lucide-react';

const BEAT_INTERVAL = 25000;
const QUEUED_RETRY = 5000;

/** 在线排队闸门：定时心跳保活；客满时展示全屏排队页（不展示任何在线数字） */
export function HeartbeatGate() {
  const pathname = usePathname();
  const [queued, setQueued] = useState(false);

  useEffect(() => {
    if (pathname === '/login') return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const beat = async () => {
      let wait = BEAT_INTERVAL;
      try {
        const res = await fetch('/api/heartbeat', { method: 'POST', cache: 'no-store' });
        if (res.status === 401) {
          window.location.href = '/login';
          return;
        }
        const data = (await res.json()) as { admitted?: boolean };
        if (!alive) return;
        const admitted = data.admitted !== false;
        setQueued(!admitted);
        if (!admitted) wait = QUEUED_RETRY;
      } catch {
        // 网络抖动不阻塞使用，下一轮心跳自动重试
      }
      if (alive) timer = setTimeout(() => void beat(), wait);
    };

    void beat();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [pathname]);

  if (pathname === '/login' || !queued) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-background/95 backdrop-blur-sm flex items-center justify-center">
      <div className="text-center px-8">
        <div className="w-16 h-16 mx-auto rounded-2xl bg-[linear-gradient(135deg,#E57373_0%,#F0A45B_35%,#E9C96A_65%,#7FA3C9_100%)] flex items-center justify-center shadow-float animate-pulse">
          <BookOpen className="w-8 h-8 text-white" />
        </div>
        <h2 className="mt-6 font-display font-bold text-xl text-on-surface">暂时客满，正在排队等待～</h2>
        <p className="mt-2 text-sm text-on-surface-variant flex items-center justify-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          排到你了会自动进入，请保持页面开启
        </p>
      </div>
    </div>
  );
}
