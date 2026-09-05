import type { Metadata } from 'next';
import { SiteHeader } from '@/components/site-header';
import './globals.css';

export const metadata: Metadata = {
  title: '果冻单词 - 上传文件，照抄背诵',
  description:
    '上传图片、PDF、Word、PPT、Excel 文件精准识别英文单词，自动匹配中文释义，照抄键入背诵，白色主题搭配彩虹线条与透明果冻效果。',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased bg-background text-on-surface font-sans min-h-screen flex flex-col">
        <SiteHeader />
        <main className="flex-1 w-full max-w-6xl mx-auto px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
