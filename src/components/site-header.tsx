'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { BookOpen, Loader2, LogOut, Shield } from 'lucide-react';
import { useAccount } from '@/lib/use-account';

const NAV_ITEMS = [
  { href: '/', label: '上传识别' },
  { href: '/practice', label: '背诵练习' },
  { href: '/records', label: '背诵记录' },
];

/** 全站顶部导航：果冻质感 + 底边彩虹线条 + 账号菜单 */
export function SiteHeader() {
  const pathname = usePathname();
  const { account, loading } = useAccount();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  const logout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // 忽略网络异常，直接跳登录页
    }
    window.location.href = '/login';
  };

  const initial = account ? (account.displayName || account.username || '友').slice(0, 1).toUpperCase() : '初';

  return (
    <header className="bg-surface/80 backdrop-blur-md sticky top-0 z-40">
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-[linear-gradient(135deg,#E57373_0%,#F0A45B_35%,#E9C96A_65%,#7FA3C9_100%)] flex items-center justify-center shadow-card">
            <BookOpen className="w-5 h-5 text-white" />
          </div>
          <span className="font-display font-bold text-lg text-on-surface">果冻单词</span>
        </Link>
        <nav className="flex items-center gap-1">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={
                  active
                    ? 'px-3.5 py-1.5 text-sm font-medium text-primary bg-primary/10 rounded-full'
                    : 'px-3.5 py-1.5 text-sm font-medium text-on-surface-variant hover:text-on-surface hover:bg-surface-container rounded-full transition-colors'
                }
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="w-9 h-9 rounded-full bg-primary/15 text-primary flex items-center justify-center text-sm font-medium hover:ring-2 hover:ring-primary/30 transition-all"
            title={account ? account.displayName || account.username : '账号'}
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : initial}
          </button>
          {menuOpen && account && (
            <div className="absolute right-0 top-11 w-52 bg-surface rounded-xl shadow-float border border-outline-variant/60 py-2 z-50">
              <div className="px-4 py-2 border-b border-outline-variant/40">
                <p className="text-sm font-medium text-on-surface truncate">{account.displayName || account.username}</p>
                <p className="text-xs text-on-surface-variant mt-0.5">
                  @{account.username} · {account.role === 'admin' ? '站长' : '成员'}
                </p>
              </div>
              {account.role === 'admin' && (
                <Link
                  href="/admin"
                  className="flex items-center gap-2 px-4 py-2 text-sm text-on-surface hover:bg-surface-container transition-colors"
                >
                  <Shield className="w-4 h-4 text-primary" /> 站长面板
                </Link>
              )}
              <button
                onClick={() => void logout()}
                className="w-full flex items-center gap-2 px-4 py-2 text-sm text-on-surface hover:bg-surface-container transition-colors"
              >
                <LogOut className="w-4 h-4 text-on-surface-variant" /> 退出登录
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="h-[3px] bg-[linear-gradient(90deg,#E57373_0%,#F0A45B_20%,#E9C96A_40%,#7E9F7A_60%,#7FA3C9_80%,#A88BC9_100%)] opacity-70" />
    </header>
  );
}
