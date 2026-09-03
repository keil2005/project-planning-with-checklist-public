/**
 * 增量测试 · 前端 store owner 动作（覆盖任务 f）。
 * 纯 Node 环境（vitest 默认 environment=node），store 创建不触达 window/DOM，
 * updateCell/addRow 通过 applyPlan → normalizePlan → recompute 落库，无需渲染。
 * 运行：npm test
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyTask, normalizePlan } from '../../shared/scheduler';
import { SCHEMA_VERSION, type Plan } from '../../shared/types';
import { useStore } from '../store';

function makePlan(): Plan {
  const t = createEmptyTask('T-0001', 1, null, '任务A');
  t.owner = '';
  return normalizePlan({
    schemaVersion: SCHEMA_VERSION,
    planId: 'p-store',
    name: 'store owner 测试',
    version: 1,
    createdAt: '2026-08-26T00:00:00.000Z',
    updatedAt: '2026-08-26T00:00:00.000Z',
    updatedBy: 'User01',
    nextTaskSeq: 2,
    calendar: { mode: 'NATURAL', anchorDate: '2026-08-26', defaultDuration: '1d', holidays: [] },
    tasks: [t],
  });
}

beforeEach(() => {
  useStore.setState({ plan: null, dirty: false });
});

describe('f·store owner 动作', () => {
  it('addRow 新任务 owner 默认为空串且置脏', () => {
    useStore.setState({ plan: makePlan() });
    useStore.getState().addRow();
    const plan = useStore.getState().plan!;
    const added = plan.tasks.find((t) => t.id === 'T-0002');
    expect(added).toBeDefined();
    expect(added!.owner).toBe('');
    expect(useStore.getState().dirty).toBe(true);
  });

  it('updateCell owner：去首尾空格、保留中间空格、不改大小写、自由文本合法', () => {
    useStore.setState({ plan: makePlan() });
    const st = useStore.getState();

    st.updateCell('T-0001', 'owner', ' User01 ');
    expect(useStore.getState().plan!.tasks[0].owner).toBe('User01');

    // 保留中间空格（Group A 原样）
    st.updateCell('T-0001', 'owner', 'Group A');
    expect(useStore.getState().plan!.tasks[0].owner).toBe('Group A');

    // 不归一大小写：手填 user01 原样保存
    st.updateCell('T-0001', 'owner', 'user01');
    expect(useStore.getState().plan!.tasks[0].owner).toBe('user01');

    // 名单外自由文本合法保存，不报错
    st.updateCell('T-0001', 'owner', '外部张三');
    expect(useStore.getState().plan!.tasks[0].owner).toBe('外部张三');

    // 仅改 owner 即置脏
    expect(useStore.getState().dirty).toBe(true);
  });

  it('清空 owner（空串）后值为空串', () => {
    useStore.setState({ plan: makePlan() });
    useStore.getState().updateCell('T-0001', 'owner', 'User02');
    useStore.getState().updateCell('T-0001', 'owner', '   ');
    expect(useStore.getState().plan!.tasks[0].owner).toBe('');
  });
});
