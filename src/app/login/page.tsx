'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { BookOpen, Loader2, ShieldCheck } from 'lucide-react';

type Mode = 'loading' | 'unready' | 'setup' | 'login';

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>('loading');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/auth/login', { cache: 'no-store' });
        const data = (await res.json()) as { mode?: string };
        setMode(data.mode === 'setup' ? 'setup' : data.mode === 'login' ? 'login' : 'unready');
      } catch {
        setMode('unready');
      }
    })();
  }, []);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');
    if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) {
      setError('用户名需为 3-20 位字母/数字/下划线');
      return;
    }
    if (password.length < 6 || password.length > 60) {
      setError('密码需为 6-60 位');
      return;
    }
    if (mode === 'setup' && password !== confirm) {
      setError('两次输入的密码不一致');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, mode }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? '操作失败，请重试');
        return;
      }
      window.location.href = '/';
    } catch {
      setError('网络异常，请重试');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-[70vh] flex items-center justify-center">
      <div className="w-full max-w-sm bg-surface/90 backdrop-blur-md rounded-2xl shadow-card border border-outline-variant/50 p-8">
        <div className="text-center">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-[linear-gradient(135deg,#E57373_0%,#F0A45B_35%,#E9C96A_65%,#7FA3C9_100%)] flex items-center justify-center shadow-card">
            <BookOpen className="w-7 h-7 text-white" />
          </div>
          <h1 className="mt-4 font-display font-bold text-xl text-on-surface">果冻单词</h1>
          <p className="mt-1 text-sm text-on-surface-variant">
            {mode === 'setup' ? '首次使用：创建站长账号，开始背诵之旅' : mode === 'login' ? '输入账号密码，继续背诵之旅' : '准备中'}
          </p>
        </div>

        {mode === 'loading' && (
          <div className="mt-8 flex items-center justify-center gap-2 text-sm text-on-surface-variant">
            <Loader2 className="w-4 h-4 animate-spin" /> 正在检查账号系统
          </div>
        )}

        {mode === 'unready' && (
          <div className="mt-8 flex items-start gap-2.5 bg-warning/10 text-warning rounded-xl px-4 py-3 text-sm">
            <ShieldCheck className="w-4.5 h-4.5 shrink-0 mt-0.5" />
            <span>账号系统初始化中：请站长在数据库执行初始化 SQL 后刷新本页。</span>
          </div>
        )}

        {(mode === 'setup' || mode === 'login') && (
          <form onSubmit={(e) => void submit(e)} className="mt-7 space-y-4">
            <div>
              <label htmlFor="username" className="block text-xs font-medium text-on-surface-variant mb-1.5">
                用户名
              </label>
              <input
                id="username"
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="3-20 位字母 / 数字 / 下划线"
                className="w-full bg-surface-container border-none rounded-lg px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <div>
              <label htmlFor="password" className="block text-xs font-medium text-on-surface-variant mb-1.5">
                密码
              </label>
              <input
                id="password"
                type="password"
                autoComplete={mode === 'setup' ? 'new-password' : 'current-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="至少 6 位"
                className="w-full bg-surface-container border-none rounded-lg px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            {mode === 'setup' && (
              <div>
                <label htmlFor="confirm" className="block text-xs font-medium text-on-surface-variant mb-1.5">
                  确认密码
                </label>
                <input
                  id="confirm"
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="再输入一次密码"
                  className="w-full bg-surface-container border-none rounded-lg px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
            )}

            {error && <p className="text-xs text-error bg-error/10 rounded-lg px-3 py-2">{error}</p>}

            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-xl bg-primary text-primary-foreground font-medium py-3 text-sm hover:opacity-90 transition-opacity disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              {mode === 'setup' ? '创建站长账号' : '登录'}
            </button>

            <p className="text-xs text-on-surface-variant/70 text-center">
              {mode === 'setup'
                ? '站长账号创建后，历史单词与记录将自动归站长所有'
                : '没有账号？联系站长获取邀请账号'}
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
