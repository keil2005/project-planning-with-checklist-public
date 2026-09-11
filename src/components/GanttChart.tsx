/**
 * src/components/GanttChart.tsx —— 右侧甘特图（手写 SVG，无第三方图表库）。
 *
 * 渲染要点（系统设计 §6）：
 *   - 行高严格取 ROW_H，与左侧表格共用同一逻辑滚动位置（K16）；
 *   - x(date) = diffDays(rangeStart, date) * dayWidth，dayWidth 随缩放档位（日 24 / 周 8 / 月 3）；
 *   - 任务条取闭区间 [start, end]：x = x(start)，width = x(end+1) - x(start)，end 那条边画在 end 那天右边缘（K3 端点式 inclusive，2026-09-07）；
 *   - 父任务画两端带脚的汇总条；
 *   - 依赖箭头为正交折线 + marker-end 三角 + 中点 'FF+1w' 标注；与依赖冲突的边画红色虚线；
 *   - 「今天」竖线；项目起止范围左右各留 7 天 padding；
 *   - 点击条形 → selectTask，与表格双向联动。
 *
 * 所有日期与时长数值一律来自 store.sched（K8），本组件不做任何排程运算。
 */

import { useEffect, useMemo, useRef, useState, type MouseEvent, type MutableRefObject } from 'react';
import { useStore, useVisibleTasks } from '../store';
import { FilterStatusBar } from './FilterBar';
import { formatDepLabel } from '../../shared/scheduler';
import { formatPeople } from '../../shared/people';
import { addDays, diffDays, formatDuration, formatISODate, parseISODate, todayISO } from '../../shared/datetime';
import {
  DAY_WIDTH,
  ErrCode,
  HEAD_H,
  ROW_H,
  type ISODate,
  type Task,
  type TaskComputed,
} from '../../shared/types';
import { deriveLabel, t, useT, useLangStore } from '../i18n';

/* ============================ 常量 ============================ */

/** 项目起止两侧留白天数 */
const PAD_DAYS = 7;

/** 叶子任务条高度 */
const BAR_H = 16;

/** 父任务汇总条高度 */
const SUMMARY_H = 9;

/** 里程碑圆点直径 */
const MILESTONE_D = 10;

/** 依赖折线的出/入短脚长度 */
const STUB = 8;

/** 底部留白行数（与表格「新增一行 + 留白」保持一致，保证滚动区间对齐） */
const TAIL_ROWS = 3;

/* SVG 颜色 token（CSS 变量；浏览器解析 SVG fill/stroke 中的 var()） */
const COLOR = {
  bar: 'var(--bar)',
  /** v1.3.1 优雅版：bar 内部高光（渐变端） */
  barHi: 'var(--bar-hi)',
  barStroke: 'var(--bar-stroke)',
  barError: 'var(--error)',
  summary: 'var(--summary)',
  link: 'var(--link)',
  linkErr: 'var(--link-err)',
  today: 'var(--today)',
  gridWeak: 'var(--grid-weak)',
  gridStrong: 'var(--grid-strong)',
  weekend: 'var(--weekend)',
  selected: 'var(--primary-soft)',
  /** 关键路径下划线（红），与冲突红区分（冲突红为虚线更粗） */
  critical: 'var(--critical)',
  /** 里程碑（实心圆） */
  milestone: 'var(--milestone)',
  /** 里程碑描边（与父任务汇总区分） */
  milestoneStroke: 'var(--milestone-stroke)',
  /** 月初 / 周首弱线（dark 下与 grid-weak 差异更大） */
  gridWeakStrong: 'var(--grid-weak-strong)',
  /** 头底色 */
  headBg: 'var(--surface-2)',
  /** 选中行背景 */
  selectedBg: 'var(--primary-soft)',
  /** owner 副文字 */
  ownerTspan: 'var(--text-subtle)',
};

/* ============================ 轴刻度 ============================ */

interface AxisSegment {
  /** 段起始 x（像素） */
  x: number;
  /** 段宽（像素） */
  w: number;
  label: string;
}

interface AxisTick {
  x: number;
  w: number;
  label: string;
  /** 月首 / 周首 → 画粗线 */
  strong: boolean;
  weekend: boolean;
}

interface AxisModel {
  top: AxisSegment[];
  ticks: AxisTick[];
}

/**
 * 双层刻度模型。
 * - 日档（dayWidth ≥ 18）：上层月、下层每日；
 * - 周档（6 ≤ dayWidth < 18）：上层月、下层每 7 天；
 * - 月档（dayWidth < 6）：上层年、下层月。
 */
function buildAxis(rangeStart: ISODate, totalDays: number, dayWidth: number): AxisModel {
  const top: AxisSegment[] = [];
  const ticks: AxisTick[] = [];
  const start = parseISODate(rangeStart);
  const monthMode = dayWidth < 6;

  /* ---- 上层：月（或年） ---- */
  let cursor = start.startOf(monthMode ? 'year' : 'month');
  const endExclusive = start.add(totalDays, 'day');
  while (cursor.isBefore(endExclusive)) {
    const next = cursor.add(1, monthMode ? 'year' : 'month');
    const segStart = cursor.isBefore(start) ? start : cursor;
    const segEnd = next.isAfter(endExclusive) ? endExclusive : next;
    const x = segStart.diff(start, 'day') * dayWidth;
    const w = segEnd.diff(segStart, 'day') * dayWidth;
    if (w > 0) {
      top.push({
        x,
        w,
        label: monthMode
          ? t('gantt.yearLabel', { y: cursor.year() })
          : t('gantt.yearMonthLabel', { y: cursor.year(), m: cursor.month() + 1 }),
      });
    }
    cursor = next;
  }

  /* ---- 下层刻度 ---- */
  if (monthMode) {
    let m = start.startOf('month');
    while (m.isBefore(endExclusive)) {
      const next = m.add(1, 'month');
      const segStart = m.isBefore(start) ? start : m;
      const segEnd = next.isAfter(endExclusive) ? endExclusive : next;
      const x = segStart.diff(start, 'day') * dayWidth;
      const w = segEnd.diff(segStart, 'day') * dayWidth;
      if (w > 0) ticks.push({ x, w, label: t('gantt.month', { m: m.month() + 1 }), strong: true, weekend: false });
      m = next;
    }
    return { top, ticks };
  }

  const step = dayWidth >= 18 ? 1 : 7;
  for (let i = 0; i < totalDays; i += step) {
    const d = start.add(i, 'day');
    const w = Math.min(step, totalDays - i) * dayWidth;
    const dow = d.day();
    ticks.push({
      x: i * dayWidth,
      w,
      label: step === 1 ? String(d.date()) : d.format('M/D'),
      strong: d.date() === 1 || (step === 7 && dow === 1),
      weekend: step === 1 && (dow === 0 || dow === 6),
    });
  }
  return { top, ticks };
}

/* ============================ 依赖折线 ============================ */

interface LinkGeom {
  path: string;
  labelX: number;
  labelY: number;
}

/**
 * 计算正交折线。
 * @param fromRight 起点取前置任务的右端（FS / FF）还是左端（SS / SF）
 * @param toLeft    终点接入后继任务的左端（FS / SS）还是右端（FF / SF）
 */
function buildLinkPath(
  sx: number,
  sy: number,
  ex: number,
  ey: number,
  fromRight: boolean,
  toLeft: boolean,
): LinkGeom {
  const exitDir = fromRight ? 1 : -1;
  const enterDir = toLeft ? 1 : -1; // 箭头前进方向：+1 向右、-1 向左
  const x1 = sx + exitDir * STUB;
  const x2 = ex - enterDir * STUB;

  const pts: Array<[number, number]> = [[sx, sy], [x1, sy]];
  const straight = enterDir > 0 ? x2 >= x1 : x2 <= x1;

  if (straight) {
    pts.push([x1, ey], [x2, ey]);
  } else {
    // 需要绕行：先走到两行之间的中线，横向折回，再进入目标行
    const midY = sy + (ey >= sy ? ROW_H / 2 : -ROW_H / 2);
    pts.push([x1, midY], [x2, midY], [x2, ey]);
  }
  pts.push([ex, ey]);

  const path = pts.map(([px, py], i) => `${i === 0 ? 'M' : 'L'}${px.toFixed(1)} ${py.toFixed(1)}`).join(' ');
  return { path, labelX: (x1 + x2) / 2, labelY: ey - BAR_H / 2 - 3 };
}

/* ============================ 悬浮提示 ============================ */

interface HoverInfo {
  x: number;
  y: number;
  task: Task;
  computed: TaskComputed;
}

/* ============================ 主体 ============================ */

export interface GanttChartProps {
  /** 与表格共用的垂直滚动同步（K16） */
  scrollRef: MutableRefObject<HTMLDivElement | null>;
  onScroll: () => void;
}

export default function GanttChart({ scrollRef, onScroll }: GanttChartProps): JSX.Element {
  const tr = useT();
  const lang = useLangStore((s) => s.lang); // 进 axis/dayCells 的 useMemo 依赖：切语言时重建本地化标签
  const plan = useStore((s) => s.plan);
  const sched = useStore((s) => s.sched);
  const diagnostics = useStore((s) => s.diagnostics);
  const zoom = useStore((s) => s.zoom);
  const selectedTaskId = useStore((s) => s.selectedTaskId);
  const selectTask = useStore((s) => s.selectTask);
  const todayTick = useStore((s) => s.todayTick);
  const visible = useVisibleTasks();
  const calendar = useStore((s) => s.calendar);
  const criticalPathOn = useStore((s) => s.criticalPathOn);
  const criticalTaskIds = useStore((s) => s.criticalTaskIds);

  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [dayHover, setDayHover] = useState<{ x: number; label: string; date: ISODate } | null>(null);
  const didAutoScroll = useRef<string>('');

  const dayWidth = DAY_WIDTH[zoom];
  const today = todayISO();

  /* ---- 时间范围 ---- */
  const range = useMemo(() => {
    const ps = sched?.projectStart ?? today;
    const pe = sched?.projectEnd ?? today;
    const rangeStart = addDays(ps, -PAD_DAYS);
    const rangeEnd = addDays(pe, PAD_DAYS);
    const totalDays = Math.max(diffDays(rangeStart, rangeEnd), 14);
    return { rangeStart, rangeEnd, totalDays };
  }, [sched?.projectStart, sched?.projectEnd, today]);

  const totalWidth = Math.max(360, range.totalDays * dayWidth);
  // 2026-09-08 修复：甘特底部新增「里程碑 summary 行」——把所有 milestone 集中到一行展示。
  // 仅当可见区内存在里程碑时为该行预留 1 个 ROW_H；其余情况不留空。
  const milestones = useMemo(() => {
    if (!sched) return [];
    return visible
      .map((t) => ({ t, c: sched.computed[t.id] }))
      .filter(({ c }) => c?.isMilestone);
  }, [visible, sched]);
  const milestoneSummaryH = milestones.length > 0 ? ROW_H : 0;
  const bodyHeight = (visible.length + TAIL_ROWS) * ROW_H + milestoneSummaryH;

  const axis = useMemo(
    () => buildAxis(range.rangeStart, range.totalDays, dayWidth),
    [range.rangeStart, range.totalDays, dayWidth, lang],
  );

  const xOf = (date: ISODate): number => diffDays(range.rangeStart, date) * dayWidth;

  /* ---- 非工作日格子（着色 + 悬浮标签）---- */
  const dayCells = useMemo(() => {
    if (!calendar) return [];
    // 范围过大（月档跨多年）时跳过逐日着色，避免 DOM 过多
    if (range.totalDays > 380) return [];
    const out: { x: number; w: number; type: 'holiday' | 'makeup'; date: ISODate; label: string }[] = [];
    const start = parseISODate(range.rangeStart);
    for (let i = 0; i < range.totalDays; i += 1) {
      const d = formatISODate(start.add(i, 'day'));
      if (calendar.isHoliday(d)) {
        out.push({ x: i * dayWidth, w: dayWidth, type: 'holiday', date: d, label: calendar.labelOf(d) ?? t('gantt.holiday') });
      } else if (calendar.isMakeup(d)) {
        out.push({ x: i * dayWidth, w: dayWidth, type: 'makeup', date: d, label: t('gantt.makeup') });
      }
    }
    return out;
  }, [calendar, range.rangeStart, range.totalDays, dayWidth, lang]);

  /* ---- 行索引 & 冲突集合 ---- */
  const rowOf = useMemo(() => {
    const map = new Map<string, number>();
    visible.forEach((t, i) => map.set(t.id, i));
    return map;
  }, [visible]);

  const conflictTasks = useMemo(() => {
    const set = new Set<string>();
    for (const d of diagnostics) {
      if (d.taskId && (d.code === ErrCode.WARN_DEP_CONFLICT || d.code === ErrCode.ERR_CYCLE)) set.add(d.taskId);
    }
    return set;
  }, [diagnostics]);

  const errorTasks = useMemo(() => {
    const set = new Set<string>();
    for (const d of diagnostics) {
      if (d.taskId && d.level === 'error') set.add(d.taskId);
    }
    return set;
  }, [diagnostics]);

  /* ---- 「今天」按钮：把今天滚到视口中间 ---- */
  useEffect(() => {
    if (todayTick === 0) return;
    const el = scrollRef.current;
    if (!el) return;
    const x = xOf(today);
    el.scrollLeft = Math.max(0, x - el.clientWidth / 2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayTick]);

  /* ---- 首次打开计划：横向对齐到项目起点前 3 天 ---- */
  useEffect(() => {
    if (!plan || !sched) return;
    if (didAutoScroll.current === plan.planId) return;
    const el = scrollRef.current;
    if (!el) return;
    didAutoScroll.current = plan.planId;
    el.scrollLeft = Math.max(0, xOf(addDays(sched.projectStart, -3)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan?.planId, sched?.projectStart]);

  // 未就绪时也要渲染等高筛选条：与左侧表格容器保持同高（K16 滚动同步）
  if (!plan || !sched) {
    return (
      <div className="flex h-full flex-col overflow-hidden" style={{ background: 'var(--surface)' }}>
        <div className="pg-filter-bar" />
        <div className="pg-scroll" />
      </div>
    );
  }

  /* ---- 依赖箭头 ---- */
  const links: JSX.Element[] = [];
  for (const succ of visible) {
    const succRow = rowOf.get(succ.id);
    const sc = sched.computed[succ.id];
    if (succRow === undefined || !sc) continue;
    for (const dep of succ.deps ?? []) {
      const predRow = rowOf.get(dep.predecessorId);
      const pc = sched.computed[dep.predecessorId];
      if (predRow === undefined || !pc) continue; // 前置被折叠隐藏或不存在 → 不画

      const fromRight = dep.type === 'FS' || dep.type === 'FF';
      const toLeft = dep.type === 'FS' || dep.type === 'SS';
      const sy = predRow * ROW_H + ROW_H / 2;
      const ey = succRow * ROW_H + ROW_H / 2;
      const sx = fromRight ? xOf(pc.end) : xOf(pc.start);
      const ex = toLeft ? xOf(sc.start) : xOf(sc.end);
      const bad = conflictTasks.has(succ.id);
      const geom = buildLinkPath(sx, sy, ex, ey, fromRight, toLeft);
      const label = formatDepLabel(dep);

      links.push(
        <g key={`${dep.predecessorId}->${succ.id}-${dep.type}`}>
          <path
            d={geom.path}
            fill="none"
            stroke={bad ? COLOR.linkErr : COLOR.link}
            strokeWidth={bad ? 1.6 : 1.2}
            strokeDasharray={bad ? '4 3' : undefined}
            markerEnd={`url(#${bad ? 'pg-arrow-err' : 'pg-arrow'})`}
          />
          {dayWidth >= 6 && (
            <text
              x={geom.labelX}
              y={geom.labelY}
              textAnchor="middle"
              fill={bad ? COLOR.linkErr : COLOR.link}
              stroke="var(--surface)"
              strokeWidth={3}
              paintOrder="stroke"
              style={{ fontSize: 10 }}
            >
              {label}
            </text>
          )}
        </g>,
      );
    }
  }

  const todayX = xOf(today);
  const todayInRange = todayX >= 0 && todayX <= totalWidth;

  return (
    <div className="flex h-full flex-col overflow-hidden" style={{ background: 'var(--surface)' }}>
      {/* 与左侧表格的筛选条等高：两侧可视高度必须一致，否则滚到底时 scrollTop 同步会错位 */}
      <FilterStatusBar />
      <div
        ref={scrollRef}
        className="pg-scroll"
        onScroll={onScroll}
        onMouseLeave={() => {
          setHover(null);
          setDayHover(null);
        }}
      >
        <div style={{ width: totalWidth, position: 'relative' }}>
          {/* ---------------- 时间轴（吸顶） ---------------- */}
          <svg
            className="pg-gantt-svg pg-sticky-head"
            width={totalWidth}
            height={HEAD_H}
            role="presentation"
          >
            <rect x={0} y={0} width={totalWidth} height={HEAD_H} fill={COLOR.headBg} />
            {axis.top.map((seg) => (
              <g key={`m-${seg.x}`}>
                <line x1={seg.x} y1={0} x2={seg.x} y2={HEAD_H} stroke={COLOR.gridStrong} strokeWidth={1} />
                <text x={seg.x + 4} y={13} style={{ fontSize: 11, fontWeight: 600 }}>
                  {seg.w >= 44 ? seg.label : ''}
                </text>
              </g>
            ))}
            {axis.ticks.map((t) => (
              <g key={`t-${t.x}`}>
                <line
                  x1={t.x}
                  y1={HEAD_H / 2}
                  x2={t.x}
                  y2={HEAD_H}
                  stroke={t.strong ? COLOR.gridStrong : COLOR.gridWeakStrong}
                  strokeWidth={1}
                />
                {t.w >= 14 && (
                  <text x={t.x + t.w / 2} y={HEAD_H - 7} textAnchor="middle" style={{ fontSize: 10 }}>
                    {t.label}
                  </text>
                )}
              </g>
            ))}
            <line x1={0} y1={HEAD_H - 0.5} x2={totalWidth} y2={HEAD_H - 0.5} stroke={COLOR.gridStrong} />
            {todayInRange && <line x1={todayX} y1={0} x2={todayX} y2={HEAD_H} stroke={COLOR.today} strokeWidth={1.5} />}
          </svg>

          {/* ---------------- 图形主体 ---------------- */}
          <svg className="pg-gantt-svg" width={totalWidth} height={bodyHeight}>
            <defs>
              {/* 任务条渐变（v1.3.1 优雅版：上下渐变体现高度感） */}
              <linearGradient id="pg-bar-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={COLOR.barHi} stopOpacity="0.95" />
                <stop offset="100%" stopColor={COLOR.bar} stopOpacity="1" />
              </linearGradient>
              <linearGradient id="pg-bar-critical-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#fb7185" stopOpacity="0.95" />
                <stop offset="100%" stopColor={COLOR.critical} stopOpacity="1" />
              </linearGradient>
              <linearGradient id="pg-bar-summary-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#94a3b8" stopOpacity="0.9" />
                <stop offset="100%" stopColor={COLOR.summary} stopOpacity="1" />
              </linearGradient>
              {/* 依赖箭头 */}
              <marker id="pg-arrow" viewBox="0 0 8 8" refX={7} refY={4} markerWidth={7} markerHeight={7} orient="auto">
                <path d="M0 0 L8 4 L0 8 z" fill={COLOR.link} />
              </marker>
              <marker
                id="pg-arrow-err"
                viewBox="0 0 8 8"
                refX={7}
                refY={4}
                markerWidth={7}
                markerHeight={7}
                orient="auto"
              >
                <path d="M0 0 L8 4 L0 8 z" fill={COLOR.linkErr} />
              </marker>
              {/* bar 投影滤镜（柔和高斯）—— 用 sRGB 避免 linearRGB 偏色 */}
              <filter id="pg-bar-shadow" x="-10%" y="-30%" width="120%" height="160%" colorInterpolationFilters="sRGB">
                <feGaussianBlur in="SourceAlpha" stdDeviation="0.6" />
                <feOffset dx="0" dy="0.8" result="offsetblur" />
                <feComponentTransfer>
                  <feFuncA type="linear" slope="0.18" />
                </feComponentTransfer>
                <feMerge>
                  <feMergeNode />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            {/* 周末底色 */}
            {dayWidth >= 10 &&
              axis.ticks
                .filter((t) => t.weekend)
                .map((t) => (
                  <rect key={`we-${t.x}`} x={t.x} y={0} width={t.w} height={bodyHeight} fill={COLOR.weekend} />
                ))}

            {/* 法定假日 / 补班日底色（覆盖在周末之上；补班为工作日，仅顶条标记） */}
            {dayWidth >= 4 &&
              dayCells.map((c) =>
                c.type === 'holiday' ? (
                  <rect
                    key={`hd-${c.date}`}
                    className="gantt-holiday"
                    x={c.x}
                    y={0}
                    width={c.w}
                    height={bodyHeight}
                    onMouseEnter={() => setDayHover({ x: c.x, label: c.label, date: c.date })}
                  />
                ) : (
                  <g key={`mk-${c.date}`}>
                    <rect className="gantt-makeup" x={c.x} y={0} width={c.w} height={bodyHeight} />
                    <rect
                      className="gantt-makeup-strip"
                      x={c.x}
                      y={0}
                      width={c.w}
                      height={4}
                      onMouseEnter={() => setDayHover({ x: c.x, label: c.label, date: c.date })}
                    />
                  </g>
                ),
              )}

            {/* 选中行底色 */}
            {selectedTaskId !== null && rowOf.has(selectedTaskId) && (
              <rect
                x={0}
                y={(rowOf.get(selectedTaskId) as number) * ROW_H}
                width={totalWidth}
                height={ROW_H}
                fill={COLOR.selected}
              />
            )}

            {/* 竖向网格 */}
            {axis.ticks.map((t) => (
              <line
                key={`v-${t.x}`}
                x1={t.x}
                y1={0}
                x2={t.x}
                y2={bodyHeight}
                stroke={t.strong ? COLOR.gridStrong : COLOR.gridWeak}
                strokeWidth={1}
              />
            ))}

            {/* 横向网格（与表格行线一致） */}
            {visible.map((t, i) => (
              <line
                key={`h-${t.id}`}
                x1={0}
                y1={(i + 1) * ROW_H - 0.5}
                x2={totalWidth}
                y2={(i + 1) * ROW_H - 0.5}
                stroke={COLOR.gridWeak}
                strokeWidth={1}
              />
            ))}

            {/* 依赖箭头（画在条形下层） */}
            <g>{links}</g>

            {/* 任务条 */}
            {visible.map((t, i) => {
              const c = sched.computed[t.id];
              if (!c) return null;
              const x = xOf(c.start);
              // K3 端点式（2026-09-07）：end 本身已是最后工作日（inclusive），
              // 视觉上条形需占满 end 那天 → 用 addDays(end, 1) 算出下一格 x
              const w = Math.max(2, xOf(addDays(c.end, 1)) - x);
              const cy = i * ROW_H + ROW_H / 2;
              const hasErr = errorTasks.has(t.id);
              const isCritical = criticalPathOn && criticalTaskIds.has(t.id);
              // 人员可多人 → 顿号拼接；顾问人按裁定不上条（只作备注信息）
              const ownerText = formatPeople(t.owner);
              const onEnter = (e: MouseEvent<SVGGElement>): void => {
                setHover({ x: x + Math.min(w, 120), y: i * ROW_H, task: t, computed: c });
                e.stopPropagation();
              };

              if (c.isParent) {
                const y = cy - SUMMARY_H / 2;
                const foot = Math.min(6, Math.max(3, SUMMARY_H));
                const d = [
                  `M${x} ${y}`,
                  `H${x + w}`,
                  `V${y + SUMMARY_H}`,
                  `L${x + w - foot} ${y + SUMMARY_H - 3}`,
                  `H${x + foot}`,
                  `L${x} ${y + SUMMARY_H}`,
                  'Z',
                ].join(' ');
                return (
                  <g key={t.id} className="pg-bar" onMouseEnter={onEnter} onClick={() => selectTask(t.id)}>
                    <path d={d} fill="url(#pg-bar-summary-grad)" stroke={hasErr ? COLOR.barError : COLOR.summary} strokeWidth={1} filter="url(#pg-bar-shadow)" />
                    {/* 关键路径下划线（父任务不参与 CPM，但视觉同步显示父任务是否跨越关键子任务——简单起见父任务不加） */}
                    <text x={x + w + 6} y={cy + 4} style={{ fontSize: 11, fontWeight: 600 }}>
                      <tspan>{t.name}</tspan>
                      {ownerText !== '' && dayWidth >= 6 && (
                        <tspan fill={COLOR.ownerTspan} fontWeight={400}>
                          {' · '}
                          {ownerText}
                        </tspan>
                      )}
                    </text>
                  </g>
                );
              }

              // 里程碑（Q4-A）：duration=0 → 实心圆，居中于 start 那天的 dayWidth/2 位置
              if (c.isMilestone) {
                const cx = x + dayWidth / 2;
                const cyM = cy;
                return (
                  <g
                    key={t.id}
                    className="pg-bar"
                    onMouseEnter={onEnter}
                    onClick={() => selectTask(t.id)}
                  >
                    <title>{tr('gantt.milestoneTitle', { date: c.start })}</title>
                    <circle
                      cx={cx}
                      cy={cyM}
                      r={MILESTONE_D / 2}
                      fill={hasErr ? COLOR.barError : COLOR.milestone}
                      stroke={hasErr ? COLOR.barError : COLOR.milestoneStroke}
                      strokeWidth={1.4}
                    />
                    <text x={cx + MILESTONE_D / 2 + 4} y={cy + 4} style={{ fontSize: 11 }}>
                      <tspan>{t.name}</tspan>
                      {ownerText !== '' && dayWidth >= 6 && (
                        <tspan fill={COLOR.ownerTspan}>{' · '}{ownerText}</tspan>
                      )}
                    </text>
                    {isCritical && (
                      <line
                        x1={cx - MILESTONE_D / 2 - 2}
                        x2={cx + MILESTONE_D / 2 + 2}
                        y1={cyM + MILESTONE_D / 2 + 2}
                        y2={cyM + MILESTONE_D / 2 + 2}
                        stroke={COLOR.critical}
                        strokeWidth={2}
                      />
                    )}
                  </g>
                );
              }

              return (
                <g key={t.id} className="pg-bar" onMouseEnter={onEnter} onClick={() => selectTask(t.id)}>
                  <rect
                    x={x}
                    y={cy - BAR_H / 2}
                    width={w}
                    height={BAR_H}
                    rx={3}
                    ry={3}
                    fill={isCritical ? 'url(#pg-bar-critical-grad)' : 'url(#pg-bar-grad)'}
                    fillOpacity={0.95}
                    stroke={hasErr ? COLOR.barError : isCritical ? COLOR.critical : COLOR.barStroke}
                    strokeWidth={hasErr ? 1.6 : isCritical ? 1.2 : 0.8}
                    filter="url(#pg-bar-shadow)"
                  />
                  {/* 关键路径下划线（Q3）：bar 下方 2px 红线，跨越整条形 */}
                  {isCritical && (
                    <line
                      x1={x}
                      x2={x + w}
                      y1={cy + BAR_H / 2 + 1}
                      y2={cy + BAR_H / 2 + 1}
                      stroke={COLOR.critical}
                      strokeWidth={2}
                    />
                  )}
                  <text x={x + w + 6} y={cy + 4} style={{ fontSize: 11 }}>
                    <tspan>{t.name}</tspan>
                    {ownerText !== '' && dayWidth >= 6 && (
                      <tspan fill={COLOR.ownerTspan}>{' · '}{ownerText}</tspan>
                    )}
                  </text>
                </g>
              );
            })}

            {/* 今天竖线 */}
            {todayInRange && (
              <line
                x1={todayX}
                y1={0}
                x2={todayX}
                y2={bodyHeight}
                stroke={COLOR.today}
                strokeWidth={1.5}
                strokeDasharray="3 3"
              />
            )}

            {/* 里程碑 summary 行（Q-2026-09-08）：把所有 milestone 集中在一行，按各自日期分散显示。
                位于最末行任务之下，TAIL_ROWS 留白行之前，方便快速扫到所有关键节点。 */}
            {milestones.length > 0 && (
              <g className="pg-milestone-summary">
                {/* 分隔线 */}
                <line
                  x1={0}
                  x2={totalWidth}
                  y1={visible.length * ROW_H - 0.5}
                  y2={visible.length * ROW_H - 0.5}
                  stroke={COLOR.gridStrong}
                  strokeDasharray="4 3"
                  strokeWidth={1}
                />
                {/* 行标签 */}
                <text
                  x={4}
                  y={visible.length * ROW_H + 14}
                  style={{ fontSize: 10, fill: COLOR.ownerTspan, fontWeight: 500 }}
                >
                  {tr('gantt.milestoneSummary', { count: milestones.length })}
                </text>
                {milestones.map(({ t, c }) => {
                  const cx = xOf(c.start) + dayWidth / 2;
                  const cy = visible.length * ROW_H + ROW_H / 2;
                  const onEnter = (e: MouseEvent<SVGGElement>): void => {
                    setHover({ x: cx, y: visible.length * ROW_H, task: t, computed: c });
                    e.stopPropagation();
                  };
                  const isCrit = criticalPathOn && criticalTaskIds.has(t.id);
                  return (
                    <g
                      key={`ms-${t.id}`}
                      className="pg-bar"
                      onMouseEnter={onEnter}
                      onClick={() => selectTask(t.id)}
                    >
                      <title>{tr('gantt.milestoneTitle', { date: c.start })}</title>
                      <circle
                        cx={cx}
                        cy={cy}
                        r={MILESTONE_D / 2}
                        fill={COLOR.milestone}
                        stroke={COLOR.milestoneStroke}
                        strokeWidth={1.4}
                        filter="url(#pg-bar-shadow)"
                      />
                      {isCrit && (
                        <line
                          x1={cx - MILESTONE_D / 2 - 2}
                          x2={cx + MILESTONE_D / 2 + 2}
                          y1={cy + MILESTONE_D / 2 + 2}
                          y2={cy + MILESTONE_D / 2 + 2}
                          stroke={COLOR.critical}
                          strokeWidth={2}
                        />
                      )}
                      {dayWidth >= 6 && (
                        <text x={cx + MILESTONE_D / 2 + 4} y={cy + 4} style={{ fontSize: 10, fill: 'var(--text-muted)' }}>
                          {t.name}
                        </text>
                      )}
                    </g>
                  );
                })}
              </g>
            )}
          </svg>

          {/* ---------------- 悬浮详情 ---------------- */}
          {hover && (
            <div
              className="pointer-events-none absolute z-10 rounded border border-border-strong bg-[var(--surface-elev)] px-2 py-1 text-[11px] shadow-lg"
              style={{ left: hover.x + 8, top: hover.y + HEAD_H + ROW_H, maxWidth: 260 }}
            >
              <div className="mb-[2px] font-semibold">
                {tr('diag.rowN', { seq: hover.task.seq })}　{hover.task.name || tr('gantt.unnamed')}
              </div>
              <div>{tr('gantt.range', { start: hover.computed.start, end: hover.computed.end })}</div>
              <div>
                {tr('gantt.durationSrc', {
                  dur: formatDuration(hover.computed.duration),
                  src: deriveLabel(hover.computed.derivedFrom),
                })}
              </div>
              {hover.computed.isParent && <div className="text-text-muted">{tr('gantt.parentSummary')}</div>}
            </div>
          )}

          {/* 非工作日列悬浮标签（T06） */}
          {dayHover && (
            <div
              className="pointer-events-none absolute z-10 rounded border border-[var(--warn)] bg-[var(--surface-elev)] px-2 py-1 text-[11px] shadow-lg"
              style={{ left: dayHover.x + dayWidth / 2, top: HEAD_H + 2, transform: 'translateX(-50%)' }}
            >
              <b>{dayHover.label}</b> · {dayHover.date}
            </div>
          )}
        </div>
      </div>

      {/* 图例。⚠️ 与左侧表格底部条共用 .pg-panel-footer：两侧必须等高，
          否则滚动容器 clientHeight 不同，滚到底时 scrollTop 同步会被 clamp（K16） */}
      <div className="pg-panel-footer">
        <span className="inline-flex items-center gap-1">
          <span style={{ width: 14, height: 8, background: COLOR.bar, display: 'inline-block', borderRadius: 2 }} />
          {tr('gantt.legendTask')}
        </span>
        <span className="inline-flex items-center gap-1">
          <span style={{ width: 14, height: 6, background: COLOR.summary, display: 'inline-block' }} />
          {tr('gantt.legendSummary')}
        </span>
        <span className="inline-flex items-center gap-1">
          <span
            style={{
              width: 12,
              height: 12,
              background: COLOR.milestone,
              borderRadius: '50%',
              display: 'inline-block',
              border: `1.5px solid ${COLOR.milestoneStroke}`,
            }}
          />
          {tr('gantt.legendMilestone')}
        </span>
        <span className="inline-flex items-center gap-1">
          <span style={{ width: 14, height: 0, borderTop: `2px solid ${COLOR.critical}`, display: 'inline-block' }} />
          {tr('gantt.legendCritical')}
        </span>
        <span className="inline-flex items-center gap-1">
          <span style={{ width: 14, height: 0, borderTop: `2px dashed ${COLOR.linkErr}`, display: 'inline-block' }} />
          {tr('gantt.legendConflict')}
        </span>
        <span className="inline-flex items-center gap-1">
          <span style={{ width: 14, height: 8, background: 'var(--holiday)', display: 'inline-block', borderRadius: 2 }} />
          {tr('gantt.legendHoliday')}
        </span>
        <span className="inline-flex items-center gap-1">
          <span style={{ width: 14, height: 4, background: 'var(--makeup-strip)', display: 'inline-block', borderRadius: 2 }} />
          {tr('gantt.legendMakeup')}
        </span>
        <span className="inline-flex items-center gap-1">
          <span style={{ width: 14, height: 8, background: COLOR.weekend, display: 'inline-block', borderRadius: 2 }} />
          {tr('gantt.legendWeekend')}
        </span>
        <span>{tr('gantt.legendRange')}</span>
      </div>
    </div>
  );
}
