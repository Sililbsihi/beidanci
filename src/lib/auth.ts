import { cookies } from 'next/headers';
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient } from '@/storage/database/supabase-client';

// ---------------------------------------------------------------------------
// 常量（全部支持环境变量覆盖）
// ---------------------------------------------------------------------------
export const SESSION_COOKIE = 'jelly_session';
export const ACCOUNTS_LIMIT = 100; // 邀请制账号总量上限
export const ONLINE_LIMIT = Number(process.env.APP_ONLINE_LIMIT || 100); // 同时在线上限
export const RECOGNIZE_DAILY_LIMIT = Number(process.env.APP_RECOGNIZE_DAILY_LIMIT || 10); // 每账号每日识别次数
export const SESSION_TTL_DAYS = 7; // 登录态有效期
export const ONLINE_WINDOW_SEC = 90; // 心跳判定窗口：最后心跳在 90s 内视为在线

// ---------------------------------------------------------------------------
// 账号类型
// ---------------------------------------------------------------------------
export interface Account {
  id: number;
  username: string;
  role: 'admin' | 'user';
  status: 'active' | 'disabled';
  displayName: string;
}

interface AccountRow {
  id: number;
  username: string;
  role: string | null;
  status: string | null;
  display_name: string | null;
  recognize_date: string | null;
  recognize_count: number | null;
}

// ---------------------------------------------------------------------------
// 密码哈希（Node 内置 scrypt，无需额外依赖）
// ---------------------------------------------------------------------------
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

// ---------------------------------------------------------------------------
// 表就绪探测（accounts/sessions 表缺失时优雅降级，避免整站 500）
// ---------------------------------------------------------------------------
let authReadyCache: { ready: boolean; checkedAt: number } = { ready: false, checkedAt: 0 };
const AUTH_PROBE_TTL_MS = 60_000;

export async function probeAuthReady(client?: SupabaseClient): Promise<boolean> {
  const now = Date.now();
  if (now - authReadyCache.checkedAt < AUTH_PROBE_TTL_MS) return authReadyCache.ready;
  const c = client ?? getSupabaseClient();
  let ready = false;
  try {
    const { error } = await c.from('accounts').select('id').limit(1);
    ready = !error;
    if (error) console.warn('[auth] probeAuthReady 查询失败:', error.message, error.details ?? '', error.hint ?? '');
  } catch (e) {
    ready = false;
    console.warn('[auth] probeAuthReady 异常:', e instanceof Error ? e.message : String(e));
  }
  authReadyCache = { ready, checkedAt: now };
  return ready;
}

export function invalidateAuthReadyCache(): void {
  authReadyCache = { ready: false, checkedAt: 0 };
}

// ---------------------------------------------------------------------------
// 会话
// ---------------------------------------------------------------------------
export async function createSession(accountId: number): Promise<{ token: string; expiresAt: string }> {
  const c = getSupabaseClient();
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 3600 * 1000).toISOString();
  const { error } = await c.from('sessions').insert({ token, account_id: accountId, expires_at: expiresAt });
  if (error) throw new Error(`创建会话失败: ${error.message}`);
  return { token, expiresAt };
}

export interface AuthContext {
  account: Account;
  supabase: SupabaseClient;
  recognizeQuota: { used: number; limit: number | null; date: string };
}

function toAccount(row: AccountRow): Account {
  return {
    id: row.id,
    username: row.username,
    role: row.role === 'admin' ? 'admin' : 'user',
    status: row.status === 'disabled' ? 'disabled' : 'active',
    displayName: row.display_name || row.username,
  };
}

/** 从请求 cookie 解析当前登录账号；未登录/会话失效/账号停用返回 null */
export async function requireAccount(): Promise<AuthContext | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const c = getSupabaseClient();
  const nowIso = new Date().toISOString();

  const { data: session, error: sErr } = await c
    .from('sessions')
    .select('account_id, expires_at')
    .eq('token', token)
    .gt('expires_at', nowIso)
    .limit(1)
    .maybeSingle();
  if (sErr || !session) return null;

  const { data: row, error: aErr } = await c
    .from('accounts')
    .select('id, username, role, status, display_name, recognize_date, recognize_count')
    .eq('id', (session as { account_id: number }).account_id)
    .limit(1)
    .maybeSingle();
  if (aErr || !row) return null;

  const account = toAccount(row as AccountRow);
  if (account.status !== 'active') return null;

  const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD（本地时区）
  const quotaRow = row as AccountRow;
  const used = quotaRow.recognize_date === today ? quotaRow.recognize_count || 0 : 0;

  return {
    account,
    supabase: c,
    recognizeQuota: {
      used,
      limit: account.role === 'admin' ? null : RECOGNIZE_DAILY_LIMIT,
      date: today,
    },
  };
}

/** 识别成功后扣减配额（管理员不限）；返回 false 表示今日已用尽 */
export async function consumeRecognizeQuota(ctx: AuthContext): Promise<boolean> {
  if (ctx.account.role === 'admin') return true;
  const c = ctx.supabase;
  const today = ctx.recognizeQuota.date;
  if (ctx.recognizeQuota.used >= RECOGNIZE_DAILY_LIMIT) return false;

  // 跨天自动重置后 +1；竞态容忍（个人级应用可接受）
  const { error } = await c
    .from('accounts')
    .update({
      recognize_date: today,
      recognize_count: ctx.recognizeQuota.used + 1,
    })
    .eq('id', ctx.account.id);
  if (error) console.warn('[auth] 配额扣减失败:', error.message);
  return true;
}

// ---------------------------------------------------------------------------
// 同时在线（心跳）
// ---------------------------------------------------------------------------
export async function heartbeat(token: string): Promise<{ admitted: boolean; online: number; invalid?: boolean }> {
  const c = getSupabaseClient();
  const nowIso = new Date().toISOString();

  // 刷新自己的心跳（会话存在且未过期才有效）
  const { data: session, error: sErr } = await c
    .from('sessions')
    .select('account_id, expires_at')
    .eq('token', token)
    .gt('expires_at', nowIso)
    .limit(1)
    .maybeSingle();
  // 会话失效（过期/被站长踢下线/已登出）→ 上层返回 401 让前端跳登录页
  if (sErr || !session) return { admitted: false, online: 0, invalid: true };

  await c.from('sessions').update({ last_seen_at: nowIso }).eq('token', token);

  const windowStart = new Date(Date.now() - ONLINE_WINDOW_SEC * 1000).toISOString();
  const { count, error } = await c
    .from('sessions')
    .select('token', { count: 'exact', head: true })
    .gt('last_seen_at', windowStart)
    .gt('expires_at', nowIso);
  const online = error ? 0 : count || 0;

  return { admitted: online <= ONLINE_LIMIT, online };
}

/** 未登录访客也参与容量判断：登录接口在满员时拒绝新进入 */
export async function isOnlineFull(): Promise<boolean> {
  const c = getSupabaseClient();
  const nowIso = new Date().toISOString();
  const windowStart = new Date(Date.now() - ONLINE_WINDOW_SEC * 1000).toISOString();
  const { count, error } = await c
    .from('sessions')
    .select('token', { count: 'exact', head: true })
    .gt('last_seen_at', windowStart)
    .gt('expires_at', nowIso);
  if (error) return false;
  return (count || 0) > ONLINE_LIMIT;
}
