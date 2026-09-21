'use client';

import { useEffect } from 'react';

export function ClientErrorReporter() {
  useEffect(() => {
    const report = (source: string, message: string, stack: string) => {
      if (!message) return;
      try {
        void fetch('/api/client-error', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source,
            message: String(message).slice(0, 800),
            stack: String(stack ?? '').slice(0, 1200),
            url: window.location.href,
            userAgent: navigator.userAgent,
          }),
          keepalive: true,
        });
      } catch {
        // 静默失败
      }
    };

    const onError = (event: ErrorEvent) => {
      report('window.onerror', event.message ?? '', `${event.filename}:${event.lineno}:${event.colno}\n${event.error?.stack ?? ''}`);
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      report(
        'unhandledrejection',
        reason instanceof Error ? reason.message : String(reason ?? ''),
        reason instanceof Error ? reason.stack ?? '' : '',
      );
    };

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  return null;
}
