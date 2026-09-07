/**
 * server · MPP 导入映射层测试（覆盖导入能力）。
 *
 * 不依赖 Java/MPXJ：直接喂中间 JSON（与 MppImport.java 输出同契约），
 * 校验 toPlan 的字段映射（独占 end = finish+1、稳定 ID、父级/依赖链接、lag 解析、owner、progress），
 * 并校验「桥接不可用 → ERR_FEATURE_DISABLED」的降级路径。
 */
import { describe, expect, it } from 'vitest';
import { DomainError, ErrCode, type Plan } from '../../shared/types';
import { normalizePlan } from '../../shared/scheduler';
import { isMppImportAvailable, toPlan, importMppFile, type MppImportResult } from '../mppImport';

/** 一个含父子层级 + 1 条 FS 依赖 + owner + progress 的样例 */
const SAMPLE: MppImportResult = {
  name: '示例导入计划',
  tasks: [
    { uid: '1', name: '阶段一', start: '2026-10-01', finish: '2026-10-15', parentUid: null, owner: 'Alice', progress: 50, predecessors: [] },
    { uid: '2', name: '任务A', start: '2026-10-01', finish: '2026-10-08', parentUid: '1', owner: 'Bob', progress: 100, predecessors: [] },
    { uid: '3', name: '任务B', start: '2026-10-09', finish: '2026-10-15', parentUid: '1', owner: null, progress: 0, predecessors: [{ uid: '2', type: 'FS', lagText: '+1d' }] },
    { uid: '4', name: '阶段二', start: null, finish: null, parentUid: null, owner: null, progress: null, predecessors: [] },
  ],
};

describe('toPlan 字段映射', () => {
  const { name, tasks } = toPlan(SAMPLE);

  it('计划名透传', () => {
    expect(name).toBe('示例导入计划');
  });

  it('稳定 ID 按数组顺序生成 T-0001…', () => {
    expect(tasks.map((t) => t.id)).toEqual(['T-0001', 'T-0002', 'T-0003', 'T-0004']);
  });

  it('end = finish（MPP finish 为含内结束，与 K3 端点式 inclusive 对齐，v1.2.1）', () => {
    // 任务A finish=2026-10-08(inclusive) → end=2026-10-08
    expect(tasks[1].input.start).toBe('2026-10-01');
    expect(tasks[1].input.end).toBe('2026-10-08');
    // 阶段一 finish=2026-10-15 → end=2026-10-15
    expect(tasks[0].input.end).toBe('2026-10-15');
  });

  it('父级链接用稳定 ID', () => {
    expect(tasks[1].parentId).toBe('T-0001'); // 任务A 父=阶段一
    expect(tasks[2].parentId).toBe('T-0001'); // 任务B 父=阶段一
    expect(tasks[0].parentId).toBeNull();
  });

  it('依赖映射为稳定 ID + 类型 + lag', () => {
    const dep = tasks[2].deps[0];
    expect(dep.predecessorId).toBe('T-0002'); // 任务B → 任务A
    expect(dep.type).toBe('FS');
    expect(dep.lag).toEqual({ value: 1, unit: 'd' });
    expect(dep.lagSign).toBe(1);
    expect(dep.raw).toBe('FS+1d');
  });

  it('owner 透传（人员字段恒为数组）；progress 空值不写', () => {
    // MPP 资源名升级为数组：单人 → 单元素数组
    expect(tasks[0].owner).toEqual(['Alice']);
    expect(tasks[0].progress).toBe(50);
    expect(tasks[1].owner).toEqual(['Bob']);
    expect(tasks[1].progress).toBe(100);
    // 无资源的任务：人员字段仍存在，只是空数组（normalizePlan 的落地不变量）
    expect(tasks[2].owner).toEqual([]);
    expect(tasks[2].consultant).toEqual([]);
    expect(tasks[2].progress).toBe(0); // 任务B progress=0 是合法值，应保留
    expect(tasks[3].owner).toEqual([]);
    expect(tasks[3].progress).toBeUndefined(); // 阶段二 progress=null → 不写
  });

  it('normalizePlan 后树形连续化 + seq 重排', () => {
    const plan = normalizePlan({ schemaVersion: 1, planId: '', name, version: 0, createdAt: '', updatedAt: '', updatedBy: '', nextTaskSeq: tasks.length + 1, calendar: { mode: 'NATURAL', anchorDate: '2026-10-01', defaultDuration: '1d' }, tasks } as Plan);
    // 父任务必须紧邻其子任务之前
    const ids = plan.tasks.map((t) => t.id);
    expect(ids.indexOf('T-0001')).toBeLessThan(ids.indexOf('T-0002'));
    expect(ids.indexOf('T-0002')).toBeLessThan(ids.indexOf('T-0003'));
    plan.tasks.forEach((t, i) => expect(t.seq).toBe(i + 1));
  });
});

describe('lag 符号解析', () => {
  it('负 lag', () => {
    const { tasks } = toPlan({
      name: 'x',
      tasks: [
        { uid: '1', name: 'a', start: '2026-10-01', finish: '2026-10-02', predecessors: [] },
        { uid: '2', name: 'b', start: '2026-10-03', finish: '2026-10-04', predecessors: [{ uid: '1', type: 'SS', lagText: '-3d' }] },
      ],
    });
    const dep = tasks[1].deps[0];
    expect(dep.predecessorId).toBe('T-0001');
    expect(dep.lagSign).toBe(-1);
    expect(dep.lag).toEqual({ value: 3, unit: 'd' });
    expect(dep.raw).toBe('SS-3d');
  });
});

describe('桥接不可用降级', () => {
  it('未启用时 isMppImportAvailable() 为 false 且 importMppFile 抛 ERR_FEATURE_DISABLED', () => {
    if (isMppImportAvailable()) {
      // 本环境已具备 Java+MPXJ，跳过降级断言（由真实环境覆盖）
      return;
    }
    expect(isMppImportAvailable()).toBe(false);
    let thrown: unknown;
    try {
      importMppFile('/nonexistent-import-test.mpp');
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(DomainError);
    expect((thrown as DomainError).code).toBe(ErrCode.ERR_FEATURE_DISABLED);
  });
});
