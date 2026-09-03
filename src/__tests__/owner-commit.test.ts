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
  t.owner = '';
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

describe('P0-A 负责人提交不丢数据', () => {
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

  it('updateCell(owner) 不抛错且写入 owner，recompute 产出 sched', () => {
    useStore.setState({ plan: makePlan() });
    expect(() => useStore.getState().updateCell('T-0001', 'owner', 'User01')).not.toThrow();
    expect(useStore.getState().plan!.tasks[0].owner).toBe('User01');
    expect(useStore.getState().sched).toBeTruthy();
    expect(useStore.getState().dirty).toBe(true);
  });

  it('空 owner 也安全（清空负责人）', () => {
    useStore.setState({ plan: makePlan() });
    useStore.getState().updateCell('T-0001', 'owner', 'User01');
    expect(() => useStore.getState().updateCell('T-0001', 'owner', '')).not.toThrow();
    expect(useStore.getState().plan!.tasks[0].owner).toBe('');
  });
});
