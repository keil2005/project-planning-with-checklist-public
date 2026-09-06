/**
 * src/filter.ts —— 左侧表格的列筛选（Excel 风格）与「Assign to me」。
 *
 * 设计要点：
 *   - 筛选是**纯视图态**：不入 plan 数据、不参与协同、不进版本；切计划 / 新建 / 导入时重置
 *     （用户裁定 2026-09-03「不记忆」）。同一会话内操作保持。
 *   - 表格与甘特共用同一份结果（store.useVisibleTasks），两侧行永远对齐（K16）。
 *   - 命中行的**祖先链**一并保留（用户裁定），保证 WBS 结构不断链、能看到任务归属哪个阶段。
 *   - 取值口径**严格对齐单元格显示值**：start / end / duration 都走「input ?? computed」，
 *     否则会出现「看到的和筛出来的不一致」这类最难排查的问题。
 *   - 多值列（负责人 / 顾问人）任一人命中即命中；空值单独由 blanks 开关控制。
 */

import type { ColumnKey } from './columns';
import type { Task, TaskComputed } from '../shared/types';
import { normalizePeople } from '../shared/people';
import { formatDuration } from '../shared/datetime';
import { formatDepsExpr } from '../shared/scheduler';
import { t } from './i18n';

/* ============================ 类型 ============================ */

/** 三类列筛选：值勾选 / 文本条件 / 日期条件 */
export type ColumnFilterKind = 'enum' | 'text' | 'date';

/** 枚举型（负责人 / 顾问人 / 时长 / 依赖）：勾选的值显示，未勾选隐藏 */
export interface EnumFilter {
  kind: 'enum';
  values: string[];
  /** 是否保留该列为空的行 */
  blanks: boolean;
}

/** 文本型（任务名称） */
export interface TextFilter {
  kind: 'text';
  op: TextOp;
  value: string;
}

/** 日期型（开始 / 结束） */
export interface DateFilter {
  kind: 'date';
  op: DateOp;
  /** 'YYYY-MM-DD'；before / onOrAfter 用 */
  from: string;
  /** 'YYYY-MM-DD'；仅 between 用 */
  to: string;
}

export type ColumnFilter = EnumFilter | TextFilter | DateFilter;

export type TextOp = 'contains' | 'notContains' | 'startsWith' | 'equals';
/** 早于 / 不早于 / 介于（含两端）—— 文案刻意避免「大于小于」的歧义 */
export type DateOp = 'before' | 'onOrAfter' | 'between';

/** 文本/日期操作符的下拉顺序（渲染顺序稳定；文案走 i18n：filter.op*） */
export const TEXT_OPS: readonly TextOp[] = ['contains', 'notContains', 'startsWith', 'equals'] as const;
export const DATE_OPS: readonly DateOp[] = ['before', 'onOrAfter', 'between'] as const;

/** 操作符文案（i18n；zh 值与 v1.2.0 前的硬编码完全一致） */
export function textOpLabel(op: TextOp): string {
  return t(`filter.op${op.charAt(0).toUpperCase()}${op.slice(1)}`);
}

export function dateOpLabel(op: DateOp): string {
  return t(`filter.op${op.charAt(0).toUpperCase()}${op.slice(1)}`);
}

/** 空值在值列表里的显示文案（对齐 Excel 的「(空白)」） */
export function blankLabel(): string {
  return t('filter.blankLabel');
}

/** 视图态筛选条件 */
export interface FilterState {
  byColumn: Partial<Record<ColumnKey, ColumnFilter>>;
  /** 「Assign to me」：负责人或顾问人含当前登录人 */
  onlyMine: boolean;
}

export const EMPTY_FILTER: FilterState = { byColumn: {}, onlyMine: false };

/** 匹配时的上下文：排程结果（取计算后的日期/时长）+ 行号映射（渲染依赖表达式）+ 当前身份 */
export interface FilterContext {
  computed: Record<string, TaskComputed>;
  idToSeq: Map<string, number>;
  me: string | null;
}

/* ============================ 列能力 ============================ */

/** 每列支持的筛选类型；null = 该列不支持筛选（行号、操作列） */
const FILTER_KIND: Record<ColumnKey, ColumnFilterKind | null> = {
  seq: null,
  name: 'text',
  start: 'date',
  end: 'date',
  duration: 'enum',
  deps: 'enum',
  owner: 'enum',
  consultant: 'enum',
  todo: null,
  actions: null,
};

export function filterKindOf(key: ColumnKey): ColumnFilterKind | null {
  return FILTER_KIND[key] ?? null;
}

export function isFilterable(key: ColumnKey): boolean {
  return filterKindOf(key) !== null;
}

/** 新建某列筛选时的初始条件（点开漏斗还没勾任何东西时的形态） */
export function defaultFilterFor(key: ColumnKey): ColumnFilter | null {
  switch (filterKindOf(key)) {
    case 'enum':
      return { kind: 'enum', values: [], blanks: true };
    case 'text':
      return { kind: 'text', op: 'contains', value: '' };
    case 'date':
      return { kind: 'date', op: 'onOrAfter', from: '', to: '' };
    default:
      return null;
  }
}

/* ============================ 取值（与单元格显示口径一致） ============================ */

/**
 * 某行在某列上参与筛选比较的值集合。
 * 单值列返回长度 0 或 1 的数组（空串代表「该行为空」）；人员列按人拆开，任一人命中即命中。
 */
export function columnValuesOf(task: Task, key: ColumnKey, ctx: FilterContext): string[] {
  const c: TaskComputed | undefined = ctx.computed[task.id];
  switch (key) {
    case 'name':
      return [task.name ?? ''];
    case 'start':
      return [task.input.start ?? c?.start ?? ''];
    case 'end':
      return [task.input.end ?? c?.end ?? ''];
    case 'duration':
      return [task.input.duration ?? (c ? formatDuration(c.duration) : '')];
    case 'deps':
      return [formatDepsExpr(task.deps, ctx.idToSeq)];
    case 'owner':
      return normalizePeople(task.owner);
    case 'consultant':
      return normalizePeople(task.consultant);
    default:
      return [];
  }
}

/** 某列的全部候选值（去重 + 排序），用于枚举型下拉的勾选列表 */
export function collectColumnValues(tasks: Task[], key: ColumnKey, ctx: FilterContext): string[] {
  const set = new Set<string>();
  for (const t of tasks) {
    for (const v of columnValuesOf(t, key, ctx)) {
      if (v !== '') set.add(v);
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN', { numeric: true }));
}

/* ============================ 匹配 ============================ */

const eqName = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

function matchEnum(values: string[], f: EnumFilter): boolean {
  if (values.length === 0) return f.blanks;
  const picked = new Set(f.values);
  return values.some((v) => picked.has(v));
}

function matchText(values: string[], f: TextFilter): boolean {
  const q = f.value.trim().toLowerCase();
  // 没填关键词 = 该列不约束（否则用户一点开漏斗、还没输入就整表消失）
  if (q === '') return true;
  const v = (values[0] ?? '').toLowerCase();
  switch (f.op) {
    case 'contains':
      return v.includes(q);
    case 'notContains':
      return !v.includes(q);
    case 'startsWith':
      return v.startsWith(q);
    case 'equals':
      return v === q;
    default:
      return true;
  }
}

function matchDate(values: string[], f: DateFilter): boolean {
  const v = values[0] ?? '';
  // 空日期不参与日期比较（Excel 也是把空值排除掉）
  if (v === '') return false;
  if (f.op === 'before') return f.from !== '' && v < f.from;
  if (f.op === 'onOrAfter') return f.from !== '' && v >= f.from;
  return f.from !== '' && f.to !== '' && v >= f.from && v <= f.to;
}

/**
 * 该行是否算「我的」：负责人或顾问人含当前身份（大小写、首尾空格不敏感）。
 * 单一真源在 shared/people.ts（服务端 MD 导出 `scope=mine` 共用），本文件 re-export
 * 以保持既有 `import { isMine } from './filter'` 调用点零改动。
 */
import { isMine } from '../shared/people';
export { isMine };

/** 所有条件之间是与（AND）：每列都要满足，且 onlyMine 也要满足 */
export function taskMatches(task: Task, f: FilterState, ctx: FilterContext): boolean {
  if (f.onlyMine && !isMine(task, ctx.me)) return false;
  for (const key of Object.keys(f.byColumn) as ColumnKey[]) {
    const cf: ColumnFilter | undefined = f.byColumn[key];
    if (!cf) continue;
    const values = columnValuesOf(task, key, ctx);
    let ok = true;
    if (cf.kind === 'enum') ok = matchEnum(values, cf);
    else if (cf.kind === 'text') ok = matchText(values, cf);
    else if (cf.kind === 'date') ok = matchDate(values, cf);
    if (!ok) return false;
  }
  return true;
}

/* ============================ 保留集合（含祖先链） ============================ */

/** 防止脏数据里的 parentId 自环把 while 卡死 */
const MAX_DEPTH_GUARD = 10000;

/**
 * 算出要保留的行 id 集合；无筛选时返回 null（调用方据此跳过过滤）。
 * 集合 = 命中行 ∪ 命中行的所有祖先（用户裁定：保留 WBS 上下文）。
 */
export function computeKeepIds(
  tasks: Task[],
  f: FilterState,
  ctx: FilterContext,
): Set<string> | null {
  if (!isFilterActive(f)) return null;

  const matched = new Set<string>();
  for (const t of tasks) {
    if (taskMatches(t, f, ctx)) matched.add(t.id);
  }

  const parentOf = new Map<string, string | null>();
  for (const t of tasks) parentOf.set(t.id, t.parentId ?? null);

  const keep = new Set<string>(matched);
  for (const id of matched) {
    let p: string | null | undefined = parentOf.get(id);
    let guard = 0;
    while (p && guard < MAX_DEPTH_GUARD) {
      guard += 1;
      if (keep.has(p)) break;
      keep.add(p);
      p = parentOf.get(p);
    }
  }
  return keep;
}

/* ============================ 状态判定与摘要 ============================ */

export function isFilterActive(f: FilterState): boolean {
  return f.onlyMine || Object.keys(f.byColumn).length > 0;
}

/** 有筛选的列名（按 COLUMNS 顺序返回，保证 chips 顺序稳定） */
export function activeColumnKeys(f: FilterState, order: readonly ColumnKey[]): ColumnKey[] {
  return order.filter((k) => f.byColumn[k] !== undefined);
}

/** 单列筛选的自然语言摘要（FilterBar 的 chip 文案；zh 值与既有测试断言逐字一致） */
export function describeColumnFilter(key: ColumnKey, f: ColumnFilter, label: string): string {
  if (f.kind === 'text') {
    return f.value.trim() === ''
      ? t('filter.descTextEmpty', { label, op: textOpLabel(f.op) })
      : t('filter.descText', { label, op: textOpLabel(f.op), v: f.value });
  }
  if (f.kind === 'date') {
    if (f.op === 'between') return t('filter.descDateBetween', { label, from: f.from || '?', to: f.to || '?' });
    return t('filter.descDateOp', { label, op: dateOpLabel(f.op), from: f.from || '?' });
  }
  const n = f.values.length;
  if (n === 0) return f.blanks ? t('filter.descEnumBlanksOnly', { label }) : t('filter.descEnumNone', { label });
  const shown = f.values.slice(0, 2).join(t('filter.enumSep'));
  const more = n > 2 ? t('filter.descEnumMore', { n }) : '';
  const blank = f.blanks ? t('filter.descEnumBlank') : '';
  return t('filter.descEnum', { label, shown, more, blank });
}
