/**
 * server/auth/users.ts —— 用户注册 / 登录 / 查询。
 *
 * 约束：
 * - userId 自生成 `u-<yyyyMMdd>-<random4>`，16 字符以内
 * - username 全小写校验、唯一；3-32 字符
 * - 密码 ≥10 字符（validatePasswordStrength）
 * - 启动时由 env ADMIN_USER/ADMIN_PASSWORD 自举首位 admin
 */

import { nowTimestamp } from '../../shared/datetime';
import { DomainError, ErrCode } from '../../shared/types';
import { generateToken, hashPassword, validatePasswordStrength, verifyPassword } from './password';
import { readUsers, writeUsers } from './store';
import type { PublicUserInfo, UserRecord, UserRole, WorkspaceRole } from './types';

const USERNAME_RE = /^[a-z0-9_-]{3,32}$/;

export function createUser(input: {
  username: string;
  password: string;
  displayName?: string;
  role?: UserRole;
  workspaceId?: string;
  workspaceRole?: WorkspaceRole;
  /** 是否跳过强度校验（仅首次 admin 自举用） */
  allowWeakPassword?: boolean;
}): UserRecord {
  const usernameRaw = String(input.username ?? '').trim().toLowerCase();
  if (!USERNAME_RE.test(usernameRaw)) {
    throw new DomainError(
      ErrCode.ERR_VALIDATION,
      '用户名必须为 3-32 字符（小写字母/数字/下划线/短横）',
    );
  }
  const pwCheck = validatePasswordStrength(String(input.password ?? ''), input.allowWeakPassword === true);
  if (!pwCheck.ok) {
    throw new DomainError(ErrCode.ERR_VALIDATION, `密码强度不足：${pwCheck.reason}`);
  }

  const users = readUsers();
  const exists = Object.values(users.users).find((u) => u.username === usernameRaw);
  if (exists) {
    throw new DomainError(ErrCode.ERR_VALIDATION, `用户名「${usernameRaw}」已被占用`);
  }

  const userId = `u-${nowTimestamp().replace(/[^0-9]/g, '').slice(0, 8)}-${generateToken().slice(0, 4)}`;
  const { hash, salt } = hashPassword(input.password);
  const record: UserRecord = {
    userId,
    username: usernameRaw,
    passwordHash: hash,
    passwordSalt: salt,
    displayName: input.displayName?.trim() || usernameRaw,
    role: input.role ?? 'user',
    createdAt: nowTimestamp(),
    memberships: [],
  };
  if (input.workspaceId && input.workspaceRole) {
    record.memberships.push({
      workspaceId: input.workspaceId,
      workspaceRole: input.workspaceRole,
    });
  }
  users.users[userId] = record;
  writeUsers(users);
  return record;
}

export function findUserByUsername(username: string): UserRecord | null {
  const uname = String(username ?? '').trim().toLowerCase();
  if (!uname) return null;
  const users = readUsers();
  return Object.values(users.users).find((u) => u.username === uname) ?? null;
}

export function findUserById(userId: string): UserRecord | null {
  if (!userId) return null;
  return readUsers().users[userId] ?? null;
}

export function authenticate(username: string, password: string): UserRecord | null {
  const user = findUserByUsername(username);
  if (!user) return null;
  const ok = verifyPassword(password, user.passwordSalt, user.passwordHash);
  return ok ? user : null;
}

export function toPublic(u: UserRecord): PublicUserInfo {
  return {
    userId: u.userId,
    username: u.username,
    displayName: u.displayName,
    role: u.role,
  };
}

/** 把 user 加入某 workspace（membership 去重） */
export function addMembership(userId: string, workspaceId: string, role: WorkspaceRole): UserRecord | null {
  const users = readUsers();
  const u = users.users[userId];
  if (!u) return null;
  if (!u.memberships.some((m) => m.workspaceId === workspaceId)) {
    u.memberships = [...u.memberships, { workspaceId, workspaceRole: role }];
    writeUsers(users);
  }
  return u;
}

/** 修改用户在 workspace 中的角色（admin-only） */
export function setMembershipRole(userId: string, workspaceId: string, role: WorkspaceRole): boolean {
  const users = readUsers();
  const u = users.users[userId];
  if (!u) return false;
  const m = u.memberships.find((x) => x.workspaceId === workspaceId);
  if (!m) return false;
  m.workspaceRole = role;
  writeUsers(users);
  return true;
}

export function isFirstUserAdminBootstrap(): boolean {
  const users = readUsers();
  return Object.keys(users.users).length === 0;
}
