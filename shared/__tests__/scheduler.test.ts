/**
 * shared 领域层单测（T02 验收）。运行：npm test
 */
import { describe, expect, it } from 'vitest';
import { addDuration, diffDuration, parseDuration, subDuration } from '../datetime';
import { buildIdSeqMaps, createEmptyTask, formatDepsExpr, normalizePlan, parseDepsExpr, schedule } from '../scheduler';
import { ErrCode, SCHEMA_VERSION, type Plan, type Task } from '../types';
import { WEEKEND_ONLY } from './calendar.test';

/* 统一注入 WEEKEND_ONLY 日历（T07 / N3）：仅周末非工作、无节假日，断言确定 */
const sched = (p: Plan) => schedule(p, { calendar: WEEKEND_ONLY });

/* ------------------------------ 测试夹具 ------------------------------ */

function makePlan(tasks: Task[], anchorDate = '2026-08-26'): Plan {
  return normalizePlan({
    schemaVersion: SCHEMA_VERSION,
    planId: 'p-test',
    name: '测试计划',
    version: 1,
    createdAt: '2026-08-26T00:00:00.000Z',
    updatedAt: '2026-08-26T00:00:00.000Z',
    updatedBy: 'Alice',
    nextTaskSeq: tasks.length + 1,
    calendar: { mode: 'NATURAL', anchorDate, defaultDuration: '1d', holidays: [] },
    tasks,
  });
}

function task(
  id: string,
  name: string,
  patch: Partial<Task> = {},
): Task {
  return { ...createEmptyTask(id, 0, null, name), ...patch };
}

/* ------------------------------ datetime ------------------------------ */

describe('datetime · ENDPOINT 语义', () => {
  it('2026-08-26 + 1m = 2026-09-23（20 工作日，WEEKEND_ONLY）', () => {
    expect(addDuration('2026-08-26', { value: 1, unit: 'm' }, 1, WEEKEND_ONLY)).toBe('2026-09-23');
  });

  it('2026-01-31 + 1m = 2026-02-28（WEEKEND_ONLY：首工作日为 02-02，第20工作日 02-27，end 02-28）', () => {
    expect(addDuration('2026-01-31', { value: 1, unit: 'm' }, 1, WEEKEND_ONLY)).toBe('2026-02-28');
  });

  it('5d / 2w 跨度（WEEKEND_ONLY）', () => {
    expect(addDuration('2026-08-26', { value: 5, unit: 'd' }, 1, WEEKEND_ONLY)).toBe('2026-09-02');
    expect(addDuration('2026-08-26', { value: 2, unit: 'w' }, 1, WEEKEND_ONLY)).toBe('2026-09-09');
  });

  it('subDuration 为 addDuration 的逆（WEEKEND_ONLY round-trip）', () => {
    expect(subDuration('2026-09-23', { value: 1, unit: 'm' }, WEEKEND_ONLY)).toBe('2026-08-26');
  });

  it('parseDuration 缺省单位为 d，大小写不敏感', () => {
    expect(parseDuration('5')).toEqual({ value: 5, unit: 'd' });
    expect(parseDuration('2W')).toEqual({ value: 2, unit: 'w' });
    expect(() => parseDuration('3x')).toThrowError();
  });

  it('diffDuration 单位优先级 m > w > d（WEEKEND_ONLY）', () => {
    expect(diffDuration('2026-08-26', '2026-09-23', WEEKEND_ONLY)).toEqual({ value: 1, unit: 'm' });
    expect(diffDuration('2026-08-26', '2026-09-09', WEEKEND_ONLY)).toEqual({ value: 2, unit: 'w' });
    expect(diffDuration('2026-08-26', '2026-08-29', WEEKEND_ONLY)).toEqual({ value: 3, unit: 'd' });
  });
});

/* ------------------------------ 依赖解析 ------------------------------ */

describe('scheduler · 依赖表达式', () => {
  const tasks = [task('T-0001', 'A'), task('T-0002', 'B'), task('T-0003', 'C'), task('T-0005', 'E')];
  const plan = makePlan(tasks);
  const { seqToId, idToSeq } = buildIdSeqMaps(plan.tasks);

  it('3FF+1w 解析', () => {
    const r = parseDepsExpr('3FF+1w', seqToId, 'T-0005');
    expect(r.diagnostics).toHaveLength(0);
    expect(r.deps).toEqual([
      { predecessorId: 'T-0003', type: 'FF', lag: { value: 1, unit: 'w' }, lagSign: 1, raw: '3FF+1w' },
    ]);
  });

  it('2FS,5SS+2d 多依赖', () => {
    const r = parseDepsExpr('2FS,4SS+2d', seqToId, 'T-0003');
    expect(r.deps).toHaveLength(2);
    expect(r.deps[1].type).toBe('SS');
    expect(r.deps[1].lag).toEqual({ value: 2, unit: 'd' });
  });

  it('缺省类型为 FS，小写与负偏移', () => {
    expect(parseDepsExpr('1', seqToId).deps[0]).toMatchObject({ predecessorId: 'T-0001', type: 'FS', lag: null });
    expect(parseDepsExpr('2ss-3d', seqToId).deps[0]).toMatchObject({ type: 'SS', lagSign: -1 });
  });

  it('非法表达式 → 1005；行号不存在 → 1009；自引用 → 1010', () => {
    expect(parseDepsExpr('3FF+1x', seqToId).diagnostics[0].code).toBe(ErrCode.ERR_DEP_PARSE);
    expect(parseDepsExpr('99', seqToId).diagnostics[0].code).toBe(ErrCode.ERR_DEP_TARGET_MISSING);
    expect(parseDepsExpr('1', seqToId, 'T-0001').diagnostics[0].code).toBe(ErrCode.ERR_DEP_SELF);
  });

  it('formatDepsExpr 用当前行号回显', () => {
    const deps = parseDepsExpr('3FF+1w', seqToId, 'T-0005').deps;
    expect(formatDepsExpr(deps, idToSeq)).toBe('3FF+1w');
  });
});

/* ------------------------------ 三选二 ------------------------------ */

describe('scheduler · 三选二决策矩阵', () => {
  it('#2 S+D', () => {
    const plan = makePlan([task('T-0001', 'A', { input: { start: '2026-08-26', end: null, duration: '1m' } })]);
    const r = sched(plan);
    expect(r.computed['T-0001'].end).toBe('2026-09-23');
    expect(r.computed['T-0001'].derivedFrom).toBe('INPUT');
  });

  it('#3 E+D 反推开始', () => {
    const plan = makePlan([task('T-0001', 'A', { input: { start: null, end: '2026-09-23', duration: '1m' } })]);
    expect(sched(plan).computed['T-0001'].start).toBe('2026-08-26');
  });

  it('#1 S+E 推时长', () => {
    const plan = makePlan([task('T-0001', 'A', { input: { start: '2026-08-26', end: '2026-08-31', duration: null } })]);
    const c = sched(plan).computed['T-0001'];
    expect(c.duration).toEqual({ value: 3, unit: 'd' });
    expect(c.fieldSources.duration).not.toBe('INPUT');
  });

  it('#5 仅 S → 缺省 1d + warn 1017', () => {
    const plan = makePlan([task('T-0001', 'A', { input: { start: '2026-08-26', end: null, duration: null } })]);
    const r = sched(plan);
    expect(r.computed['T-0001'].end).toBe('2026-08-27');
    expect(r.diagnostics.some((d) => d.code === ErrCode.WARN_DURATION_DEFAULTED)).toBe(true);
  });

  it('#14 无任何约束 → 落锚点 + warn 1016', () => {
    const plan = makePlan([task('T-0001', 'A')], '2026-08-26');
    const r = sched(plan);
    expect(r.computed['T-0001'].start).toBe('2026-08-26');
    expect(r.diagnostics.some((d) => d.code === ErrCode.WARN_UNSCHEDULED)).toBe(true);
  });

  it('#15 三填冲突 → error 1003；一致 → warn 1018', () => {
    const bad = makePlan([task('T-0001', 'A', { input: { start: '2026-08-26', end: '2026-09-01', duration: '1m' } })]);
    expect(sched(bad).diagnostics.some((d) => d.code === ErrCode.ERR_OVER_CONSTRAINED)).toBe(true);

    const good = makePlan([task('T-0001', 'A', { input: { start: '2026-08-26', end: '2026-09-23', duration: '1m' } })]);
    expect(sched(good).diagnostics.some((d) => d.code === ErrCode.WARN_REDUNDANT_INPUT)).toBe(true);
  });

  it('#8 仅时长 + FS 依赖 → 依赖驱动开始', () => {
    const a = task('T-0001', 'A', { input: { start: '2026-08-26', end: null, duration: '5d' } });
    const b = task('T-0002', 'B', {
      input: { start: null, end: null, duration: '3d' },
      deps: [{ predecessorId: 'T-0001', type: 'FS', lag: null, lagSign: 1, raw: '1FS' }],
    });
    const c = sched(makePlan([a, b])).computed;
    expect(c['T-0001'].end).toBe('2026-09-02');
    expect(c['T-0002'].start).toBe('2026-09-02');
    expect(c['T-0002'].end).toBe('2026-09-05');
  });

  it('FF+1w 依赖驱动结束', () => {
    const a = task('T-0001', 'A', { input: { start: '2026-08-26', end: '2026-09-02', duration: null } });
    const b = task('T-0002', 'B', {
      input: { start: null, end: null, duration: null },
      deps: [{ predecessorId: 'T-0001', type: 'FF', lag: { value: 1, unit: 'w' }, lagSign: 1, raw: '1FF+1w' }],
    });
    const c = sched(makePlan([a, b])).computed;
    expect(c['T-0002'].end).toBe('2026-09-09');
  });

  it('手填早于依赖 → warn 1006', () => {
    const a = task('T-0001', 'A', { input: { start: '2026-08-26', end: '2026-09-10', duration: null } });
    const b = task('T-0002', 'B', {
      input: { start: '2026-08-27', end: '2026-08-28', duration: null },
      deps: [{ predecessorId: 'T-0001', type: 'FS', lag: null, lagSign: 1, raw: '1FS' }],
    });
    expect(sched(makePlan([a, b])).diagnostics.some((d) => d.code === ErrCode.WARN_DEP_CONFLICT)).toBe(true);
  });
});

/* ------------------------------ 父子 rollup / 环 ------------------------------ */

describe('scheduler · 父子 rollup 与环检测', () => {
  it('两级父任务 rollup', () => {
    const root = task('T-0001', '根');
    const mid = task('T-0002', '中', { parentId: 'T-0001' });
    const leaf1 = task('T-0003', '叶1', { parentId: 'T-0002', input: { start: '2026-08-26', end: null, duration: '5d' } });
    const leaf2 = task('T-0004', '叶2', { parentId: 'T-0001', input: { start: '2026-09-01', end: null, duration: '1m' } });
    const c = sched(makePlan([root, mid, leaf1, leaf2])).computed;
    expect(c['T-0002'].start).toBe('2026-08-26');
    expect(c['T-0002'].end).toBe('2026-09-02');
    expect(c['T-0001'].start).toBe('2026-08-26');
    expect(c['T-0001'].end).toBe('2026-09-29');
    expect(c['T-0001'].isParent).toBe(true);
    expect(c['T-0001'].derivedFrom).toBe('ROLLUP');
    expect(c['T-0003'].depth).toBe(2);
  });

  it('父任务手填时间被忽略 → warn 1015', () => {
    const p = task('T-0001', '父', { input: { start: '2020-01-01', end: null, duration: null } });
    const k = task('T-0002', '子', { parentId: 'T-0001', input: { start: '2026-08-26', end: null, duration: '2d' } });
    const r = sched(makePlan([p, k]));
    expect(r.computed['T-0001'].start).toBe('2026-08-26');
    expect(r.diagnostics.some((d) => d.code === ErrCode.WARN_PARENT_INPUT_IGNORED)).toBe(true);
  });

  it('A→B→A 环 → error 1004 且不崩', () => {
    const a = task('T-0001', 'A', {
      deps: [{ predecessorId: 'T-0002', type: 'FS', lag: null, lagSign: 1, raw: '2FS' }],
    });
    const b = task('T-0002', 'B', {
      deps: [{ predecessorId: 'T-0001', type: 'FS', lag: null, lagSign: 1, raw: '1FS' }],
    });
    const r = sched(makePlan([a, b]));
    expect(r.diagnostics.some((d) => d.code === ErrCode.ERR_CYCLE)).toBe(true);
    expect(Object.keys(r.computed)).toHaveLength(2);
  });

  it('子任务依赖祖先 → error 1011', () => {
    const p = task('T-0001', '父');
    const k = task('T-0002', '子', {
      parentId: 'T-0001',
      input: { start: '2026-08-26', end: null, duration: '2d' },
      deps: [{ predecessorId: 'T-0001', type: 'FS', lag: null, lagSign: 1, raw: '1FS' }],
    });
    const r = sched(makePlan([p, k]));
    expect(r.diagnostics.some((d) => d.code === ErrCode.ERR_DEP_ANCESTOR)).toBe(true);
    expect(r.computed['T-0002'].start).toBe('2026-08-26');
  });

  it('父任务可作为前置被依赖', () => {
    const p = task('T-0001', '父');
    const k = task('T-0002', '子', { parentId: 'T-0001', input: { start: '2026-08-26', end: null, duration: '5d' } });
    const next = task('T-0003', '后继', {
      deps: [{ predecessorId: 'T-0001', type: 'FS', lag: null, lagSign: 1, raw: '1FS' }],
    });
    const c = sched(makePlan([p, k, next])).computed;
    expect(c['T-0003'].start).toBe('2026-09-02');
  });

  it('projectStart / projectEnd', () => {
    const a = task('T-0001', 'A', { input: { start: '2026-08-26', end: null, duration: '5d' } });
    const b = task('T-0002', 'B', { input: { start: '2026-09-01', end: null, duration: '1m' } });
    const r = sched(makePlan([a, b]));
    expect(r.projectStart).toBe('2026-08-26');
    expect(r.projectEnd).toBe('2026-09-29');
  });
});

/* ------------------------------ 规整与性能 ------------------------------ */

describe('scheduler · normalizePlan 与性能', () => {
  it('seq 重排 + 悬空依赖清理 + 树形连续化', () => {
    const plan = makePlan([
      task('T-0002', '子', { parentId: 'T-0001' }),
      task('T-0001', '父'),
      task('T-0003', 'C', { deps: [{ predecessorId: 'T-9999', type: 'FS', lag: null, lagSign: 1, raw: 'x' }] }),
    ]);
    expect(plan.tasks.map((t) => t.id)).toEqual(['T-0001', 'T-0002', 'T-0003']);
    expect(plan.tasks.map((t) => t.seq)).toEqual([1, 2, 3]);
    expect(plan.tasks[2].deps).toHaveLength(0);
  });

  it('500 行链式排程 < 200ms', () => {
    const tasks: Task[] = [];
    for (let i = 1; i <= 500; i += 1) {
      const id = `T-${String(i).padStart(4, '0')}`;
      const t = task(id, `任务${i}`, { input: { start: null, end: null, duration: '2d' } });
      if (i === 1) t.input = { start: '2026-01-01', end: null, duration: '2d' };
      else t.deps = [{ predecessorId: `T-${String(i - 1).padStart(4, '0')}`, type: 'FS', lag: null, lagSign: 1, raw: '' }];
      tasks.push(t);
    }
    const plan = makePlan(tasks);
    const t0 = Date.now();
    const r = sched(plan);
    const cost = Date.now() - t0;
    expect(r.diagnostics.filter((d) => d.level === 'error')).toHaveLength(0);
    expect(cost).toBeLessThan(200);
  });
});
