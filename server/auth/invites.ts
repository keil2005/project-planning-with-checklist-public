/**
 * server/auth/invites.ts —— 邀请链接（一次性 token）。
 *
 * 流程：
 *   1. owner 在 ws 内创建邀请（指定 role + 有效期）→ 返回一次性 token
 *   2. 受邀者 POST /api/auth/register 带 inviteToken → workspace 自动加入
 *   3. token 状态变为 'consumed'；二次使用 → 4103
 *
 * 约束：
 *   - 默认 7 天过期
 *   - 一次性消费（consumed_at 落库）
 *   - 撤销（revoked）只能由 owner 操作
 */

import { nowTimestamp } from '../../shared/datetime';
import { DomainError, ErrCode } from '../../shared/types';
import { generateToken } from './password';
import { readInvites, writeInvites } from './store';
import { findWorkspace, isWorkspaceMember } from './workspaces';
import { findUserById } from './users';
import { AUTH_ERR } from './types';
import type { InviteRecord, InviteStatus, WorkspaceRole } from './types';

const DEFAULT_TTL_MS = 7 * 24 * 3600 * 1000;

export function createInvite(input: {
  workspaceId: string;
  role: WorkspaceRole;
  createdBy: string;
  ttlMs?: number;
}): InviteRecord {
  const ws = findWorkspace(input.workspaceId);
  if (!ws) {
    throw new DomainError(ErrCode.ERR_VALIDATION, `workspace ${input.workspaceId} 不存在`);
  }
  const creator = findUserById(input.createdBy);
  if (!creator) {
    throw new DomainError(ErrCode.ERR_VALIDATION, `邀请发起人 userId=${input.createdBy} 不存在`);
  }
  if (!isWorkspaceMember(input.workspaceId, input.createdBy)) {
    throw new DomainError(ErrCode.ERR_VALIDATION, '邀请发起人必须是 workspace 成员');
  }
  const token = generateToken();
  const now = Date.now();
  const ttl = input.ttlMs ?? DEFAULT_TTL_MS;
  const rec: InviteRecord = {
    token,
    workspaceId: input.workspaceId,
    role: input.role,
    createdBy: input.createdBy,
    createdAt: nowTimestamp(),
    expiresAt: new Date(now + ttl).toISOString(),
    status: 'pending',
  };
  const file = readInvites();
  file.invites[token] = rec;
  writeInvites(file);
  return rec;
}

export function findInvite(token: string): InviteRecord | null {
  return readInvites().invites[token] ?? null;
}

/** 校验邀请（不消费）；返回 pending 邀请或抛错 */
export function validateInvite(token: string): InviteRecord {
  const inv = findInvite(token);
  if (!inv) {
    throw new DomainError(AUTH_ERR.INVITE_INVALID, '邀请链接无效');
  }
  if (inv.status === 'consumed') {
    throw new DomainError(AUTH_ERR.INVITE_CONSUMED, '邀请链接已被使用');
  }
  if (inv.status === 'revoked') {
    throw new DomainError(AUTH_ERR.INVITE_INVALID, '邀请链接已撤销');
  }
  if (inv.status === 'expired' || Date.parse(inv.expiresAt) <= Date.now()) {
    throw new DomainError(AUTH_ERR.INVITE_EXPIRED, '邀请链接已过期');
  }
  if (inv.status !== 'pending') {
    throw new DomainError(AUTH_ERR.INVITE_INVALID, `邀请链接状态异常：${inv.status}`);
  }
  return inv;
}

/** 消费邀请（注册/加入时调用），更新状态为 consumed */
export function consumeInvite(token: string, userId: string): InviteRecord {
  const file = readInvites();
  const inv = file.invites[token];
  if (!inv) {
    throw new DomainError(AUTH_ERR.INVITE_INVALID, '邀请链接无效');
  }
  if (inv.status === 'consumed') {
    throw new DomainError(AUTH_ERR.INVITE_CONSUMED, '邀请链接已被使用');
  }
  if (inv.status !== 'pending') {
    throw new DomainError(AUTH_ERR.INVITE_INVALID, `邀请链接状态异常：${inv.status}`);
  }
  inv.status = 'consumed';
  inv.consumedBy = userId;
  inv.consumedAt = nowTimestamp();
  writeInvites(file);
  return inv;
}

/** 撤销邀请（owner-only） */
export function revokeInvite(token: string, byUserId: string): InviteRecord {
  const file = readInvites();
  const inv = file.invites[token];
  if (!inv) {
    throw new DomainError(AUTH_ERR.INVITE_INVALID, '邀请链接无效');
  }
  if (inv.createdBy !== byUserId && !isWorkspaceMember(inv.workspaceId, byUserId)) {
    throw new DomainError(ErrCode.ERR_VALIDATION, '无权撤销此邀请');
  }
  inv.status = 'revoked';
  writeInvites(file);
  return inv;
}

/** 列出某 workspace 下所有邀请（owner 视角） */
export function listInvitesForWorkspace(workspaceId: string): InviteRecord[] {
  return Object.values(readInvites().invites).filter((i) => i.workspaceId === workspaceId);
}

/** 清理过期邀请 */
export function purgeExpiredInvites(): number {
  const file = readInvites();
  const now = Date.now();
  let purged = 0;
  for (const [token, inv] of Object.entries(file.invites)) {
    if (inv.status === 'pending' && Date.parse(inv.expiresAt) <= now) {
      inv.status = 'expired';
      purged++;
    }
  }
  if (purged > 0) writeInvites(file);
  return purged;
}

export type { InviteStatus };
