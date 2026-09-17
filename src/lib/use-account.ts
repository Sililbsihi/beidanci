'use client';

import { useCallback, useEffect, useState } from 'react';

export interface AccountInfo {
  id: number;
  username: string;
  role: string;
  displayName: string;
  recognize: { used: number; limit: number | null; remaining: number | null };
}

export interface AccountState {
  account: AccountInfo | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

/** 拉取当前登录账号信息；未登录（401）时自动跳转登录页 */
export function useAccount(): AccountState {
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me', { cache: 'no-store' });
      if (res.status === 401) {
        window.location.href = '/login';
        return;
      }
      const data = (await res.json()) as { account?: AccountInfo };
      setAccount(data.account ?? null);
    } catch {
      // 网络异常：保持空账号，不阻塞页面
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { account, loading, refresh };
}
