/**
 * shared · TODO 交付清单（U04）纯函数与一致性规则测试。
 * 运行：npx vitest run shared/__tests__/todo.test.ts
 *
 * 覆盖：
 *  - sanitizeTodos：空文本/脏项丢弃、id 去重、order 重排、assignee trim；
 *  - enforceTodoOwnerConsistency：todo.assignee 不在负责人/顾问人时单向并入负责人；
 *  - todosProgress / todosProgressText：进度计数与文案；
 *  - normalizePlan 集成：assignee 自动并入 owner、旧 string owner 迁移不受影响。
 */
import { describe, expect, it } from 'vitest';
import { normalizePlan } from '../scheduler';
import {
  applyTodoOp,
  enforceTodoOwnerConsistency,
  sanitizeTodos,
  todosProgress,
  todosProgressText,
} from '../todo';
import { SCHEMA_VERSION, type Plan, type Task, type TodoItem } from '../types';

function makePlan(tasks: Task[]): Plan {
  return normalizePlan({
    schemaVersion: SCHEMA_VERSION,
    planId: 'p-todo',
    name: 'todo 测试',
    version: 1,
    createdAt: '2026-08-26T00:00:00.000Z',
    updatedAt: '2026-08-26T00:00:00.000Z',
    updatedBy: 'User01',
    nextTaskSeq: tasks.length + 1,
    calendar: { mode: 'NATURAL', anchorDate: '2026-08-26', defaultDuration: '1d', holidays: [] },
    tasks,
  });
}

describe('u04 · sanitizeTodos 清洗', () => {
  it('丢弃空文本与非对象项，保留合法项并 trim assignee', () => {
    const raw = [
      null,
      { text: '   ', id: 'a' },
      { text: '写报告', id: 'x', done: true, assignee: '  User01  ' },
      'not-an-object',
      { text: '画图', id: 'y' },
    ];
    const out = sanitizeTodos(raw, 'T-0001');
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ text: '写报告', done: true, assignee: 'User01', order: 0 });
    expect(out[1]).toMatchObject({ text: '画图', order: 1 });
    // 未显式 done 的项恒为 false
    expect(out[1].done).toBe(false);
    // assignee 为空时省略字段（而非空串）
    expect('assignee' in out[1]).toBe(false);
  });

  it('id 空 / 重复时做确定性补救，order 按数组序重排', () => {
    const raw: Partial<TodoItem>[] = [
      { id: '', text: 'A' },
      { id: 'dup', text: 'B' },
      { id: 'dup', text: 'C' },
      { id: 'd1', text: 'D', order: 99 },
    ];
    const out = sanitizeTodos(raw, 'T-0001');
    expect(out.map((t) => t.id)).toEqual(['T-0001-td-0', 'dup', 'T-0001-td-2', 'd1']);
    // order 一律重排为 0..n-1，忽略脏 order
    expect(out.map((t) => t.order)).toEqual([0, 1, 2, 3]);
  });

  it('非数组输入返回空数组', () => {
    expect(sanitizeTodos(undefined, 'T-0001')).toEqual([]);
    expect(sanitizeTodos('x', 'T-0001')).toEqual([]);
    expect(sanitizeTodos({}, 'T-0001')).toEqual([]);
  });
});

describe('u04 · enforceTodoOwnerConsistency 一致性（单向只增）', () => {
  it('todo.assignee 不在负责人/顾问人 → 自动并入负责人', () => {
    const tasks = [
      { owner: ['User01'], consultant: ['User02'], todos: [{ id: '1', text: 'A', done: false, order: 0, assignee: '张三' }] },
    ];
    enforceTodoOwnerConsistency(tasks);
    expect(tasks[0].owner).toEqual(['User01', '张三']);
  });

  it('大小写 / 首尾空格不敏感：已在名单内则不变', () => {
    const tasks = [
      { owner: ['User01'], consultant: [], todos: [{ id: '1', text: 'A', done: false, order: 0, assignee: ' user01 ' }] },
    ];
    enforceTodoOwnerConsistency(tasks);
    expect(tasks[0].owner).toEqual(['User01']);
  });

  it('已在顾问人内则不变', () => {
    const tasks = [
      { owner: [], consultant: ['User02'], todos: [{ id: '1', text: 'A', done: false, order: 0, assignee: 'User02' }] },
    ];
    enforceTodoOwnerConsistency(tasks);
    expect(tasks[0].owner).toEqual([]);
  });

  it('多个 todo 同一新 assignee 只并入一次', () => {
    const tasks = [
      {
        owner: ['User01'],
        consultant: [],
        todos: [
          { id: '1', text: 'A', done: false, order: 0, assignee: '张三' },
          { id: '2', text: 'B', done: false, order: 1, assignee: '张三' },
        ],
      },
    ];
    enforceTodoOwnerConsistency(tasks);
    expect(tasks[0].owner).toEqual(['User01', '张三']);
  });
});

describe('u04 · todosProgress / todosProgressText', () => {
  it('计数与文案', () => {
    const todos: TodoItem[] = [
      { id: '1', text: 'A', done: true, order: 0 },
      { id: '2', text: 'B', done: false, order: 1 },
      { id: '3', text: 'C', done: true, order: 2 },
    ];
    expect(todosProgress(todos)).toEqual({ done: 2, total: 3 });
    expect(todosProgressText(todos)).toBe('2/3');
  });

  it('空 / undefined 返回 0/0 与空串', () => {
    expect(todosProgress([])).toEqual({ done: 0, total: 0 });
    expect(todosProgress(undefined)).toEqual({ done: 0, total: 0 });
    expect(todosProgressText(undefined)).toBe('');
  });
});

describe('u04 · normalizePlan 集成', () => {
  it('assignee 不在负责人/顾问人时，normalizePlan 后自动并入负责人', () => {
    const plan = makePlan([
      {
        id: 'T-0001',
        seq: 1,
        name: '设计',
        parentId: null,
        input: { start: '2026-08-26', end: null, duration: '5d' },
        deps: [],
        owner: ['User01'],
        consultant: [],
        todos: [{ id: 'td1', text: '出原理图', done: false, order: 0, assignee: '张三' }],
      },
    ]);
    const t = plan.tasks[0];
    expect(t.owner).toEqual(['User01', '张三']);
    expect(t.todos).toHaveLength(1);
  });

  it('历史 string owner 迁移 + todos 归一化同时生效', () => {
    // 旧数据的 owner 是字符串（如 'User01,User13'），同时带 todos
    const plan = makePlan([
      {
        id: 'T-0001',
        seq: 1,
        name: '设计',
        parentId: null,
        input: { start: '2026-08-26', end: null, duration: '5d' },
        deps: [],
        // @ts-expect-error 故意喂历史 string owner
        owner: 'User01,User13',
        todos: [{ id: 'td1', text: '出原理图', done: true, order: 0 }],
      },
    ]);
    const t = plan.tasks[0];
    expect(t.owner).toEqual(['User01', 'User13']);
    expect(t.todos?.[0]).toMatchObject({ text: '出原理图', done: true });
  });

  it('assignee 与负责人/顾问人无关时仅并入 owner，不自动移除已有成员', () => {
    const plan = makePlan([
      {
        id: 'T-0001',
        seq: 1,
        name: '设计',
        parentId: null,
        input: { start: '2026-08-26', end: null, duration: '5d' },
        deps: [],
        owner: ['User01'],
        consultant: ['User02'],
        todos: [{ id: 'td1', text: '出原理图', done: false, order: 0, assignee: '张三' }],
      },
    ]);
    // 一致性只增：原 owner/consultant 全部保留，只追加张三
    expect(plan.tasks[0].owner).toEqual(['User01', '张三']);
    expect(plan.tasks[0].consultant).toEqual(['User02']);
  });
});

describe('u04 · applyTodoOp 指令纯函数', () => {
  const makeId = (() => {
    let n = 0;
    return () => `id-${++n}`;
  })();

  const seed: TodoItem[] = [
    { id: 'a', text: 'A', done: false, order: 0 },
    { id: 'b', text: 'B', done: false, order: 1 },
    { id: 'c', text: 'C', done: false, order: 2 },
  ];

  it('add：追加并重排 order；空文本不添加', () => {
    const out = applyTodoOp(seed, { op: 'add', text: '  新项  ' }, makeId);
    expect(out).toHaveLength(4);
    expect(out[3]).toMatchObject({ text: '新项', done: false, order: 3 });
    expect(applyTodoOp(seed, { op: 'add', text: '   ' }, makeId)).toHaveLength(3);
  });

  it('update：按 id 打补丁；空文本不更新', () => {
    const out = applyTodoOp(seed, { op: 'update', todoId: 'b', patch: { done: true, assignee: ' 张三 ' } }, makeId);
    expect(out[1]).toMatchObject({ done: true, assignee: '张三' });
    expect(applyTodoOp(seed, { op: 'update', todoId: 'b', patch: { text: '  ' } }, makeId)[1].text).toBe('B');
    // 不存在的 id → 原样
    expect(applyTodoOp(seed, { op: 'update', todoId: 'x', patch: { done: true } }, makeId)).toHaveLength(3);
  });

  it('delete：按 id 删除；不存在幂等', () => {
    const out = applyTodoOp(seed, { op: 'delete', todoId: 'b' }, makeId);
    expect(out.map((t) => t.id)).toEqual(['a', 'c']);
    expect(out.map((t) => t.order)).toEqual([0, 1]);
    expect(applyTodoOp(seed, { op: 'delete', todoId: 'x' }, makeId)).toHaveLength(3);
  });

  it('move：上移/下移；越界原样', () => {
    const up = applyTodoOp(seed, { op: 'move', todoId: 'c', direction: -1 }, makeId);
    expect(up.map((t) => t.id)).toEqual(['a', 'c', 'b']);
    expect(up.map((t) => t.order)).toEqual([0, 1, 2]);

    const down = applyTodoOp(seed, { op: 'move', todoId: 'a', direction: 1 }, makeId);
    expect(down.map((t) => t.id)).toEqual(['b', 'a', 'c']);

    // 越界（首项上移 / 末项下移）→ 原样
    expect(applyTodoOp(seed, { op: 'move', todoId: 'a', direction: -1 }, makeId).map((t) => t.id)).toEqual(['a', 'b', 'c']);
    expect(applyTodoOp(seed, { op: 'move', todoId: 'c', direction: 1 }, makeId).map((t) => t.id)).toEqual(['a', 'b', 'c']);
  });

  it('clear assignee：空串清除 assignee 字段', () => {
    const withAssignee: TodoItem[] = [{ id: 'a', text: 'A', done: false, order: 0, assignee: '张三' }];
    const out = applyTodoOp(withAssignee, { op: 'update', todoId: 'a', patch: { assignee: '' } }, makeId);
    expect('assignee' in out[0]).toBe(false);
  });
});
