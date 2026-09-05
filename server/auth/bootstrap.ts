/**
 * server/auth/bootstrap.ts —— 启动期身份层自举。
 *
 * 触发顺序（main() 内）：
 *   1. ensureAuthDir() + warmAuthCache()
 *   2. bootstrapAdminFromEnv() — 若无任何用户 + 环境变量 ADMIN_USER+ADMIN_PASSWORD → 建首位 admin
 *   3. bootstrapDemoSeed() — 若无任何 workspace → 创建 demo workspace 并预填 sample plan
 *
 * demo seed 仅在 DATA_DIR 完全空时执行；用户一旦开始使用就停止注入。
 */

import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config';
import { seedDemoPlanIfEmpty } from '../demoSeed';
import { createUser } from './users';
import { createWorkspace, findWorkspace, addWorkspaceMember } from './workspaces';
import { isFirstUserAdminBootstrap } from './users';

const DEFAULT_DEMO_WORKSPACE_NAME = 'Demo Workspace';

/** 读取环境变量首位 admin（不抛错；缺一即不创建） */
export function bootstrapAdminFromEnv(): { created: boolean; username?: string; userId?: string } {
  const username = process.env.ADMIN_USER?.trim();
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password) {
    return { created: false };
  }
  if (!isFirstUserAdminBootstrap()) {
    return { created: false }; // 已有用户，不重复创建
  }
  const user = createUser({
    username,
    password,
    displayName: username,
    role: 'admin',
    allowWeakPassword: true, // 启动期允许弱密码（dev 体验），生产应在 env 强制 ≥10 字符
  });
  return { created: true, username: user.username, userId: user.userId };
}

/** 若无 workspace：建默认 + demo 计划 */
export function bootstrapDemoWorkspace(): {
  created: boolean;
  workspaceId?: string;
  adminUserId?: string;
} {
  // 找任一 admin 用户作为 demo ws owner
  const usersFile = fs.existsSync(path.join(config.dataDir, 'auth', 'users.json'))
    ? JSON.parse(fs.readFileSync(path.join(config.dataDir, 'auth', 'users.json'), 'utf8'))
    : { users: {} };
  const adminUser = Object.values(usersFile.users).find((u: { role?: string }) => u.role === 'admin') as
    | { userId: string; username: string }
    | undefined;
  if (!adminUser) {
    return { created: false };
  }

  // 已有 workspace 就不重复 seed
  const wsFile = fs.existsSync(path.join(config.dataDir, 'auth', 'workspaces.json'))
    ? JSON.parse(fs.readFileSync(path.join(config.dataDir, 'auth', 'workspaces.json'), 'utf8'))
    : { workspaces: {} };
  if (Object.keys(wsFile.workspaces).length > 0) {
    const firstWs = Object.values(wsFile.workspaces)[0] as { workspaceId: string };
    return { created: false, workspaceId: firstWs.workspaceId, adminUserId: adminUser.userId };
  }

  const ws = createWorkspace({
    name: DEFAULT_DEMO_WORKSPACE_NAME,
    createdBy: adminUser.userId,
    description: '首次启动自动创建的演示 workspace。可在管理后台改名或归档。',
  });
  return { created: true, workspaceId: ws.workspaceId, adminUserId: adminUser.userId };
}

/** 完整启动自举：返回自举状态供启动日志使用 */
export function bootstrapAuth(): {
  adminCreated: boolean;
  adminUsername?: string;
  demoWsCreated: boolean;
  demoWsId?: string;
} {
  const adminRes = bootstrapAdminFromEnv();
  const wsRes = bootstrapDemoWorkspace();
  return {
    adminCreated: adminRes.created,
    adminUsername: adminRes.username,
    demoWsCreated: wsRes.created,
    demoWsId: wsRes.workspaceId,
  };
}

/** demo 计划 seed（仅在 workspace 刚建且 DATA_DIR/plans/* 空时触发） */
export function maybeSeedDemoPlan(workspaceId: string, createdBy: string): boolean {
  const result = seedDemoPlanIfEmpty(workspaceId, createdBy);
  return result.seeded;
}

export { findWorkspace, addWorkspaceMember };
