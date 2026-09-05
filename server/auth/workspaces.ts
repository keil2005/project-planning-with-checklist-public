/**
 * server/auth/workspaces.ts —— workspace CRUD + 成员管理。
 *
 * 单 workspace 模型（v1.0）：每个用户至少在一个 workspace；workspace 内三角色 RBAC。
 * workspaceId 自生成 `ws-<yyyyMMdd>-<random4>`（与 planId 同 16 字符内）。
 */

import { nowTimestamp } from '../../shared/datetime';
import { DomainError, ErrCode } from '../../shared/types';
import { generateToken } from './password';
import { readWorkspaces, writeWorkspaces } from './store';
import { addMembership, findUserById, toPublic } from './users';
import type { PublicWorkspaceInfo, WorkspaceRecord, WorkspaceRole } from './types';

const WORKSPACE_NAME_MAX = 80;

export function createWorkspace(input: {
  name: string;
  createdBy: string;
  description?: string;
}): WorkspaceRecord {
  const name = String(input.name ?? '').trim();
  if (name === '') {
    throw new DomainError(ErrCode.ERR_VALIDATION, 'workspace 名称不能为空');
  }
  if (name.length > WORKSPACE_NAME_MAX) {
    throw new DomainError(ErrCode.ERR_VALIDATION, `workspace 名称不得超过 ${WORKSPACE_NAME_MAX} 字符`);
  }
  const creator = findUserById(input.createdBy);
  if (!creator) {
    throw new DomainError(ErrCode.ERR_VALIDATION, `创建者 userId=${input.createdBy} 不存在`);
  }
  const wsId = `ws-${nowTimestamp().replace(/[^0-9]/g, '').slice(0, 8)}-${generateToken().slice(0, 4)}`;
  const now = nowTimestamp();
  const ws: WorkspaceRecord = {
    workspaceId: wsId,
    name,
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
    description: input.description?.trim() || undefined,
    members: [{ userId: input.createdBy, role: 'owner', joinedAt: now }],
  };
  const file = readWorkspaces();
  file.workspaces[wsId] = ws;
  writeWorkspaces(file);
  // 创建者同时获得 membership 记录（双向）
  addMembership(input.createdBy, wsId, 'owner');
  return ws;
}

export function findWorkspace(workspaceId: string): WorkspaceRecord | null {
  return readWorkspaces().workspaces[workspaceId] ?? null;
}

export function listWorkspacesForUser(userId: string): WorkspaceRecord[] {
  const all = Object.values(readWorkspaces().workspaces);
  return all.filter((w) => w.members.some((m) => m.userId === userId));
}

export function listAllWorkspaces(): WorkspaceRecord[] {
  return Object.values(readWorkspaces().workspaces);
}

export function getWorkspaceRole(wsId: string, userId: string): WorkspaceRole | null {
  const w = findWorkspace(wsId);
  if (!w) return null;
  const m = w.members.find((x) => x.userId === userId);
  return m ? m.role : null;
}

export function isWorkspaceMember(wsId: string, userId: string): boolean {
  return getWorkspaceRole(wsId, userId) !== null;
}

export function isWorkspaceOwner(wsId: string, userId: string): boolean {
  return getWorkspaceRole(wsId, userId) === 'owner';
}

export function addWorkspaceMember(wsId: string, userId: string, role: WorkspaceRole): WorkspaceRecord | null {
  const file = readWorkspaces();
  const w = file.workspaces[wsId];
  if (!w) return null;
  if (w.members.some((m) => m.userId === userId)) {
    return w; // 已存在，幂等
  }
  w.members = [...w.members, { userId, role, joinedAt: nowTimestamp() }];
  w.updatedAt = nowTimestamp();
  writeWorkspaces(file);
  addMembership(userId, wsId, role);
  return w;
}

export function removeWorkspaceMember(wsId: string, userId: string): boolean {
  const file = readWorkspaces();
  const w = file.workspaces[wsId];
  if (!w) return false;
  const member = w.members.find((m) => m.userId === userId);
  if (!member) return false;
  if (member.role === 'owner') {
    throw new DomainError(ErrCode.ERR_VALIDATION, 'workspace owner 不能被移除');
  }
  w.members = w.members.filter((m) => m.userId !== userId);
  w.updatedAt = nowTimestamp();
  writeWorkspaces(file);
  return true;
}

export function setWorkspaceMemberRole(wsId: string, userId: string, role: WorkspaceRole): boolean {
  const file = readWorkspaces();
  const w = file.workspaces[wsId];
  if (!w) return false;
  const m = w.members.find((x) => x.userId === userId);
  if (!m) return false;
  if (m.role === 'owner' && role !== 'owner') {
    throw new DomainError(ErrCode.ERR_VALIDATION, 'workspace owner 角色不可降级（需先转让 owner）');
  }
  m.role = role;
  w.updatedAt = nowTimestamp();
  writeWorkspaces(file);
  return true;
}

export function deleteWorkspace(wsId: string): boolean {
  const file = readWorkspaces();
  if (!file.workspaces[wsId]) return false;
  delete file.workspaces[wsId];
  writeWorkspaces(file);
  return true;
}

export function toPublicWorkspace(w: WorkspaceRecord): PublicWorkspaceInfo {
  return {
    workspaceId: w.workspaceId,
    name: w.name,
    description: w.description,
    createdBy: w.createdBy,
    createdAt: w.createdAt,
    updatedAt: w.updatedAt,
    members: w.members.map((m) => {
      const u = findUserById(m.userId);
      return {
        userId: m.userId,
        displayName: u?.displayName ?? m.userId,
        role: m.role,
        joinedAt: m.joinedAt,
      };
    }),
  };
}

/** RBAC 权限检查：viewer < editor < owner */
export function hasWorkspacePermission(wsId: string, userId: string, minRole: WorkspaceRole): boolean {
  const role = getWorkspaceRole(wsId, userId);
  if (!role) return false;
  const rank: Record<WorkspaceRole, number> = { viewer: 1, editor: 2, owner: 3 };
  return rank[role] >= rank[minRole];
}

export { toPublic };
