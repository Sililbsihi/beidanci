'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BookOpen } from 'lucide-react';

const NAV_ITEMS = [
  { href: '/', label: '上传识别' },
  { href: '/practice', label: '背诵练习' },
  { href: '/records', label: '背诵记录' },
];

/** 全站顶部导航：果冻质感 + 底边彩虹线条 */
export function SiteHeader() {
  const pathname = usePathname();

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
        <div className="w-9 h-9 rounded-full bg-primary/15 text-primary flex items-center justify-center text-sm font-medium" title="学习伙伴">
          初
        </div>
      </div>
      <div className="h-[3px] bg-[linear-gradient(90deg,#E57373_0%,#F0A45B_20%,#E9C96A_40%,#7E9F7A_60%,#7FA3C9_80%,#A88BC9_100%)] opacity-70" />
    </header>
  );
}
