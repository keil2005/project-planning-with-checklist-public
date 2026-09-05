/**
 * server/auth/types.ts —— 身份与协作层数据类型。
 *
 * 设计原则：
 * - 数据落盘独立于 plans/：auth/users.json / auth/sessions.json / auth/workspaces.json / auth/invites.json
 * - 启动时若文件不存在自动空对象 → 配合 ADMIN_USER/PASSWORD env 完成自举
 * - session token 与 invite token 都是 32 字节随机 base64url（256 位熵）
 * - passwords 用 Node 内置 crypto.scrypt 哈希（cost N=2^15，scrypt 强抗 GPU 爆破）
 */

import type { ISODate } from '../../shared/types';

/* ------------------------------ Users ------------------------------ */

export type UserRole = 'admin' | 'user';

/** 单个用户；passwordHash 是 scrypt N=2^15 派生 64 字节 hex（128 字符） */
export interface UserRecord {
  userId: string;
  username: string;
  passwordHash: string;
  passwordSalt: string;
  displayName: string;
  role: UserRole;
  createdAt: string;
  /** workspace membership：userId 属于哪些 workspace + 在该 ws 内的角色 */
  memberships: Array<{ workspaceId: string; workspaceRole: WorkspaceRole }>;
}

export interface UsersFile {
  schemaVersion: 1;
  users: Record<string, UserRecord>; // keyed by userId
}

/* ------------------------------ Sessions ------------------------------ */

export interface SessionRecord {
  token: string;
  userId: string;
  workspaceId: string;
  role: WorkspaceRole;
  createdAt: string;
  expiresAt: string; // ISO 8601
  /** last activity（滑动续期，每次有效请求刷新） */
  lastSeenAt: string;
}

export interface SessionsFile {
  schemaVersion: 1;
  sessions: Record<string, SessionRecord>;
}

/* ------------------------------ Workspaces ------------------------------ */

export type WorkspaceRole = 'owner' | 'editor' | 'viewer';

export interface WorkspaceRecord {
  workspaceId: string;
  name: string;
  createdBy: string;
  createdAt: string;
  /** ISO 8601：与 sessions.json 共用同一 clock */
  updatedAt: string;
  /** 成员清单（owner 不可被移除） */
  members: Array<{ userId: string; role: WorkspaceRole; joinedAt: string }>;
  /** 可选描述 */
  description?: string;
}

export interface WorkspacesFile {
  schemaVersion: 1;
  workspaces: Record<string, WorkspaceRecord>;
}

/* ------------------------------ Invites ------------------------------ */

export type InviteStatus = 'pending' | 'consumed' | 'revoked' | 'expired';

export interface InviteRecord {
  token: string;
  workspaceId: string;
  role: WorkspaceRole;
  /** 邀请发起人 */
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  status: InviteStatus;
  /** consumed 时记录被谁消费 */
  consumedBy?: string;
  consumedAt?: string;
}

export interface InvitesFile {
  schemaVersion: 1;
  invites: Record<string, InviteRecord>;
}

/* ------------------------------ Auth context (request) ------------------------------ */

/** 附加到 req.auth；anon 请求为 null */
export interface AuthContext {
  userId: string;
  username: string;
  displayName: string;
  workspaceId: string;
  role: WorkspaceRole;
  sessionToken: string;
}

export interface PublicUserInfo {
  userId: string;
  username: string;
  displayName: string;
  role: UserRole;
}

export interface PublicWorkspaceInfo {
  workspaceId: string;
  name: string;
  description?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  members: Array<{ userId: string; displayName: string; role: WorkspaceRole; joinedAt: string }>;
}

/* ------------------------------ Errors ------------------------------ */

export const AUTH_ERR = {
  INVALID_CREDENTIALS: 4101,
  WEAK_PASSWORD: 4102,
  USERNAME_TAKEN: 4103,
  SESSION_INVALID: 4104,
  SESSION_EXPIRED: 4105,
  WORKSPACE_NOT_FOUND: 4201,
  WORKSPACE_FORBIDDEN: 4202,
  INVITE_INVALID: 4301,
  INVITE_EXPIRED: 4302,
  INVITE_CONSUMED: 4303,
  AUTH_REQUIRED: 4401,
  ROLE_INSUFFICIENT: 4403,
} as const;

export type AuthErrCode = (typeof AUTH_ERR)[keyof typeof AUTH_ERR];

/** 重新导出 ISODate 类型供 auth 模块共享 */
export type { ISODate };
