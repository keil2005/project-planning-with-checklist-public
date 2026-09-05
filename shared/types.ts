/**
 * shared/types.ts —— 前后端共用的领域类型、错误码与 API 契约。
 *
 * 约束（见系统设计 §11 共享知识）：
 *  - K1 业务日期一律 'YYYY-MM-DD' 字符串（无时区自然日），禁止出现 Date / 时间戳；
 *  - K2 元数据时间一律 ISO 8601 UTC 字符串；
 *  - K4 task.input 是唯一真源，禁止把 computed 回写 input；
 *  - K9 API 统一 { code, data, message }，错误码常量只在本文件定义。
 *
 * 本文件零副作用、零依赖（不 import dayjs / fs / DOM）。
 */

/* ========================= 基础别名 ========================= */

/** 'YYYY-MM-DD'（无时区自然日） */
export type ISODate = string;

/** '2026-08-26T03:38:21.000Z'（UTC） */
export type ISOTimestamp = string;

export type DurationUnit = 'd' | 'w' | 'm';

export type DepType = 'FS' | 'SS' | 'FF' | 'SF';

export type DeriveSource = 'INPUT' | 'DEP' | 'ROLLUP' | 'ANCHOR' | 'MIXED';

export type Level = 'error' | 'warn';

/**
 * 可编辑的单元格字段（文本类，走 `updateCell(taskId, field, value: string)`）。
 * ⚠️ 人员字段（负责人 / 顾问人）是 string[]，不走这里，改走 `updatePeople(taskId, field, names)`。
 */
export type TaskField = 'start' | 'end' | 'duration' | 'deps' | 'name';

/* ========================= 领域模型 ========================= */

export interface Duration {
  value: number;
  unit: DurationUnit;
}

export interface Dependency {
  /** 稳定 ID（落盘用，K5） */
  predecessorId: string;
  /** 缺省 FS */
  type: DepType;
  lag: Duration | null;
  lagSign: 1 | -1;
  /** 用户原文，如 '3FF+1w'（仅用于回显 / 排错） */
  raw: string;
}

/** ★ 唯一真源：只存用户手敲的值 */
export interface TaskInput {
  start: ISODate | null;
  end: ISODate | null;
  /** 原文 '5d' / '1m'，保留用户单位偏好 */
  duration: string | null;
}

export interface FieldSources {
  start: DeriveSource;
  end: DeriveSource;
  duration: DeriveSource;
}

/** ★ 每次全量重算，不可回写 input */
export interface TaskComputed {
  start: ISODate;
  end: ISODate;
  duration: Duration;
  derivedFrom: DeriveSource;
  fieldSources: FieldSources;
  isParent: boolean;
  /** 0-based */
  depth: number;
  hasError: boolean;
}

/**
 * 任务的细分交付清单项（U04，2026-09-03 新增）。
 *
 * 定位（用户裁定）：**轻量验收清单**，不是 WBS 子任务——不进甘特图、不参与依赖/排程/关键路径、
 * 不生成 MS Project Resource/Assignment。衡量「这个任务交付时，这 N 项成果是否都做完了」。
 *
 * 一致性不变量（用户裁定）：todo.assignee 若既不在负责人也不在顾问人里，由 normalizePlan()
 * 自动单向并入负责人（只增不自动移除），从而保证「Assign to me 只认负责人/顾问人」能自动覆盖
 * 「我负责了某个 todo 项」。
 */
export interface TodoItem {
  /** 任务内唯一（stable，落盘用） */
  id: string;
  /** 明细文本（trim 后非空才保留） */
  text: string;
  done: boolean;
  /** 展示顺序（0-based，normalizePlan 重排） */
  order: number;
  /** 该明细的责任人（可选，单人）；被指派后若不在负责人/顾问人则自动并入负责人 */
  assignee?: string;
}

/**
 * todo 独立资源落盘结构（2026-09-03，方案 B「todo 独立并发」）。
 *
 * todo 从 plan.json 快照中拆出，作为唯一真源独立落盘（DATA_DIR/plans/<planId>/todos.json），
 * 从而允许多人并发编辑 todo 而不受计划级排他锁约束：
 *   - plan.json 的 tasks[].todos 降级为「最后一次保存时的快照」（可能过期）；
 *   - 读取 / 保存 plan 时，统一以 todos.json 的 byTask 为准合并（见 routes.readPlanFresh）。
 *   - revision 单调递增，供前端轮询判断是否有他人变更。
 */
export interface TodosFile {
  schemaVersion: 1;
  planId: string;
  /** 单调递增；每次指令写操作 +1，前端据此判断是否需要拉取最新 */
  revision: number;
  /** taskId → 该任务的验收清单（数组顺序 == order） */
  byTask: Record<string, TodoItem[]>;
}

/** todo 指令（POST /plans/:planId/tasks/:taskId/todos 的请求体，见 shared/todo.applyTodoOp） */
export interface TodoOp {
  op: 'add' | 'update' | 'delete' | 'move';
  /** update / delete / move 必填 */
  todoId?: string;
  /** add 必填 */
  text?: string;
  /** update 的字段补丁（text / done / assignee） */
  patch?: Partial<Pick<TodoItem, 'text' | 'done' | 'assignee'>>;
  /** move 的方向：-1 上移、+1 下移 */
  direction?: -1 | 1;
}

/** todo 指令响应：最新 revision + 该任务的最新清单 */
export interface TodoOpResp {
  revision: number;
  todos: TodoItem[];
}

export interface Task {
  /** 'T-0001' 系统生成，全生命周期不变（K6） */
  id: string;
  /** 显示行号 1-based，随排序重算 */
  seq: number;
  name: string;
  parentId: string | null;
  input: TaskInput;
  deps: Dependency[];
  /** 落盘为缓存，读取后仍会重算 */
  computed?: TaskComputed;
  collapsed?: boolean;
  note?: string;
  /**
   * 负责人（可多人）。
   * ⚠️ 2026-09-03 起由 `string` 升级为 `string[]`；历史字符串由 `normalizePlan()` 自动迁移，无需手工处理。
   * 恒为数组（可能为空数组），业务侧不要再判 `Array.isArray`。
   */
  owner?: string[];
  /**
   * 顾问人（可多人，2026-09-03 新增）。
   * 与 owner 同构；导出时按用户裁定只写进 Notes，不生成 MS Project 的 Resource / Assignment。
   */
  consultant?: string[];
  /** 扩展位 0-100 */
  progress?: number;
  /** 细分交付清单（轻量验收清单，见 TodoItem）；恒为数组（可能为空），由 normalizePlan 归一化 */
  todos?: TodoItem[];
}

export interface CalendarConfig {
  /** 扩展位：'WORKWEEK5'（工作日口径）；'NATURAL' 保留以兼容既有引用，本期不再驱动排程 */
  mode: 'NATURAL' | 'WORKWEEK5';
  /** 扩展位（本期忽略，全局日历由 T02 calendar.json 提供） */
  holidays?: ISODate[];
  /**
   * 是否按全局日历跳过国定节假日（与调休补班）：
   *   true  → 排程使用 buildWorkCalendar() 真实日历（跳过周末+法定假日+调休补班）
   *   false → 排程使用 NATURAL_CALENDAR（全工作日兜底，适合倒推交付期的硬期限项目）
   * 默认 false，保持向后兼容（v1.0 之前的 plan 数据迁移也按 false 处理）。
   */
  skipHolidays: boolean;
  /** 无任何约束时的落脚点，默认创建日 */
  anchorDate: ISODate;
  /** '1d' */
  defaultDuration: string;
}

/**
 * 工作日历：日期是否工作的纯函数接口（前后端共用，零副作用）。
 * 排程/日期算术统一通过它判断工作日，从而跳过周末与节假日、纳入调休补班。
 */
export interface WorkCalendar {
  /** 该自然日是否工作日（排除周末+法定假，但调休补班日算工作） */
  isWorking(date: ISODate): boolean;
  /** 该自然日是否法定放假日 */
  isHoliday(date: ISODate): boolean;
  /** 该自然日是否调休补班日（周末变工作日） */
  isMakeup(date: ISODate): boolean;
  /** 节假日展示标签；非节假日返回 null（补班日不着色） */
  labelOf(date: ISODate): string | null;
  /** 已覆盖（数据已核实）的年份集合；不在其中 → 降级为仅周末规则 */
  coveredYears: ReadonlySet<number>;
}

/** 全局日历落盘结构（T02 后端用，T01 仅定义类型） */
export interface CalendarConfigData {
  schemaVersion: 1;
  version: number;
  updatedBy: string;
  updatedAt: string;
  userHolidays: Record<number, ISODate[]>;
  userRemoved: Record<number, ISODate[]>;
  makeup: Record<number, ISODate[]>;
  coveredYears: number[];
}

/** 全工作日兜底（未注入日历的调用方不崩溃）：每一天都算工作日 */
export const NATURAL_CALENDAR: WorkCalendar = {
  isWorking: () => true,
  isHoliday: () => false,
  isMakeup: () => false,
  labelOf: () => null,
  coveredYears: new Set<number>(),
};

export interface Plan {
  schemaVersion: 1;
  /** 'p-20260826-113821-a7f3' */
  planId: string;
  name: string;
  /** 与 history 最新版本号一致 */
  version: number;
  createdAt: ISOTimestamp;
  updatedAt: ISOTimestamp;
  updatedBy: string;
  /** 生成 T-xxxx 用，只增不减 */
  nextTaskSeq: number;
  calendar: CalendarConfig;
  /** 数组顺序 == 显示顺序 */
  tasks: Task[];
}

export interface PlanMeta {
  planId: string;
  name: string;
  version: number;
  updatedAt: ISOTimestamp;
  updatedBy: string;
  taskCount: number;
}

export interface VersionMeta {
  version: number;
  timestamp: ISOTimestamp;
  editor: string;
  notes: string;
}

export interface VersionEntry extends VersionMeta {
  planSnapshot: Plan;
  /** 扩展位：快照外置文件名 */
  snapshotRef?: string;
}

export interface HistoryFile {
  schemaVersion: 1;
  planId: string;
  versions: VersionEntry[];
}

/* ========================= 编辑锁 ========================= */

export type LockStatus = 'IDLE' | 'EDITING';

export interface LockState {
  planId: string;
  status: LockStatus;
  holder: string | null;
  /** 对外（GET /locks/:id）返回时一律置 null */
  lockToken: string | null;
  since: number | null;
  lastHeartbeatAt: number | null;
  expiresAt: number | null;
}

/* ========================= 诊断与排程结果 ========================= */

export interface Diagnostic {
  level: Level;
  code: number;
  taskId?: string;
  field?: TaskField;
  message: string;
}

export interface ScheduleResult {
  computed: Record<string, TaskComputed>;
  diagnostics: Diagnostic[];
  order: string[];
  projectStart: ISODate;
  projectEnd: ISODate;
}

export interface ScheduleOptions {
  /** 无任何约束时的落脚日期；缺省取 plan.calendar.anchorDate，再缺省取今天 */
  anchorDate?: ISODate;
  /** 缺省时长文本；缺省取 plan.calendar.defaultDuration，再缺省 '1d' */
  defaultDuration?: string;
  /** 工作日历；缺省 NATURAL_CALENDAR（全工作日兜底） */
  calendar?: WorkCalendar;
}

/* ========================= API 契约（K9） ========================= */

export interface ApiResp<T> {
  code: number;
  data: T | null;
  message: string;
}

export interface LockCfgPublic {
  timeoutMs: number;
  heartbeatMs: number;
  sweepMs: number;
  pollMs: number;
}

export interface HealthInfo {
  ok: true;
  dataDir: string;
  version: string;
  lock: LockCfgPublic;
}

export interface CreatePlanReq {
  name: string;
  editor: string;
  notes: string;
}

export interface SavePlanReq {
  plan: Plan;
  editor: string;
  notes: string;
  lockToken: string;
  baseVersion: number;
}

export interface SavePlanResp {
  plan: Plan;
  version: number;
}

export interface RestoreReq {
  version: number;
  editor: string;
  notes: string;
  lockToken: string;
}

export interface AcquireLockReq {
  user: string;
}

export interface LockTokenReq {
  user: string;
  lockToken: string;
}

export interface ValidationErrData {
  diagnostics: Diagnostic[];
}

export type ExportFormat = 'mspdi' | 'csv' | 'md';

/* ========================= 错误码（§4.2） ========================= */

export const ErrCode = {
  OK: 0,

  ERR_VALIDATION: 1001,
  ERR_NOTES_REQUIRED: 1002,
  ERR_OVER_CONSTRAINED: 1003,
  ERR_CYCLE: 1004,
  ERR_DEP_PARSE: 1005,
  WARN_DEP_CONFLICT: 1006,
  ERR_INVALID_DATE: 1007,
  ERR_DURATION_PARSE: 1008,
  ERR_DEP_TARGET_MISSING: 1009,
  ERR_DEP_SELF: 1010,
  ERR_DEP_ANCESTOR: 1011,
  WARN_PARENT_DEP_IGNORED: 1012,
  ERR_NEGATIVE_DURATION: 1013,
  ERR_PARENT_CYCLE: 1014,
  WARN_PARENT_INPUT_IGNORED: 1015,
  WARN_UNSCHEDULED: 1016,
  WARN_DURATION_DEFAULTED: 1017,
  WARN_REDUNDANT_INPUT: 1018,
  ERR_SCHEDULE: 1019,

  ERR_LOCK_HELD: 2001,
  ERR_LOCK_LOST: 2002,
  ERR_NO_LOCK: 2003,

  ERR_PLAN_NOT_FOUND: 3001,
  ERR_VERSION_NOT_FOUND: 3002,
  ERR_STALE_VERSION: 3003,

  ERR_FEATURE_DISABLED: 4001,

  ERR_INTERNAL: 5000,
} as const;

export type ErrCodeName = keyof typeof ErrCode;
export type ErrCodeValue = (typeof ErrCode)[ErrCodeName];

/** 错误码 → HTTP 状态码（§4.2） */
export const HTTP_STATUS_BY_CODE: Record<number, number> = {
  [ErrCode.OK]: 200,
  [ErrCode.ERR_VALIDATION]: 400,
  [ErrCode.ERR_NOTES_REQUIRED]: 400,
  [ErrCode.ERR_OVER_CONSTRAINED]: 400,
  [ErrCode.ERR_CYCLE]: 400,
  [ErrCode.ERR_LOCK_HELD]: 409,
  [ErrCode.ERR_LOCK_LOST]: 409,
  [ErrCode.ERR_NO_LOCK]: 409,
  [ErrCode.ERR_PLAN_NOT_FOUND]: 404,
  [ErrCode.ERR_VERSION_NOT_FOUND]: 404,
  [ErrCode.ERR_STALE_VERSION]: 409,
  [ErrCode.ERR_FEATURE_DISABLED]: 501,
  [ErrCode.ERR_INTERNAL]: 500,
};

export function httpStatusOf(code: number): number {
  return HTTP_STATUS_BY_CODE[code] ?? 400;
}

/** 错误码 → 中文短名（前端 Snackbar 兜底文案用） */
export const ERR_CODE_LABEL: Record<number, string> = {
  [ErrCode.ERR_VALIDATION]: '校验失败',
  [ErrCode.ERR_NOTES_REQUIRED]: '变更纪要必填',
  [ErrCode.ERR_OVER_CONSTRAINED]: '过度约束（开始/结束/时长最多填 2 个）',
  [ErrCode.ERR_CYCLE]: '循环依赖',
  [ErrCode.ERR_DEP_PARSE]: '依赖表达式非法',
  [ErrCode.WARN_DEP_CONFLICT]: '与依赖冲突',
  [ErrCode.ERR_INVALID_DATE]: '日期非法',
  [ErrCode.ERR_DURATION_PARSE]: '时长非法',
  [ErrCode.ERR_DEP_TARGET_MISSING]: '依赖行号不存在',
  [ErrCode.ERR_DEP_SELF]: '不能依赖自己',
  [ErrCode.ERR_DEP_ANCESTOR]: '不能依赖自己的祖先/后代',
  [ErrCode.WARN_PARENT_DEP_IGNORED]: '父任务依赖被忽略',
  [ErrCode.ERR_NEGATIVE_DURATION]: '结束不得早于开始',
  [ErrCode.ERR_PARENT_CYCLE]: '父子层级成环',
  [ErrCode.WARN_PARENT_INPUT_IGNORED]: '父任务手填时间被忽略',
  [ErrCode.WARN_UNSCHEDULED]: '无约束，已落到锚点日期',
  [ErrCode.WARN_DURATION_DEFAULTED]: '时长缺省为 1d',
  [ErrCode.WARN_REDUNDANT_INPUT]: '三者同填但一致',
  [ErrCode.ERR_SCHEDULE]: '排程计算出错',
  [ErrCode.ERR_LOCK_HELD]: '编辑权被他人持有',
  [ErrCode.ERR_LOCK_LOST]: '编辑权已失效',
  [ErrCode.ERR_NO_LOCK]: '未持有编辑权',
  [ErrCode.ERR_PLAN_NOT_FOUND]: '计划不存在',
  [ErrCode.ERR_VERSION_NOT_FOUND]: '版本不存在',
  [ErrCode.ERR_STALE_VERSION]: '版本已过期，请刷新',
  [ErrCode.ERR_FEATURE_DISABLED]: '本部署未启用该能力',
  [ErrCode.ERR_INTERNAL]: '服务内部错误',
};

/* ========================= 领域异常 ========================= */

/**
 * 领域异常：前后端共用。
 * 服务端由错误中间件转成 { code, data, message } + HTTP 状态码；
 * 共享层（datetime/scheduler）抛出后由调用方转成 Diagnostic。
 */
export class DomainError extends Error {
  public readonly code: number;
  public readonly data: unknown;

  constructor(code: number, message: string, data: unknown = null) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.data = data;
  }
}

export function isDomainError(e: unknown): e is DomainError {
  return e instanceof DomainError;
}

/* ========================= 全局常量 ========================= */

/** 表格与甘特共用行高（K16，同步 CSS 变量 --row-h） */
export const ROW_H = 32;

/** 表头 / 时间轴头高度 */
export const HEAD_H = 36;

/** 缩放档位 → 每天像素宽 */
export const DAY_WIDTH: Record<'day' | 'week' | 'month', number> = {
  day: 24,
  week: 8,
  month: 3,
};

export type ZoomLevel = keyof typeof DAY_WIDTH;

/** 缺省时长文本 */
export const DEFAULT_DURATION_TEXT = '1d';

/** notes 长度上限（K12） */
export const NOTES_MAX_LEN = 500;

/** 落盘 schema 版本（K17） */
export const SCHEMA_VERSION = 1 as const;

/** 数据来源 → 中文说明（UI tooltip） */
export const DERIVE_SOURCE_LABEL: Record<DeriveSource, string> = {
  INPUT: '手动输入',
  DEP: '由依赖关系推算',
  ROLLUP: '由子任务汇总',
  ANCHOR: '由默认锚点日期推算',
  MIXED: '由其它已填字段推算',
};
export type UserRole = 'admin' | 'user';
export type WorkspaceRole = 'owner' | 'editor' | 'viewer';

export interface PublicUserInfo {
  userId: string;
  username: string;
  displayName: string;
  role: UserRole;
}

export interface PublicWorkspaceInfo {
  workspaceId: string;
  name: string;
  description?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  members: Array<{ userId: string; displayName: string; role: WorkspaceRole; joinedAt: string }>;
}

/** 身份协作层错误码（前后端共用，src/api.ts 用作 humanAuthError 分支；server/auth/types.ts 再 re-export 一份保证服务端代码零改动） */
export const AUTH_ERR = {
  INVALID_CREDENTIALS: 4101,
  WEAK_PASSWORD: 4102,
  USERNAME_TAKEN: 4103,
  SESSION_INVALID: 4104,
  SESSION_EXPIRED: 4105,
  WORKSPACE_NOT_FOUND: 4201,
  WORKSPACE_FORBIDDEN: 4202,
  INVITE_INVALID: 4301,
  INVITE_EXPIRED: 4302,
  INVITE_CONSUMED: 4303,
  AUTH_REQUIRED: 4401,
  ROLE_INSUFFICIENT: 4403,
} as const;

export type AuthErrCode = (typeof AUTH_ERR)[keyof typeof AUTH_ERR];

