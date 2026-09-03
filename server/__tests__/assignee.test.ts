/**
 * 增量测试 · 负责人（Assignee）落盘 / 排程隔离 / 导出 / 名单接口。
 * 覆盖任务 a·e（名单接口）、b（落盘/快照/回滚）、c（不影响排程）、d（导出含 owner）。
 * 运行：npm test
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// 必须在动态 import('../routes') 之前设置，config 在 import 时读取
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-gantt-assignee-'));
process.env.DATA_DIR = DATA_DIR;
process.env.ANCHOR_DATE = '2026-08-26';
process.env.LOCK_TIMEOUT_MS = '800';
process.env.LOCK_SWEEP_MS = '100';

import { createEmptyTask, normalizePlan, schedule } from '../../shared/scheduler';
import { BUILTIN_USERS } from '../../shared/roster';
import { SCHEMA_VERSION, type Plan, type Task } from '../../shared/types';
import { toCsv, toMsProjectXml } from '../exporters';

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
});

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

function task(id: string, name: string, patch: Partial<Task> = {}): Task {
  return { ...createEmptyTask(id, 0, null, name), ...patch };
}

function buildPlan(tasks: Task[], anchorDate = '2026-08-26'): Plan {
  return normalizePlan({
    schemaVersion: SCHEMA_VERSION,
    planId: 'p-assignee',
    name: '负责人测试计划',
    version: 3,
    createdAt: '2026-08-26T00:00:00.000Z',
    updatedAt: '2026-08-26T00:00:00.000Z',
    updatedBy: 'User01',
    nextTaskSeq: tasks.length + 1,
    calendar: { mode: 'NATURAL', anchorDate, defaultDuration: '1d', holidays: [] },
    tasks,
  });
}

/* ===================== e·GET /api/users 名单接口 ===================== */
describe('e·GET /api/users 内置名单', () => {
  it('返回 21 项且顺序与 BUILTIN_USERS 完全一致', async () => {
    const r = await api('GET', '/api/users');
    expect(r.code).toBe(0);
    expect(Array.isArray(r.data)).toBe(true);
    expect(r.data).toHaveLength(21);
    expect(r.data).toEqual([...BUILTIN_USERS]);
    expect(r.data[0]).toBe('User01');
    expect(r.data[20]).toBe('External');
    expect(r.data[18]).toBe('Group A');
    expect(r.data[13]).toBe('User14');
    expect(r.data[12]).toBe('User13');
  });
});

/* ===================== b·owner 落盘 / 快照 / 回滚 ===================== */
describe('b·owner 落盘 / 历史快照 / 回滚', () => {
  let planId = '';
  let lockToken = '';

  it('创建计划 + 抢锁', async () => {
    const c = await api('POST', '/api/plans', { name: 'owner 落盘', editor: 'User01', notes: 'v1' });
    expect(c.code).toBe(0);
    planId = c.data.planId;
    const acq = await api('POST', `/api/locks/${planId}/acquire`, { user: 'User01' });
    expect(acq.code).toBe(0);
    lockToken = acq.data.lockToken;
  });

  it('保存含 owner 的任务 → plan.json 含 owner', async () => {
    const created = (await api('GET', `/api/plans/${planId}`)).data;
    const body = {
      ...created,
      version: 1,
      tasks: [
        { id: 'T-0001', seq: 1, name: '设计', parentId: null, input: { start: '2026-08-26', end: null, duration: '5d' }, deps: [], owner: 'User01' },
        { id: 'T-0002', seq: 2, name: '开发', parentId: null, input: { start: '2026-08-31', end: null, duration: '3d' }, deps: [], owner: 'Group A' },
        { id: 'T-0003', seq: 3, name: '空负责人', parentId: null, input: { start: '2026-09-03', end: null, duration: '2d' }, deps: [], owner: '' },
      ],
    };
    const r = await api('PUT', `/api/plans/${planId}`, {
      plan: body,
      editor: 'User01',
      notes: 'set owner',
      lockToken,
      baseVersion: 1,
    });
    expect(r.code).toBe(0);
    expect(r.data.version).toBe(2);

    const saved = (await api('GET', `/api/plans/${planId}`)).data;
    const byId = Object.fromEntries(saved.tasks.map((t: Task) => [t.id, t]));
    expect(byId['T-0001'].owner).toBe('User01');
    expect(byId['T-0002'].owner).toBe('Group A');
    expect(byId['T-0003'].owner).toBe('');
  });

  it('历史快照（v2 planSnapshot）含 owner', async () => {
    const v2 = await api('GET', `/api/plans/${planId}/history/2`);
    expect(v2.code).toBe(0);
    const byId = Object.fromEntries(v2.data.planSnapshot.tasks.map((t: Task) => [t.id, t]));
    expect(byId['T-0001'].owner).toBe('User01');
    expect(byId['T-0002'].owner).toBe('Group A');
  });

  it('回滚到 v2 生成新版本，owner 仍保留', async () => {
    const restore = await api('POST', `/api/plans/${planId}/restore`, {
      version: 2,
      editor: 'User01',
      notes: '回滚',
      lockToken,
    });
    expect(restore.code).toBe(0);
    expect(restore.data.version).toBe(3);
    const after = (await api('GET', `/api/plans/${planId}`)).data;
    const byId = Object.fromEntries(after.tasks.map((t: Task) => [t.id, t]));
    expect(byId['T-0001'].owner).toBe('User01');
    expect(byId['T-0002'].owner).toBe('Group A');
  });
});

/* ===================== c·owner 不影响排程 ===================== */
describe('c·owner 不参与排程（红线）', () => {
  it('带 owner 与不带 owner 的任务排程结果完全一致', () => {
    const base = buildPlan([
      task('T-0001', 'A', { input: { start: '2026-08-26', end: null, duration: '5d' }, deps: [] }),
      task('T-0002', 'B', { input: { start: '2026-08-31', end: null, duration: '3d' }, deps: [{ predecessorId: 'T-0001', type: 'FS', lag: null, lagSign: 1, raw: '1FS' }] }),
    ]);
    const withOwner = buildPlan([
      task('T-0001', 'A', { input: { start: '2026-08-26', end: null, duration: '5d' }, deps: [], owner: 'User01' }),
      task('T-0002', 'B', { input: { start: '2026-08-31', end: null, duration: '3d' }, deps: [{ predecessorId: 'T-0001', type: 'FS', lag: null, lagSign: 1, raw: '1FS' }], owner: 'Group A' }),
    ]);

    const s1 = schedule(base);
    const s2 = schedule(withOwner);

    expect(s2.computed).toEqual(s1.computed);
    expect(s2.diagnostics).toEqual(s1.diagnostics);
    // 不产生任何与 owner 相关的诊断
    expect(s2.diagnostics.every((d) => d.field !== 'owner')).toBe(true);
  });

  it('owner 字段不出现在任何 Diagnostic 中', () => {
    const p = buildPlan([
      task('T-0001', 'A', { input: { start: '2026-08-26', end: null, duration: '5d' }, deps: [], owner: '外部张三' }),
    ]);
    const s = schedule(p);
    expect(s.diagnostics.some((d) => d.field === 'owner' || (d.message ?? '').includes('owner'))).toBe(false);
  });
});

/* ===================== d·导出含 owner ===================== */
describe('d·导出含负责人', () => {
  const plan = buildPlan([
    task('T-0001', '设计', { input: { start: '2026-08-26', end: null, duration: '5d' }, deps: [], owner: 'User01' }),
    task('T-0002', '联调', { input: { start: '2026-08-31', end: null, duration: '3d' }, deps: [], owner: 'Group A' }),
    task('T-0003', '未指派', { input: { start: '2026-09-03', end: null, duration: '2d' }, deps: [], owner: '' }),
  ]);
  const sched = schedule(plan);

  it('CSV 含「负责人」列且插入「依赖」与「来源」之间', () => {
    const csv = toCsv(plan, sched);
    const headerLine = csv.replace(/^﻿/, '').split('\r\n')[0];
    expect(headerLine).toContain('负责人');
    // 期望表头：依赖,负责人,来源（保持相对顺序）
    const idxDep = headerLine.indexOf('依赖');
    const idxOwner = headerLine.indexOf('负责人');
    const idxSrc = headerLine.indexOf('来源');
    expect(idxDep).toBeGreaterThan(-1);
    expect(idxOwner).toBeGreaterThan(idxDep);
    expect(idxSrc).toBeGreaterThan(idxOwner);
    expect(headerLine.split(',').length).toBe(12);
    // 'Group A' 含空格但无逗号 → 不被拆成两列
    expect(csv).toContain('Group A');
  });

  it('MSPDI 含 <Resources> + <Assignments>，owner 进入 ResourceName', () => {
    const xml = toMsProjectXml(plan, sched);
    expect(xml).toContain('<Resources>');
    expect(xml).toContain('<Assignments>');
    // 被使用的负责人作为资源，其名称 = 负责人
    expect(xml).toContain('<Name>User01</Name>');
    expect(xml).toContain('<Name>Group A</Name>');
    // 空 owner 任务不应生成 Assignment
    const assignmentCount = (xml.match(/<Assignment>/g) ?? []).length;
    // 仅 T-0001 / T-0002 有 owner，应为 2 条
    expect(assignmentCount).toBe(2);
  });
});
