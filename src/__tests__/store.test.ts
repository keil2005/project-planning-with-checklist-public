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
  t.owner = [];
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
    expect(added!.owner).toEqual([]);
    expect(added!.consultant).toEqual([]);
    expect(useStore.getState().dirty).toBe(true);
  });

  it('updatePeople owner：trim、保留中间空格、不归一大小写、自由文本合法', () => {
    useStore.setState({ plan: makePlan() });
    const st = useStore.getState();

    st.updatePeople('T-0001', 'owner', [' User01 ']);
    expect(useStore.getState().plan!.tasks[0].owner).toEqual(['User01']);

    // 保留中间空格（Group A 原样）
    st.updatePeople('T-0001', 'owner', ['Group A']);
    expect(useStore.getState().plan!.tasks[0].owner).toEqual(['Group A']);

    // 不归一大小写：手填 user01 原样保存（但不会与已存在的 User01 重复共存）
    st.updatePeople('T-0001', 'owner', ['user01']);
    expect(useStore.getState().plan!.tasks[0].owner).toEqual(['user01']);

    // 名单外自由文本合法保存，不报错
    st.updatePeople('T-0001', 'owner', ['外部张三']);
    expect(useStore.getState().plan!.tasks[0].owner).toEqual(['外部张三']);

    // 仅改人员即置脏
    expect(useStore.getState().dirty).toBe(true);
  });

  it('updatePeople owner：多人按录入顺序保存，去重大小写不敏感', () => {
    useStore.setState({ plan: makePlan() });
    const st = useStore.getState();

    st.updatePeople('T-0001', 'owner', ['User01', 'User13', 'User02']);
    expect(useStore.getState().plan!.tasks[0].owner).toEqual(['User01', 'User13', 'User02']);

    // 一次提交内的大小写重复会折叠，保留首次出现的写法
    st.updatePeople('T-0001', 'owner', ['User01', 'user01', 'User02']);
    expect(useStore.getState().plan!.tasks[0].owner).toEqual(['User01', 'User02']);

    // 空串 / 纯空白被丢弃
    st.updatePeople('T-0001', 'owner', ['User01', '  ', '']);
    expect(useStore.getState().plan!.tasks[0].owner).toEqual(['User01']);
  });

  it('updatePeople consultant：与 owner 各自独立', () => {
    useStore.setState({ plan: makePlan() });
    const st = useStore.getState();

    st.updatePeople('T-0001', 'owner', ['User01']);
    st.updatePeople('T-0001', 'consultant', ['User13', 'User02']);
    const t = useStore.getState().plan!.tasks[0];
    expect(t.owner).toEqual(['User01']);
    expect(t.consultant).toEqual(['User13', 'User02']);

    // 清掉顾问人不动负责人
    st.updatePeople('T-0001', 'consultant', []);
    expect(useStore.getState().plan!.tasks[0].owner).toEqual(['User01']);
    expect(useStore.getState().plan!.tasks[0].consultant).toEqual([]);
  });

  it('updatePeople：重复写入相同内容是幂等的（值稳定、不报错）', () => {
    useStore.setState({ plan: makePlan() });
    useStore.getState().updatePeople('T-0001', 'owner', ['User01', 'User02']);
    const first = useStore.getState().plan!.tasks[0].owner;
    expect(() => useStore.getState().updatePeople('T-0001', 'owner', ['User01', 'User02'])).not.toThrow();
    const second = useStore.getState().plan!.tasks[0].owner;
    expect(second).toEqual(first);
    expect(second).toEqual(['User01', 'User02']);
  });

  it('清空 owner（空数组）后值为空数组', () => {
    useStore.setState({ plan: makePlan() });
    useStore.getState().updatePeople('T-0001', 'owner', ['User02']);
    useStore.getState().updatePeople('T-0001', 'owner', []);
    expect(useStore.getState().plan!.tasks[0].owner).toEqual([]);
  });
});
