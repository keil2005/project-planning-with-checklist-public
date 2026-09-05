/**
 * src/api.ts —— 通道层。
 *
 * 统一解包 { code, data, message }（K9）：code !== 0 一律抛 ApiError，
 * 组件/store 只处理 data 与 ApiError。
 *
 * 认证：所有请求都带 cookie（httpOnly, SameSite=Lax）。fetch 默认 same-origin 行为会带上，
 * 因此无需在 headers 里手动塞 cookie。
 */

import { ErrCode, type ApiResp } from '../shared/types';
import type {
  CalendarConfigData,
  ExportFormat,
  HealthInfo,
  LockState,
  Plan,
  PlanMeta,
  PublicUserInfo,
  PublicWorkspaceInfo,
  SavePlanResp,
  TodoOp,
  TodoOpResp,
  TodosFile,
  VersionEntry,
  VersionMeta,
} from '../shared/types';

const BASE = '/api';

/** 登录响应 */
export interface AuthResp {
  user: PublicUserInfo;
  session: { token: string; expiresAt: string };
  workspaceId: string;
  role?: string;
}

/** 邀请信息（公开） */
export interface InviteInfo {
  workspaceId: string;
  role: string;
  status: 'pending' | 'consumed' | 'revoked' | 'expired';
  expiresAt: string;
}

export class ApiError extends Error {
  public readonly code: number;
  public readonly data: unknown;

  constructor(code: number, message: string, data: unknown = null) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.data = data;
  }
}

async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const init: RequestInit = {
    method,
    credentials: 'same-origin', // 带 cookie 走 httpOnly session
    headers: { 'Content-Type': 'application/json' },
  };
  if (body !== undefined) init.body = JSON.stringify(body);

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, init);
  } catch (e) {
    throw new ApiError(ErrCode.ERR_INTERNAL, `网络请求失败：${String(e)}`);
  }

  let payload: ApiResp<T> | null = null;
  try {
    payload = (await res.json()) as ApiResp<T>;
  } catch {
    throw new ApiError(ErrCode.ERR_INTERNAL, `服务响应异常（HTTP ${res.status}）`);
  }

  if (!payload || payload.code !== ErrCode.OK) {
    throw new ApiError(payload?.code ?? ErrCode.ERR_INTERNAL, payload?.message ?? `HTTP ${res.status}`, payload?.data);
  }
  return payload.data as T;
}

/**
 * 允许 401 / 未登录的探测请求：返回 null，不抛错。
 * 用于 /auth/me、/workspaces/invites/:token 等公开接口。
 */
async function requestAllow401<T>(path: string, method = 'GET', body?: unknown): Promise<T | null> {
  const init: RequestInit = {
    method,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
  };
  if (body !== undefined) init.body = JSON.stringify(body);

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, init);
  } catch (e) {
    return null;
  }

  let payload: ApiResp<T> | null = null;
  try {
    payload = (await res.json()) as ApiResp<T>;
  } catch {
    return null;
  }

  if (!payload) return null;
  if (res.status === 401 || payload.code === 4401) return null;
  if (payload.code !== ErrCode.OK) {
    throw new ApiError(payload.code, payload.message ?? `HTTP ${res.status}`, payload.data);
  }
  return payload.data as T;
}

export const api = {
  health(): Promise<HealthInfo> {
    return request<HealthInfo>('/health');
  },

  getUsers(): Promise<string[]> {
    return request<string[]>('/users');
  },

  listPlans(): Promise<PlanMeta[]> {
    return request<PlanMeta[]>('/plans');
  },

  createPlan(name: string, editor: string, notes: string, skipHolidays = false): Promise<Plan> {
    return request<Plan>('/plans', 'POST', { name, editor, notes, skipHolidays });
  },

  /** 导入 Microsoft Project 文件（.mpp/.mpx/.xml），content 为 base64（可带 data URL 前缀） */
  importPlan(fileName: string, content: string, editor: string, notes?: string): Promise<Plan> {
    return request<Plan>('/plans/import', 'POST', { fileName, content, editor, notes });
  },

  getPlan(planId: string): Promise<Plan> {
    return request<Plan>(`/plans/${encodeURIComponent(planId)}`);
  },

  savePlan(
    planId: string,
    plan: Plan,
    editor: string,
    notes: string,
    lockToken: string,
    baseVersion: number,
  ): Promise<SavePlanResp> {
    return request<SavePlanResp>(`/plans/${encodeURIComponent(planId)}`, 'PUT', {
      plan,
      editor,
      notes,
      lockToken,
      baseVersion,
    });
  },

  getHistory(planId: string): Promise<VersionMeta[]> {
    return request<VersionMeta[]>(`/plans/${encodeURIComponent(planId)}/history`);
  },

  getVersion(planId: string, version: number): Promise<VersionEntry> {
    return request<VersionEntry>(`/plans/${encodeURIComponent(planId)}/history/${version}`);
  },

  restore(planId: string, version: number, editor: string, notes: string, lockToken: string): Promise<SavePlanResp> {
    return request<SavePlanResp>(`/plans/${encodeURIComponent(planId)}/restore`, 'POST', {
      version,
      editor,
      notes,
      lockToken,
    });
  },

  /** todo 独立资源：拉取全量 { revision, byTask }（供初始化 / 轮询，无需锁） */
  getTodos(planId: string): Promise<TodosFile> {
    return request<TodosFile>(`/plans/${encodeURIComponent(planId)}/todos`);
  },

  /** todo 独立资源：指令式写（add/update/delete/move，无需排他锁，仅要求 user） */
  todoOp(planId: string, taskId: string, user: string, op: TodoOp): Promise<TodoOpResp> {
    return request<TodoOpResp>(`/plans/${encodeURIComponent(planId)}/tasks/${encodeURIComponent(taskId)}/todos`, 'POST', {
      user,
      op,
    });
  },

  lockStatus(planId: string): Promise<LockState> {
    return request<LockState>(`/locks/${encodeURIComponent(planId)}`);
  },

  acquireLock(planId: string, user: string): Promise<LockState> {
    return request<LockState>(`/locks/${encodeURIComponent(planId)}/acquire`, 'POST', { user });
  },

  heartbeat(planId: string, user: string, lockToken: string): Promise<LockState> {
    return request<LockState>(`/locks/${encodeURIComponent(planId)}/heartbeat`, 'POST', { user, lockToken });
  },

  releaseLock(planId: string, user: string, lockToken: string): Promise<{ ok: true }> {
    return request<{ ok: true }>(`/locks/${encodeURIComponent(planId)}/release`, 'POST', { user, lockToken });
  },

  /**
   * 导出直链（由浏览器下载，带 Content-Disposition）。
   *
   * @param format  'mspdi' | 'csv' | 'md'
   * @param scope   仅 MD 生效：'mine' 时必须同时传 user；'all'/缺省 → 全量
   * @param user    仅 scope='mine' 时必填：作为 query `user=...` 传给服务端做 isMine 过滤
   */
  exportUrl(planId: string, format: ExportFormat, scope?: 'mine' | 'all', user?: string): string {
    const params = new URLSearchParams({ format });
    if (format === 'md' && scope) {
      params.set('scope', scope);
      if (scope === 'mine' && user && user.trim() !== '') {
        params.set('user', user.trim());
      }
    }
    return `${BASE}/plans/${encodeURIComponent(planId)}/export?${params.toString()}`;
  },

  /** 读取全局工作日历配置（GET /api/calendar，无需锁） */
  getCalendar(): Promise<CalendarConfigData> {
    return request<CalendarConfigData>('/calendar');
  },

  /**
   * 保存全局工作日历配置（PUT /api/calendar，需持 GLOBAL_CALENDAR 编辑锁）。
   * @param cfg        完整配置（含 schemaVersion / coveredYears / 各 Date 映射）
   * @param editor     编辑者身份
   * @param lockToken  acquireLock('GLOBAL_CALENDAR') 获取的锁令牌
   */
  putCalendar(cfg: CalendarConfigData, editor: string, lockToken: string): Promise<CalendarConfigData> {
    return request<CalendarConfigData>('/calendar', 'PUT', { editor, lockToken, config: cfg });
  },

  /* ============================ 身份协作（v1.2.0） ============================ */

  /** 探测当前登录态；未登录返回 null（不抛错） */
  me(): Promise<{ user: PublicUserInfo; workspace: { workspaceId: string; role: string } } | null> {
    return requestAllow401<{ user: PublicUserInfo; workspace: { workspaceId: string; role: string } }>('/auth/me');
  },

  /** 用户名 + 密码登录（任意已注册账号；workspaceId 可选，缺省取首个 membership） */
  login(username: string, password: string, workspaceId?: string): Promise<AuthResp> {
    return request<AuthResp>('/auth/login', 'POST', {
      username,
      password,
      ...(workspaceId ? { workspaceId } : {}),
    });
  },

  /** 注册（可带 inviteToken 加入指定 workspace；不带则建个人 workspace） */
  register(username: string, password: string, displayName: string, inviteToken?: string): Promise<AuthResp> {
    return request<AuthResp>('/auth/register', 'POST', {
      username,
      password,
      displayName,
      ...(inviteToken ? { inviteToken } : {}),
    });
  },

  /** 注销（清 cookie + 销毁服务端 session） */
  logout(): Promise<{ ok: true }> {
    return request<{ ok: true }>('/auth/logout', 'POST');
  },

  /** 切换当前 workspace（多 workspace 用户） */
  switchWorkspace(workspaceId: string): Promise<{ workspaceId: string; role: string }> {
    return request<{ workspaceId: string; role: string }>('/auth/switch-workspace', 'POST', { workspaceId });
  },

  /** 列出我所在的所有 workspace（用于 workspace 切换器） */
  listWorkspaces(): Promise<PublicWorkspaceInfo[]> {
    return request<PublicWorkspaceInfo[]>('/workspaces');
  },

  /** 查邀请信息（无需登录；前端可在注册页展示「邀请有效 / 已过期 / 已使用」） */
  getInviteInfo(token: string): Promise<InviteInfo | null> {
    return requestAllow401<InviteInfo>(`/workspaces/invites/${encodeURIComponent(token)}`);
  },

  /** 创建邀请链接（owner-only） */
  createInvite(workspaceId: string, role: 'owner' | 'editor' | 'viewer'): Promise<{ token: string; expiresAt: string }> {
    return request<{ token: string; expiresAt: string }>(`/workspaces/${encodeURIComponent(workspaceId)}/invites`, 'POST', { role });
  },

  /** 撤销邀请（owner-only） */
  revokeInvite(workspaceId: string, token: string): Promise<{ ok: true }> {
    return request<{ ok: true }>(
      `/workspaces/${encodeURIComponent(workspaceId)}/invites/${encodeURIComponent(token)}`,
      'DELETE',
    );
  },

  /** 列出 workspace 邀请（owner-only） */
  listInvites(workspaceId: string): Promise<
    Array<{
      token: string;
      role: string;
      status: string;
      createdBy: string;
      createdAt: string;
      expiresAt: string;
      consumedBy?: string;
      consumedAt?: string;
    }>
  > {
    return request(`/workspaces/${encodeURIComponent(workspaceId)}/invites`);
  },

  /** 移除成员（owner-only） */
  removeMember(workspaceId: string, userId: string): Promise<{ ok: true }> {
    return request<{ ok: true }>(
      `/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(userId)}`,
      'DELETE',
    );
  },
};

/**
 * 关闭页面时尽力释放编辑锁（§2.6）。
 * 失败也无妨：服务端 sweeper 会在超时后自动回收。
 */
export function releaseLockBeacon(planId: string, user: string, lockToken: string): void {
  try {
    const url = `${BASE}/locks/${encodeURIComponent(planId)}/release`;
    const blob = new Blob([JSON.stringify({ user, lockToken })], { type: 'application/json' });
    navigator.sendBeacon(url, blob);
  } catch {
    /* 忽略：尽力而为 */
  }
}
