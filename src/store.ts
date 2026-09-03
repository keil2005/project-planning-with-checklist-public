/**
 * src/store.ts —— 状态层（zustand 单 store）。
 *
 * 铁律：
 *   - 任何改 plan 的动作末尾统一调 recompute()，它是唯一排程入口（K8）；
 *   - 只写 task.input，绝不写 task.computed（K4）；
 *   - 依赖以稳定 ID 存储，显示时用 formatDepsExpr 反查行号（K5）；
 *   - 心跳/轮询间隔来自服务端 /api/health 的 lock 配置（K11）。
 */

import { create } from 'zustand';
import { ApiError, api, releaseLockBeacon } from './api';
import { buildWorkCalendar } from '../shared/calendar-build';
import { BUILTIN_USERS } from '../shared/roster';
import {
  buildIdSeqMaps,
  collectDescendants,
  computeVisibleTasks,
  createEmptyTask,
  diag,
  hasChildren,
  makeTaskId,
  normalizePlan,
  parseDepsExpr,
  schedule,
  subtreeRange,
} from '../shared/scheduler';
import {
  DEFAULT_DURATION_TEXT,
  ErrCode,
  NATURAL_CALENDAR,
  type CalendarConfigData,
  type Diagnostic,
  type ExportFormat,
  type LockCfgPublic,
  type LockState,
  type Plan,
  type PlanMeta,
  type ScheduleResult,
  type Task,
  type TaskField,
  type VersionMeta,
  type WorkCalendar,
  type ZoomLevel,
} from '../shared/types';
import { collectPeople, normalizePeople, type PeopleField } from '../shared/people';

/* ============================ 类型 ============================ */

export type Mode = 'READONLY' | 'EDITING';

export interface Session {
  user: string | null;
  mode: Mode;
  lockToken: string | null;
}

export interface PreviewInfo {
  version: number;
  editor: string;
  notes: string;
}

export interface ToastMsg {
  message: string;
  severity: 'success' | 'info' | 'warning' | 'error';
}

export type DialogName = 'user' | 'planPicker' | 'save' | 'history' | 'calendar';

/** 全局工作日历保留资源 id（与 per-plan 锁相互独立，见 server/routes.ts） */
export const GLOBAL_CALENDAR = 'GLOBAL_CALENDAR';

/**
 * 用户手填 start/end 落在非工作日时挂起的确认弹窗状态。
 * - field 为被修改的时间字段（start / end）
 * - value 为用户手填的原始日期（未归一）
 */
export interface NonWorkingPrompt {
  taskId: string;
  field: 'start' | 'end';
  value: string;
}

export interface StoreState {
  /* 数据 */
  users: string[];
  plans: PlanMeta[];
  plan: Plan | null;
  sched: ScheduleResult | null;
  diagnostics: Diagnostic[];
  history: VersionMeta[];
  lock: LockState | null;
  lockCfg: LockCfgPublic;

  /* 工作日历（全局单一真源，前端无本地副本，统一从 GET /api/calendar 拉取后 buildWorkCalendar） */
  calendar: WorkCalendar | null;
  /** 原始配置（编辑日历设置弹窗用）；与 calendar 同步刷新 */
  calendarConfig: CalendarConfigData | null;
  calendarLoading: boolean;
  calendarSaving: boolean;
  /** 用户手填非工作日日期的挂起确认弹窗（T05） */
  pendingNonWorking: NonWorkingPrompt | null;

  /* 会话与状态 */
  session: Session;
  dirty: boolean;
  preview: PreviewInfo | null;
  busy: boolean;
  toast: ToastMsg | null;
  saveDiagnostics: Diagnostic[];

  /* 依赖解析诊断（按 taskId，独立于排程诊断） */
  parseDiag: Record<string, Diagnostic[]>;

  /* 视图 */
  zoom: ZoomLevel;
  selectedTaskId: string | null;
  todayTick: number;
  dialogs: Record<DialogName, boolean>;

  /* ---------------- 动作 ---------------- */
  init: () => Promise<void>;
  setUser: (name: string) => Promise<void>;
  listPlans: () => Promise<void>;
  openPlan: (planId: string) => Promise<void>;
  createPlan: (name: string, notes: string) => Promise<void>;
  importPlan: (file: File) => Promise<void>;
  refreshPlan: () => Promise<void>;
  recompute: () => void;

  /* ---------------- 工作日历 ---------------- */
  /** 拉取并构建全局工作日历（启动 / 刷新用） */
  loadCalendar: () => Promise<void>;
  /** 用服务端返回的配置刷新内存中的 WorkCalendar（保存成功后调用） */
  setCalendar: (cfg: CalendarConfigData) => void;
  /** 打开非工作日手填确认弹窗 */
  openNonWorkingPrompt: (p: NonWorkingPrompt) => void;
  /** 关闭非工作日手填确认弹窗 */
  closeNonWorkingPrompt: () => void;
  /** 保存工作日历配置（先持 GLOBAL_CALENDAR 锁，再 PUT /api/calendar） */
  saveCalendarConfig: (cfg: CalendarConfigData, editor: string) => Promise<void>;

  /** 文本类单元格（开始/结束/时长/依赖/名称） */
  updateCell: (taskId: string, field: TaskField, value: string) => void;
  /**
   * 人员类单元格（负责人 / 顾问人）：整段替换名单。
   * 走独立动作而非 updateCell，因为值是 string[] 且需要归一化（trim / 去重 / 去空）。
   */
  updatePeople: (taskId: string, field: PeopleField, names: string[]) => void;
  addRow: (afterTaskId?: string) => void;
  deleteRow: (taskId: string) => void;
  indent: (taskId: string) => void;
  outdent: (taskId: string) => void;
  moveRow: (taskId: string, delta: 1 | -1) => void;
  toggleCollapse: (taskId: string) => void;
  renamePlan: (name: string) => void;

  enterEditMode: () => Promise<void>;
  exitEditMode: () => Promise<void>;
  save: (notes: string) => Promise<void>;

  loadHistory: () => Promise<void>;
  previewVersion: (version: number) => Promise<void>;
  exitPreview: () => Promise<void>;
  restoreVersion: (version: number, notes: string) => Promise<void>;

  exportPlan: (format: ExportFormat) => void;
  setZoom: (zoom: ZoomLevel) => void;
  selectTask: (taskId: string | null) => void;
  jumpToday: () => void;
  openDialog: (name: DialogName) => void;
  closeDialog: (name: DialogName) => void;
  showToast: (message: string, severity?: ToastMsg['severity']) => void;
  clearToast: () => void;
}

/* ============================ 模块级计时器 ============================ */

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let initialized = false;
let lastPolledHolder: string | null = null;

const LS_USER_KEY = 'pg.user';

const DEFAULT_LOCK_CFG: LockCfgPublic = {
  timeoutMs: 30_000,
  heartbeatMs: 10_000,
  sweepMs: 5_000,
  pollMs: 5_000,
};

/* ============================ 工具 ============================ */

function clonePlan(plan: Plan): Plan {
  return JSON.parse(JSON.stringify(plan)) as Plan;
}

function errMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}

/* ============================ Store ============================ */

export const useStore = create<StoreState>((set, get) => {
  /** 统一的 plan 变更入口：克隆 → 变更 → 规整 → 置 dirty → 重算（K8） */
  const applyPlan = (mutate: (draft: Plan) => void): void => {
    const current = get().plan;
    if (!current) return;
    const draft = clonePlan(current);
    mutate(draft);
    const next = normalizePlan(draft);
    set({ plan: next, dirty: true });
    get().recompute();
  };

  const stopHeartbeat = (): void => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  };

  const stopPolling = (): void => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  };

  /** 编辑权丢失：退出编辑态但保留本地修改（§2.6） */
  const handleLockLost = (message: string): void => {
    stopHeartbeat();
    const session = get().session;
    set({
      session: { ...session, mode: 'READONLY', lockToken: null },
      toast: { message, severity: 'warning' },
    });
    startPolling();
  };

  const startHeartbeat = (): void => {
    stopHeartbeat();
    const { lockCfg } = get();
    heartbeatTimer = setInterval(() => {
      void (async () => {
        const { plan, session } = get();
        if (!plan || !session.user || !session.lockToken || session.mode !== 'EDITING') {
          stopHeartbeat();
          return;
        }
        try {
          const lock = await api.heartbeat(plan.planId, session.user, session.lockToken);
          set({ lock: { ...lock, lockToken: null } });
        } catch (e) {
          if (e instanceof ApiError && (e.code === ErrCode.ERR_LOCK_LOST || e.code === ErrCode.ERR_NO_LOCK)) {
            handleLockLost('编辑权已被回收，未保存的修改请复制备份后重新进入编辑模式');
          }
        }
      })();
    }, Math.max(2000, lockCfg.heartbeatMs));
  };

  const startPolling = (): void => {
    stopPolling();
    const { lockCfg } = get();
    pollTimer = setInterval(() => {
      void (async () => {
        const { plan, session, dirty } = get();
        if (!plan || session.mode === 'EDITING') return;
        try {
          const lock = await api.lockStatus(plan.planId);
          set({ lock });
          // 他人编辑结束（EDITING → IDLE）且本地无改动 → 自动拉取最新版本
          if (lastPolledHolder && lock.status === 'IDLE' && !dirty) {
            lastPolledHolder = null;
            await get().refreshPlan();
          } else if (lock.status === 'EDITING' && lock.holder !== session.user) {
            lastPolledHolder = lock.holder;
          }
        } catch {
          /* 轮询失败静默重试 */
        }
      })();
    }, Math.max(2000, lockCfg.pollMs));
  };

  return {
    /* ---------------- 初始状态 ---------------- */
    users: [],
    plans: [],
    plan: null,
    sched: null,
    diagnostics: [],
    history: [],
    lock: null,
    lockCfg: DEFAULT_LOCK_CFG,

    session: { user: null, mode: 'READONLY', lockToken: null },
    dirty: false,
    preview: null,
    busy: false,
    toast: null,
    saveDiagnostics: [],
    parseDiag: {},

    zoom: 'day',
    selectedTaskId: null,
    todayTick: 0,
    dialogs: { user: false, planPicker: false, save: false, history: false, calendar: false },

    /* 工作日历（T04：全局单一真源） */
    calendar: null,
    calendarConfig: null,
    calendarLoading: false,
    calendarSaving: false,
    pendingNonWorking: null,

    /* ---------------- 启动 ---------------- */
    init: async () => {
      if (initialized) return;
      initialized = true;

      try {
        const health = await api.health();
        set({ lockCfg: health.lock });
      } catch {
        /* health 失败不阻断，使用默认锁参数 */
      }

      let users: string[] = [];
      try {
        users = await api.getUsers();
        set({ users });
      } catch (e) {
        set({ toast: { message: `读取用户名单失败：${errMessage(e)}`, severity: 'error' } });
      }

      // 拉取全局工作日历（T04：生产路径启用真实日历，单一真源）
      try {
        await get().loadCalendar();
      } catch (e) {
        set({ toast: { message: `读取工作日历失败：${errMessage(e)}`, severity: 'warning' } });
      }

      window.addEventListener('beforeunload', () => {
        const { plan, session } = get();
        if (plan && session.user && session.lockToken && session.mode === 'EDITING') {
          releaseLockBeacon(plan.planId, session.user, session.lockToken);
        }
      });

      // 启动第一步：强制「登录」——每次启动先选名字确定本次操作人（共享盘多用户部署避免串号）。
      get().openDialog('user');
    },

    setUser: async (name: string) => {
      window.localStorage.setItem(LS_USER_KEY, name);
      set((s) => ({ session: { ...s.session, user: name }, dialogs: { ...s.dialogs, user: false } }));
      await get().listPlans();
      if (!get().plan) get().openDialog('planPicker');
    },

    listPlans: async () => {
      try {
        set({ plans: await api.listPlans() });
      } catch (e) {
        get().showToast(`读取计划列表失败：${errMessage(e)}`, 'error');
      }
    },

    openPlan: async (planId: string) => {
      set({ busy: true });
      try {
        const plan = await api.getPlan(planId);
        set({
          plan: normalizePlan(plan),
          dirty: false,
          preview: null,
          parseDiag: {},
          saveDiagnostics: [],
          selectedTaskId: null,
          session: { ...get().session, mode: 'READONLY', lockToken: null },
          dialogs: { ...get().dialogs, planPicker: false },
        });
        get().recompute();
        await get().loadHistory();
        try {
          set({ lock: await api.lockStatus(planId) });
        } catch {
          /* 忽略 */
        }
        startPolling();
      } catch (e) {
        get().showToast(`打开计划失败：${errMessage(e)}`, 'error');
      } finally {
        set({ busy: false });
      }
    },

    createPlan: async (name: string, notes: string) => {
      const user = get().session.user;
      if (!user) {
        get().showToast('请先选择身份', 'warning');
        return;
      }
      set({ busy: true });
      try {
        const plan = await api.createPlan(name, user, notes);
        set({ dialogs: { ...get().dialogs, planPicker: false } });
        await get().listPlans();
        await get().openPlan(plan.planId);
        get().showToast(`计划「${plan.name}」已创建（v${plan.version}）`, 'success');
      } catch (e) {
        get().showToast(`新建计划失败：${errMessage(e)}`, 'error');
      } finally {
        set({ busy: false });
      }
    },

    importPlan: async (file: File) => {
      const user = get().session.user;
      if (!user) {
        get().showToast('请先选择身份', 'warning');
        return;
      }
      set({ busy: true });
      try {
        const content = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
          reader.onerror = () => reject(reader.error ?? new Error('文件读取失败'));
          reader.readAsDataURL(file);
        });
        const plan = await api.importPlan(file.name, content, user);
        // 导入即落盘为新计划（v1），直接打开即可；共享版可随后打开该原生 JSON
        await get().openPlan(plan.planId);
        await get().listPlans();
        get().showToast(`已导入「${plan.name}」（v${plan.version}）`, 'success');
      } catch (e) {
        if (e instanceof ApiError && e.code === ErrCode.ERR_FEATURE_DISABLED) {
          get().showToast('本部署未启用 MPP 导入（本机需运行 server/mpxj/fetch-mpxj.sh 后重启服务）', 'warning');
          return;
        }
        get().showToast(`导入失败：${errMessage(e)}`, 'error');
      } finally {
        set({ busy: false });
      }
    },

    refreshPlan: async () => {
      const plan = get().plan;
      if (!plan) return;
      try {
        const fresh = await api.getPlan(plan.planId);
        set({ plan: normalizePlan(fresh), dirty: false, parseDiag: {}, preview: null });
        get().recompute();
        await get().loadHistory();
      } catch (e) {
        get().showToast(`刷新失败：${errMessage(e)}`, 'error');
      }
    },

    /* ---------------- 排程唯一入口 ---------------- */
    recompute: () => {
      const { plan, parseDiag, calendar } = get();
      if (!plan) {
        set({ sched: null, diagnostics: [] });
        return;
      }
      try {
        const sched = schedule(plan, {
          anchorDate: plan.calendar.anchorDate,
          defaultDuration: plan.calendar.defaultDuration || DEFAULT_DURATION_TEXT,
          // 注入全局真实工作日历；仅在未加载到日历时防御性回退 NATURAL（生产路径必有 calendar）
          calendar: calendar ?? NATURAL_CALENDAR,
        });
        const parse = Object.values(parseDiag).flat();
        set({ sched, diagnostics: [...parse, ...sched.diagnostics] });
      } catch (e) {
        // 排程引擎异常绝不能冒泡到事件处理器导致整页卸载；降级为 error 诊断 + toast。
        // eslint-disable-next-line no-console
        console.error('[recompute] schedule 抛出异常：', e);
        const prev = get().diagnostics.filter((d) => d.code !== ErrCode.ERR_SCHEDULE);
        set({
          diagnostics: [
            ...prev,
            diag('error', ErrCode.ERR_SCHEDULE, `排程计算出错：${errMessage(e)}`, undefined),
          ],
        });
        get().showToast(`排程计算出错：${errMessage(e)}`, 'error');
      }
    },

    /* ---------------- 工作日历 ---------------- */

    loadCalendar: async () => {
      set({ calendarLoading: true });
      try {
        const cfg = await api.getCalendar();
        set({ calendarConfig: cfg, calendar: buildWorkCalendar(cfg), calendarLoading: false });
      } catch (e) {
        set({ calendarLoading: false });
        throw e;
      }
    },

    /** 用服务端返回的配置刷新内存中的 WorkCalendar（保存成功后调用） */
    setCalendar: (cfg: CalendarConfigData) => {
      set({ calendarConfig: cfg, calendar: buildWorkCalendar(cfg) });
    },

    /** 打开非工作日手填确认弹窗 */
    openNonWorkingPrompt: (p: NonWorkingPrompt) => set({ pendingNonWorking: p }),

    /** 关闭非工作日手填确认弹窗 */
    closeNonWorkingPrompt: () => set({ pendingNonWorking: null }),

    /** 保存工作日历配置：先持 GLOBAL_CALENDAR 锁 → PUT → 刷新内存（T05） */
    saveCalendarConfig: async (cfg: CalendarConfigData, editor: string) => {
      set({ calendarSaving: true });
      try {
        const lock = await api.acquireLock(GLOBAL_CALENDAR, editor);
        try {
          const saved = await api.putCalendar(cfg, editor, lock.lockToken ?? '');
          set({ calendarConfig: saved, calendar: buildWorkCalendar(saved), calendarSaving: false });
          get().showToast('工作日历已保存', 'success');
        } finally {
          try {
            await api.releaseLock(GLOBAL_CALENDAR, editor, lock.lockToken ?? '');
          } catch {
            /* 释放失败无妨，sweeper 会回收 */
          }
        }
      } catch (e) {
        set({ calendarSaving: false });
        get().showToast(`保存工作日历失败：${errMessage(e)}`, 'error');
      }
    },

    /* ---------------- 表格编辑 ---------------- */
    updateCell: (taskId: string, field: TaskField, value: string) => {
      const plan = get().plan;
      if (!plan) return;

      if (field === 'deps') {
        const { seqToId } = buildIdSeqMaps(plan.tasks);
        const result = parseDepsExpr(value, seqToId, taskId);
        set((s) => ({ parseDiag: { ...s.parseDiag, [taskId]: result.diagnostics } }));
        applyPlan((draft) => {
          const t = draft.tasks.find((x) => x.id === taskId);
          if (t) t.deps = result.deps;
        });
        return;
      }

      // 人员字段（负责人 / 顾问人）是 string[]，不走这里，见 updatePeople。

      applyPlan((draft) => {
        const t = draft.tasks.find((x) => x.id === taskId);
        if (!t) return;
        const v = value.trim();
        if (field === 'name') {
          t.name = value;
        } else {
          t.input[field] = v === '' ? null : v;
        }
      });
    },

    /**
     * 人员字段（负责人 / 顾问人）整段替换。
     * 归一化（trim / 去空 / 大小写不敏感去重）交给 normalizePeople，保证落盘形态唯一。
     * 复用 applyPlan → 自动置脏 + 重算（人员不参与排程，见 K20）。
     */
    updatePeople: (taskId: string, field: PeopleField, names: string[]) => {
      if (!get().plan) return;
      const next = normalizePeople(names);
      applyPlan((draft) => {
        const t = draft.tasks.find((x) => x.id === taskId);
        if (!t) return;
        const prev = field === 'owner' ? t.owner : t.consultant;
        // 内容相同则跳过，避免无意义置脏（用户只是点开又关掉也会走一次提交）
        if (prev && prev.length === next.length && prev.every((v, i) => v === next[i])) return;
        if (field === 'owner') t.owner = next;
        else t.consultant = next;
      });
    },

    addRow: (afterTaskId?: string) => {
      const plan = get().plan;
      if (!plan) return;
      const newId = makeTaskId(plan.nextTaskSeq);
      applyPlan((draft) => {
        const after = afterTaskId ? draft.tasks.find((t) => t.id === afterTaskId) : undefined;
        const parentId = after ? after.parentId : null;
        const task: Task = createEmptyTask(newId, 0, parentId, '');
        // 显式补人员字段默认，避免 undefined（createEmptyTask 不动，守「排程引擎不动」红线）
        task.owner = [];
        task.consultant = [];
        if (after) {
          const [, to] = subtreeRange(draft.tasks, after.id);
          draft.tasks.splice(to, 0, task);
        } else {
          draft.tasks.push(task);
        }
        draft.nextTaskSeq += 1;
      });
      set({ selectedTaskId: newId });
    },

    deleteRow: (taskId: string) => {
      const plan = get().plan;
      if (!plan) return;
      const doomed = new Set(collectDescendants(plan.tasks, taskId, true));
      let clearedDeps = 0;
      applyPlan((draft) => {
        draft.tasks = draft.tasks.filter((t) => !doomed.has(t.id));
        for (const t of draft.tasks) {
          const before = t.deps.length;
          t.deps = t.deps.filter((d) => !doomed.has(d.predecessorId));
          clearedDeps += before - t.deps.length;
        }
      });
      set((s) => {
        const nextParse = { ...s.parseDiag };
        doomed.forEach((id) => delete nextParse[id]);
        return { parseDiag: nextParse, selectedTaskId: null };
      });
      get().recompute();
      const extra = clearedDeps > 0 ? `，同时清理了 ${clearedDeps} 条指向它的依赖` : '';
      get().showToast(`已删除 ${doomed.size} 行${extra}`, 'info');
    },

    indent: (taskId: string) => {
      const plan = get().plan;
      if (!plan) return;
      const idx = plan.tasks.findIndex((t) => t.id === taskId);
      if (idx < 0) return;
      const self = plan.tasks[idx];
      // 上一个同级兄弟
      let prevSibling: Task | null = null;
      for (let i = idx - 1; i >= 0; i -= 1) {
        if (plan.tasks[i].parentId === self.parentId) {
          prevSibling = plan.tasks[i];
          break;
        }
      }
      if (!prevSibling) {
        get().showToast('已是本层第一行，无法缩进', 'info');
        return;
      }
      const newParentId = prevSibling.id;
      applyPlan((draft) => {
        const t = draft.tasks.find((x) => x.id === taskId);
        if (!t) return;
        t.parentId = newParentId;
        const p = draft.tasks.find((x) => x.id === newParentId);
        if (p) p.collapsed = false;
      });
    },

    outdent: (taskId: string) => {
      const plan = get().plan;
      if (!plan) return;
      const self = plan.tasks.find((t) => t.id === taskId);
      if (!self || !self.parentId) {
        get().showToast('已是顶层，无法升级', 'info');
        return;
      }
      const parent = plan.tasks.find((t) => t.id === self.parentId);
      const grandParentId = parent ? parent.parentId : null;
      const parentId = self.parentId;
      applyPlan((draft) => {
        const t = draft.tasks.find((x) => x.id === taskId);
        if (!t) return;
        t.parentId = grandParentId;
        // 移动到原父任务子树之后，成为其下一个兄弟
        const [from, to] = subtreeRange(draft.tasks, taskId);
        if (from < 0) return;
        const block = draft.tasks.splice(from, to - from);
        const [, parentTo] = subtreeRange(draft.tasks, parentId);
        const insertAt = parentTo >= 0 ? parentTo : draft.tasks.length;
        draft.tasks.splice(insertAt, 0, ...block);
      });
    },

    moveRow: (taskId: string, delta: 1 | -1) => {
      const plan = get().plan;
      if (!plan) return;
      const self = plan.tasks.find((t) => t.id === taskId);
      if (!self) return;
      const siblings = plan.tasks.filter((t) => t.parentId === self.parentId);
      const pos = siblings.findIndex((t) => t.id === taskId);
      const targetPos = pos + delta;
      if (targetPos < 0 || targetPos >= siblings.length) {
        get().showToast('已到边界，无法移动', 'info');
        return;
      }
      const targetId = siblings[targetPos].id;
      applyPlan((draft) => {
        const [from, to] = subtreeRange(draft.tasks, taskId);
        if (from < 0) return;
        const block = draft.tasks.splice(from, to - from);
        const [tFrom, tTo] = subtreeRange(draft.tasks, targetId);
        if (tFrom < 0) {
          draft.tasks.splice(from, 0, ...block);
          return;
        }
        const insertAt = delta > 0 ? tTo : tFrom;
        draft.tasks.splice(insertAt, 0, ...block);
      });
    },

    toggleCollapse: (taskId: string) => {
      const plan = get().plan;
      if (!plan) return;
      if (!hasChildren(plan.tasks, taskId)) return;
      // 折叠只影响视图，但会随计划落盘 → 记为 dirty，不需要重算
      const draft = clonePlan(plan);
      const t = draft.tasks.find((x) => x.id === taskId);
      if (!t) return;
      t.collapsed = !t.collapsed;
      set({ plan: draft, dirty: true });
    },

    renamePlan: (name: string) => {
      applyPlan((draft) => {
        draft.name = name.trim() === '' ? '未命名计划' : name;
      });
    },

    /* ---------------- 编辑锁 ---------------- */
    enterEditMode: async () => {
      const { plan, session, dirty } = get();
      if (!plan || !session.user) return;
      if (get().preview) {
        get().showToast('请先退出版本预览', 'info');
        return;
      }
      try {
        if (!dirty) await get().refreshPlan();
        const lock = await api.acquireLock(plan.planId, session.user);
        set({
          lock: { ...lock, lockToken: null },
          session: { ...get().session, mode: 'EDITING', lockToken: lock.lockToken },
        });
        stopPolling();
        startHeartbeat();
        get().showToast('已进入编辑模式', 'success');
      } catch (e) {
        if (e instanceof ApiError && e.code === ErrCode.ERR_LOCK_HELD) {
          const holder = (e.data as { holder?: string } | null)?.holder ?? '他人';
          set({ lock: { ...(get().lock as LockState), status: 'EDITING', holder } });
          get().showToast(`「${holder}」正在编辑，暂时无法获取编辑权`, 'warning');
          return;
        }
        get().showToast(`获取编辑权失败：${errMessage(e)}`, 'error');
      }
    },

    exitEditMode: async () => {
      const { plan, session } = get();
      stopHeartbeat();
      if (plan && session.user && session.lockToken) {
        try {
          await api.releaseLock(plan.planId, session.user, session.lockToken);
        } catch {
          /* 释放失败无妨，sweeper 会回收 */
        }
      }
      set({ session: { ...get().session, mode: 'READONLY', lockToken: null } });
      if (plan) {
        try {
          set({ lock: await api.lockStatus(plan.planId) });
        } catch {
          /* 忽略 */
        }
      }
      startPolling();
    },

    /* ---------------- 保存 ---------------- */
    save: async (notes: string) => {
      const { plan, session } = get();
      if (!plan || !session.user || !session.lockToken) {
        get().showToast('请先进入编辑模式', 'warning');
        return;
      }
      set({ busy: true, saveDiagnostics: [] });
      try {
        const resp = await api.savePlan(
          plan.planId,
          plan,
          session.user,
          notes,
          session.lockToken,
          plan.version,
        );
        set({
          plan: normalizePlan(resp.plan),
          dirty: false,
          parseDiag: {},
          dialogs: { ...get().dialogs, save: false },
        });
        get().recompute();
        await get().loadHistory();
        await get().listPlans();
        get().showToast(`已保存为 v${resp.version}`, 'success');
      } catch (e) {
        if (e instanceof ApiError) {
          if (e.code === ErrCode.ERR_VALIDATION) {
            const diags = (e.data as { diagnostics?: Diagnostic[] } | null)?.diagnostics ?? [];
            set({ saveDiagnostics: diags });
            get().showToast('存在阻断性错误，保存被拒绝', 'error');
            return;
          }
          if (e.code === ErrCode.ERR_LOCK_LOST || e.code === ErrCode.ERR_NO_LOCK) {
            handleLockLost('编辑权已失效，保存失败。请重新进入编辑模式后再次保存');
            return;
          }
          if (e.code === ErrCode.ERR_STALE_VERSION) {
            get().showToast('服务端已有更新版本，请刷新后重做本次修改', 'error');
            return;
          }
        }
        get().showToast(`保存失败：${errMessage(e)}`, 'error');
      } finally {
        set({ busy: false });
      }
    },

    /* ---------------- 历史 ---------------- */
    loadHistory: async () => {
      const plan = get().plan;
      if (!plan) return;
      try {
        set({ history: await api.getHistory(plan.planId) });
      } catch (e) {
        get().showToast(`读取变更记录失败：${errMessage(e)}`, 'error');
      }
    },

    previewVersion: async (version: number) => {
      const plan = get().plan;
      if (!plan) return;
      if (get().dirty) {
        get().showToast('有未保存的修改，请先保存或刷新后再预览历史版本', 'warning');
        return;
      }
      if (get().session.mode === 'EDITING') await get().exitEditMode();
      try {
        const entry = await api.getVersion(plan.planId, version);
        set({
          plan: normalizePlan(entry.planSnapshot),
          preview: { version: entry.version, editor: entry.editor, notes: entry.notes },
          dirty: false,
          parseDiag: {},
        });
        get().recompute();
      } catch (e) {
        get().showToast(`预览版本失败：${errMessage(e)}`, 'error');
      }
    },

    exitPreview: async () => {
      set({ preview: null });
      await get().refreshPlan();
    },

    restoreVersion: async (version: number, notes: string) => {
      const { plan, session } = get();
      if (!plan || !session.user) return;
      if (!session.lockToken || session.mode !== 'EDITING') {
        get().showToast('回滚属于写操作，请先进入编辑模式', 'warning');
        return;
      }
      set({ busy: true });
      try {
        const resp = await api.restore(plan.planId, version, session.user, notes, session.lockToken);
        set({ plan: normalizePlan(resp.plan), dirty: false, preview: null, parseDiag: {} });
        get().recompute();
        await get().loadHistory();
        get().showToast(`已回滚 v${version}，生成新版本 v${resp.version}`, 'success');
      } catch (e) {
        if (e instanceof ApiError && (e.code === ErrCode.ERR_LOCK_LOST || e.code === ErrCode.ERR_NO_LOCK)) {
          handleLockLost('编辑权已失效，回滚失败');
          return;
        }
        get().showToast(`回滚失败：${errMessage(e)}`, 'error');
      } finally {
        set({ busy: false });
      }
    },

    /* ---------------- 视图 ---------------- */
    exportPlan: (format: ExportFormat) => {
      const plan = get().plan;
      if (!plan) return;
      if (get().dirty) {
        get().showToast('导出使用服务端最新版本，当前有未保存修改不会包含在内', 'warning');
      }
      window.open(api.exportUrl(plan.planId, format), '_blank');
    },

    setZoom: (zoom: ZoomLevel) => set({ zoom }),

    selectTask: (taskId: string | null) => set({ selectedTaskId: taskId }),

    jumpToday: () => set((s) => ({ todayTick: s.todayTick + 1 })),

    openDialog: (name: DialogName) => set((s) => ({ dialogs: { ...s.dialogs, [name]: true } })),

    closeDialog: (name: DialogName) => set((s) => ({ dialogs: { ...s.dialogs, [name]: false } })),

    showToast: (message: string, severity: ToastMsg['severity'] = 'info') => set({ toast: { message, severity } }),

    clearToast: () => set({ toast: null }),
  };
});

/* ============================ 派生选择器 ============================ */

/** 当前是否可编辑（持有锁且非预览态） */
export function useCanEdit(): boolean {
  return useStore((s) => s.session.mode === 'EDITING' && s.preview === null);
}

/** 存在 error 级诊断 → 禁止保存（K10） */
export function useHasError(): boolean {
  return useStore((s) => s.diagnostics.some((d) => d.level === 'error'));
}

/** 折叠过滤后的可见任务（表格与甘特共用，保证行对齐 K16） */
export function useVisibleTasks(): Task[] {
  return useStore((s) => (s.plan ? computeVisibleTasks(s.plan.tasks) : []));
}

/**
 * 人员联想候选：固定名单（原序）+ 本 plan 内已用过的名单外姓名（去重、排其后，P1-5）。
 * 负责人与顾问人共用一份候选（两列的录入范围一致，见 U02）。
 */
export function useOwnerCandidates(): string[] {
  return useStore((s) => {
    const base = BUILTIN_USERS as readonly string[];
    const extra = new Set<string>();
    if (s.plan) {
      for (const t of s.plan.tasks) {
        for (const p of collectPeople(t)) {
          if (!base.includes(p)) extra.add(p);
        }
      }
    }
    return [...base, ...extra];
  });
}
