/**
 * server/authRoutes.ts —— /api/auth/* 与 /api/workspaces/* 路由。
 *
 * 独立于 routes.ts（plan/lock/todo 等）—— 不破坏既有 18 个 endpoint。
 * 所有响应体遵循 { code, data, message }（K9，与既有 routes 同口径）。
 *
 * Auth 端点（公开）：
 *   POST /api/auth/register           带 inviteToken 注册
 *   POST /api/auth/login              用户名+密码登录
 *   POST /api/auth/logout             注销当前 session
 *   GET  /api/auth/me                 当前登录信息（debug / 健康检查）
 *
 * Workspace 端点（需登录）：
 *   GET    /api/workspaces                  列出我所在的所有 workspace
 *   POST   /api/workspaces                  创建 workspace（任何登录用户）
 *   GET    /api/workspaces/:wsId            workspace 详情
 *   POST   /api/workspaces/:wsId/members    添加成员（owner-only）
 *   DELETE /api/workspaces/:wsId/members/:userId  移除成员（owner-only）
 *   POST   /api/workspaces/:wsId/invites    创建邀请链接（owner-only）
 *   GET    /api/workspaces/:wsId/invites    列出 workspace 邀请（owner-only）
 *   DELETE /api/workspaces/:wsId/invites/:token  撤销邀请（owner-only）
 *
 * User 端点：
 *   GET /api/users                         列出所有用户（仅 admin role 用户可见）
 */

import { Router, type NextFunction, type Request, type Response } from 'express';
import { DomainError, ErrCode, httpStatusOf, isDomainError, type ApiResp } from '../shared/types';
import {
  AUTH_ERR,
  addMembership,
  authenticate,
  buildCookieHeader,
  clearCookieHeader,
  createSession,
  createUser,
  createWorkspace,
  createInvite,
  destroySession,
  extractTokenFromCookie,
  findUserByUsername,
  findUserById,
  getAuth,
  getWorkspaceRole,
  isWorkspaceOwner,
  listAllWorkspaces,
  listInvitesForWorkspace,
  purgeExpiredInvites,
  purgeExpiredSessions,
  revokeInvite,
  findInvite as lookupInvite,
  removeWorkspaceMember,
  requireAuth,
  requireSameWorkspace,
  requireWorkspaceRole,
  toPublic,
  toPublicWorkspace,
  addWorkspaceMember,
  findWorkspace,
  setWorkspaceMemberRole,
  listWorkspacesForUser,
  validateInvite,
  consumeInvite,
  validateSession,
} from './auth';
import { config } from './config';
import { readUsers } from './auth';

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void> | void;
function asyncHandler(fn: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const r = fn(req, res, next);
      if (r instanceof Promise) r.catch(next);
    } catch (e) {
      next(e);
    }
  };
}

function ok<T>(res: Response, data: T, message = 'ok'): void {
  const body: ApiResp<T> = { code: ErrCode.OK, data, message };
  res.status(200).json(body);
}

function fail(res: Response, code: number, message: string, data: unknown = null): void {
  const body: ApiResp<unknown> = { code, data, message };
  res.status(httpStatusOf(code)).json(body);
}

function isProdEnv(): boolean {
  return process.env.NODE_ENV === 'production';
}

/* ------------------------------ Auth 路由 ------------------------------ */

export function createAuthRouter(): Router {
  const router = Router();

  /** POST /api/auth/register — 带 inviteToken 注册；不带则可注册但不入任何 workspace */
  router.post(
    '/register',
    asyncHandler((req, res) => {
      const username = String(req.body?.username ?? '').trim();
      const password = String(req.body?.password ?? '');
      const displayName = typeof req.body?.displayName === 'string' ? req.body.displayName.trim() : '';
      const inviteToken = typeof req.body?.inviteToken === 'string' ? req.body.inviteToken.trim() : '';

      if (username === '' || password === '') {
        fail(res, AUTH_ERR.AUTH_REQUIRED, '缺少 username 或 password');
        return;
      }

      // 1. 创建用户（不传 workspace，由 invite 决定）
      const user = createUser({ username, password, displayName: displayName || username });

      // 2. 若带 invite token → 校验 + 消费 + 加入 workspace
      let joinedWsId: string | null = null;
      let joinedWsRole: string | null = null;
      if (inviteToken) {
        const inv = validateInvite(inviteToken);
        consumeInvite(inviteToken, user.userId);
        addWorkspaceMember(inv.workspaceId, user.userId, inv.role);
        joinedWsId = inv.workspaceId;
        joinedWsRole = inv.role;
      }

      // 3. 若未加入任何 workspace，且没有现存 workspace → 自动建一个个人 workspace
      if (!joinedWsId) {
        const wsRes = bootstrapPersonalWorkspace(user.userId, user.displayName);
        joinedWsId = wsRes.workspaceId;
        joinedWsRole = 'owner';
      }

      // 4. 立即创建 session 并 set cookie
      const sess = createSession({ userId: user.userId, workspaceId: joinedWsId, role: joinedWsRole as 'owner' | 'editor' | 'viewer' });
      const ttlMs = Date.parse(sess.expiresAt) - Date.now();
      res.setHeader('Set-Cookie', buildCookieHeader(sess.token, { secure: isProdEnv(), maxAgeMs: ttlMs }));
      ok(res, {
        user: toPublic(user),
        session: { token: sess.token, expiresAt: sess.expiresAt },
        workspaceId: joinedWsId,
      });
    }),
  );

  /** POST /api/auth/login */
  router.post(
    '/login',
    asyncHandler((req, res) => {
      const username = String(req.body?.username ?? '').trim();
      const password = String(req.body?.password ?? '');
      const workspaceIdRaw = typeof req.body?.workspaceId === 'string' ? req.body.workspaceId.trim() : '';
      if (username === '' || password === '') {
        fail(res, AUTH_ERR.AUTH_REQUIRED, '缺少 username 或 password');
        return;
      }
      const user = authenticate(username, password);
      if (!user) {
        fail(res, AUTH_ERR.INVALID_CREDENTIALS, '用户名或密码不正确');
        return;
      }
      // 取 session 目标 workspace：请求指定 → 该 workspace 成员身份；否则取首个 membership
      let targetWsId = workspaceIdRaw;
      let targetRole: 'owner' | 'editor' | 'viewer' = 'viewer';
      if (targetWsId) {
        const r = getWorkspaceRole(targetWsId, user.userId);
        if (!r) {
          fail(res, AUTH_ERR.WORKSPACE_FORBIDDEN, '非该 workspace 成员');
          return;
        }
        targetRole = r;
      } else if (user.memberships.length > 0) {
        targetWsId = user.memberships[0].workspaceId;
        targetRole = user.memberships[0].workspaceRole;
      } else {
        // 用户没有任何 workspace：建个人 workspace
        const wsRes = bootstrapPersonalWorkspace(user.userId, user.displayName);
        targetWsId = wsRes.workspaceId;
        targetRole = 'owner';
      }
      const sess = createSession({ userId: user.userId, workspaceId: targetWsId, role: targetRole });
      const ttlMs = Date.parse(sess.expiresAt) - Date.now();
      res.setHeader('Set-Cookie', buildCookieHeader(sess.token, { secure: isProdEnv(), maxAgeMs: ttlMs }));
      ok(res, {
        user: toPublic(user),
        session: { token: sess.token, expiresAt: sess.expiresAt },
        workspaceId: targetWsId,
        role: targetRole,
      });
    }),
  );

  /** POST /api/auth/logout */
  router.post(
    '/logout',
    asyncHandler((req, res) => {
      const token = extractTokenFromCookie(req.headers.cookie);
      if (token) destroySession(token);
      res.setHeader('Set-Cookie', clearCookieHeader());
      ok(res, { ok: true });
    }),
  );

  /** GET /api/auth/me — 当前登录信息 */
  router.get(
    '/me',
    asyncHandler((req, res) => {
      const auth = getAuth(req);
      if (!auth) {
        fail(res, AUTH_ERR.AUTH_REQUIRED, '未登录');
        return;
      }
      const user = findUserById(auth.userId);
      if (!user) {
        fail(res, AUTH_ERR.AUTH_REQUIRED, '用户不存在');
        return;
      }
      ok(res, {
        user: toPublic(user),
        workspace: { workspaceId: auth.workspaceId, role: auth.role },
        sessionToken: auth.sessionToken,
      });
    }),
  );

  /** POST /api/auth/switch-workspace — 切换 session 当前 workspace（多 workspace 用户） */
  router.post(
    '/switch-workspace',
    asyncHandler((req, res) => {
      const auth = getAuth(req);
      if (!auth) {
        fail(res, AUTH_ERR.AUTH_REQUIRED, '需要登录');
        return;
      }
      const newWsId = String(req.body?.workspaceId ?? '').trim();
      const newRole = getWorkspaceRole(newWsId, auth.userId);
      if (!newRole) {
        fail(res, AUTH_ERR.WORKSPACE_FORBIDDEN, '非该 workspace 成员');
        return;
      }
      // 销毁旧 session，签发新 session
      destroySession(auth.sessionToken);
      const sess = createSession({ userId: auth.userId, workspaceId: newWsId, role: newRole });
      const ttlMs = Date.parse(sess.expiresAt) - Date.now();
      res.setHeader('Set-Cookie', buildCookieHeader(sess.token, { secure: isProdEnv(), maxAgeMs: ttlMs }));
      ok(res, { workspaceId: newWsId, role: newRole });
    }),
  );

  return router;
}

/* ------------------------------ Workspace 路由 ------------------------------ */

export function createWorkspaceRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  /** GET /api/workspaces — 列出我所在的所有 workspace */
  router.get(
    '/',
    asyncHandler((req, res) => {
      const auth = getAuth(req)!;
      const all = listWorkspacesForUser(auth.userId);
      ok(res, all.map(toPublicWorkspace));
    }),
  );

  /** POST /api/workspaces — 创建 workspace */
  router.post(
    '/',
    asyncHandler((req, res) => {
      const auth = getAuth(req)!;
      const name = String(req.body?.name ?? '').trim();
      const description = typeof req.body?.description === 'string' ? req.body.description : undefined;
      const ws = createWorkspace({ name, createdBy: auth.userId, description });
      ok(res, toPublicWorkspace(ws));
    }),
  );

  /** GET /api/workspaces/:wsId */
  router.get(
    '/:wsId',
    requireSameWorkspace,
    asyncHandler((req, res) => {
      const auth = getAuth(req)!;
      const ws = findWorkspace(auth.workspaceId);
      if (!ws) {
        fail(res, AUTH_ERR.WORKSPACE_NOT_FOUND, 'workspace 不存在');
        return;
      }
      ok(res, toPublicWorkspace(ws));
    }),
  );

  /** POST /api/workspaces/:wsId/members — 添加成员（owner-only） */
  router.post(
    '/:wsId/members',
    requireSameWorkspace,
    requireWorkspaceRole('owner'),
    asyncHandler((req, res) => {
      const auth = getAuth(req)!;
      const userId = String(req.body?.userId ?? '').trim();
      const role = String(req.body?.role ?? 'viewer') as 'owner' | 'editor' | 'viewer';
      if (!userId || !['owner', 'editor', 'viewer'].includes(role)) {
        fail(res, ErrCode.ERR_VALIDATION, '缺少 userId 或 role 非法');
        return;
      }
      const targetUser = findUserById(userId);
      if (!targetUser) {
        fail(res, ErrCode.ERR_VALIDATION, '用户不存在');
        return;
      }
      const ws = addWorkspaceMember(auth.workspaceId, userId, role);
      if (!ws) {
        fail(res, AUTH_ERR.WORKSPACE_NOT_FOUND, 'workspace 不存在');
        return;
      }
      ok(res, toPublicWorkspace(ws));
    }),
  );

  /** DELETE /api/workspaces/:wsId/members/:userId */
  router.delete(
    '/:wsId/members/:userId',
    requireSameWorkspace,
    requireWorkspaceRole('owner'),
    asyncHandler((req, res) => {
      const auth = getAuth(req)!;
      const userId = String(req.params.userId);
      if (userId === auth.userId) {
        fail(res, ErrCode.ERR_VALIDATION, 'owner 不能移除自己');
        return;
      }
      const ok2 = removeWorkspaceMember(auth.workspaceId, userId);
      if (!ok2) {
        fail(res, ErrCode.ERR_VALIDATION, '成员不存在或不能移除 owner');
        return;
      }
      ok(res, { ok: true });
    }),
  );

  /** POST /api/workspaces/:wsId/members/:userId/role — 改成员角色（owner-only） */
  router.put(
    '/:wsId/members/:userId/role',
    requireSameWorkspace,
    requireWorkspaceRole('owner'),
    asyncHandler((req, res) => {
      const auth = getAuth(req)!;
      const userId = String(req.params.userId);
      const role = String(req.body?.role ?? '') as 'owner' | 'editor' | 'viewer';
      if (!['owner', 'editor', 'viewer'].includes(role)) {
        fail(res, ErrCode.ERR_VALIDATION, 'role 非法');
        return;
      }
      const ok2 = setWorkspaceMemberRole(auth.workspaceId, userId, role);
      if (!ok2) {
        fail(res, ErrCode.ERR_VALIDATION, '成员不存在或角色冲突');
        return;
      }
      ok(res, { ok: true });
    }),
  );

  /** POST /api/workspaces/:wsId/invites — 创建邀请链接 */
  router.post(
    '/:wsId/invites',
    requireSameWorkspace,
    requireWorkspaceRole('owner'),
    asyncHandler((req, res) => {
      const auth = getAuth(req)!;
      const role = String(req.body?.role ?? 'editor') as 'owner' | 'editor' | 'viewer';
      const ttlMs = Number(req.body?.ttlMs) > 0 ? Number(req.body.ttlMs) : undefined;
      if (!['owner', 'editor', 'viewer'].includes(role)) {
        fail(res, ErrCode.ERR_VALIDATION, 'role 非法');
        return;
      }
      const inv = createInvite({
        workspaceId: auth.workspaceId,
        role,
        createdBy: auth.userId,
        ...(ttlMs ? { ttlMs } : {}),
      });
      ok(res, {
        token: inv.token,
        workspaceId: inv.workspaceId,
        role: inv.role,
        expiresAt: inv.expiresAt,
        /** 注册链接（前端可拼装完整 URL） */
        inviteUrlHint: `/api/auth/register?invite=${inv.token}`,
      });
    }),
  );

  /** GET /api/workspaces/:wsId/invites — 列出 workspace 邀请 */
  router.get(
    '/:wsId/invites',
    requireSameWorkspace,
    requireWorkspaceRole('owner'),
    asyncHandler((req, res) => {
      const auth = getAuth(req)!;
      const invites = listInvitesForWorkspace(auth.workspaceId);
      ok(res, invites.map((i) => ({
        token: i.token,
        role: i.role,
        status: i.status,
        createdBy: i.createdBy,
        createdAt: i.createdAt,
        expiresAt: i.expiresAt,
        consumedBy: i.consumedBy,
        consumedAt: i.consumedAt,
      })));
    }),
  );

  /** DELETE /api/workspaces/:wsId/invites/:token — 撤销邀请 */
  router.delete(
    '/:wsId/invites/:token',
    requireSameWorkspace,
    requireWorkspaceRole('owner'),
    asyncHandler((req, res) => {
      const token = String(req.params.token);
      try {
        revokeInvite(token, getAuth(req)!.userId);
        ok(res, { ok: true });
      } catch (e) {
        if (isDomainError(e)) {
          fail(res, e.code, e.message);
          return;
        }
        throw e;
      }
    }),
  );

  /** POST /api/workspaces/join-via-invite — 接受邀请（已注册用户） */
  router.post(
    '/join-via-invite',
    asyncHandler((req, res) => {
      const auth = getAuth(req)!;
      const token = String(req.body?.inviteToken ?? '').trim();
      if (!token) {
        fail(res, ErrCode.ERR_VALIDATION, '缺少 inviteToken');
        return;
      }
      const inv = validateInvite(token);
      consumeInvite(token, auth.userId);
      addWorkspaceMember(inv.workspaceId, auth.userId, inv.role);
      ok(res, { workspaceId: inv.workspaceId, role: inv.role });
    }),
  );

  /** GET /api/workspaces/invites/:token — 查邀请详情（无需登录，供前端展示"邀请存在/过期/已用"） */
  router.get(
    '/invites/:token',
    asyncHandler((req, res) => {
      const inv = lookupInvite(String(req.params.token));
      if (!inv) {
        fail(res, AUTH_ERR.INVITE_INVALID, '邀请链接无效');
        return;
      }
      // 不返回敏感字段，仅展示
      ok(res, {
        workspaceId: inv.workspaceId,
        role: inv.role,
        status: inv.status,
        expiresAt: inv.expiresAt,
      });
    }),
  );

  return router;
}

/* ------------------------------ Users 路由（admin-only） ------------------------------ */

export function createUsersRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  /** GET /api/users — 列出所有用户（admin role 才能看；其他登录用户只能看自己） */
  router.get(
    '/',
    asyncHandler((req, res) => {
      const auth = getAuth(req)!;
      const file = readUsers();
      const users = Object.values(file.users);
      const visible = auth.role === 'admin' || users.some((u: { userId: string; role: string }) => u.userId === auth.userId && u.role === 'admin')
        ? users.map(toPublic)
        : users.filter((u: { userId: string }) => u.userId === auth.userId).map(toPublic);
      ok(res, visible);
    }),
  );

  return router;
}

/* ------------------------------ Bootstrap helper ------------------------------ */

import { createWorkspace as createWsFromAuth } from './auth';

function bootstrapPersonalWorkspace(userId: string, displayName: string): { workspaceId: string } {
  const ws = createWsFromAuth({
    name: `${displayName} 的工作区`,
    createdBy: userId,
    description: '个人 workspace',
  });
  return { workspaceId: ws.workspaceId };
}

// 重导出 purgeExpired 给 index.ts 在启动期调用
export { purgeExpiredSessions, purgeExpiredInvites };
