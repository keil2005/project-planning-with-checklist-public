/**
 * src/columns.ts —— 左侧任务表格的列定义与列宽持久化。
 *
 * 设计要点：
 *   - 列宽是「纯 UI 偏好」，不入 plan 数据、不参与协同（不进版本、不上锁）；
 *   - 唯一可伸缩列是「任务名称」（FLEX_COLUMN_INDEX），用 minmax(min, 1fr) 吸收容器剩余宽度，
 *     其余列固定 px；当各列之和超过容器宽度时，行上的 min-width 触发横向滚动条；
 *   - 持久化到 localStorage，读写全部包在 try/catch 内：隐私模式 / 禁用存储时静默降级为默认值；
 *   - 顺序与 GRID 模板顺序一致，增删列只需改 COLUMNS 一处。
 */

import type { CSSProperties } from 'react';
import type { Task } from '../shared/types';

/* ============================ 类型 ============================ */

export type ColumnKey = 'seq' | 'name' | 'start' | 'end' | 'duration' | 'deps' | 'owner' | 'actions';

export interface ColumnDef {
  key: ColumnKey;
  /** 表头文案 */
  label: string;
  /** 默认宽度（px） */
  def: number;
  /** 最小宽度（px），拖拽下限 */
  min: number;
  /** 最大宽度（px），拖拽上限 */
  max: number;
}

/* ============================ 列定义 ============================ */

/** 顺序即 grid-template-columns 顺序，与表头、数据行共用同一份定义 */
export const COLUMNS: ColumnDef[] = [
  { key: 'seq', label: '行号', def: 52, min: 40, max: 120 },
  { key: 'name', label: '任务名称', def: 260, min: 120, max: 960 },
  { key: 'start', label: '开始', def: 96, min: 84, max: 240 },
  { key: 'end', label: '结束', def: 96, min: 84, max: 240 },
  { key: 'duration', label: '时长', def: 78, min: 60, max: 200 },
  { key: 'deps', label: '依赖', def: 110, min: 80, max: 360 },
  { key: 'owner', label: '负责人', def: 120, min: 90, max: 360 },
  { key: 'actions', label: '操作', def: 136, min: 110, max: 260 },
];

/** 唯一可伸缩列（任务名称）的下标 */
export const FLEX_COLUMN_INDEX = 1;

/** 单列上下限之外的余量：单元格左右 padding(12) + 输入框内 padding(8) + 视觉余量(6) */
export const AUTOFIT_PADDING = 26;

/** 自适应时最多测量的行数，避免超大计划下逐行测量引发长任务 */
const AUTOFIT_MAX_ROWS = 400;

const STORAGE_KEY = 'plan-gantt:column-widths:v1';

/* ============================ 宽度读写 ============================ */

export function defaultWidths(): number[] {
  return COLUMNS.map((c) => c.def);
}

/** 把任意宽度收敛到该列的 [min, max] 区间内（四舍五入取整 px） */
export function clampWidth(index: number, w: number): number {
  const c = COLUMNS[index];
  if (!c) return Math.round(w);
  if (!Number.isFinite(w)) return c.def;
  return Math.round(Math.min(Math.max(w, c.min), c.max));
}

/** 从 localStorage 读列宽；任何异常 / 结构不符都回退到默认值（版本变了自动丢弃旧值） */
export function loadWidths(): number[] {
  const def = defaultWidths();
  try {
    if (typeof localStorage === 'undefined') return def;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return def;
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr) || arr.length !== COLUMNS.length) return def;
    return def.map((d, i) => (typeof arr[i] === 'number' ? clampWidth(i, arr[i] as number) : d));
  } catch {
    return def;
  }
}

export function saveWidths(widths: number[]): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(widths));
  } catch {
    /* 存储不可用时静默忽略：列宽只是偏好，不值得打断用户 */
  }
}

/* ============================ 网格模板 ============================ */

/** 生成 grid-template-columns：可伸缩列用 minmax 吸收剩余空间，其余固定 px */
export function gridTemplate(widths: number[]): string {
  return COLUMNS.map((_c, i) =>
    i === FLEX_COLUMN_INDEX ? `minmax(${widths[i]}px, 1fr)` : `${widths[i]}px`,
  ).join(' ');
}

/** 行的 min-width：各列宽度之和（超过容器即出现横向滚动条） */
export function tableMinWidth(widths: number[]): number {
  return widths.reduce((a, b) => a + b, 0);
}

/* ============================ CSS 变量（拖拽期零重渲染） ============================ */

/**
 * grid-template-columns 的「变量版」：挂在滚动容器上，所有表头/数据行继承。
 * 拖拽时只改容器上的变量值，不触发 React 重渲染（大计划下拖拽才跟手）。
 */
export const GRID_TEMPLATE_VARS: string = COLUMNS.map((c, i) =>
  i === FLEX_COLUMN_INDEX ? `minmax(var(--col-${c.key}), 1fr)` : `var(--col-${c.key})`,
).join(' ');

/** 每列对应的 CSS 变量名，顺序同 COLUMNS */
export const COL_VAR_NAMES: string[] = COLUMNS.map((c) => `--col-${c.key}`);

/** 表格最小宽度对应的变量名 */
export const TABLE_MIN_W_VAR = '--table-min-w';

/** 宽度数组 → 容器的 inline style（React 渲染路径与拖拽直改路径共用同一套变量名） */
export function columnCssVars(widths: number[]): CSSProperties {
  const vars: Record<string, string> = {};
  COLUMNS.forEach((c, i) => {
    vars[COL_VAR_NAMES[i]] = `${widths[i]}px`;
  });
  vars[TABLE_MIN_W_VAR] = `${tableMinWidth(widths)}px`;
  return vars as CSSProperties;
}

/* ============================ 文本测量（自适应列宽用） ============================ */

let probe: HTMLSpanElement | null = null;

/**
 * 用离屏 span 测量文本渲染宽度（比 canvas 更贴近真实排版：自动处理中英文混排与字体回退）。
 * 非浏览器环境（如 jsdom 未实现布局）返回 0，调用方会回退到默认宽度。
 */
export function measureTextWidth(text: string): number {
  if (typeof document === 'undefined' || text === '') return 0;
  try {
    if (!probe) {
      probe = document.createElement('span');
      probe.style.cssText =
        'position:absolute;left:-9999px;top:0;visibility:hidden;white-space:pre;pointer-events:none;';
      document.body.appendChild(probe);
    }
    probe.textContent = text;
    return probe.getBoundingClientRect().width;
  } catch {
    return 0;
  }
}

/** 一列中要参与自适应宽度的原始文本（不含缩进 / 图标等固定占位） */
function columnTexts(task: Task, key: ColumnKey, depsText: string): string[] {
  switch (key) {
    case 'seq':
      return [String(task.seq)];
    case 'name':
      return [task.name || ''];
    case 'start':
      return [task.input.start ?? 'YYYY-MM-DD'];
    case 'end':
      return [task.input.end ?? 'YYYY-MM-DD'];
    case 'duration':
      return [task.input.duration ?? ''];
    case 'deps':
      return [depsText];
    case 'owner':
      return [task.owner ?? ''];
    default:
      return [];
  }
}

/** 单元格内除文本外的固定占位宽度（缩进 + 折叠三角 + 日历按钮等） */
function columnChrome(key: ColumnKey, depth: number, isParent: boolean): number {
  switch (key) {
    case 'name':
      // 层级缩进 depth*16 + 折叠三角（父任务 18px）/ 占位 18px
      return depth * 16 + (isParent ? 18 : 18);
    case 'start':
    case 'end':
      // 日历按钮 22px + 与输入框的间距 2px
      return 24;
    default:
      return 0;
  }
}

export interface AutoFitInput {
  /** 参与自适应的行（通常是可见行） */
  tasks: Task[];
  /** 行号 → 层级，用于计算名称列缩进 */
  depthOf: (task: Task) => number;
  /** 行 id → 是否为父任务 */
  isParentOf: (task: Task) => boolean;
  /** 行 id → 依赖表达式文本 */
  depsTextOf: (task: Task) => string;
}

/**
 * 计算某一列「刚好放下最长内容」的宽度。
 * 返回 null 表示该列不支持自适应（如操作列）。
 */
export function autoFitWidth(index: number, input: AutoFitInput): number | null {
  const col = COLUMNS[index];
  if (!col) return null;
  if (col.key === 'actions') return null;

  let max = measureTextWidth(col.label);
  const rows = input.tasks.length > AUTOFIT_MAX_ROWS ? input.tasks.slice(0, AUTOFIT_MAX_ROWS) : input.tasks;

  for (const t of rows) {
    const chrome = columnChrome(col.key, input.depthOf(t), input.isParentOf(t));
    let rowWidth = chrome;
    for (const s of columnTexts(t, col.key, input.depsTextOf(t))) {
      rowWidth += measureTextWidth(s);
    }
    if (rowWidth > max) max = rowWidth;
  }

  // 测不出宽度（离屏环境）时不做任何改动，交给调用方保持原样
  if (max <= 0) return null;

  return clampWidth(index, max + AUTOFIT_PADDING);
}
