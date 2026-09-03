/**
 * shared/scheduler.ts —— 排程引擎（前后端共用唯一入口，K8）。
 *
 * 职责：
 *   1. 依赖表达式解析 / 反解析（K5：存 ID、显示行号）
 *   2. 统一有向图（依赖边 ∪ 层级边）+ Kahn 拓扑排序 + 环检测（§2.5）
 *   3. 「三选二」× 依赖 的 15 分支决策矩阵（§2.4）
 *   4. 父子 rollup
 *   5. 冲突/合法性诊断
 *   6. 计划规整（seq 重排、树形连续化、脏数据清洗）与树操作纯函数
 *
 * 零副作用：不 import fs / DOM / express，可在浏览器与 Node 中运行同一份源码（D5）。
 */

import {
  DomainError,
  ErrCode,
  SCHEMA_VERSION,
  isDomainError,
  NATURAL_CALENDAR,
  type WorkCalendar,
  type DeriveSource,
  type Dependency,
  type DepType,
  type Diagnostic,
  type Duration,
  type DurationUnit,
  type FieldSources,
  type ISODate,
  type Level,
  type Plan,
  type ScheduleOptions,
  type ScheduleResult,
  type Task,
  type TaskComputed,
  type TaskField,
  type TaskInput,
} from './types';
import { normalizePeople } from './people';
import {
  addDuration,
  countWorkingDays,
  diffDuration,
  formatISODate,
  isValidISODate,
  maxDate,
  minDate,
  nowTimestamp,
  parseDuration,
  parseISODate,
  nextWorkingDay,
  subDuration,
  todayISO,
} from './datetime';

/* ============================================================
   0. 通用小工具
   ============================================================ */

const DEP_ITEM_RE = /^(\d+)\s*(FS|SS|FF|SF)?\s*(?:([+-])\s*(\d+)\s*([dwm]))?$/i;

const ONE_DAY: Duration = { value: 1, unit: 'd' };

export function diag(
  level: Level,
  code: number,
  message: string,
  taskId?: string,
  field?: TaskField,
): Diagnostic {
  const d: Diagnostic = { level, code, message };
  if (taskId !== undefined) d.taskId = taskId;
  if (field !== undefined) d.field = field;
  return d;
}

/** 任务 ID 生成规则（K6）：'T-' + 4 位零填充 */
export function makeTaskId(seq: number): string {
  const n = Math.max(1, Math.floor(seq));
  return `T-${String(n).padStart(4, '0')}`;
}

/** 从 'T-0012' 抽出数字 12；非法返回 0 */
export function taskIdSeqNumber(id: string): number {
  const m = /^T-(\d+)$/.exec(id ?? '');
  return m ? Number(m[1]) : 0;
}

export function emptyTaskInput(): TaskInput {
  return { start: null, end: null, duration: null };
}

/** 创建空白任务（前后端共用，保证字段齐全） */
export function createEmptyTask(id: string, seq: number, parentId: string | null, name = ''): Task {
  return {
    id,
    seq,
    name,
    parentId,
    input: emptyTaskInput(),
    deps: [],
    collapsed: false,
  };
}

export interface IdSeqMaps {
  idToSeq: Map<string, number>;
  seqToId: Map<number, string>;
}

/** 建立「稳定 ID ⇄ 显示行号」双向索引（K5 唯一转换依据） */
export function buildIdSeqMaps(tasks: Task[]): IdSeqMaps {
  const idToSeq = new Map<string, number>();
  const seqToId = new Map<number, string>();
  tasks.forEach((t, i) => {
    const seq = t.seq && t.seq > 0 ? t.seq : i + 1;
    idToSeq.set(t.id, seq);
    seqToId.set(seq, t.id);
  });
  return { idToSeq, seqToId };
}

/* ============================================================
   1. 依赖表达式解析 / 反解析（§2.2）
   ============================================================ */

export interface DepParseResult {
  deps: Dependency[];
  diagnostics: Diagnostic[];
}

/**
 * 解析用户输入的依赖表达式，如 '2FS,5SS+2d'。
 * @param raw      用户原文
 * @param seqToId  当前行号 → 稳定 ID
 * @param selfTaskId 当前任务 ID（用于自引用校验，可选）
 */
export function parseDepsExpr(
  raw: string,
  seqToId: Map<number, string>,
  selfTaskId?: string,
): DepParseResult {
  const deps: Dependency[] = [];
  const diagnostics: Diagnostic[] = [];
  const text = (raw ?? '').trim();
  if (text === '') return { deps, diagnostics };

  const seen = new Set<string>();
  for (const chunk of text.split(',')) {
    const item = chunk.trim();
    if (item === '') continue;
    const m = DEP_ITEM_RE.exec(item);
    if (!m) {
      diagnostics.push(
        diag(
          'error',
          ErrCode.ERR_DEP_PARSE,
          `依赖表达式「${item}」无法解析，示例：3 / 2FS / 3FF+1w / 7ss-3d`,
          selfTaskId,
          'deps',
        ),
      );
      continue;
    }
    const predRow = Number(m[1]);
    const type = (m[2] ?? 'FS').toUpperCase() as DepType;
    const lagSign: 1 | -1 = m[3] === '-' ? -1 : 1;
    const lag: Duration | null = m[4]
      ? { value: Number(m[4]), unit: (m[5] ?? 'd').toLowerCase() as DurationUnit }
      : null;

    const predId = seqToId.get(predRow);
    if (!predId) {
      diagnostics.push(
        diag('error', ErrCode.ERR_DEP_TARGET_MISSING, `依赖的行号 ${predRow} 不存在`, selfTaskId, 'deps'),
      );
      continue;
    }
    if (selfTaskId && predId === selfTaskId) {
      diagnostics.push(diag('error', ErrCode.ERR_DEP_SELF, `不能依赖自己（行 ${predRow}）`, selfTaskId, 'deps'));
      continue;
    }
    const key = `${predId}|${type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deps.push({ predecessorId: predId, type, lag, lagSign, raw: item });
  }
  return { deps, diagnostics };
}

/** 反解析：稳定 ID → 当前行号，用于表格显示（K5） */
export function formatDepsExpr(deps: Dependency[] | undefined, idToSeq: Map<string, number>): string {
  if (!deps || deps.length === 0) return '';
  return deps
    .map((d) => {
      const seq = idToSeq.get(d.predecessorId);
      if (seq === undefined) return d.raw || '?';
      const lag = d.lag ? `${d.lagSign < 0 ? '-' : '+'}${d.lag.value}${d.lag.unit}` : '';
      return `${seq}${d.type}${lag}`;
    })
    .join(',');
}

/** 单条依赖的可读标签，用于甘特箭头中点文案，如 'FF+1w' */
export function formatDepLabel(d: Dependency): string {
  const lag = d.lag ? `${d.lagSign < 0 ? '-' : '+'}${d.lag.value}${d.lag.unit}` : '';
  return `${d.type}${lag}`;
}

/* ============================================================
   2. 树结构纯函数（表格 / 甘特 / 服务端共用）
   ============================================================ */

export function buildTaskIndex(tasks: Task[]): Map<string, Task> {
  return new Map(tasks.map((t) => [t.id, t]));
}

/** 收集某任务的全部后代 ID（含自身可选） */
export function collectDescendants(tasks: Task[], rootId: string, includeSelf = false): string[] {
  const childrenOf = new Map<string, string[]>();
  for (const t of tasks) {
    if (!t.parentId) continue;
    const arr = childrenOf.get(t.parentId) ?? [];
    arr.push(t.id);
    childrenOf.set(t.parentId, arr);
  }
  const out: string[] = includeSelf ? [rootId] : [];
  const stack = [...(childrenOf.get(rootId) ?? [])];
  const guard = new Set<string>([rootId]);
  while (stack.length) {
    const id = stack.pop() as string;
    if (guard.has(id)) continue;
    guard.add(id);
    out.push(id);
    stack.push(...(childrenOf.get(id) ?? []));
  }
  return out;
}

/**
 * 任务在数组中的「子树区间」[from, to)。
 * 前提：tasks 已按树形连续化（normalizePlan 保证）。
 */
export function subtreeRange(tasks: Task[], taskId: string): [number, number] {
  const from = tasks.findIndex((t) => t.id === taskId);
  if (from < 0) return [-1, -1];
  const descendants = new Set(collectDescendants(tasks, taskId));
  let to = from + 1;
  while (to < tasks.length && descendants.has(tasks[to].id)) to += 1;
  return [from, to];
}

/** 计算每个任务的 depth（父指针成环时按 0 处理，安全） */
export function computeDepthMap(tasks: Task[]): Map<string, number> {
  const byId = buildTaskIndex(tasks);
  const depth = new Map<string, number>();
  for (const t of tasks) {
    let d = 0;
    let cur = t.parentId;
    const guard = new Set<string>([t.id]);
    while (cur && byId.has(cur) && !guard.has(cur)) {
      guard.add(cur);
      d += 1;
      cur = byId.get(cur)?.parentId ?? null;
    }
    depth.set(t.id, d);
  }
  return depth;
}

/** 折叠过滤：隐藏所有「祖先被折叠」的任务（表格与甘特共用，保证行号一致） */
/**
 * 折叠过滤后的可见任务（表格与甘特共用，保证行对齐 K16）。
 *
 * @param keep 额外保留白名单（列筛选结果，含命中行的祖先链）；null / undefined 表示不做筛选。
 *             折叠与筛选取**交集**：被折叠隐藏的行即使命中筛选也不显示（折叠是用户显式意图，优先）。
 */
export function computeVisibleTasks(tasks: Task[], keep?: ReadonlySet<string> | null): Task[] {
  const byId = buildTaskIndex(tasks);
  const hidden = new Set<string>();
  for (const t of tasks) {
    const p = t.parentId;
    if (!p) continue;
    const parent = byId.get(p);
    if (!parent) continue;
    if (hidden.has(p) || parent.collapsed === true) hidden.add(t.id);
  }
  return tasks.filter((t) => !hidden.has(t.id) && (keep == null || keep.has(t.id)));
}

export function hasChildren(tasks: Task[], taskId: string): boolean {
  return tasks.some((t) => t.parentId === taskId);
}

/* ============================================================
   3. 计划规整（脏数据清洗 + seq 重排 + 树形连续化）
   ============================================================ */

function sanitizeInput(raw: unknown): TaskInput {
  const src = (raw ?? {}) as Partial<TaskInput>;
  const norm = (v: unknown): string | null => {
    if (typeof v !== 'string') return null;
    const t = v.trim();
    return t === '' ? null : t;
  };
  return { start: norm(src.start), end: norm(src.end), duration: norm(src.duration) };
}

function sanitizeDeps(raw: unknown): Dependency[] {
  if (!Array.isArray(raw)) return [];
  const out: Dependency[] = [];
  for (const d of raw) {
    const item = d as Partial<Dependency>;
    if (!item || typeof item.predecessorId !== 'string' || item.predecessorId === '') continue;
    const type = (typeof item.type === 'string' ? item.type.toUpperCase() : 'FS') as DepType;
    if (!['FS', 'SS', 'FF', 'SF'].includes(type)) continue;
    let baseLagSign: 1 | -1 = item.lagSign === -1 ? -1 : 1;
    let lag: Duration | null = null;
    if (item.lag && typeof item.lag === 'object') {
      const v = Number((item.lag as Duration).value);
      const u = String((item.lag as Duration).unit ?? 'd').toLowerCase();
      if (Number.isFinite(v) && v >= 0 && ['d', 'w', 'm'].includes(u)) {
        lag = { value: Math.floor(v), unit: u as DurationUnit };
      }
    } else if (typeof item.lag === 'string' || (item.lag != null && typeof item.lag !== 'object')) {
      // 字符串型 lag（如 '1w' / '+1w' / '-3d'）：解析符号/数值/单位，
      // 与 item.lagSign 合并符号，避免后续集成时静默丢偏移。
      const lagStr = String(item.lag).trim();
      const m = /^([+-]?)\s*(\d+)\s*([dwm])$/i.exec(lagStr);
      if (m) {
        const strSign = m[1] === '-' ? -1 : m[1] === '+' ? 1 : 1;
        const num = Number(m[2]);
        const unit = m[3].toLowerCase();
        if (Number.isFinite(num) && ['d', 'w', 'm'].includes(unit)) {
          lag = { value: Math.floor(Math.abs(num)), unit: unit as DurationUnit };
          const itemSign = item.lagSign === -1 ? -1 : 1;
          const effectiveSign = strSign * itemSign;
          baseLagSign = effectiveSign < 0 ? -1 : 1;
        }
      }
    }
    const lagSign: 1 | -1 = baseLagSign;
    out.push({
      predecessorId: item.predecessorId,
      type,
      lag,
      lagSign,
      raw: typeof item.raw === 'string' ? item.raw : '',
    });
  }
  return out;
}

/**
 * 树形连续化：DFS 输出，保证「父任务紧跟其全部子孙」，同层保持原相对顺序。
 * 这是 seq 编号、表格缩进、MSPDI OutlineLevel 正确的前提。
 */
function orderTasksByTree(tasks: Task[]): Task[] {
  const childrenOf = new Map<string | null, Task[]>();
  const ids = new Set(tasks.map((t) => t.id));
  for (const t of tasks) {
    const key = t.parentId && ids.has(t.parentId) && t.parentId !== t.id ? t.parentId : null;
    const arr = childrenOf.get(key) ?? [];
    arr.push(t);
    childrenOf.set(key, arr);
  }
  const out: Task[] = [];
  const visited = new Set<string>();
  const walk = (parentId: string | null): void => {
    for (const t of childrenOf.get(parentId) ?? []) {
      if (visited.has(t.id)) continue;
      visited.add(t.id);
      out.push(t);
      walk(t.id);
    }
  };
  walk(null);
  // 兜底：父指针成环导致未被遍历到的节点，按原序附加到末尾（降级不丢数据）
  for (const t of tasks) {
    if (!visited.has(t.id)) {
      visited.add(t.id);
      out.push(t);
    }
  }
  return out;
}

/**
 * 规整计划：清洗脏字段、去重 ID、修正非法 parentId、丢弃悬空依赖、
 * 树形连续化并重排 seq、修正 nextTaskSeq。纯函数，返回新对象。
 */
export function normalizePlan(input: Plan): Plan {
  const raw = (input ?? {}) as Partial<Plan>;
  const rawTasks = Array.isArray(raw.tasks) ? raw.tasks : [];

  // ① 逐个清洗 + ID 去重
  const seenIds = new Set<string>();
  const cleaned: Task[] = [];
  for (const t0 of rawTasks) {
    const t = (t0 ?? {}) as Partial<Task>;
    if (typeof t.id !== 'string' || t.id === '' || seenIds.has(t.id)) continue;
    seenIds.add(t.id);
    cleaned.push({
      id: t.id,
      seq: 0,
      name: typeof t.name === 'string' ? t.name : '',
      parentId: typeof t.parentId === 'string' && t.parentId !== '' ? t.parentId : null,
      input: sanitizeInput(t.input),
      deps: sanitizeDeps(t.deps),
      collapsed: t.collapsed === true,
      // 人员字段（负责人 / 顾问人）：恒归一化为数组。
      // 历史数据的 owner 是 string（可能手打过 "User01,User13"），normalizePeople 会自动拆成数组；
      // 旧计划缺失 consultant → 空数组。写回后即完成升级，无需单独的 schemaVersion 迁移脚本。
      owner: normalizePeople(t.owner),
      consultant: normalizePeople(t.consultant),
      ...(typeof t.note === 'string' ? { note: t.note } : {}),
      ...(typeof t.progress === 'number' ? { progress: t.progress } : {}),
    });
  }

  // ② parentId 合法性（不存在 / 自引用 → 置 null）
  for (const t of cleaned) {
    if (t.parentId && (!seenIds.has(t.parentId) || t.parentId === t.id)) t.parentId = null;
  }

  // ③ 依赖指向不存在的任务 → 丢弃；自引用 → 丢弃
  for (const t of cleaned) {
    t.deps = t.deps.filter((d) => seenIds.has(d.predecessorId) && d.predecessorId !== t.id);
  }

  // ④ 树形连续化 + seq 重排
  const ordered = orderTasksByTree(cleaned);
  ordered.forEach((t, i) => {
    t.seq = i + 1;
  });

  // ⑤ nextTaskSeq 只增不减
  const maxIdSeq = ordered.reduce((acc, t) => Math.max(acc, taskIdSeqNumber(t.id)), 0);
  const nextTaskSeq = Math.max(Number(raw.nextTaskSeq ?? 1) || 1, maxIdSeq + 1, 1);

  const calendarRaw = (raw.calendar ?? {}) as Partial<Plan['calendar']>;
  const anchorDate = isValidISODate(calendarRaw.anchorDate) ? (calendarRaw.anchorDate as ISODate) : todayISO();
  const defaultDuration =
    typeof calendarRaw.defaultDuration === 'string' && calendarRaw.defaultDuration.trim() !== ''
      ? calendarRaw.defaultDuration.trim()
      : '1d';

  return {
    schemaVersion: SCHEMA_VERSION,
    planId: String(raw.planId ?? ''),
    name: typeof raw.name === 'string' && raw.name.trim() !== '' ? raw.name : '未命名计划',
    version: Number(raw.version ?? 0) || 0,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : nowTimestamp(),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : nowTimestamp(),
    updatedBy: typeof raw.updatedBy === 'string' ? raw.updatedBy : '',
    nextTaskSeq,
    calendar: {
      mode: 'WORKWEEK5',
      // 本期忽略 per-plan holidays 字段（D7）：全局日历由 T02 calendar.json 提供，避免与全局冲突
      holidays: [],
      anchorDate,
      defaultDuration,
    },
    tasks: ordered,
  };
}

/* ============================================================
   4. 排程主流程（§2.5）
   ============================================================ */

interface Graph {
  /** node → 求值后继列表（可含重复边） */
  adj: Map<string, string[]>;
  indeg: Map<string, number>;
}

function buildGraph(tasks: Task[], effDeps: Map<string, Dependency[]>, parentOf: Map<string, string | null>): Graph {
  const adj = new Map<string, string[]>();
  const indeg = new Map<string, number>();
  for (const t of tasks) {
    adj.set(t.id, []);
    indeg.set(t.id, 0);
  }
  const addEdge = (from: string, to: string): void => {
    const list = adj.get(from);
    if (!list || !indeg.has(to)) return;
    list.push(to);
    indeg.set(to, (indeg.get(to) ?? 0) + 1);
  };
  for (const t of tasks) {
    // 依赖边：前置先算
    for (const d of effDeps.get(t.id) ?? []) addEdge(d.predecessorId, t.id);
    // 层级边：子先算，父再 rollup
    const p = parentOf.get(t.id) ?? null;
    if (p) addEdge(t.id, p);
  }
  return { adj, indeg };
}

interface SortResult {
  order: string[];
  residual: string[];
}

/** Kahn 拓扑排序；队列按任务原序播种，保证结果稳定 */
function topoSort(tasks: Task[], graph: Graph): SortResult {
  const indeg = new Map(graph.indeg);
  const order: string[] = [];
  const queue: string[] = tasks.filter((t) => (indeg.get(t.id) ?? 0) === 0).map((t) => t.id);
  let head = 0;
  while (head < queue.length) {
    const id = queue[head];
    head += 1;
    order.push(id);
    for (const nxt of graph.adj.get(id) ?? []) {
      const v = (indeg.get(nxt) ?? 0) - 1;
      indeg.set(nxt, v);
      if (v === 0) queue.push(nxt);
    }
  }
  const done = new Set(order);
  const residual = tasks.filter((t) => !done.has(t.id)).map((t) => t.id);
  return { order, residual };
}

/** 在残余子图中 DFS 提取一条可读环路径：A → B → A */
function findCycle(graph: Graph, residual: string[]): string[] {
  const inSet = new Set(residual);
  const visited = new Set<string>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  let result: string[] = [];

  const dfs = (id: string): boolean => {
    visited.add(id);
    stack.push(id);
    onStack.add(id);
    for (const nxt of graph.adj.get(id) ?? []) {
      if (!inSet.has(nxt)) continue;
      if (onStack.has(nxt)) {
        const i = stack.indexOf(nxt);
        result = [...stack.slice(i), nxt];
        return true;
      }
      if (!visited.has(nxt) && dfs(nxt)) return true;
    }
    stack.pop();
    onStack.delete(id);
    return false;
  };

  for (const id of residual) {
    if (!visited.has(id) && dfs(id)) break;
  }
  return result;
}

interface LeafCtx {
  computed: Record<string, TaskComputed>;
  deps: Dependency[];
  anchor: ISODate;
  defaultDuration: Duration;
  calendar: WorkCalendar;
  depth: number;
}

/**
 * 叶子任务求值：§2.4 决策矩阵全 15 条分支。
 *
 * fieldSources 语义（供 UI 灰显）：
 *   INPUT  = 用户手填该字段
 *   DEP    = 由依赖候选推出
 *   ANCHOR = 落到锚点/默认值
 *   MIXED  = 由用户其它字段推出（如 S+E 推 duration）
 */
function resolveLeaf(task: Task, ctx: LeafCtx, diagnostics: Diagnostic[]): TaskComputed {
  const input: TaskInput = task.input ?? { start: null, end: null, duration: null };

  const pushErr = (e: unknown, field: TaskField): void => {
    if (isDomainError(e)) {
      diagnostics.push(diag('error', e.code, e.message, task.id, field));
    } else {
      diagnostics.push(diag('error', ErrCode.ERR_INTERNAL, String(e), task.id, field));
    }
  };

  let S: ISODate | null = null;
  let E: ISODate | null = null;
  let D: Duration | null = null;

  if (input.start) {
    try {
      S = formatISODate(parseISODate(input.start));
    } catch (e) {
      pushErr(e, 'start');
    }
  }
  if (input.end) {
    try {
      E = formatISODate(parseISODate(input.end));
    } catch (e) {
      pushErr(e, 'end');
    }
  }
  if (input.duration) {
    try {
      D = parseDuration(input.duration);
    } catch (e) {
      pushErr(e, 'duration');
    }
  }

  // ---- 依赖候选（§2.3）：cs = max(FS/SS candStart)，ce = max(FF/SF candEnd) ----
  const candStarts: ISODate[] = [];
  const candEnds: ISODate[] = [];
  for (const d of ctx.deps) {
    const pc = ctx.computed[d.predecessorId];
    if (!pc) continue; // 环内 / 尚未求值 → 忽略该约束（降级不崩）
    const anchorDate = d.type === 'FS' || d.type === 'FF' ? pc.end : pc.start;
    const cand = d.lag ? addDuration(anchorDate, d.lag, d.lagSign, ctx.calendar) : anchorDate;
    if (d.type === 'FS' || d.type === 'SS') candStarts.push(cand);
    else candEnds.push(cand);
  }
  const cs = maxDate(candStarts);
  const ce = maxDate(candEnds);
  const DEF = ctx.defaultDuration;

  let start: ISODate;
  let end: ISODate;
  let derivedFrom: DeriveSource;
  const src: FieldSources = { start: 'MIXED', end: 'MIXED', duration: 'MIXED' };

  if (S && E && D) {
    // #15 三者同填
    start = S;
    end = E;
    derivedFrom = 'INPUT';
    src.start = 'INPUT';
    src.end = 'INPUT';
    src.duration = 'INPUT';
    if (addDuration(S, D, 1, ctx.calendar) === E) {
      diagnostics.push(
        diag('warn', ErrCode.WARN_REDUNDANT_INPUT, '开始/结束/时长三者同填且一致，时长为冗余输入', task.id, 'duration'),
      );
    } else {
      diagnostics.push(
        diag(
          'error',
          ErrCode.ERR_OVER_CONSTRAINED,
          `过度约束：开始 ${S} + 时长 ${D.value}${D.unit} = ${addDuration(S, D, 1, ctx.calendar)}，与结束 ${E} 不一致（三者最多填 2 个）`,
          task.id,
          'duration',
        ),
      );
    }
  } else if (S && E) {
    // #1
    start = S;
    end = E;
    derivedFrom = 'INPUT';
    src.start = 'INPUT';
    src.end = 'INPUT';
  } else if (S && D) {
    // #2
    start = S;
    end = addDuration(S, D, 1, ctx.calendar);
    derivedFrom = 'INPUT';
    src.start = 'INPUT';
    src.duration = 'INPUT';
  } else if (E && D) {
    // #3
    start = subDuration(E, D, ctx.calendar);
    end = E;
    derivedFrom = 'INPUT';
    src.end = 'INPUT';
    src.duration = 'INPUT';
  } else if (S) {
    src.start = 'INPUT';
    if (ce) {
      // #4
      start = S;
      end = maxDate([ce, addDuration(S, ONE_DAY, 1, ctx.calendar)]) as ISODate;
      derivedFrom = 'MIXED';
      src.end = 'DEP';
      src.duration = 'MIXED';
    } else {
      // #5
      start = S;
      end = addDuration(S, DEF, 1, ctx.calendar);
      derivedFrom = 'INPUT';
      src.duration = 'ANCHOR';
      src.end = 'MIXED';
      diagnostics.push(
        diag('warn', ErrCode.WARN_DURATION_DEFAULTED, `未指定结束或时长，时长缺省为 ${DEF.value}${DEF.unit}`, task.id, 'duration'),
      );
    }
  } else if (E) {
    src.end = 'INPUT';
    if (cs && cs < E) {
      // #6
      start = cs;
      end = E;
      derivedFrom = 'MIXED';
      src.start = 'DEP';
      src.duration = 'MIXED';
    } else {
      // #7
      start = subDuration(E, DEF, ctx.calendar);
      end = E;
      derivedFrom = 'INPUT';
      src.start = 'MIXED';
      src.duration = 'ANCHOR';
      diagnostics.push(
        diag('warn', ErrCode.WARN_DURATION_DEFAULTED, `未指定开始或时长，时长缺省为 ${DEF.value}${DEF.unit}`, task.id, 'duration'),
      );
    }
  } else if (D) {
    src.duration = 'INPUT';
    if (cs) {
      // #8
      start = cs;
      end = addDuration(cs, D, 1, ctx.calendar);
      derivedFrom = 'DEP';
      src.start = 'DEP';
      src.end = 'DEP';
    } else if (ce) {
      // #9
      start = subDuration(ce, D, ctx.calendar);
      end = ce;
      derivedFrom = 'DEP';
      src.start = 'DEP';
      src.end = 'DEP';
    } else {
      // #10
      start = ctx.anchor;
      end = addDuration(ctx.anchor, D, 1, ctx.calendar);
      derivedFrom = 'ANCHOR';
      src.start = 'ANCHOR';
      src.end = 'ANCHOR';
      diagnostics.push(
        diag('warn', ErrCode.WARN_UNSCHEDULED, `无开始/结束/依赖约束，已落到锚点日期 ${ctx.anchor}`, task.id, 'start'),
      );
    }
  } else if (cs && ce) {
    // #11
    start = cs;
    end = maxDate([ce, addDuration(cs, ONE_DAY, 1, ctx.calendar)]) as ISODate;
    derivedFrom = 'DEP';
    src.start = 'DEP';
    src.end = 'DEP';
    src.duration = 'DEP';
  } else if (cs) {
    // #12
    start = cs;
    end = addDuration(cs, DEF, 1, ctx.calendar);
    derivedFrom = 'DEP';
    src.start = 'DEP';
    src.end = 'DEP';
    src.duration = 'ANCHOR';
    diagnostics.push(
      diag('warn', ErrCode.WARN_DURATION_DEFAULTED, `未指定时长，缺省为 ${DEF.value}${DEF.unit}`, task.id, 'duration'),
    );
  } else if (ce) {
    // #13
    start = subDuration(ce, DEF, ctx.calendar);
    end = ce;
    derivedFrom = 'DEP';
    src.start = 'DEP';
    src.end = 'DEP';
    src.duration = 'ANCHOR';
  } else {
    // #14
    start = ctx.anchor;
    end = addDuration(ctx.anchor, DEF, 1, ctx.calendar);
    derivedFrom = 'ANCHOR';
    src.start = 'ANCHOR';
    src.end = 'ANCHOR';
    src.duration = 'ANCHOR';
    diagnostics.push(
      diag('warn', ErrCode.WARN_UNSCHEDULED, `无任何时间约束，已落到锚点日期 ${ctx.anchor}`, task.id, 'start'),
    );
  }

  // ---- D5：依赖/锚点推算出的 start 落非工作日 → 静默顺延至下一工作日（手填/锚点不顺延）----
  if (src.start === 'DEP' && !ctx.calendar.isWorking(start)) {
    start = nextWorkingDay(start, ctx.calendar);
  }

  // ---- 冲突校验（ASAP 不等式语义：依赖只给「最早」，手填更晚只 warn）----
  if (cs && cs > start) {
    diagnostics.push(
      diag('warn', ErrCode.WARN_DEP_CONFLICT, `依赖要求最早 ${cs} 开始，当前开始 ${start} 早于依赖约束`, task.id, 'start'),
    );
  }
  if (ce && ce > end) {
    diagnostics.push(
      diag('warn', ErrCode.WARN_DEP_CONFLICT, `依赖要求最早 ${ce} 结束，当前结束 ${end} 早于依赖约束`, task.id, 'end'),
    );
  }

  // ---- 收尾统一处理（工作日口径：零工期才报错，见 N1d）----
  if (countWorkingDays(start, end, ctx.calendar) === 0) {
    diagnostics.push(
      diag('error', ErrCode.ERR_NEGATIVE_DURATION, `结束 ${end} 必须晚于开始 ${start}（最短 1 个工作日）`, task.id, 'end'),
    );
    end = addDuration(start, DEF, 1, ctx.calendar);
    if (!(end > start)) end = addDuration(start, ONE_DAY, 1, ctx.calendar);
  }

  return {
    start,
    end,
    duration: diffDuration(start, end, ctx.calendar),
    derivedFrom,
    fieldSources: src,
    isParent: false,
    depth: ctx.depth,
    hasError: false,
  };
}

/** 父任务 rollup：start = min(子.start)，end = max(子.end) */
function rollupParent(
  task: Task,
  kids: TaskComputed[],
  depth: number,
  diagnostics: Diagnostic[],
  cal: WorkCalendar,
): TaskComputed {
  const input = task.input ?? { start: null, end: null, duration: null };
  if (input.start || input.end || input.duration) {
    diagnostics.push(
      diag('warn', ErrCode.WARN_PARENT_INPUT_IGNORED, '父任务的时间由子任务汇总决定，手填值已被忽略', task.id, 'start'),
    );
  }
  const start = minDate(kids.map((k) => k.start)) as ISODate;
  const end = maxDate(kids.map((k) => k.end)) as ISODate;
  return {
    start,
    end,
    duration: diffDuration(start, end, cal),
    derivedFrom: 'ROLLUP',
    fieldSources: { start: 'ROLLUP', end: 'ROLLUP', duration: 'ROLLUP' },
    isParent: true,
    depth,
    hasError: false,
  };
}

/**
 * ★ 排程唯一入口（K8）。纯函数：不修改 plan，返回全量 computed + 诊断。
 */
export function schedule(plan: Plan, opts: ScheduleOptions = {}): ScheduleResult {
  const diagnostics: Diagnostic[] = [];
  const tasks: Task[] = Array.isArray(plan?.tasks) ? plan.tasks : [];
  const cal = opts.calendar ?? NATURAL_CALENDAR;

  // ---- 锚点与缺省时长 ----
  const anchorRaw = opts.anchorDate ?? plan?.calendar?.anchorDate;
  const anchor: ISODate = isValidISODate(anchorRaw) ? (anchorRaw as ISODate) : todayISO();
  let defaultDuration: Duration = { value: 1, unit: 'd' };
  const defRaw = opts.defaultDuration ?? plan?.calendar?.defaultDuration;
  if (defRaw) {
    try {
      defaultDuration = parseDuration(defRaw);
    } catch {
      defaultDuration = { value: 1, unit: 'd' };
    }
  }

  if (tasks.length === 0) {
    return { computed: {}, diagnostics, order: [], projectStart: anchor, projectEnd: anchor };
  }

  const byId = buildTaskIndex(tasks);

  // ---- ① parent 关系 + 断环（ERR_PARENT_CYCLE） ----
  const parentOf = new Map<string, string | null>();
  for (const t of tasks) {
    const p = t.parentId;
    parentOf.set(t.id, p && p !== t.id && byId.has(p) ? p : null);
  }
  const visitState = new Map<string, 0 | 1 | 2>();
  const breakParentCycle = (id: string): void => {
    const st = visitState.get(id) ?? 0;
    if (st === 2) return;
    if (st === 1) {
      diagnostics.push(
        diag('error', ErrCode.ERR_PARENT_CYCLE, `父子层级出现环，已断开 ${id} 的父级引用`, id, 'name'),
      );
      parentOf.set(id, null);
      visitState.set(id, 2);
      return;
    }
    visitState.set(id, 1);
    const p = parentOf.get(id) ?? null;
    if (p) breakParentCycle(p);
    visitState.set(id, 2);
  };
  for (const t of tasks) breakParentCycle(t.id);

  // ---- depth ----
  const depth = new Map<string, number>();
  const depthOf = (id: string): number => {
    const cached = depth.get(id);
    if (cached !== undefined) return cached;
    const p = parentOf.get(id) ?? null;
    const d = p ? depthOf(p) + 1 : 0;
    depth.set(id, d);
    return d;
  };
  for (const t of tasks) depthOf(t.id);

  // ---- children / isParent ----
  const childrenOf = new Map<string, Task[]>();
  for (const t of tasks) {
    const p = parentOf.get(t.id) ?? null;
    if (!p) continue;
    const arr = childrenOf.get(p) ?? [];
    arr.push(t);
    childrenOf.set(p, arr);
  }
  const isParent = (id: string): boolean => (childrenOf.get(id)?.length ?? 0) > 0;

  const isAncestorOf = (ancestorId: string, nodeId: string): boolean => {
    let cur = parentOf.get(nodeId) ?? null;
    while (cur) {
      if (cur === ancestorId) return true;
      cur = parentOf.get(cur) ?? null;
    }
    return false;
  };

  // ---- ② 依赖合法性过滤（§2.2 硬校验） ----
  const effDeps = new Map<string, Dependency[]>();
  for (const t of tasks) {
    const list: Dependency[] = [];
    let parentDepWarned = false;
    for (const d of t.deps ?? []) {
      const pred = byId.get(d.predecessorId);
      if (!pred) {
        diagnostics.push(
          diag('error', ErrCode.ERR_DEP_TARGET_MISSING, `依赖的前置任务 ${d.predecessorId} 不存在，已忽略`, t.id, 'deps'),
        );
        continue;
      }
      if (pred.id === t.id) {
        diagnostics.push(diag('error', ErrCode.ERR_DEP_SELF, '不能依赖自己', t.id, 'deps'));
        continue;
      }
      if (isAncestorOf(pred.id, t.id) || isAncestorOf(t.id, pred.id)) {
        diagnostics.push(
          diag('error', ErrCode.ERR_DEP_ANCESTOR, `不能依赖自己的祖先或后代（${pred.id}），该依赖已忽略`, t.id, 'deps'),
        );
        continue;
      }
      if (isParent(t.id)) {
        if (!parentDepWarned) {
          parentDepWarned = true;
          diagnostics.push(
            diag(
              'warn',
              ErrCode.WARN_PARENT_DEP_IGNORED,
              '父任务时间由子任务汇总决定，其依赖不驱动自身时间（但可作为别人的前置）',
              t.id,
              'deps',
            ),
          );
        }
        continue;
      }
      list.push(d);
    }
    effDeps.set(t.id, list);
  }

  // ---- ③④ 统一图 + Kahn 拓扑 ----
  const graph = buildGraph(tasks, effDeps, parentOf);
  const { order, residual } = topoSort(tasks, graph);

  // ---- ⑤ 环 ----
  if (residual.length > 0) {
    const path = findCycle(graph, residual);
    const pathText = path.length > 0 ? path.join(' → ') : residual.join(', ');
    for (const id of residual) {
      diagnostics.push(
        diag('error', ErrCode.ERR_CYCLE, `检测到循环依赖：${pathText}（环内依赖已被忽略以继续排程）`, id, 'deps'),
      );
    }
    order.push(...residual);
  }

  // ---- ⑥ 单遍求值 ----
  const computed: Record<string, TaskComputed> = {};
  for (const id of order) {
    const t = byId.get(id);
    if (!t) continue;
    const kids = childrenOf.get(id) ?? [];
    if (kids.length > 0) {
      const kidComputed = kids.map((k) => computed[k.id]).filter((c): c is TaskComputed => Boolean(c));
      if (kidComputed.length > 0) {
        computed[id] = rollupParent(t, kidComputed, depth.get(id) ?? 0, diagnostics, cal);
        continue;
      }
      // 子任务全部未求值（极端环情形）→ 降级按叶子处理
    }
    computed[id] = resolveLeaf(
      t,
      {
        computed,
        deps: effDeps.get(id) ?? [],
        anchor,
        defaultDuration,
        calendar: cal,
        depth: depth.get(id) ?? 0,
      },
      diagnostics,
    );
  }

  // ---- hasError 标记（K10：诊断带 taskId 便于定位单元格） ----
  const errorIds = new Set(diagnostics.filter((d) => d.level === 'error' && d.taskId).map((d) => d.taskId as string));
  for (const id of Object.keys(computed)) {
    computed[id].hasError = errorIds.has(id);
  }

  // ---- ⑦ 项目总跨度 ----
  const allComputed = Object.values(computed);
  const projectStart = minDate(allComputed.map((c) => c.start)) ?? anchor;
  const projectEnd = maxDate(allComputed.map((c) => c.end)) ?? anchor;

  return { computed, diagnostics, order, projectStart, projectEnd };
}

/** 便捷：排程结果中是否存在 error 级诊断（K10 保存闸门） */
export function hasBlockingError(diagnostics: Diagnostic[]): boolean {
  return diagnostics.some((d) => d.level === 'error');
}

/** 便捷：按 taskId 聚合诊断，供表格单元格标注 */
export function groupDiagnosticsByTask(diagnostics: Diagnostic[]): Map<string, Diagnostic[]> {
  const map = new Map<string, Diagnostic[]>();
  for (const d of diagnostics) {
    if (!d.taskId) continue;
    const arr = map.get(d.taskId) ?? [];
    arr.push(d);
    map.set(d.taskId, arr);
  }
  return map;
}

export { DomainError };
