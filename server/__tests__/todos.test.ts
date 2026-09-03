/**
 * server · todo 独立资源（方案 B「多人并发编辑 todo」）测试。
 *
 * 核心断言：
 *   1. todo 指令（add/update/delete/move）不要求排他锁，任何登录用户可操作；
 *   2. 并发交错写（A、B 交替操作不同/相同 todo）不丢更新，revision 单调递增；
 *   3. assignee 自动并入 owner（读 plan 时派生，无需 save plan）；
 *   4. save plan 用最新 todos 覆盖提交里的 todos，不覆盖并发 todo 修改。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// 必须在动态 import('../routes') 之前设置，config 在 import 时读取
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-gantt-todos-'));
process.env.DATA_DIR = DATA_DIR;
process.env.ANCHOR_DATE = '2026-08-26';

let server: import('node:http').Server;
let baseUrl = '';

beforeAll(async () => {
  const express = (await import('express')).default;
  const { createApiRouter, errorMiddleware } = await import('../routes');
  const app = express();
  app.use(express.json({ limit: '20mb' }));
  app.use('/api', createApiRouter());
  app.use(errorMiddleware);
  await new Promise<void>((resolve) => {
    server = app.listen(0, resolve);
  });
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
}, 60_000);

afterAll(() => {
  if (server) server.close();
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

async function api(method: string, p: string, body?: unknown) {
  const res = await fetch(baseUrl + p, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json()) as { code: number; data: any; message: string };
  return { status: res.status, code: data.code, data: data.data, message: data.message };
}

let planId = '';

async function createPlanWithTask(): Promise<string> {
  const created = await api('POST', '/api/plans', { name: 'todo 并发计划', editor: 'Alice', notes: '初始版本' });
  expect(created.code).toBe(0);
  planId = created.data.planId;
  const acq = await api('POST', `/api/locks/${planId}/acquire`, { user: 'Alice' });
  const token = acq.data.lockToken;
  const body = {
    ...created.data,
    version: 1,
    tasks: [
      { id: 'T-0001', seq: 1, name: '需求分析', parentId: null, input: { start: '2026-08-26', end: null, duration: '5d' }, deps: [] },
      { id: 'T-0002', seq: 2, name: '设计', parentId: null, input: { start: '2026-08-31', end: null, duration: '3d' }, deps: [] },
    ],
  };
  const saved = await api('PUT', `/api/plans/${planId}`, {
    plan: body,
    editor: 'Alice',
    notes: '录入两个任务',
    lockToken: token,
    baseVersion: 1,
  });
  expect(saved.code).toBe(0);
  await api('POST', `/api/locks/${planId}/release`, { user: 'Alice', lockToken: token });
  return token;
}

describe('todo 独立资源（多人并发）', () => {
  it('建立带任务计划', async () => {
    await createPlanWithTask();
    expect(planId).toMatch(/^p-/);
  });

  it('不持锁也能 add / update / delete / move（任何人可操作）', async () => {
    // add 两条（不抢锁，直接操作）
    const add1 = await api('POST', `/api/plans/${planId}/tasks/T-0001/todos`, { user: 'Bob', op: { op: 'add', text: '出原理图' } });
    expect(add1.code).toBe(0);
    expect(add1.data.todos).toHaveLength(1);
    expect(add1.data.todos[0].text).toBe('出原理图');

    const add2 = await api('POST', `/api/plans/${planId}/tasks/T-0001/todos`, { user: 'Carol', op: { op: 'add', text: '出BOM' } });
    expect(add2.code).toBe(0);
    expect(add2.data.todos).toHaveLength(2);

    const id0 = add1.data.todos[0].id;
    const id1 = add2.data.todos[1].id;

    // update：勾选第一条
    const upd = await api('POST', `/api/plans/${planId}/tasks/T-0001/todos`, {
      user: 'Bob',
      op: { op: 'update', todoId: id0, patch: { done: true } },
    });
    expect(upd.code).toBe(0);
    expect(upd.data.todos.find((t: any) => t.id === id0).done).toBe(true);

    // move：把第二条上移
    const mv = await api('POST', `/api/plans/${planId}/tasks/T-0001/todos`, {
      user: 'Carol',
      op: { op: 'move', todoId: id1, direction: -1 },
    });
    expect(mv.code).toBe(0);
    expect(mv.data.todos[0].id).toBe(id1);
    expect(mv.data.todos[0].order).toBe(0);

    // delete：删掉第一条
    const del = await api('POST', `/api/plans/${planId}/tasks/T-0001/todos`, {
      user: 'Bob',
      op: { op: 'delete', todoId: id0 },
    });
    expect(del.code).toBe(0);
    expect(del.data.todos).toHaveLength(1);
    expect(del.data.todos[0].id).toBe(id1);
  });

  it('revision 单调递增；并发交错写不丢更新', async () => {
    const before = await api('GET', `/api/plans/${planId}/todos`);
    const r0 = before.data.revision as number;

    // A、B 交替向两个不同任务写，各自 revision 递增
    const a = await api('POST', `/api/plans/${planId}/tasks/T-0001/todos`, { user: 'Alice', op: { op: 'add', text: 'A 的项' } });
    const b = await api('POST', `/api/plans/${planId}/tasks/T-0002/todos`, { user: 'Bob', op: { op: 'add', text: 'B 的项' } });
    const after = await api('GET', `/api/plans/${planId}/todos`);

    expect(a.data.revision).toBeGreaterThan(r0);
    expect(b.data.revision).toBe(a.data.revision + 1);
    expect(after.data.revision).toBe(b.data.revision);
    // 两个任务的 todo 都保留（互不覆盖）
    expect(after.data.byTask['T-0001'].some((t: any) => t.text === 'A 的项')).toBe(true);
    expect(after.data.byTask['T-0002'].some((t: any) => t.text === 'B 的项')).toBe(true);
  });

  it('assignee 自动并入 owner（读 plan 派生，无需 save）', async () => {
    // 给 T-0001 的 todo 指派一个不在负责人里的人
    const get = await api('GET', `/api/plans/${planId}/todos`);
    const todoId = get.data.byTask['T-0001'][0].id;
    const upd = await api('POST', `/api/plans/${planId}/tasks/T-0001/todos`, {
      user: 'Carol',
      op: { op: 'update', todoId, patch: { assignee: '张工' } },
    });
    expect(upd.code).toBe(0);

    // 读 plan：owner 应含「张工」（派生并集，无需 save plan）
    const plan = await api('GET', `/api/plans/${planId}`);
    const task1 = plan.data.tasks.find((t: any) => t.id === 'T-0001');
    expect(task1.owner).toContain('张工');
    // todo 也合并到 plan.tasks[].todos
    expect(task1.todos.some((t: any) => t.assignee === '张工')).toBe(true);
  });

  it('save plan 不覆盖并发 todo 修改（用最新 todos 合并）', async () => {
    // 模拟：Alice 拿到 plan 后（此刻 todos 快照），Bob 又加了一条 todo
    const stalePlan = (await api('GET', `/api/plans/${planId}`)).data;
    // Bob 并发加一条
    const add = await api('POST', `/api/plans/${planId}/tasks/T-0001/todos`, { user: 'Bob', op: { op: 'add', text: 'Bob 并发新增' } });
    expect(add.code).toBe(0);

    // Alice 保存（提交的是旧 todos 快照）
    const acq = await api('POST', `/api/locks/${planId}/acquire`, { user: 'Alice' });
    const token = acq.data.lockToken;
    const saved = await api('PUT', `/api/plans/${planId}`, {
      plan: { ...stalePlan, version: stalePlan.version },
      editor: 'Alice',
      notes: 'Alice 正常保存',
      lockToken: token,
      baseVersion: stalePlan.version,
    });
    expect(saved.code).toBe(0);
    await api('POST', `/api/locks/${planId}/release`, { user: 'Alice', lockToken: token });

    // Bob 并发加的 todo 仍在（未被 Alice 的旧快照覆盖）
    const after = await api('GET', `/api/plans/${planId}/todos`);
    expect(after.data.byTask['T-0001'].some((t: any) => t.text === 'Bob 并发新增')).toBe(true);
  });

  it('非法指令 / 不存在任务 → 校验错误', async () => {
    const bad = await api('POST', `/api/plans/${planId}/tasks/T-0001/todos`, { user: 'Alice', op: { op: 'nope' } });
    expect(bad.code).toBe(1001);

    const noTask = await api('POST', `/api/plans/${planId}/tasks/T-9999/todos`, { user: 'Alice', op: { op: 'add', text: 'x' } });
    expect(noTask.code).toBe(1001);
  });
});
