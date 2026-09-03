/**
 * 回归测试（P0-A）：负责人单元格提交不应抛错、数据不丢。
 * 纯 Node 环境（vitest 默认 environment=node），复用 store.test.ts 的构建方式。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyTask, normalizePlan } from '../../shared/scheduler';
import { NATURAL_CALENDAR, SCHEMA_VERSION, type Plan } from '../../shared/types';
import { useStore } from '../store';

function makePlan(): Plan {
  const t = createEmptyTask('T-0001', 1, null, '任务A');
  t.owner = [];
  t.consultant = [];
  return normalizePlan({
    schemaVersion: SCHEMA_VERSION,
    planId: 'p-owner',
    name: 'owner 提交测试',
    version: 1,
    createdAt: '2026-08-26T00:00:00.000Z',
    updatedAt: '2026-08-26T00:00:00.000Z',
    updatedBy: 'User01',
    nextTaskSeq: 2,
    calendar: { mode: 'WORKWEEK5', anchorDate: '2026-08-26', defaultDuration: '1d' },
    tasks: [t],
  });
}

describe('P0-A 人员字段（负责人/顾问人）提交不丢数据', () => {
  beforeEach(() => {
    useStore.setState({
      session: { user: 'User01', mode: 'EDITING', lockToken: null },
      preview: null,
      plan: null,
      calendar: NATURAL_CALENDAR,
      diagnostics: [],
      sched: null,
      dirty: false,
    });
  });

  it('updatePeople(owner) 不抛错且写入 owner，recompute 产出 sched', () => {
    useStore.setState({ plan: makePlan() });
    expect(() => useStore.getState().updatePeople('T-0001', 'owner', ['User01'])).not.toThrow();
    expect(useStore.getState().plan!.tasks[0].owner).toEqual(['User01']);
    expect(useStore.getState().sched).toBeTruthy();
    expect(useStore.getState().dirty).toBe(true);
  });

  it('多人一次写入、顺序保持', () => {
    useStore.setState({ plan: makePlan() });
    useStore.getState().updatePeople('T-0001', 'owner', ['User01', 'User13', 'User02']);
    expect(useStore.getState().plan!.tasks[0].owner).toEqual(['User01', 'User13', 'User02']);
  });

  it('空数组也安全（清空负责人）', () => {
    useStore.setState({ plan: makePlan() });
    useStore.getState().updatePeople('T-0001', 'owner', ['User01']);
    expect(() => useStore.getState().updatePeople('T-0001', 'owner', [])).not.toThrow();
    expect(useStore.getState().plan!.tasks[0].owner).toEqual([]);
  });

  it('顾问人与负责人互不影响', () => {
    useStore.setState({ plan: makePlan() });
    useStore.getState().updatePeople('T-0001', 'owner', ['User01']);
    useStore.getState().updatePeople('T-0001', 'consultant', ['User13', 'User02']);
    const t = useStore.getState().plan!.tasks[0];
    expect(t.owner).toEqual(['User01']);
    expect(t.consultant).toEqual(['User13', 'User02']);
  });

  it('历史字符串 owner 经 normalizePlan 迁移为数组', () => {
    const raw = makePlan();
    (raw.tasks[0] as unknown as { owner: unknown }).owner = 'User01,User13';
    const migrated = normalizePlan(raw);
    expect(migrated.tasks[0].owner).toEqual(['User01', 'User13']);
    expect(migrated.tasks[0].consultant).toEqual([]);
  });
});
