/**
 * 增量测试 · 前端 store owner 动作（覆盖任务 f）。
 * 纯 Node 环境（vitest 默认 environment=node），store 创建不触达 window/DOM，
 * updateCell/addRow 通过 applyPlan → normalizePlan → recompute 落库，无需渲染。
 * 运行：npm test
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyTask, normalizePlan } from '../../shared/scheduler';
import { applyTodoOp, makeTodoId } from '../../shared/todo';
import { SCHEMA_VERSION, type Plan, type TodoItem, type TodoOp } from '../../shared/types';
import { api } from '../api';
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

/** 模拟服务端 todo 独立资源：applyTodoOp 纯函数 + revision 单调递增（与 TodoRepository.applyOp 同构） */
function makeTodoServer() {
  const state: Record<string, TodoItem[]> = {};
  let revision = 0;
  const mock = vi
    .spyOn(api, 'todoOp')
    .mockImplementation(async (_planId: string, taskId: string, _user: string, op: TodoOp) => {
      const next = applyTodoOp(state[taskId] ?? [], op, makeTodoId);
      state[taskId] = next;
      revision += 1;
      return { revision, todos: next };
    });
  return { mock, getRevision: () => revision };
}

beforeEach(() => {
  vi.restoreAllMocks();
  useStore.setState({
    plan: null,
    dirty: false,
    session: { user: null, mode: 'READONLY', lockToken: null },
    todosRevision: 0,
    todoDrawerTaskId: null,
    toast: null,
  });
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

describe('f·store todo 动作', () => {
  it('addTodo / updateTodo / deleteTodo 走 api.todoOp 即时提交，不置脏（独立资源）', async () => {
    useStore.setState({ plan: makePlan(), session: { user: 'User01', mode: 'READONLY', lockToken: null } });
    const server = makeTodoServer();

    await useStore.getState().addTodo('T-0001', '出原理图');
    await useStore.getState().addTodo('T-0001', '  出BOM  '); // 首尾空白被 trim
    let todos = useStore.getState().plan!.tasks[0].todos!;
    expect(todos).toHaveLength(2);
    expect(todos[0].text).toBe('出原理图');
    expect(todos[1].text).toBe('出BOM');
    expect(todos.map((t) => t.order)).toEqual([0, 1]);

    // 走接口（而非 applyPlan），且携带正确参数
    expect(server.mock).toHaveBeenCalledTimes(2);
    expect(server.mock.mock.calls[0][0]).toBe('p-store');
    expect(server.mock.mock.calls[0][1]).toBe('T-0001');
    expect(server.mock.mock.calls[0][2]).toBe('User01');

    // 勾选完成
    await useStore.getState().updateTodo('T-0001', todos[0].id, { done: true });
    todos = useStore.getState().plan!.tasks[0].todos!;
    expect(todos[0].done).toBe(true);

    // 空文本不更新（清空走 deleteTodo）
    await useStore.getState().updateTodo('T-0001', todos[0].id, { text: '   ' });
    expect(useStore.getState().plan!.tasks[0].todos![0].text).toBe('出原理图');

    // 删除
    await useStore.getState().deleteTodo('T-0001', todos[0].id);
    expect(useStore.getState().plan!.tasks[0].todos).toHaveLength(1);

    // todo 是独立真源：不改 plan.json → 不置脏
    expect(useStore.getState().dirty).toBe(false);
    // revision 随每次指令 +1
    expect(useStore.getState().todosRevision).toBe(server.getRevision());
  });

  it('todo.assignee 不在负责人时自动并入负责人（单向只增，经 normalizePlan 派生）', async () => {
    useStore.setState({ plan: makePlan(), session: { user: 'User01', mode: 'READONLY', lockToken: null } });
    makeTodoServer();

    await useStore.getState().addTodo('T-0001', '出原理图');
    const todoId = useStore.getState().plan!.tasks[0].todos![0].id;

    await useStore.getState().updateTodo('T-0001', todoId, { assignee: '张三' });
    expect(useStore.getState().plan!.tasks[0].owner).toEqual(['张三']);

    // 清掉 assignee 不自动移除已并入的负责人（单向只增）
    await useStore.getState().updateTodo('T-0001', todoId, { assignee: '' });
    expect(useStore.getState().plan!.tasks[0].owner).toEqual(['张三']);
  });

  it('moveTodo 上移/下移走 api.todoOp 提交并重排 order', async () => {
    useStore.setState({ plan: makePlan(), session: { user: 'User01', mode: 'READONLY', lockToken: null } });
    makeTodoServer();

    await useStore.getState().addTodo('T-0001', 'A');
    await useStore.getState().addTodo('T-0001', 'B');
    await useStore.getState().addTodo('T-0001', 'C');
    let todos = useStore.getState().plan!.tasks[0].todos!;
    expect(todos.map((t) => t.text)).toEqual(['A', 'B', 'C']);

    await useStore.getState().moveTodo('T-0001', todos[0].id, 1); // A 下移
    todos = useStore.getState().plan!.tasks[0].todos!;
    expect(todos.map((t) => t.text)).toEqual(['B', 'A', 'C']);

    await useStore.getState().moveTodo('T-0001', todos[2].id, -1); // C 上移
    todos = useStore.getState().plan!.tasks[0].todos!;
    expect(todos.map((t) => t.text)).toEqual(['B', 'C', 'A']);
    expect(todos.map((t) => t.order)).toEqual([0, 1, 2]);
    expect(useStore.getState().dirty).toBe(false);
  });

  it('未登录时 todo 动作不发起请求（无 user 即 no-op）', async () => {
    useStore.setState({ plan: makePlan() }); // session.user 保持 null
    const server = makeTodoServer();

    await useStore.getState().addTodo('T-0001', '出原理图');
    expect(server.mock).not.toHaveBeenCalled();
  });

  it('openTodoDrawer / closeTodoDrawer 切换抽屉态', () => {
    useStore.setState({ plan: makePlan(), todoDrawerTaskId: null });
    useStore.getState().openTodoDrawer('T-0001');
    expect(useStore.getState().todoDrawerTaskId).toBe('T-0001');
    useStore.getState().closeTodoDrawer();
    expect(useStore.getState().todoDrawerTaskId).toBeNull();
  });
});

describe('f·store todo 未保存守门', () => {
  /** 默认期望文案：与 src/i18n.tsx zh 段 `toast.todoNeedSave` 一致（保持用例就地可读） */
  const TODO_NEED_SAVE_ZH = '请先保存计划，再管理 TODO';

  it('dirty=true 时 addTodo 不发请求，且 toast 提示「请先保存计划」', async () => {
    useStore.setState({
      plan: makePlan(),
      dirty: true, // 关键：模拟"新建计划后未保存"或"已修改但未保存"
      session: { user: 'User01', mode: 'READONLY', lockToken: null },
    });
    const server = makeTodoServer();

    await useStore.getState().addTodo('T-0001', '出原理图');

    // 不发请求
    expect(server.mock).not.toHaveBeenCalled();
    // 本地 plan 的 todos 也未被修改
    expect(useStore.getState().plan!.tasks[0].todos ?? []).toEqual([]);
    // toast 显示新文案（warning 等级、明确指引）
    expect(useStore.getState().toast?.message).toBe(TODO_NEED_SAVE_ZH);
    expect(useStore.getState().toast?.severity).toBe('warning');
  });

  it('dirty=false 时 addTodo 正常走 api.todoOp（回归守门）', async () => {
    useStore.setState({
      plan: makePlan(),
      dirty: false,
      session: { user: 'User01', mode: 'READONLY', lockToken: null },
    });
    const server = makeTodoServer();

    await useStore.getState().addTodo('T-0001', '出原理图');

    expect(server.mock).toHaveBeenCalledTimes(1);
    expect(useStore.getState().plan!.tasks[0].todos).toHaveLength(1);
    expect(useStore.getState().toast).toBeNull();
  });
});
