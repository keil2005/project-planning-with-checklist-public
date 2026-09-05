/**
 * server/auth/middleware.ts —— Express 中间件（鉴权 + 工作区角色校验）。
 *
 * 设计：
 * - optionalAuth: 解析 cookie → req.auth（未登录为 undefined）；不强制登录
 * - requireAuth: 必须登录；未登录 → 4401
 * - requireWorkspaceRole(role): 必须为 workspace 指定角色或更高
 *
 * 注：本中间件只挂在新加的 /api/auth/* 与 /api/workspaces/* 等 endpoint；
 * 现有 plan/todo/lock 等 endpoint 不强制（v1.0 向后兼容），等 v1.1 前端登录 UI 上线后收紧。
 */

import type { NextFunction, Request, Response } from 'express';
import { DomainError, ErrCode } from '../../shared/types';
import { extractTokenFromCookie, validateSession } from './sessions';
import { findUserById } from './users';
import { getWorkspaceRole } from './workspaces';
import { AUTH_ERR } from './types';
import type { AuthContext, WorkspaceRole } from './types';

/** 解析 cookie → req.auth（未登录为 undefined） */
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  try {
    const token = extractTokenFromCookie(req.headers.cookie);
    if (!token) {
      next();
      return;
    }
    const sess = validateSession(token);
    const user = findUserById(sess.userId);
    if (!user) {
      // session 引用了已删除用户 → 当作未登录
      next();
      return;
    }
    const role = getWorkspaceRole(sess.workspaceId, sess.userId) ?? sess.role;
    const ctx: AuthContext = {
      userId: sess.userId,
      username: user.username,
      displayName: user.displayName,
      workspaceId: sess.workspaceId,
      role,
      sessionToken: token,
    };
    (req as Request & { auth?: AuthContext }).auth = ctx;
    next();
  } catch {
    // session 无效/过期：忽略，匿名处理
    next();
  }
}

/** 强制登录 */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const auth = (req as Request & { auth?: AuthContext }).auth;
  if (!auth) {
    next(new DomainError(AUTH_ERR.AUTH_REQUIRED, '需要登录'));
    return;
  }
  next();
}

/** 强制 workspace 指定角色或更高 */
export function requireWorkspaceRole(minRole: WorkspaceRole) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const auth = (req as Request & { auth?: AuthContext }).auth;
    if (!auth) {
      next(new DomainError(AUTH_ERR.AUTH_REQUIRED, '需要登录'));
      return;
    }
    const rank: Record<WorkspaceRole, number> = { viewer: 1, editor: 2, owner: 3 };
    if (rank[auth.role] < rank[minRole]) {
      next(new DomainError(AUTH_ERR.ROLE_INSUFFICIENT, `需要 ${minRole} 角色（当前 ${auth.role}）`));
      return;
    }
    next();
  };
}

/** 取请求上的 auth context（无则 undefined） */
export function getAuth(req: Request): AuthContext | undefined {
  return (req as Request & { auth?: AuthContext }).auth;
}

/** URL 参数中的 workspaceId 与 session 中的 workspace 是否一致 */
export function requireSameWorkspace(req: Request, _res: Response, next: NextFunction): void {
  const auth = getAuth(req);
  if (!auth) {
    next(new DomainError(AUTH_ERR.AUTH_REQUIRED, '需要登录'));
    return;
  }
  const wsParam = (req.params.workspaceId ?? req.params.wsId ?? '') as string;
  if (wsParam && wsParam !== auth.workspaceId) {
    next(new DomainError(AUTH_ERR.WORKSPACE_FORBIDDEN, 'session 与 workspace 不匹配'));
    return;
  }
  next();
}

export { ErrCode };
