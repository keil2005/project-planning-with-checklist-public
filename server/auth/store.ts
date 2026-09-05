/**
 * server/auth/store.ts —— 身份数据的原子读写 + 自举。
 *
 * 落盘结构：
 *   DATA_DIR/auth/users.json
 *   DATA_DIR/auth/sessions.json
 *   DATA_DIR/auth/workspaces.json
 *   DATA_DIR/auth/invites.json
 *
 * 规则：
 *   - 原子写（tmp → rename，与 storage.ts 同口径）
 *   - 内存缓存：读写通过 facade，每次写操作回写文件
 *   - 文件不存在返回空对象（首次启动）
 */

import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config';
import type { InvitesFile, SessionsFile, UsersFile, WorkspacesFile } from './types';

const AUTH_DIR = (): string => path.join(config.dataDir, 'auth');

function atomicWriteJson(file: string, obj: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(obj, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, file);
}

function readJsonIfExists<T>(file: string, fallback: T): T {
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch (e) {
    console.warn(`[auth-store] 读取失败 ${file}：${String(e)}；返回 fallback`);
    return fallback;
  }
}

function emptyUsers(): UsersFile {
  return { schemaVersion: 1, users: {} };
}
function emptySessions(): SessionsFile {
  return { schemaVersion: 1, sessions: {} };
}
function emptyWorkspaces(): WorkspacesFile {
  return { schemaVersion: 1, workspaces: {} };
}
function emptyInvites(): InvitesFile {
  return { schemaVersion: 1, invites: {} };
}

/* ------------------------------ Users ------------------------------ */

let usersCache: UsersFile | null = null;
const usersFile = (): string => path.join(AUTH_DIR(), 'users.json');

export function readUsers(): UsersFile {
  if (usersCache === null) {
    usersCache = readJsonIfExists<UsersFile>(usersFile(), emptyUsers());
  }
  return usersCache;
}

export function writeUsers(data: UsersFile): void {
  data.schemaVersion = 1;
  usersCache = data;
  atomicWriteJson(usersFile(), data);
}

/* ------------------------------ Sessions ------------------------------ */

let sessionsCache: SessionsFile | null = null;
const sessionsFile = (): string => path.join(AUTH_DIR(), 'sessions.json');

export function readSessions(): SessionsFile {
  if (sessionsCache === null) {
    sessionsCache = readJsonIfExists<SessionsFile>(sessionsFile(), emptySessions());
  }
  return sessionsCache;
}

export function writeSessions(data: SessionsFile): void {
  data.schemaVersion = 1;
  sessionsCache = data;
  atomicWriteJson(sessionsFile(), data);
}

/* ------------------------------ Workspaces ------------------------------ */

let workspacesCache: WorkspacesFile | null = null;
const workspacesFilePath = (): string => path.join(AUTH_DIR(), 'workspaces.json');

export function readWorkspaces(): WorkspacesFile {
  if (workspacesCache === null) {
    workspacesCache = readJsonIfExists<WorkspacesFile>(workspacesFilePath(), emptyWorkspaces());
  }
  return workspacesCache;
}

export function writeWorkspaces(data: WorkspacesFile): void {
  data.schemaVersion = 1;
  workspacesCache = data;
  atomicWriteJson(workspacesFilePath(), data);
}

/* ------------------------------ Invites ------------------------------ */

let invitesCache: InvitesFile | null = null;
const invitesFile = (): string => path.join(AUTH_DIR(), 'invites.json');

export function readInvites(): InvitesFile {
  if (invitesCache === null) {
    invitesCache = readJsonIfExists<InvitesFile>(invitesFile(), emptyInvites());
  }
  return invitesCache;
}

export function writeInvites(data: InvitesFile): void {
  data.schemaVersion = 1;
  invitesCache = data;
  atomicWriteJson(invitesFile(), data);
}

/* ------------------------------ 自举 ------------------------------ */

/** 确保 auth 目录存在（首次启动） */
export function ensureAuthDir(): void {
  fs.mkdirSync(AUTH_DIR(), { recursive: true });
}

/** 加载所有 cache（用于启动后一次性自举） */
export function warmAuthCache(): void {
  ensureAuthDir();
  readUsers();
  readSessions();
  readWorkspaces();
  readInvites();
}
