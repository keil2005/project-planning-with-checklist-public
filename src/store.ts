/**
 * src/store.ts —— 状态层（zustand 单 store）。
 *
 * 铁律：
 *   - 任何改 plan 的动作末尾统一调 recompute()，它是唯一排程入口（K8）；
 *   - 只写 task.input，绝不写 task.computed（K4）；
 *   - 依赖以稳定 ID 存储，显示时用 formatDepsExpr 反查行号（K5）；
 *   - 心跳/轮询间隔来自服务端 /api/health 的 lock 配置（K11）。
 */

import { useMemo } from 'react';
import { create } from 'zustand';
import { ApiError, api, releaseLockBeacon } from './api';
import { buildWorkCalendar } from '../shared/calendar-build';
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
  type PublicUserInfo,
  type PublicWorkspaceInfo,
  type ScheduleResult,
  type Task,
  type TaskComputed,
  type TaskField,
  type TodoItem,
  type TodoOp,
  type TodosFile,
  type VersionMeta,
  type WorkCalendar,
  type WorkspaceRole,
  type ZoomLevel,
} from '../shared/types';
import { collectPeople, normalizePeople, type PeopleField } from '../shared/people';
import type { ColumnKey } from './columns';
import { computeKeepIds, EMPTY_FILTER, collectColumnValues, type ColumnFilter, type FilterContext, type FilterState } from './filter';

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

export type DialogName = 'user' | 'planPicker' | 'save' | 'history' | 'calendar' | 'exportTodos' | 'roster';

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
  /**
   * 列筛选 + 「Assign to me」。
   * 纯视图态：不入 plan、不参与协同、不进版本；切计划 / 预览 / 回滚时重置（用户裁定「不记忆」）。
   */
  filter: FilterState;
  /**
   * todo 抽屉：当前打开哪个任务的第二维明细表格（null = 关闭）。
   * 纯视图态（不入 plan、不参与协同）；切计划 / 预览 / 回滚时关闭。
   */
  todoDrawerTaskId: string | null;
  /**
   * todo 独立资源的本地已知 revision（方案 B 轮询用）。
   * 轮询到服务端 revision > 本地值时，说明有他人并发修改，拉取合并。
   */
  todosRevision: number;

  /* ---------------- 身份协作（v1.2.0） ---------------- */
  /** 启动时已探测完成（无论登录与否） */
  authReady: boolean;
  /** 当前是否已登录（来自 /api/auth/me） */
  authed: boolean;
  /** 当前登录用户的 userId（用于 owner 自查、邀请消费识别等） */
  sessionUserId: string | null;
  /** 当前用户所在的所有 workspace 列表 */
  workspaces: PublicWorkspaceInfo[];
  /** 当前 session 绑定的 workspaceId（可能 null：未登录或无任何 workspace） */
  currentWorkspaceId: string | null;
  /** 当前 workspace 中的角色 */
  currentWorkspaceRole: WorkspaceRole | null;

  /* ---------------- 动作 ---------------- */
  init: () => Promise<void>;
  /** 启动期探测登录态（cookie 优先），完成后 authReady=true */
  initAuth: () => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string, displayName: string, inviteToken?: string) => Promise<void>;
  logout: () => Promise<void>;
  listWorkspaces: () => Promise<void>;
  switchWorkspace: (workspaceId: string) => Promise<void>;
  /** 把当前 workspace 成员名单注入 users 数组（驱动人员下拉） */
  loadTeamRoster: () => void;
  /** 旧的 setUser 保留作为内部辅助：仅设置 displayName，不发任何请求（兼容旧路径） */
  setUser: (name: string) => Promise<void>;
  listPlans: () => Promise<void>;
  openPlan: (planId: string) => Promise<void>;
  createPlan: (name: string, notes: string, skipHolidays?: boolean) => Promise<void>;
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
  /** MD 导出（U05 增量）；scope=mine 需 session.user 已选 */
  exportTodos: (scope: 'mine' | 'all') => void;
  setZoom: (zoom: ZoomLevel) => void;
  selectTask: (taskId: string | null) => void;
  jumpToday: () => void;
  /* 筛选（视图态，见 FilterState 注释） */
  setColumnFilter: (key: ColumnKey, f: ColumnFilter | null) => void;
  setOnlyMine: (v: boolean) => void;
  clearAllFilters: () => void;
  /* todo 交付清单（独立资源：走 api.todoOp 异步即时提交；assignee 一致性由 normalizePlan 兜底） */
  addTodo: (taskId: string, text: string) => Promise<void>;
  updateTodo: (taskId: string, todoId: string, patch: Partial<Pick<TodoItem, 'text' | 'done' | 'assignee'>>) => Promise<void>;
  deleteTodo: (taskId: string, todoId: string) => Promise<void>;
  moveTodo: (taskId: string, todoId: string, direction: -1 | 1) => Promise<void>;
  openTodoDrawer: (taskId: string) => void;
  closeTodoDrawer: () => void;
  openDialog: (name: DialogName) => void;
  closeDialog: (name: DialogName) => void;
  showToast: (message: string, severity?: ToastMsg['severity']) => void;
  clearToast: () => void;
}

/* ============================ 模块级计时器 ============================ */

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
/** todo 独立资源轮询（方案 B）：独立于排他锁轮询，编辑/只读态都跑，判断他人并发修改 */
let todoPollTimer: ReturnType<typeof setInterval> | null = null;
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

  /**
   * 方案 B（todo 独立并发）：把服务端返回的单任务最新清单合并回 plan。
   * 关键点：**不置 dirty**（todo 不走 plan.json 保存，是独立真源）、**不 recompute**
   * （todo 与 owner 均不参与排程，见 K20）；normalizePlan 负责把 assignee 单向并入 owner。
   * revision 只增不减：响应 revision 小于本地已知值说明已被更新的轮询结果覆盖，丢弃。
   */
  const applyTodoList = (planId: string, taskId: string, todos: TodoItem[], revision: number): void => {
    if (get().plan?.planId !== planId) return; // 已切计划，丢弃过期响应
    if (revision < get().todosRevision) return;
    const plan = get().plan;
    if (!plan) return;
    const draft = clonePlan(plan);
    const task = draft.tasks.find((x) => x.id === taskId);
    if (!task) return;
    task.todos = todos;
    set({ plan: normalizePlan(draft), todosRevision: revision });
  };

  /** 把服务端返回的全量 todos 文件合并回 plan（初始化 / 轮询拉取用） */
  const applyTodosFile = (planId: string, file: TodosFile): void => {
    if (get().plan?.planId !== planId) return;
    if (file.revision < get().todosRevision) return;
    const plan = get().plan;
    if (!plan) return;
    const draft = clonePlan(plan);
    for (const t of draft.tasks) t.todos = file.byTask[t.id] ?? [];
    set({ plan: normalizePlan(draft), todosRevision: file.revision });
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

  const stopTodoPolling = (): void => {
    if (todoPollTimer) {
      clearInterval(todoPollTimer);
      todoPollTimer = null;
    }
  };

  /**
   * todo 独立资源轮询（方案 B）：**独立于排他锁轮询**，无论编辑/只读态都运行。
   * 轮询到服务端 revision > 本地 todosRevision 即拉取合并（不置脏、不 recompute），
   * 实现多人并发编辑 todo 的准实时同步。预览态跳过（历史快照里的 todo 不随 live 资源变）。
   */
  const startTodoPolling = (): void => {
    stopTodoPolling();
    const { lockCfg } = get();
    todoPollTimer = setInterval(() => {
      void (async () => {
        const { plan, session, preview } = get();
        if (!plan || !session.user || preview) return;
        try {
          const file = await api.getTodos(plan.planId);
          if (file.revision > get().todosRevision) {
            applyTodosFile(plan.planId, file);
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

    session: { user: null, userId: null, role: null, mode: 'READONLY', lockToken: null },
    dirty: false,
    preview: null,
    busy: false,
    toast: null,
    saveDiagnostics: [],
    parseDiag: {},

    zoom: 'day',
    selectedTaskId: null,
    todayTick: 0,
    dialogs: { user: false, planPicker: false, save: false, history: false, calendar: false, exportTodos: false, roster: false },
    filter: EMPTY_FILTER,
    todoDrawerTaskId: null,
    todosRevision: 0,

    /* 工作日历（T04：全局单一真源） */
    calendar: null,
    calendarConfig: null,
    calendarLoading: false,
    calendarSaving: false,
    pendingNonWorking: null,

    /* 身份协作（v1.2.0） */
    authReady: false,
    authed: false,
    sessionUserId: null,
    workspaces: [],
    currentWorkspaceId: null,
    currentWorkspaceRole: null,

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

      // 启动期探测登录态（cookie 优先；未登录就弹登录门禁）
      await get().initAuth();
      get().openDialog('user');
    },

    /**
     * 启动期探测：用 cookie 调 /api/auth/me；已登录就拉到 workspaces + 团队花名册。
     * 失败一律按未登录处理（不阻断启动，由 AuthGate 弹登录）。
     */
    initAuth: async () => {
      try {
        const me = await api.me();
        if (me) {
          set({
            authReady: true,
            authed: true,
            sessionUserId: me.user.userId,
            session: {
              ...get().session,
              user: me.user.displayName,
              userId: me.user.userId,
              role: me.user.role,
            },
            currentWorkspaceId: me.workspace.workspaceId,
            currentWorkspaceRole: me.workspace.role as WorkspaceRole,
          });
          await get().listWorkspaces();
          await get().loadTeamRoster();
        } else {
          set({ authReady: true, authed: false });
        }
      } catch (e) {
        // 网络错误：按未登录处理
        set({ authReady: true, authed: false });
        set({ toast: { message: `探测登录态失败：${errMessage(e)}`, severity: 'warning' } });
      }
    },

    login: async (username: string, password: string) => {
      const r = await api.login(username, password);
      set({
        authed: true,
        sessionUserId: r.user.userId,
        session: {
          ...get().session,
          user: r.user.displayName,
          userId: r.user.userId,
          role: r.user.role,
        },
        currentWorkspaceId: r.workspaceId,
        currentWorkspaceRole: (r.role ?? 'editor') as WorkspaceRole,
      });
      window.localStorage.setItem(LS_USER_KEY, r.user.displayName);
      await get().listWorkspaces();
      await get().loadTeamRoster();
      await get().listPlans();
      // 单 workspace 时直接关掉登录门禁，跳到计划列表
      if (get().workspaces.length <= 1) {
        set((s) => ({ dialogs: { ...s.dialogs, user: false } }));
        if (!get().plan) get().openDialog('planPicker');
      }
    },

    register: async (username: string, password: string, displayName: string, inviteToken?: string) => {
      const r = await api.register(username, password, displayName, inviteToken);
      set({
        authed: true,
        sessionUserId: r.user.userId,
        session: {
          ...get().session,
          user: r.user.displayName,
          userId: r.user.userId,
          role: r.user.role,
        },
        currentWorkspaceId: r.workspaceId,
        currentWorkspaceRole: (r.role ?? 'owner') as WorkspaceRole,
      });
      window.localStorage.setItem(LS_USER_KEY, r.user.displayName);
      await get().listWorkspaces();
      await get().loadTeamRoster();
      set((s) => ({ dialogs: { ...s.dialogs, user: false } }));
      if (!get().plan) get().openDialog('planPicker');
    },

    logout: async () => {
      try {
        await api.logout();
      } catch {
        /* 忽略：服务端 session 可能已过期 */
      }
      // 清状态：保留 lockCfg / calendar；其余清零
      set({
        authed: false,
        sessionUserId: null,
        session: { user: null, userId: null, role: null, mode: 'READONLY', lockToken: null },
        workspaces: [],
        currentWorkspaceId: null,
        currentWorkspaceRole: null,
        users: [],
        plans: [],
        plan: null,
        sched: null,
        history: [],
        lock: null,
        selectedTaskId: null,
        dialogs: { ...get().dialogs, user: true, planPicker: false, save: false, history: false, roster: false },
      });
      window.localStorage.removeItem(LS_USER_KEY);
    },

    listWorkspaces: async () => {
      try {
        const ws = await api.listWorkspaces();
        set({ workspaces: ws });
      } catch (e) {
        get().showToast(`读取工作区列表失败：${errMessage(e)}`, 'error');
      }
    },

    switchWorkspace: async (workspaceId: string) => {
      const r = await api.switchWorkspace(workspaceId);
      set({
        currentWorkspaceId: r.workspaceId,
        currentWorkspaceRole: r.role as WorkspaceRole,
      });
      await get().loadTeamRoster();
      await get().listPlans();
      set((s) => ({ dialogs: { ...s.dialogs, user: false } }));
      if (!get().plan) get().openDialog('planPicker');
    },

    /**
     * 把当前 workspace 的成员 displayName 注入 users 数组，让「负责人 / 顾问人 / TODO assignee」
     * 下拉统一用团队花名册做唯一候选源。
     */
    loadTeamRoster: () => {
      const { workspaces, currentWorkspaceId } = get();
      const ws = workspaces.find((w) => w.workspaceId === currentWorkspaceId);
      const memberNames = ws ? ws.members.map((m) => m.displayName) : [];
      set({ users: memberNames });
    },

    setUser: async (name: string) => {
      // 保留兼容：仅在没有登录时用 setUser（displayName 直填）
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
          // 筛选是纯视图态、按用户裁定「不记忆」：切计划即重置，避免打开后一片空白
          filter: EMPTY_FILTER,
          todoDrawerTaskId: null,
          // todo 独立资源：切计划即重置本地 revision，由轮询对齐到服务端真实值
          todosRevision: 0,
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
        startTodoPolling();
      } catch (e) {
        get().showToast(`打开计划失败：${errMessage(e)}`, 'error');
      } finally {
        set({ busy: false });
      }
    },

    createPlan: async (name: string, notes: string, skipHolidays = false) => {
      const user = get().session.user;
      if (!user) {
        get().showToast('请先选择身份', 'warning');
        return;
      }
      set({ busy: true });
      try {
        const plan = await api.createPlan(name, user, notes, skipHolidays);
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
        task.todos = [];
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
          filter: EMPTY_FILTER,
          todoDrawerTaskId: null,
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
        set({ plan: normalizePlan(resp.plan), dirty: false, preview: null, parseDiag: {}, filter: EMPTY_FILTER, todoDrawerTaskId: null });
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

    /**
     * MD 导出（U05）。scope=mine 需 session.user 已选，否则直接拒绝并提示。
     * 与 exportPlan 一样走 window.open，由服务端 Content-Disposition 触发下载。
     */
    exportTodos: (scope) => {
      const plan = get().plan;
      if (!plan) return;
      const me = get().session.user;
      if (scope === 'mine' && (!me || me.trim() === '')) {
        get().showToast('未选择身份，无法导出「仅与我相关」', 'warning');
        return;
      }
      if (get().dirty) {
        get().showToast('导出使用服务端最新版本，当前有未保存修改不会包含在内', 'warning');
      }
      const url =
        scope === 'mine'
          ? api.exportUrl(plan.planId, 'md', 'mine', me ?? '')
          : api.exportUrl(plan.planId, 'md', 'all');
      window.open(url, '_blank');
    },

    setZoom: (zoom: ZoomLevel) => set({ zoom }),

    selectTask: (taskId: string | null) => set({ selectedTaskId: taskId }),

    jumpToday: () => set((s) => ({ todayTick: s.todayTick + 1 })),

    setColumnFilter: (key, f) =>
      set((s) => {
        const byColumn = { ...s.filter.byColumn };
        // 传 null = 清除该列（delete 而不是置 undefined，避免留下空键被算作"有筛选"）
        if (f === null) delete byColumn[key];
        else byColumn[key] = f;
        return { filter: { ...s.filter, byColumn } };
      }),

    setOnlyMine: (v) => {
      if (get().filter.onlyMine === v) return;
      set((s) => ({ filter: { ...s.filter, onlyMine: v } }));
    },

    clearAllFilters: () => set({ filter: EMPTY_FILTER }),

    /* ---------------- todo 交付清单 ---------------- */

    /**
     * todo 走独立资源（方案 B）：直接调 api.todoOp 异步即时提交，服务端返回该任务最新清单，
     * 合并回 plan（不置脏、不 recompute）。任何登录用户都可操作，不要求排他锁。
     */
    addTodo: async (taskId, text) => {
      const t = text.trim();
      if (t === '') return;
      const { plan, session } = get();
      if (!plan || !session.user) return;
      const planId = plan.planId;
      try {
        const resp = await api.todoOp(planId, taskId, session.user, { op: 'add', text: t });
        applyTodoList(planId, taskId, resp.todos, resp.revision);
      } catch (e) {
        get().showToast(`添加 TODO 失败：${errMessage(e)}`, 'error');
      }
    },

    updateTodo: async (taskId, todoId, patch) => {
      const { plan, session } = get();
      if (!plan || !session.user) return;
      const planId = plan.planId;
      // 与 applyTodoOp 语义一致：空文本不更新（清空走 deleteTodo）；空 assignee 删除字段
      const clean: TodoOp['patch'] = {};
      if (patch.text !== undefined) {
        const t = patch.text.trim();
        if (t === '') return;
        clean.text = t;
      }
      if (patch.done !== undefined) clean.done = patch.done;
      if (patch.assignee !== undefined) clean.assignee = patch.assignee.trim();
      try {
        const resp = await api.todoOp(planId, taskId, session.user, { op: 'update', todoId, patch: clean });
        applyTodoList(planId, taskId, resp.todos, resp.revision);
      } catch (e) {
        get().showToast(`更新 TODO 失败：${errMessage(e)}`, 'error');
      }
    },

    deleteTodo: async (taskId, todoId) => {
      const { plan, session } = get();
      if (!plan || !session.user) return;
      const planId = plan.planId;
      try {
        const resp = await api.todoOp(planId, taskId, session.user, { op: 'delete', todoId });
        applyTodoList(planId, taskId, resp.todos, resp.revision);
      } catch (e) {
        get().showToast(`删除 TODO 失败：${errMessage(e)}`, 'error');
      }
    },

    moveTodo: async (taskId, todoId, direction) => {
      const { plan, session } = get();
      if (!plan || !session.user) return;
      const planId = plan.planId;
      try {
        const resp = await api.todoOp(planId, taskId, session.user, { op: 'move', todoId, direction });
        applyTodoList(planId, taskId, resp.todos, resp.revision);
      } catch (e) {
        get().showToast(`移动 TODO 失败：${errMessage(e)}`, 'error');
      }
    },

    openTodoDrawer: (taskId) => set({ todoDrawerTaskId: taskId }),
    closeTodoDrawer: () => set({ todoDrawerTaskId: null }),

    openDialog: (name: DialogName) => set((s) => ({ dialogs: { ...s.dialogs, [name]: true } })),

    closeDialog: (name: DialogName) => set((s) => ({ dialogs: { ...s.dialogs, [name]: false } })),

    showToast: (message: string, severity: ToastMsg['severity'] = 'info') => set({ toast: { message, severity } }),

    clearToast: () => set({ toast: null }),
  };
});

/* ============================ 派生选择器 ============================ */

/**
 * 模块级空常量：让 useMemo 在没有 plan 时返回**稳定引用**，
 * 避免每次渲染造新数组 / 新 Map 触发下游无谓重渲染。
 */
const EMPTY_TASKS: Task[] = [];
const EMPTY_ID_SEQ: Map<string, number> = new Map<string, number>();
const EMPTY_COMPUTED: Record<string, TaskComputed> = {};

/** 当前是否可编辑（持有锁且非预览态） */
export function useCanEdit(): boolean {
  return useStore((s) => s.session.mode === 'EDITING' && s.preview === null);
}

/**
 * 当前是否可编辑 todo（方案 B：todo 是独立并发资源，**不要求排他锁**）。
 * 只要已登录且非预览态即可增删改移 todo；主计划（甘特/依赖/排程）仍受 useCanEdit 排他锁约束。
 */
export function useCanEditTodo(): boolean {
  return useStore((s) => s.session.user !== null && s.preview === null);
}

/** 存在 error 级诊断 → 禁止保存（K10） */
export function useHasError(): boolean {
  return useStore((s) => s.diagnostics.some((d) => d.level === 'error'));
}

/**
 * 折叠 + 筛选后的可见行（表格与甘特共用，保证行对齐 K16）。
 *
 * ⚠️ 过滤只在**显示层**生效：排程（deps 求解）、诊断、导出、保存一律基于全量任务，
 *    所以筛掉的行依然参与排期计算，不会因为看不见就丢依赖。
 */
export function useVisibleTasks(): Task[] {
  const plan = useStore((s) => s.plan);
  const filter = useStore((s) => s.filter);
  const sched = useStore((s) => s.sched);
  const me = useStore((s) => s.session.user);
  const idToSeq = useMemo(() => (plan ? buildIdSeqMaps(plan.tasks).idToSeq : EMPTY_ID_SEQ), [plan]);
  return useMemo(() => {
    if (!plan) return EMPTY_TASKS;
    const keep = computeKeepIds(plan.tasks, filter, { computed: sched?.computed ?? EMPTY_COMPUTED, idToSeq, me });
    return computeVisibleTasks(plan.tasks, keep);
  }, [plan, filter, sched, me, idToSeq]);
}

/**
 * 行数统计（FilterBar 的「显示 N / 共 M」）：
 * shown = 折叠 + 筛选后，total = 仅折叠后。两者都不含被折叠隐藏的行。
 */
export function useRowCounts(): { shown: number; total: number } {
  const plan = useStore((s) => s.plan);
  const filter = useStore((s) => s.filter);
  const sched = useStore((s) => s.sched);
  const me = useStore((s) => s.session.user);
  const idToSeq = useMemo(() => (plan ? buildIdSeqMaps(plan.tasks).idToSeq : EMPTY_ID_SEQ), [plan]);
  return useMemo(() => {
    if (!plan) return { shown: 0, total: 0 };
    const total = computeVisibleTasks(plan.tasks).length;
    const keep = computeKeepIds(plan.tasks, filter, { computed: sched?.computed ?? EMPTY_COMPUTED, idToSeq, me });
    if (!keep) return { shown: total, total };
    return { shown: computeVisibleTasks(plan.tasks, keep).length, total };
  }, [plan, filter, sched, me, idToSeq]);
}

/** 筛选求值上下文（菜单里的候选值列表、FilterBar 的判断都会用到） */
export function useFilterContext(): FilterContext {
  const plan = useStore((s) => s.plan);
  const sched = useStore((s) => s.sched);
  const me = useStore((s) => s.session.user);
  const idToSeq = useMemo(() => (plan ? buildIdSeqMaps(plan.tasks).idToSeq : EMPTY_ID_SEQ), [plan]);
  return useMemo(
    () => ({ computed: sched?.computed ?? EMPTY_COMPUTED, idToSeq, me }),
    [sched, idToSeq, me],
  );
}

/** 某列的候选值（枚举型下拉用）；依赖计算只在 plan / sched 变化时重跑 */
export function useColumnValues(key: ColumnKey): string[] {
  const plan = useStore((s) => s.plan);
  const ctx = useFilterContext();
  return useMemo(() => (plan ? collectColumnValues(plan.tasks, key, ctx) : []), [plan, key, ctx]);
}

/**
 * 人员联想候选：当前 workspace members + 本 plan 内已用过的非 member 姓名（去重、排其后）。
 * 负责人 / 顾问人 / TODO assignee 共用一份候选（单一真源）。
 */
export function useOwnerCandidates(): string[] {
  return useStore((s) => {
    const base = s.users ?? [];
    const baseSet = new Set(base);
    const extra = new Set<string>();
    if (s.plan) {
      for (const t of s.plan.tasks) {
        for (const p of collectPeople(t)) {
          if (!baseSet.has(p)) extra.add(p);
        }
      }
    }
    return [...base, ...extra];
  });
}
