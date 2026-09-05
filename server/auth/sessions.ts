/**
 * server/auth/sessions.ts —— Session 创建 / 校验 / 失效。
 *
 * Session 持久化（重启不丢失登录态）。Cookie 名 = `pg_sid`。
 * HttpOnly + SameSite=Lax（生产 HTTPS 加 Secure 标志，由反向代理强制）。
 * 默认 7 天有效；每次有效请求滑动续期（lastSeenAt 刷新，expiresAt 在 [lastSeen+ttl] 之内滚动）。
 */

import { nowTimestamp } from '../../shared/datetime';
import { DomainError, ErrCode } from '../../shared/types';
import { generateToken } from './password';
import { readSessions, writeSessions } from './store';
import { findUserById } from './users';
import { AUTH_ERR } from './types';
import type { SessionRecord, WorkspaceRole } from './types';

const DEFAULT_TTL_MS = 7 * 24 * 3600 * 1000; // 7 天
const RENEW_THRESHOLD_MS = 24 * 3600 * 1000; // 续期阈值：剩余 < 1 天则续

export function createSession(input: {
  userId: string;
  workspaceId: string;
  role: WorkspaceRole;
  ttlMs?: number;
}): SessionRecord {
  const token = generateToken();
  const now = Date.now();
  const ttl = input.ttlMs ?? DEFAULT_TTL_MS;
  const sess: SessionRecord = {
    token,
    userId: input.userId,
    workspaceId: input.workspaceId,
    role: input.role,
    createdAt: nowTimestamp(),
    expiresAt: new Date(now + ttl).toISOString(),
    lastSeenAt: nowTimestamp(),
  };
  const file = readSessions();
  file.sessions[token] = sess;
  writeSessions(file);
  return sess;
}

/** 校验 session；返回有效 session 或抛错。自动滑动续期。 */
export function validateSession(token: string): SessionRecord {
  if (!token) {
    throw new DomainError(AUTH_ERR.SESSION_INVALID, '缺少 session token');
  }
  const file = readSessions();
  const sess = file.sessions[token];
  if (!sess) {
    throw new DomainError(AUTH_ERR.SESSION_INVALID, 'session 无效或已注销');
  }
  const now = Date.now();
  const expMs = Date.parse(sess.expiresAt);
  if (!Number.isFinite(expMs) || now > expMs) {
    delete file.sessions[token];
    writeSessions(file);
    throw new DomainError(AUTH_ERR.SESSION_EXPIRED, 'session 已过期');
  }
  // 滑动续期
  if (expMs - now < RENEW_THRESHOLD_MS) {
    sess.expiresAt = new Date(now + DEFAULT_TTL_MS).toISOString();
    sess.lastSeenAt = nowTimestamp();
    writeSessions(file);
  }
  return sess;
}

export function destroySession(token: string): boolean {
  const file = readSessions();
  if (!file.sessions[token]) return false;
  delete file.sessions[token];
  writeSessions(file);
  return true;
}

/** 清理过期 session（启动时调用一次） */
export function purgeExpiredSessions(): number {
  const file = readSessions();
  const now = Date.now();
  let purged = 0;
  for (const [token, sess] of Object.entries(file.sessions)) {
    if (Date.parse(sess.expiresAt) <= now) {
      delete file.sessions[token];
      purged++;
    }
  }
  if (purged > 0) writeSessions(file);
  return purged;
}

/** 从 cookie header 提取 session token（PG_SID） */
export function extractTokenFromCookie(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(/;\s*/);
  for (const p of parts) {
    const eq = p.indexOf('=');
    if (eq < 0) continue;
    const k = p.slice(0, eq).trim();
    if (k === 'pg_sid') {
      return decodeURIComponent(p.slice(eq + 1).trim());
    }
  }
  return null;
}

/** 构造 Set-Cookie header */
export function buildCookieHeader(token: string, opts: { secure: boolean; maxAgeMs: number }): string {
  const parts = [
    `pg_sid=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(opts.maxAgeMs / 1000)}`,
  ];
  if (opts.secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearCookieHeader(): string {
  return 'pg_sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
}

export { findUserById, ErrCode };
