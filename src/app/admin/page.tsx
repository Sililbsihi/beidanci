'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Users, Globe2, BookOpen, Repeat2, Zap, MessageSquare, Loader2,
  UserPlus, Ban, CircleCheck, Trash2, Copy, ShieldCheck, RefreshCw, X,
} from 'lucide-react';

interface Stats {
  accounts: number;
  online: number;
  totalWords: number;
  totalRecites: number;
  todayRecites: number;
  recognizedToday: number;
  pendingFeedback: number;
}

interface AdminAccount {
  id: number;
  username: string;
  role: 'admin' | 'user';
  status: 'active' | 'disabled';
  displayName: string;
  recognizedToday: number;
  createdAt: string;
}

interface FeedbackRow {
  id: number;
  nickname: string;
  contact: string;
  content: string;
  status: string;
  user_id: number | null;
  created_at: string;
}

type Tab = 'overview' | 'accounts' | 'feedback';

const fmtTime = (iso: string) => {
  try {
    return new Date(iso).toLocaleString('zh-CN', { hour12: false });
  } catch {
    return iso;
  }
};

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const el = document.createElement('textarea');
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      return true;
    } catch {
      return false;
    }
  }
}

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>('overview');
  const [stats, setStats] = useState<Stats | null>(null);
  const [accounts, setAccounts] = useState<AdminAccount[]>([]);
  const [accountLimit, setAccountLimit] = useState(100);
  const [feedbacks, setFeedbacks] = useState<FeedbackRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [tip, setTip] = useState('');

  const [creating, setCreating] = useState(false);
  const [newDisplayName, setNewDisplayName] = useState('');
  const [issued, setIssued] = useState<{ username: string; password: string } | null>(null);

  const [confirmDelete, setConfirmDelete] = useState<AdminAccount | null>(null);

  const flash = useCallback((msg: string) => {
    setTip(msg);
    window.setTimeout(() => setTip(''), 2800);
  }, []);

  const loadStats = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/stats', { cache: 'no-store' });
      if (res.ok) setStats((await res.json()) as Stats);
    } catch {
      // 忽略，保持旧值
    }
  }, []);

  const loadAccounts = useCallback(async () => {
    const res = await fetch('/api/admin/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'list' }),
    });
    if (!res.ok) return;
    const data = (await res.json()) as { accounts: AdminAccount[]; limit: number };
    setAccounts(data.accounts ?? []);
    setAccountLimit(data.limit ?? 100);
  }, []);

  const loadFeedback = useCallback(async () => {
    const res = await fetch('/api/feedback/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'list' }),
    });
    if (!res.ok) return;
    const data = (await res.json()) as { messages: FeedbackRow[] };
    setFeedbacks(data.messages ?? []);
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([loadStats(), loadAccounts(), loadFeedback()]);
    setLoading(false);
  }, [loadStats, loadAccounts, loadFeedback]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const createAccount = async () => {
    setCreating(true);
    try {
      const res = await fetch('/api/admin/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', displayName: newDisplayName }),
      });
      const data = (await res.json()) as { ok?: boolean; username?: string; password?: string; error?: string };
      if (!res.ok || !data.username || !data.password) {
        flash(data.error ?? '创建失败');
        return;
      }
      setIssued({ username: data.username, password: data.password });
      setNewDisplayName('');
      await loadAccounts();
      await loadStats();
    } catch {
      flash('网络异常，请重试');
    } finally {
      setCreating(false);
    }
  };

  const accountAction = async (id: number, action: 'disable' | 'enable' | 'delete') => {
    const res = await fetch('/api/admin/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, id }),
    });
    const data = (await res.json()) as { error?: string };
    if (!res.ok) {
      flash(data.error ?? '操作失败');
      return;
    }
    if (action === 'delete') setConfirmDelete(null);
    flash(action === 'delete' ? '账号已删除' : action === 'disable' ? '账号已停用' : '账号已启用');
    await loadAccounts();
    await loadStats();
  };

  const feedbackAction = async (id: number, action: 'approve' | 'hide' | 'delete') => {
    const res = await fetch('/api/feedback/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, id }),
    });
    if (!res.ok) {
      flash('操作失败');
      return;
    }
    await loadFeedback();
    await loadStats();
  };

  const statCards: Array<{ icon: typeof Users; label: string; value: number | undefined; tone: string }> = [
    { icon: Users, label: '已启用账号', value: stats?.accounts, tone: 'text-jelly-blue bg-jelly-blue/12' },
    { icon: Globe2, label: '当前在线', value: stats?.online, tone: 'text-jelly-green bg-jelly-green/12' },
    { icon: BookOpen, label: '词库总词数', value: stats?.totalWords, tone: 'text-jelly-orange bg-jelly-orange/12' },
    { icon: Repeat2, label: '累计背诵轮数', value: stats?.totalRecites, tone: 'text-jelly-purple bg-jelly-purple/12' },
    { icon: Repeat2, label: '今日背诵轮数', value: stats?.todayRecites, tone: 'text-jelly-red bg-jelly-red/12' },
    { icon: Zap, label: '今日识别次数', value: stats?.recognizedToday, tone: 'text-jelly-blue bg-jelly-blue/12' },
    { icon: MessageSquare, label: '待审留言', value: stats?.pendingFeedback, tone: 'text-jelly-orange bg-jelly-orange/12' },
  ];

  const activeCount = accounts.filter((a) => a.status === 'active').length;

  return (
    <div className="space-y-6">
      {/* 标题 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold font-display text-on-surface flex items-center gap-2.5">
            <ShieldCheck className="w-6 h-6 text-primary" /> 站长面板
          </h1>
          <p className="text-sm text-on-surface-variant mt-1">账号管理、全站统计与留言审核</p>
        </div>
        <button
          onClick={() => void loadAll()}
          className="inline-flex items-center gap-1.5 text-sm text-on-surface-variant hover:text-on-surface bg-surface-container hover:bg-surface-container/70 rounded-full px-3.5 py-1.5 transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> 刷新
        </button>
      </div>

      {tip && <div className="text-sm text-primary bg-primary/10 rounded-xl px-4 py-2.5">{tip}</div>}

      {/* 标签页 */}
      <div className="flex gap-1 bg-surface-container/60 rounded-full p-1 w-fit">
        {([
          ['overview', '概览'],
          ['accounts', '账号管理'],
          ['feedback', '留言管理'],
        ] as Array<[Tab, string]>).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={
              tab === key
                ? 'px-4 py-1.5 text-sm font-medium text-primary bg-surface rounded-full shadow-card'
                : 'px-4 py-1.5 text-sm font-medium text-on-surface-variant hover:text-on-surface rounded-full transition-colors'
            }
          >
            {label}
          </button>
        ))}
      </div>

      {/* 概览 */}
      {tab === 'overview' && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {statCards.map((card) => (
            <div key={card.label} className="bg-surface/80 backdrop-blur-md rounded-2xl shadow-card p-4">
              <div className={`w-9 h-9 rounded-xl ${card.tone} flex items-center justify-center`}>
                <card.icon className="w-4.5 h-4.5" />
              </div>
              <p className="mt-3 text-2xl font-bold font-display text-on-surface">{card.value ?? '-'}</p>
              <p className="text-xs text-on-surface-variant mt-0.5">{card.label}</p>
            </div>
          ))}
          <div className="col-span-2 md:col-span-4 bg-surface/80 backdrop-blur-md rounded-2xl shadow-card p-4 text-sm text-on-surface-variant">
            邀请制账号共 {accountLimit} 个名额，当前已启用 {activeCount} 个；每人每天识别配额 10 次（站长不限），单次识别最多 200 词。
          </div>
        </div>
      )}

      {/* 账号管理 */}
      {tab === 'accounts' && (
        <div className="space-y-4">
          <div className="bg-surface/80 backdrop-blur-md rounded-2xl shadow-card p-4 flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-48">
              <label htmlFor="display-name" className="block text-xs font-medium text-on-surface-variant mb-1.5">
                新成员昵称（可选，便于识别）
              </label>
              <input
                id="display-name"
                value={newDisplayName}
                onChange={(e) => setNewDisplayName(e.target.value)}
                placeholder="例如：小明"
                className="w-full bg-surface-container border-none rounded-lg px-4 py-2.5 text-sm text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <button
              onClick={() => void createAccount()}
              disabled={creating || activeCount >= accountLimit}
              className="inline-flex items-center gap-2 rounded-xl bg-primary text-primary-foreground font-medium px-4 py-2.5 text-sm hover:opacity-90 transition-opacity disabled:opacity-60"
            >
              {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
              生成账号密码
            </button>
            <p className="w-full text-xs text-on-surface-variant">
              名额 {activeCount}/{accountLimit}；生成后请把账号密码私下发给对方，注册通道不开放自助注册。
            </p>
          </div>

          {/* 发放弹窗 */}
          {issued && (
            <div className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm flex items-center justify-center px-4" onClick={() => setIssued(null)}>
              <div className="bg-surface rounded-2xl shadow-float p-6 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between">
                  <h3 className="font-display font-bold text-lg text-on-surface">账号已生成</h3>
                  <button onClick={() => setIssued(null)} className="text-on-surface-variant hover:text-on-surface">
                    <X className="w-4.5 h-4.5" />
                  </button>
                </div>
                <p className="mt-1 text-xs text-on-surface-variant">密码只显示这一次，请立即复制保存并发给对方</p>
                <div className="mt-4 space-y-2.5">
                  <div className="flex items-center justify-between bg-surface-container rounded-lg px-3.5 py-2.5">
                    <span className="text-sm text-on-surface font-mono">{issued.username}</span>
                    <button
                      onClick={() => void copyText(issued.username).then((ok) => flash(ok ? '用户名已复制' : '复制失败'))}
                      className="text-on-surface-variant hover:text-primary"
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="flex items-center justify-between bg-surface-container rounded-lg px-3.5 py-2.5">
                    <span className="text-sm text-on-surface font-mono">{issued.password}</span>
                    <button
                      onClick={() =>
                        void copyText(`${issued.username} / ${issued.password}`).then((ok) => flash(ok ? '账号密码已复制' : '复制失败'))
                      }
                      className="text-on-surface-variant hover:text-primary"
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <button
                  onClick={() => setIssued(null)}
                  className="mt-5 w-full rounded-xl bg-primary text-primary-foreground font-medium py-2.5 text-sm hover:opacity-90 transition-opacity"
                >
                  我已保存
                </button>
              </div>
            </div>
          )}

          {/* 删除确认 */}
          {confirmDelete && (
            <div className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm flex items-center justify-center px-4" onClick={() => setConfirmDelete(null)}>
              <div className="bg-surface rounded-2xl shadow-float p-6 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
                <h3 className="font-display font-bold text-lg text-on-surface">删除账号 {confirmDelete.displayName}？</h3>
                <p className="mt-2 text-sm text-on-surface-variant">
                  该账号的单词、背诵记录、上传记录将一并删除，且无法恢复。
                </p>
                <div className="mt-5 flex gap-2.5">
                  <button
                    onClick={() => setConfirmDelete(null)}
                    className="flex-1 rounded-xl bg-surface-container text-on-surface font-medium py-2.5 text-sm hover:bg-surface-container/70 transition-colors"
                  >
                    取消
                  </button>
                  <button
                    onClick={() => void accountAction(confirmDelete.id, 'delete')}
                    className="flex-1 rounded-xl bg-error text-white font-medium py-2.5 text-sm hover:opacity-90 transition-opacity"
                  >
                    确认删除
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="bg-surface/80 backdrop-blur-md rounded-2xl shadow-card overflow-x-auto">
            <table className="w-full text-sm min-w-160">
              <thead>
                <tr className="text-left text-xs text-on-surface-variant border-b border-outline-variant/40">
                  <th className="px-4 py-3 font-medium">成员</th>
                  <th className="px-4 py-3 font-medium">用户名</th>
                  <th className="px-4 py-3 font-medium">角色</th>
                  <th className="px-4 py-3 font-medium">状态</th>
                  <th className="px-4 py-3 font-medium">今日识别</th>
                  <th className="px-4 py-3 font-medium">创建时间</th>
                  <th className="px-4 py-3 font-medium text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.id} className="border-b border-outline-variant/20 last:border-0">
                    <td className="px-4 py-3 text-on-surface">{a.displayName}</td>
                    <td className="px-4 py-3 text-on-surface-variant font-mono text-xs">{a.username}</td>
                    <td className="px-4 py-3">
                      {a.role === 'admin' ? (
                        <span className="text-xs font-medium text-primary bg-primary/10 rounded-full px-2.5 py-0.5">站长</span>
                      ) : (
                        <span className="text-xs text-on-surface-variant">成员</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`text-xs font-medium rounded-full px-2.5 py-0.5 ${
                          a.status === 'active' ? 'text-success bg-success/10' : 'text-error bg-error/10'
                        }`}
                      >
                        {a.status === 'active' ? '正常' : '已停用'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-on-surface-variant">{a.recognizedToday} 次</td>
                    <td className="px-4 py-3 text-on-surface-variant text-xs">{fmtTime(a.createdAt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1.5">
                        {a.role !== 'admin' && (
                          <>
                            {a.status === 'active' ? (
                              <button
                                onClick={() => void accountAction(a.id, 'disable')}
                                title="停用并踢下线"
                                className="p-1.5 rounded-lg text-on-surface-variant hover:text-error hover:bg-error/10 transition-colors"
                              >
                                <Ban className="w-4 h-4" />
                              </button>
                            ) : (
                              <button
                                onClick={() => void accountAction(a.id, 'enable')}
                                title="启用"
                                className="p-1.5 rounded-lg text-on-surface-variant hover:text-success hover:bg-success/10 transition-colors"
                              >
                                <CircleCheck className="w-4 h-4" />
                              </button>
                            )}
                            <button
                              onClick={() => setConfirmDelete(a)}
                              title="删除"
                              className="p-1.5 rounded-lg text-on-surface-variant hover:text-error hover:bg-error/10 transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {accounts.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-on-surface-variant text-sm">
                      {loading ? '加载中...' : '暂无账号'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 留言管理 */}
      {tab === 'feedback' && (
        <div className="space-y-3">
          {feedbacks.length === 0 && (
            <div className="bg-surface/80 backdrop-blur-md rounded-2xl shadow-card p-10 text-center text-on-surface-variant text-sm">
              {loading ? '加载中...' : '暂无留言'}
            </div>
          )}
          {feedbacks.map((f) => (
            <div key={f.id} className="bg-surface/80 backdrop-blur-md rounded-2xl shadow-card p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-sm text-on-surface">{f.nickname}</span>
                <span
                  className={`text-xs font-medium rounded-full px-2.5 py-0.5 ${
                    f.status === 'approved'
                      ? 'text-success bg-success/10'
                      : f.status === 'pending'
                        ? 'text-jelly-orange bg-jelly-orange/10'
                        : 'text-on-surface-variant bg-surface-container'
                  }`}
                >
                  {f.status === 'approved' ? '已公开' : f.status === 'pending' ? '待审核' : '已隐藏'}
                </span>
                <span className="text-xs text-on-surface-variant ml-auto">{fmtTime(f.created_at)}</span>
              </div>
              <p className="mt-2 text-sm text-on-surface whitespace-pre-wrap break-words">{f.content}</p>
              <div className="mt-2.5 flex flex-wrap items-center gap-3">
                <span className="text-xs text-on-surface-variant">
                  联系方式：<span className="font-mono">{f.contact || '-'}</span>
                  <span className="ml-1 text-on-surface-variant/60">（仅站长可见）</span>
                </span>
                <div className="ml-auto flex items-center gap-1.5">
                  {f.status !== 'approved' && (
                    <button
                      onClick={() => void feedbackAction(f.id, 'approve')}
                      className="inline-flex items-center gap-1 text-xs font-medium text-success bg-success/10 rounded-full px-3 py-1.5 hover:bg-success/20 transition-colors"
                    >
                      <CircleCheck className="w-3.5 h-3.5" /> 公开
                    </button>
                  )}
                  {f.status !== 'pending' && (
                    <button
                      onClick={() => void feedbackAction(f.id, 'hide')}
                      className="inline-flex items-center gap-1 text-xs font-medium text-jelly-orange bg-jelly-orange/10 rounded-full px-3 py-1.5 hover:bg-jelly-orange/20 transition-colors"
                    >
                      <Ban className="w-3.5 h-3.5" /> 隐藏
                    </button>
                  )}
                  <button
                    onClick={() => void feedbackAction(f.id, 'delete')}
                    className="inline-flex items-center gap-1 text-xs font-medium text-error bg-error/10 rounded-full px-3 py-1.5 hover:bg-error/20 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> 删除
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
