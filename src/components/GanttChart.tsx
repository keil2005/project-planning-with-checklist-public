/**
 * src/components/GanttChart.tsx —— 右侧甘特图（手写 SVG，无第三方图表库）。
 *
 * 渲染要点（系统设计 §6）：
 *   - 行高严格取 ROW_H，与左侧表格共用同一逻辑滚动位置（K16）；
 *   - x(date) = diffDays(rangeStart, date) * dayWidth，dayWidth 随缩放档位（日 24 / 周 8 / 月 3）；
 *   - 任务条取半开区间 [start, end)：x = x(start)，width = x(end) - x(start)，天然无缝衔接；
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
  DERIVE_SOURCE_LABEL,
  ErrCode,
  HEAD_H,
  ROW_H,
  type ISODate,
  type Task,
  type TaskComputed,
} from '../../shared/types';

/* ============================ 常量 ============================ */

/** 项目起止两侧留白天数 */
const PAD_DAYS = 7;

/** 叶子任务条高度 */
const BAR_H = 16;

/** 父任务汇总条高度 */
const SUMMARY_H = 9;

/** 依赖折线的出/入短脚长度 */
const STUB = 8;

/** 底部留白行数（与表格「新增一行 + 留白」保持一致，保证滚动区间对齐） */
const TAIL_ROWS = 3;

const COLOR = {
  bar: '#3b82f6',
  barStroke: '#1d4ed8',
  barError: '#dc2626',
  summary: '#334155',
  link: '#64748b',
  linkErr: '#dc2626',
  today: '#ef4444',
  gridWeak: '#eef2f6',
  gridStrong: '#cbd5e1',
  weekend: '#f8fafc',
  selected: '#eff6ff',
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
      top.push({ x, w, label: monthMode ? cursor.format('YYYY 年') : cursor.format('YYYY 年 M 月') });
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
      if (w > 0) ticks.push({ x, w, label: `${m.month() + 1}月`, strong: true, weekend: false });
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
  const plan = useStore((s) => s.plan);
  const sched = useStore((s) => s.sched);
  const diagnostics = useStore((s) => s.diagnostics);
  const zoom = useStore((s) => s.zoom);
  const selectedTaskId = useStore((s) => s.selectedTaskId);
  const selectTask = useStore((s) => s.selectTask);
  const todayTick = useStore((s) => s.todayTick);
  const visible = useVisibleTasks();
  const calendar = useStore((s) => s.calendar);

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
  const bodyHeight = (visible.length + TAIL_ROWS) * ROW_H;

  const axis = useMemo(
    () => buildAxis(range.rangeStart, range.totalDays, dayWidth),
    [range.rangeStart, range.totalDays, dayWidth],
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
        out.push({ x: i * dayWidth, w: dayWidth, type: 'holiday', date: d, label: calendar.labelOf(d) ?? '节假日' });
      } else if (calendar.isMakeup(d)) {
        out.push({ x: i * dayWidth, w: dayWidth, type: 'makeup', date: d, label: '补班' });
      }
    }
    return out;
  }, [calendar, range.rangeStart, range.totalDays, dayWidth]);

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
      <div className="flex h-full flex-col overflow-hidden bg-white">
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
              stroke="#ffffff"
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
    <div className="flex h-full flex-col overflow-hidden bg-white">
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
            <rect x={0} y={0} width={totalWidth} height={HEAD_H} fill="#f1f5f9" />
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
                  stroke={t.strong ? COLOR.gridStrong : '#dfe6ee'}
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
                      onMouseEnter={() => setDayHover({ x: c.x, label: '补班', date: c.date })}
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
              const w = Math.max(2, xOf(c.end) - x);
              const cy = i * ROW_H + ROW_H / 2;
              const hasErr = errorTasks.has(t.id);
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
                    <path d={d} fill={COLOR.summary} stroke={hasErr ? COLOR.barError : COLOR.summary} />
                    <text x={x + w + 6} y={cy + 4} style={{ fontSize: 11, fontWeight: 600 }}>
                      <tspan>{t.name}</tspan>
                      {ownerText !== '' && dayWidth >= 6 && (
                        <tspan fill="#94a3b8" fontWeight={400}>
                          {' · '}
                          {ownerText}
                        </tspan>
                      )}
                    </text>
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
                    fill={COLOR.bar}
                    fillOpacity={0.9}
                    stroke={hasErr ? COLOR.barError : COLOR.barStroke}
                    strokeWidth={hasErr ? 1.6 : 0.8}
                  />
                  <text x={x + w + 6} y={cy + 4} style={{ fontSize: 11 }}>
                    <tspan>{t.name}</tspan>
                    {ownerText !== '' && dayWidth >= 6 && (
                      <tspan fill="#94a3b8">{' · '}{ownerText}</tspan>
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
          </svg>

          {/* ---------------- 悬浮详情 ---------------- */}
          {hover && (
            <div
              className="pointer-events-none absolute z-10 rounded border border-slate-300 bg-white px-2 py-1 text-[11px] shadow-lg"
              style={{ left: hover.x + 8, top: hover.y + HEAD_H + ROW_H, maxWidth: 260 }}
            >
              <div className="mb-[2px] font-semibold">
                行{hover.task.seq}　{hover.task.name || '（未命名）'}
              </div>
              <div>
                区间：{hover.computed.start} → {hover.computed.end}（半开，不含结束日）
              </div>
              <div>
                时长：{formatDuration(hover.computed.duration)}　来源：
                {DERIVE_SOURCE_LABEL[hover.computed.derivedFrom]}
              </div>
              {hover.computed.isParent && <div className="text-slate-500">父任务：时间由子任务汇总</div>}
            </div>
          )}

          {/* 非工作日列悬浮标签（T06） */}
          {dayHover && (
            <div
              className="pointer-events-none absolute z-10 rounded border border-amber-300 bg-white px-2 py-1 text-[11px] shadow-lg"
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
          任务
        </span>
        <span className="inline-flex items-center gap-1">
          <span style={{ width: 14, height: 6, background: COLOR.summary, display: 'inline-block' }} />
          父任务汇总
        </span>
        <span className="inline-flex items-center gap-1">
          <span style={{ width: 14, height: 0, borderTop: `2px dashed ${COLOR.linkErr}`, display: 'inline-block' }} />
          依赖冲突
        </span>
        <span className="inline-flex items-center gap-1">
          <span style={{ width: 14, height: 8, background: '#fee2e2', display: 'inline-block', borderRadius: 2 }} />
          法定假日
        </span>
        <span className="inline-flex items-center gap-1">
          <span style={{ width: 14, height: 4, background: '#f59e0b', display: 'inline-block', borderRadius: 2 }} />
          补班日
        </span>
        <span className="inline-flex items-center gap-1">
          <span style={{ width: 14, height: 8, background: COLOR.weekend, display: 'inline-block', borderRadius: 2 }} />
          周末
        </span>
        <span>条形区间为 [开始, 结束)，结束日不占用工期</span>
      </div>
    </div>
  );
}
