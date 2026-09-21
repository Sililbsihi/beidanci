'use client';

import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    const payload = {
      source: 'global-error',
      message: error?.message ?? 'unknown',
      stack: error?.stack ?? '',
      url: typeof window !== 'undefined' ? window.location.href : 'unknown',
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
    };
    try {
      void fetch('/api/client-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true,
      });
    } catch {
      // 上报失败不影响错误页
    }
  }, [error]);

  return (
    <html lang="zh-CN">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#FBF3E7',
          fontFamily: 'Georgia, "Songti SC", SimSun, serif',
          color: '#31251B',
        }}
      >
        <div
          style={{
            background: '#FFF9F1',
            borderRadius: 24,
            padding: '40px 36px',
            maxWidth: 420,
            textAlign: 'center',
            boxShadow: '0 10px 30px rgba(49, 37, 27, 0.08)',
          }}
        >
          <div style={{ fontSize: 44, marginBottom: 12 }}>🍋</div>
          <h1 style={{ fontSize: 22, margin: '0 0 8px' }}>页面遇到了一点小问题</h1>
          <p style={{ color: '#8B7662', fontSize: 14, margin: '0 0 4px', wordBreak: 'break-all' }}>
            {error?.message ? `错误信息：${error.message.slice(0, 160)}` : '页面加载时出现了异常'}
          </p>
          <p style={{ color: '#8B7662', fontSize: 13, margin: '0 0 24px' }}>
            多数情况点下方按钮重试即可恢复；若持续出现，请强制刷新（Ctrl+Shift+R）清除旧缓存。
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              background: '#C96F3D',
              color: '#FFF9F1',
              border: 'none',
              borderRadius: 12,
              padding: '10px 28px',
              fontSize: 15,
              cursor: 'pointer',
              marginRight: 10,
            }}
          >
            刷新重试
          </button>
          <button
            onClick={() => reset()}
            style={{
              background: 'transparent',
              color: '#C96F3D',
              border: '1px solid #C96F3D',
              borderRadius: 12,
              padding: '10px 28px',
              fontSize: 15,
              cursor: 'pointer',
            }}
          >
            重新渲染
          </button>
        </div>
      </body>
    </html>
  );
}
