/**
 * server/exporters.ts —— 导出层（§2.8）。
 *
 *  - toMsProjectXml：MSPDI（MS Project XML），导出「周一~周五 8h」真实工作日历，
 *    并据注入的 WorkCalendar 生成节假日（非工作）/ 补班（工作）例外，使导出口径与
 *    本工具工作日排程一致，MS Project / ProjectLibre 打开后不再日期漂移（K18）。
 *    ★ MSPDI 的 Finish = end − 1 day @16:00 是全项目唯一一处 ENDPOINT→inclusive 转换（K18）。
 *    ★ Duration 改用 countWorkingDays(start, end, cal) × 8h；LinkLag 改用 lagToDays(..., cal) × 480 × 10。
 *  - toCsv：带 UTF-8 BOM，Excel 可直接打开（CSV 仅展示已算结果，不涉及日历换算，故无 cal 形参）。
 *
 * 导出取值一律来自服务端 schedule() 的 computed（K18），不信客户端传值。
 * 日历以可选形参 cal 注入，缺省 NATURAL_CALENDAR（全工作日兜底），保证既有调用点（routes.ts）零改动编译通过。
 */

import { create } from 'xmlbuilder2';
import {
  addDays,
  countWorkingDays,
  diffDays,
  formatDuration,
  formatISODate,
  lagToDays,
  maxDate,
  minDate,
  parseISODate,
} from '../shared/datetime';
import { buildIdSeqMaps, formatDepsExpr } from '../shared/scheduler';
import { isMine, formatPeople, normalizePeople } from '../shared/people';
import { todosProgress, todosProgressText } from '../shared/todo';
import type {
  DepType,
  ExportFormat,
  ISODate,
  Plan,
  ScheduleResult,
  Task,
  TaskComputed,
  WorkCalendar,
} from '../shared/types';
import { NATURAL_CALENDAR } from '../shared/types';

/** 本工具依赖类型 → MSPDI PredecessorLink.Type（官方枚举） */
const DEP_TYPE_TO_LINK_TYPE: Record<DepType, number> = {
  FF: 0,
  FS: 1,
  SF: 2,
  SS: 3,
};

/** 每工作日分钟数（8h） */
const MINUTES_PER_DAY = 480;
/** LinkLag 单位为 1/10 分钟 */
const TENTH_MINUTES_PER_DAY = MINUTES_PER_DAY * 10;
/** 每日工作时段（8:00 ~ 16:00，含午休则拆段；此处单段 8h） */
const WORK_FROM = '08:00:00';
const WORK_TO = '16:00:00';
/** 例外收集时，向导出日期区间两端各外扩的天数（确保跨边界的假期/补班不被截断） */
const EXCEPTION_RANGE_PAD_DAYS = 3;
/** 周末 DayType（1=周日，7=周六） */
const WEEKEND_DAY_TYPES = new Set<number>([1, 7]);

export function depTypeToLinkType(type: DepType): number {
  return DEP_TYPE_TO_LINK_TYPE[type] ?? 1;
}

/**
 * lag → 1/10 分钟；anchor 必须是该依赖引用的前置端点日期（保证 'm' 取真实自然月）。
 * cal 决定工作日感知：返回 diffDays(anchor, addDuration(anchor, lag, sign, cal)) × 480 × 10，
 * 故值随锚点在周内的位置变化（如周三锚点 +1w 跨 7 自然日 → 33600；周一锚点跨 5 自然日 → 24000），这是正确表现。
 */
export function lagToTenthMinutes(
  lag: { value: number; unit: 'd' | 'w' | 'm' } | null,
  sign: 1 | -1,
  anchor: ISODate,
  cal: WorkCalendar = NATURAL_CALENDAR,
): number {
  const days = lagToDays(lag, sign, anchor, cal);
  return days * TENTH_MINUTES_PER_DAY;
}

function startDateTime(d: ISODate): string {
  return `${d}T${WORK_FROM}`;
}

function finishDateTime(d: ISODate): string {
  return `${d}T${WORK_TO}`;
}

/** K18 唯一转换点：end 已经是 inclusive 最后工作日（v1.2.1对齐），Finish = end@16:00 */
function inclusiveFinishDate(start: ISODate, end: ISODate): ISODate {
  return end;
}

/**
 * 任务的 TODO 交付清单摘要（按 order 排序；无项返回空串）。
 * 与顾问人一样是「信息附注」，不进 Resource/Assignment。
 */
function buildTodoSummary(t: Task): string {
  const todos = (t.todos ?? []).slice().sort((a, b) => a.order - b.order);
  if (todos.length === 0) return '';
  const { done, total } = todosProgress(todos);
  const lines = todos.map((td) => {
    const mark = td.done ? '[x]' : '[ ]';
    const who = td.assignee ? `（${td.assignee}）` : '';
    return `${mark} ${td.text}${who}`;
  });
  return `TODO（${done}/${total}）：\n${lines.join('\n')}`;
}

/**
 * MSPDI 的 Notes 文本 = 用户备注（原样）+ 顾问人（若有）+ TODO 交付清单（若有）。
 *
 * 顾问人与 todo 均不生成 Resource/Assignment（用户裁定 2026-09-03）：它们只是"该问谁 /
 * 该交付什么"的信息，算成资源会让 MS Project 的投入/工时口径失真，因此降级为文本附注。
 */
function buildNotes(t: Task): string {
  const parts: string[] = [];
  const note = typeof t.note === 'string' ? t.note.trim() : '';
  if (note !== '') parts.push(note);
  const consultants = normalizePeople(t.consultant);
  if (consultants.length > 0) parts.push(`顾问人：${formatPeople(consultants)}`);
  const todoSummary = buildTodoSummary(t);
  if (todoSummary !== '') parts.push(todoSummary);
  return parts.join('\n');
}

/** MD 导出的范围（仅与我相关 / 全部）。mspdi/csv 忽略此参数。 */
export type TodoExportScope = 'all' | 'mine';

const FILE_EXT: Record<ExportFormat, string> = {
  mspdi: 'xml',
  csv: 'csv',
  md: 'md',
};

/**
 * 文件名：MSPDI/CSV → `{planName}-v{version}.{ext}`；
 * MD（带 scope）→ `{planName}-todos-{scope}-v{version}.md`，
 * 显式 `all` / `mine` 段以便用户下载两次后不混淆。
 */
export function exportFileName(plan: Plan, format: ExportFormat, scope?: TodoExportScope): string {
  const safeName = (plan.name || '未命名计划').replace(/[\\/:*?"<>|]/g, '_');
  const ext = FILE_EXT[format] ?? 'txt';
  if (format === 'md') {
    const s = scope === 'mine' ? 'mine' : 'all';
    return `${safeName}-todos-${s}-v${plan.version}.${ext}`;
  }
  return `${safeName}-v${plan.version}.${ext}`;
}

/* ============================================================
   MSPDI
   ============================================================ */

/**
 * 生成 MSPDI XML。
 * @param plan   计划（含任务与元数据）
 * @param sched  schedule() 的计算结果（computed 为唯一真源）
 * @param cal    工作日历；缺省 NATURAL_CALENDAR（全工作日兜底）。路由层尚未注入真实日历（遗留项）。
 */
export function toMsProjectXml(
  plan: Plan,
  sched: ScheduleResult,
  cal: WorkCalendar = NATURAL_CALENDAR,
): string {
  const computed = sched.computed;
  const tasks: Task[] = plan.tasks;

  // UID 从 1 递增，按显示顺序
  const uidOf = new Map<string, number>();
  tasks.forEach((t, i) => uidOf.set(t.id, i + 1));

  const doc = create({ version: '1.0', encoding: 'UTF-8' }).ele('Project', {
    xmlns: 'http://schemas.microsoft.com/project',
  });

  // ---------------- Project 级 ----------------
  doc.ele('Name').txt(plan.name).up();
  doc.ele('Title').txt(plan.name).up();
  doc.ele('CreationDate').txt(startDateTime(sched.projectStart)).up();
  doc.ele('StartDate').txt(startDateTime(sched.projectStart)).up();
  doc.ele('FinishDate').txt(finishDateTime(sched.projectEnd)).up();
  doc.ele('CalendarUID').txt('1').up();
  doc.ele('ScheduleFromStart').txt('1').up();
  doc.ele('DurationFormat').txt('7').up();
  doc.ele('DefaultTaskType').txt('1').up();
  doc.ele('NewTasksAreManual').txt('0').up();
  doc.ele('SpreadPercentComplete').txt('0').up();
  doc.ele('MinutesPerDay').txt(String(MINUTES_PER_DAY)).up();
  doc.ele('MinutesPerWeek').txt(String(MINUTES_PER_DAY * 5)).up();
  doc.ele('DaysPerMonth').txt('30').up();

  // ---------------- Calendars 级：周一~周五 8h + 节假日/补班例外 ----------------
  const calendars = doc.ele('Calendars');
  const calendar = calendars.ele('Calendar');
  calendar.ele('UID').txt('1').up();
  calendar.ele('Name').txt('WorkCalendar(5d×8h)').up();
  calendar.ele('IsBaseCalendar').txt('1').up();
  calendar.ele('BaseCalendarUID').txt('-1').up();

  // 每周工作日规则：周一~周五工作 8h，周六日非工作
  const weekDays = calendar.ele('WeekDays');
  for (let dayType = 1; dayType <= 7; dayType += 1) {
    const wd = weekDays.ele('WeekDay');
    wd.ele('DayType').txt(String(dayType)).up();
    if (WEEKEND_DAY_TYPES.has(dayType)) {
      wd.ele('DayWorking').txt('0').up();
    } else {
      wd.ele('DayWorking').txt('1').up();
      const wts = wd.ele('WorkingTimes');
      const wt = wts.ele('WorkingTime');
      wt.ele('FromTime').txt(WORK_FROM).up();
      wt.ele('ToTime').txt(WORK_TO).up();
      wt.up();
      wts.up();
    }
    wd.up();
  }
  weekDays.up();

  // 例外：遍历本次导出的日期范围（任务最小 start ~ 最大 end，各外扩若干天），
  // 逐日调用 cal.isHoliday / cal.isMakeup 收集，再生成 <Exception>。
  const exceptionsEle = calendar.ele('Exceptions');
  const rangeStart = minDate(tasks.map((t) => computed[t.id]?.start ?? null));
  const rangeEnd = maxDate(tasks.map((t) => computed[t.id]?.end ?? null));
  if (rangeStart && rangeEnd) {
    let cur = parseISODate(addDays(rangeStart, -EXCEPTION_RANGE_PAD_DAYS));
    const last = parseISODate(addDays(rangeEnd, EXCEPTION_RANGE_PAD_DAYS));
    while (!cur.isAfter(last)) {
      const d = formatISODate(cur);
      if (cal.isMakeup(d)) {
        // 补班日：工作例外，必须带 WorkingTimes
        const ex = exceptionsEle.ele('Exception');
        ex.ele('TimePeriodFrom').txt(`${d}T00:00:00`).up();
        ex.ele('TimePeriodTo').txt(`${d}T23:59:00`).up();
        ex.ele('DayWorking').txt('1').up();
        const wts = ex.ele('WorkingTimes');
        const wt = wts.ele('WorkingTime');
        wt.ele('FromTime').txt(WORK_FROM).up();
        wt.ele('ToTime').txt(WORK_TO).up();
        wt.up();
        wts.up();
        ex.up();
      } else if (cal.isHoliday(d)) {
        // 法定放假日：非工作例外（可逐日，亦可将连续假期合并为单条，此处逐日以保持简单确定）
        const ex = exceptionsEle.ele('Exception');
        ex.ele('TimePeriodFrom').txt(`${d}T00:00:00`).up();
        ex.ele('TimePeriodTo').txt(`${d}T23:59:00`).up();
        ex.ele('DayWorking').txt('0').up();
        ex.up();
      }
      cur = cur.add(1, 'day');
    }
  }
  exceptionsEle.up();

  calendar.up();
  calendars.up();

  // ---------------- Tasks 级 ----------------
  const tasksEle = doc.ele('Tasks');
  tasks.forEach((t) => {
    const c: TaskComputed | undefined = computed[t.id];
    if (!c) return;
    const uid = uidOf.get(t.id) as number;
    const days = Math.max(0, countWorkingDays(c.start, c.end, cal));
    const finishDate = inclusiveFinishDate(c.start, c.end);

    const te = tasksEle.ele('Task');
    te.ele('UID').txt(String(uid)).up();
    te.ele('ID').txt(String(t.seq)).up();
    te.ele('Name').txt(t.name && t.name.trim() !== '' ? t.name : '未命名任务').up();
    te.ele('Active').txt('1').up();
    te.ele('Manual').txt('0').up();
    te.ele('Type').txt('1').up();
    te.ele('IsNull').txt('0').up();
    te.ele('Start').txt(startDateTime(c.start)).up();
    te.ele('Finish').txt(finishDateTime(finishDate)).up();
    te.ele('Duration').txt(`PT${days * (MINUTES_PER_DAY / 60)}H0M0S`).up();
    te.ele('DurationFormat').txt('7').up();
    te.ele('OutlineLevel').txt(String(c.depth + 1)).up();
    te.ele('Summary').txt(c.isParent ? '1' : '0').up();
    te.ele('Milestone').txt(days === 0 ? '1' : '0').up();
    te.ele('CalendarUID').txt('1').up();
    if (typeof t.progress === 'number') {
      te.ele('PercentComplete').txt(String(Math.max(0, Math.min(100, Math.round(t.progress))))).up();
    }
    // 顾问人按用户裁定（2026-09-03）不入 Resource/Assignment，只作为备注附加在任务 Notes 末尾，
    // 这样 MS Project 的资源工时口径不受影响，但信息不丢。
    const notes = buildNotes(t);
    if (notes !== '') {
      te.ele('Notes').txt(notes).up();
    }

    // ConstraintType / ConstraintDate
    let constraintType = 0;
    let constraintDate: string | null = null;
    if (!c.isParent) {
      if (t.input.start) {
        constraintType = 4; // SNET
        constraintDate = startDateTime(c.start);
      } else if (t.input.end) {
        constraintType = 6; // FNET
        constraintDate = finishDateTime(finishDate);
      }
    }
    te.ele('ConstraintType').txt(String(constraintType)).up();
    if (constraintDate) te.ele('ConstraintDate').txt(constraintDate).up();

    // PredecessorLink（父任务不输出依赖）
    if (!c.isParent) {
      for (const dep of t.deps) {
        const predUid = uidOf.get(dep.predecessorId);
        const predComputed = computed[dep.predecessorId];
        if (predUid === undefined || !predComputed) continue;
        const anchor = dep.type === 'FS' || dep.type === 'FF' ? predComputed.end : predComputed.start;
        const link = te.ele('PredecessorLink');
        link.ele('PredecessorUID').txt(String(predUid)).up();
        link.ele('Type').txt(String(depTypeToLinkType(dep.type))).up();
        link.ele('CrossProject').txt('0').up();
        link.ele('LinkLag').txt(String(lagToTenthMinutes(dep.lag, dep.lagSign, anchor, cal))).up();
        link.ele('LagFormat').txt('7').up();
        link.up();
      }
    }
    te.up();
  });
  tasksEle.up();

  // ---------------- Resources / Assignments（负责人，Q3 选型） ----------------
  // 收集本计划实际使用到的负责人（非空、去重、保序）；ResourceUID 从 1000 起，避开 Task UID（1..N）。
  // 负责人已可多人（U02），故按「任务 → 多人」展开成一资源多分配；顾问人不在此列（见 buildNotes）。
  const usedOwners: string[] = [];
  const seenOwner = new Set<string>();
  for (const t of tasks) {
    for (const o of normalizePeople(t.owner)) {
      if (!seenOwner.has(o)) {
        seenOwner.add(o);
        usedOwners.push(o);
      }
    }
  }
  const resUidOf = new Map<string, number>();
  usedOwners.forEach((o, i) => resUidOf.set(o, 1000 + i));

  const resourcesEle = doc.ele('Resources');
  usedOwners.forEach((o) => {
    const re = resourcesEle.ele('Resource');
    re.ele('UID').txt(String(resUidOf.get(o))).up();
    re.ele('ID').txt(String(resUidOf.get(o))).up();
    re.ele('Name').txt(o).up(); // 资源名称 = 负责人文本
    re.ele('Type').txt('1').up(); // 1 = Work
    re.ele('IsNull').txt('0').up();
    re.ele('Active').txt('1').up();
    re.up();
  });
  resourcesEle.up();

  const assignmentsEle = doc.ele('Assignments');
  let assignUid = 1;
  for (const t of tasks) {
    const taskUid = uidOf.get(t.id);
    if (taskUid === undefined) continue;
    // 一个任务可有多个负责人 → 每人一条 Assignment
    for (const o of normalizePeople(t.owner)) {
      const resUid = resUidOf.get(o);
      if (resUid === undefined) continue;
      const ae = assignmentsEle.ele('Assignment');
      ae.ele('UID').txt(String(assignUid++)).up();
      ae.ele('TaskUID').txt(String(taskUid)).up();
      ae.ele('ResourceUID').txt(String(resUid)).up();
      ae.ele('Units').txt('100').up();
      ae.ele('PercentWorkComplete').txt('0').up();
      ae.up();
    }
  }
  assignmentsEle.up();

  return doc.end({ prettyPrint: true });
}

/* ============================================================
   CSV
   ============================================================ */

const CSV_HEADER = [
  '行号',
  '任务ID',
  '层级',
  '任务名称(缩进)',
  '父任务ID',
  '开始',
  '结束',
  '时长',
  '依赖',
  '负责人',
  '顾问人',
  'TODO 进度',
  '来源',
  '备注',
];

function csvCell(value: string | number | null | undefined): string {
  const s = value === null || value === undefined ? '' : String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function toCsv(plan: Plan, sched: ScheduleResult): string {
  const { idToSeq } = buildIdSeqMaps(plan.tasks);
  const lines: string[] = [CSV_HEADER.map(csvCell).join(',')];

  for (const t of plan.tasks) {
    const c = sched.computed[t.id];
    if (!c) continue;
    const indentedName = `${'  '.repeat(c.depth)}${t.name}`;
    lines.push(
      [
        csvCell(t.seq),
        csvCell(t.id),
        csvCell(c.depth + 1),
        csvCell(indentedName),
        csvCell(t.parentId ?? ''),
        csvCell(c.start),
        csvCell(c.end),
        csvCell(formatDuration(c.duration)),
        csvCell(formatDepsExpr(t.deps, idToSeq)),
        // 人员列可多人 → 顿号拼接（与表格单元格展示一致）
        csvCell(formatPeople(normalizePeople(t.owner))),
        csvCell(formatPeople(normalizePeople(t.consultant))),
        // TODO 进度（无项留空，与徽章「—」不同——CSV 用空值更利于 Excel 统计）
        csvCell(todosProgressText(t.todos)),
        csvCell(c.derivedFrom),
        csvCell(t.note ?? ''),
      ].join(','),
    );
  }

  // UTF-8 BOM，便于 Excel 直接打开
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

/* ============================================================
   Markdown TODO 清单（U05 增量，2026-09-04）
   ============================================================ */

/**
 * MD 导出选项。
 *
 * - scope='all'   → 全部任务按显示顺序输出
 * - scope='mine'  → 只输出 isMine(task, me) 命中的任务；命中任务下的全部 todo 仍展示
 *                   （保留"我负责的任务完整交付物"语义，与 UI「Assign to me」严格一致）
 * - me            → scope=mine 时必填（大小写/首尾空格不敏感，复用 isMine）
 * - exportedAt    → 缺省取服务端 now；测试可注入固定值
 */
export interface TodoExportOptions {
  scope: TodoExportScope;
  me?: string;
  exportedAt?: string;
}

/** 把 ISO 时间戳压成 'YYYY-MM-DD HH:MM:SS' 便于 Markdown 直读（缺省取 now） */
function formatExportedAt(iso: string): string {
  // 兼容 Z 后缀；保证稳定可预测，避免调用方 toLocaleString 在不同 Node 时区表现漂移
  const d = new Date(iso);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 负责人/顾问人展示串：空数组 → '—'（与表格占位一致），非空 → '、' 拼接 */
function peopleOrDash(v: unknown): string {
  const list = normalizePeople(v);
  return list.length === 0 ? '—' : formatPeople(list);
}

/** derivedFrom → 中文标签（与 UI 列一致） */
function deriveFromLabel(d: TaskComputed['derivedFrom'] | undefined): string {
  switch (d) {
    case 'INPUT':
      return '手动';
    case 'DEP':
      return '依赖';
    case 'ROLLUP':
      return '汇总';
    case 'ANCHOR':
      return '锚点';
    case 'MIXED':
      return '混合';
    default:
      return '—';
  }
}

/**
 * 生成 Markdown TODO 清单（U05 增量，2026-09-04）。
 *
 * 章节结构：
 *   # {planName} v{version} — TODO 清单
 *   顶部摘要表（导出时间、范围、统计）
 *   ---
 *   ## {任务名}        ×N
 *   > 元信息（编号、日期、负责人、来源）
 *   TODO（x/y）：
 *   - [x] / [ ] 文本 — assignee
 *
 * 设计取舍：
 *   - 走 server-side 而非纯客户端：与 mspdi/csv 共用 schedulePlan() 的 computed 字段
 *     （start/end/derivedFrom），保证「UI 看到的日期」与「导出看到的日期」完全一致。
 *   - 任务顺序取 `sched.order`（与表格/甘特显示顺序一致），不是 plan.tasks 原始数组。
 *   - 没有 computed 的脏任务（sanitizeTasks 漏过）静默跳过，与 MSPDI/CSV 行为一致。
 *   - 顶部「我负责的 TODO」单独计数（todo.assignee == me），与「命中任务数」分开：
 *     一个命中任务可能含多条别人 assignee 的 todo。
 */
export function toTodosMarkdown(plan: Plan, sched: ScheduleResult, opts: TodoExportOptions): string {
  const exportedAt = opts.exportedAt ?? new Date().toISOString();
  const me = (opts.me ?? '').trim();

  // 显示顺序（与表格对齐）
  const order: string[] = Array.isArray(sched.order) && sched.order.length > 0
    ? sched.order
    : plan.tasks.map((t) => t.id);

  // scope=mine 过滤（命中后保留任务内全部 todo，与 Assign to me 语义一致）
  const tasksInOrder: Task[] = [];
  for (const id of order) {
    const t = plan.tasks.find((x) => x.id === id);
    if (!t) continue;
    if (opts.scope === 'mine' && !isMine(t, me)) continue;
    tasksInOrder.push(t);
  }

  // 统计：按"我负责的 todo"独立计数（todo.assignee == me，大小写/首尾空格不敏感）
  const meKey = me.toLowerCase();
  let totalTodos = 0;
  let doneTodos = 0;
  let mineTodos = 0;
  for (const t of tasksInOrder) {
    for (const td of t.todos ?? []) {
      totalTodos += 1;
      if (td.done) doneTodos += 1;
      if (meKey !== '' && td.assignee && td.assignee.trim().toLowerCase() === meKey) mineTodos += 1;
    }
  }

  const lines: string[] = [];

  // ─── 标题与摘要 ───
  lines.push(`# ${plan.name || '未命名计划'} v${plan.version} — TODO 清单`);
  lines.push('');
  lines.push(`| 字段 | 值 |`);
  lines.push(`| --- | --- |`);
  lines.push(`| 导出时间 | ${formatExportedAt(exportedAt)} |`);
  if (opts.scope === 'mine') {
    lines.push(`| 范围 | 仅与我相关（${me || '未指定'}） |`);
  } else {
    lines.push(`| 范围 | 全部 |`);
  }
  lines.push(`| 计划任务数 | ${plan.tasks.length} |`);
  lines.push(`| 命中任务数 | ${tasksInOrder.length} |`);
  lines.push(`| TODO 总数 | ${totalTodos}（已完成 ${doneTodos} / 未完成 ${totalTodos - doneTodos}） |`);
  if (opts.scope === 'mine') {
    lines.push(`| 我负责的 TODO | ${mineTodos} |`);
  }
  lines.push('');

  // ─── 空态 ───
  if (tasksInOrder.length === 0) {
    if (opts.scope === 'mine') {
      lines.push(`> 当前用户「${me || '未指定'}」在本计划中没有负责或顾问任务，TODO 清单为空。`);
    } else {
      lines.push(`> 本计划没有任务。`);
    }
    lines.push('');
    return lines.join('\n');
  }

  lines.push('---');
  lines.push('');

  // ─── 任务分组 ───
  for (const t of tasksInOrder) {
    const c: TaskComputed | undefined = sched.computed[t.id];
    const todos = (t.todos ?? []).slice().sort((a, b) => a.order - b.order);
    const { done, total } = todosProgress(todos);

    // 任务标题（##）—— 用 T-xxxx 与表格 ID 对齐
    const taskId = t.id ? `\`${t.id}\`` : '';
    const name = (t.name && t.name.trim() !== '') ? t.name : '未命名任务';
    lines.push(`## ${name}${taskId !== '' ? ` ${taskId}` : ''}`);
    lines.push('');

    // 元信息（> ...）
    const meta: string[] = [];
    if (c) {
      const dates = `${c.start} ~ ${c.end}`;
      const dur = formatDuration(c.duration);
      const progress = typeof t.progress === 'number' ? ` · 进度 ${Math.round(t.progress)}%` : '';
      meta.push(`${dates} · ${dur ? `${dur} 工作日` : '即时点'}${progress}`);
    }
    const owners = peopleOrDash(t.owner);
    const consultants = peopleOrDash(t.consultant);
    meta.push(`负责人：${owners} · 顾问人：${consultants}`);
    if (c) {
      meta.push(`来源：${deriveFromLabel(c.derivedFrom)}`);
    }
    if (typeof t.note === 'string' && t.note.trim() !== '') {
      meta.push(`备注：${t.note.trim()}`);
    }
    lines.push(`> ${meta.join('  \n> ')}`);
    lines.push('');

    // TODO 清单
    if (total === 0) {
      lines.push('TODO（0/0）：');
      lines.push('');
      lines.push('- （无 TODO）');
      lines.push('');
    } else {
      lines.push(`TODO（${done}/${total}）：`);
      lines.push('');
      for (const td of todos) {
        const mark = td.done ? '[x]' : '[ ]';
        const who = td.assignee ? ` — ${td.assignee}` : '';
        lines.push(`- ${mark} ${td.text}${who}`);
      }
      lines.push('');
    }

    lines.push('---');
    lines.push('');
  }

  // 去掉末尾多余的 '---'（保持视觉干净）
  while (lines.length > 0 && lines[lines.length - 1] === '---') {
    lines.pop();
  }

  return lines.join('\n');
}
