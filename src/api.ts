/**
 * src/api.ts —— 通道层。
 *
 * 统一解包 { code, data, message }（K9）：code !== 0 一律抛 ApiError，
 * 组件/store 只处理 data 与 ApiError。
 */

import { ErrCode, type ApiResp } from '../shared/types';
import type {
  CalendarConfigData,
  ExportFormat,
  HealthInfo,
  LockState,
  Plan,
  PlanMeta,
  SavePlanResp,
  VersionEntry,
  VersionMeta,
} from '../shared/types';

const BASE = '/api';

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
  const init: RequestInit = { method, headers: { 'Content-Type': 'application/json' } };
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

  createPlan(name: string, editor: string, notes: string): Promise<Plan> {
    return request<Plan>('/plans', 'POST', { name, editor, notes });
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

  /** 导出直链（由浏览器下载，带 Content-Disposition） */
  exportUrl(planId: string, format: ExportFormat): string {
    return `${BASE}/plans/${encodeURIComponent(planId)}/export?format=${format}`;
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
