/**
 * sanitizeDeps · 字符串型 lag 兼容加固（team-lead 冒烟回填）。
 * 运行：npm run test
 */
import { describe, expect, it } from 'vitest';
import { addDuration } from '../datetime';
import { normalizePlan, schedule } from '../scheduler';
import { SCHEMA_VERSION, type Dependency, type Plan, type Task } from '../types';
import { WEEKEND_ONLY } from './calendar.test';

/* ------------------------------ 测试夹具 ------------------------------ */

function makePlan(tasks: Task[], anchorDate = '2026-08-26'): Plan {
  return normalizePlan({
    schemaVersion: SCHEMA_VERSION,
    planId: 'p-extra',
    name: '耗时加固测试',
    version: 1,
    createdAt: '2026-08-26T00:00:00.000Z',
    updatedAt: '2026-08-26T00:00:00.000Z',
    updatedBy: 'Alice',
    nextTaskSeq: tasks.length + 1,
    calendar: { mode: 'NATURAL', anchorDate, defaultDuration: '1d', holidays: [] },
    tasks,
  });
}

function task(id: string, name: string, patch: Partial<Task> = {}): Task {
  return {
    id,
    seq: 0,
    parentId: null,
    name,
    collapsed: false,
    input: { start: null, end: null, duration: null },
    deps: [],
    ...patch,
  };
}

/* --------------------- sanitizeDeps 字符串 lag 归一化 --------------------- */

describe('sanitizeDeps · 字符串型 lag 归一化', () => {
  it("lag '1w' → {value:1, unit:'w'}，lagSign=1", () => {
    const deps = sanitizeDepsString([
      { predecessorId: 'T-1', type: 'FF', lag: '1w', lagSign: 1, raw: '1FF+1w' },
    ]);
    expect(deps).toHaveLength(1);
    expect(deps[0].lag).toEqual({ value: 1, unit: 'w' });
    expect(deps[0].lagSign).toBe(1);
  });

  it("lag '-3d' → {value:3, unit:'d'}，lagSign=-1（字符串负号优先）", () => {
    const deps = sanitizeDepsString([
      { predecessorId: 'T-1', type: 'FS', lag: '-3d', lagSign: 1, raw: '1FS-3d' },
    ]);
    expect(deps).toHaveLength(1);
    expect(deps[0].lag).toEqual({ value: 3, unit: 'd' });
    expect(deps[0].lagSign).toBe(-1);
  });

  it("lag '+1w' 且 lagSign=-1 → 符号相乘得 -1", () => {
    const deps = sanitizeDepsString([
      { predecessorId: 'T-1', type: 'SS', lag: '+1w', lagSign: -1, raw: '1SS+1w' },
    ]);
    expect(deps).toHaveLength(1);
    expect(deps[0].lag).toEqual({ value: 1, unit: 'w' });
    expect(deps[0].lagSign).toBe(-1);
  });

  it("非法字符串 '3x' / 缺单位 → lag 落为 null（不静默丢数据时也不误建）", () => {
    const bad = sanitizeDepsString([
      { predecessorId: 'T-1', type: 'FS', lag: '3x', lagSign: 1, raw: '1FS3x' },
    ]);
    expect(bad).toHaveLength(1);
    expect(bad[0].lag).toBeNull();
    expect(bad[0].lagSign).toBe(1);
  });
});

/* --------------------- schedule 端到端：字符串 lag == 对象 lag --------------------- */

describe('schedule · 字符串 lag 与对象 lag 行为一致', () => {
  it("FF+1w 字符串 lag → successor.end = predecessor.end + 7d", () => {
    const plan = makePlan([
      task('T-1', '前驱', { input: { start: '2026-08-26', end: '2026-09-02', duration: '1w' } }),
      task('T-2', '后继', {
        input: { start: null, end: null, duration: '1d' },
        deps: [{ predecessorId: 'T-1', type: 'FF', lag: '1w', lagSign: 1, raw: '1FF+1w' } as unknown as Dependency],
      }),
    ]);
    const res = schedule(plan, { calendar: WEEKEND_ONLY });
    const pred = res.computed['T-1'];
    const succ = res.computed['T-2'];
    expect(pred.end).toBe('2026-09-02');
    expect(succ.end).toBe(addDuration('2026-09-02', { value: 1, unit: 'w' }, 1, WEEKEND_ONLY));
    expect(succ.end).toBe('2026-09-09');
    expect(res.diagnostics.filter((d) => d.level === 'error')).toHaveLength(0);
  });

  it('同结构用对象型 lag 得到一致结果（回归对照）', () => {
    const plan = makePlan([
      task('T-1', '前驱', { input: { start: '2026-08-26', end: '2026-09-02', duration: '1w' } }),
      task('T-2', '后继', {
        input: { start: null, end: null, duration: '1d' },
        deps: [{ predecessorId: 'T-1', type: 'FF', lag: { value: 1, unit: 'w' }, lagSign: 1, raw: '1FF+1w' }],
      }),
    ]);
    const res = schedule(plan, { calendar: WEEKEND_ONLY });
    expect(res.computed['T-2'].end).toBe('2026-09-09');
  });
});

/* ------------------------------ 辅助：直接驱动 sanitizeDeps ------------------------------ */

// sanitizeDeps 为模块内部函数，这里通过 normalizePlan 对 deps 的归一化结果间接断言。
function sanitizeDepsString(rawArr: unknown[]): Dependency[] {
  const plan = normalizePlan({
    schemaVersion: SCHEMA_VERSION,
    planId: 'p-internal',
    name: 'sanitizeDeps 探针',
    version: 1,
    createdAt: '2026-08-26T00:00:00.000Z',
    updatedAt: '2026-08-26T00:00:00.000Z',
    updatedBy: 'Alice',
    nextTaskSeq: 2,
    calendar: { mode: 'NATURAL', anchorDate: '2026-08-26', defaultDuration: '1d', holidays: [] },
    tasks: [
      {
        id: 'T-1',
        seq: 1,
        parentId: null,
        name: '前驱',
        collapsed: false,
        input: { start: '2026-08-26', end: '2026-08-27', duration: '1d' },
        deps: [],
      },
      {
        id: 'T-2',
        seq: 2,
        parentId: null,
        name: '后继',
        collapsed: false,
        input: { start: null, end: null, duration: null },
        deps: rawArr as unknown as Dependency[],
      },
    ],
  });
  return plan.tasks.find((t) => t.id === 'T-2')?.deps ?? [];
}
