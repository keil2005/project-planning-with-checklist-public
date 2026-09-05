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
        { id: 'T-0001', seq: 1, name: '设计', parentId: null, input: { start: '2026-08-26', end: null, duration: '5d' }, deps: [], owner: ['User01'] },
        { id: 'T-0002', seq: 2, name: '开发', parentId: null, input: { start: '2026-08-31', end: null, duration: '3d' }, deps: [], owner: ['Group A'], consultant: ['User02', 'User03'] },
        { id: 'T-0003', seq: 3, name: '空负责人', parentId: null, input: { start: '2026-09-03', end: null, duration: '2d' }, deps: [], owner: [] },
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
    expect(byId['T-0001'].owner).toEqual(['User01']);
    expect(byId['T-0002'].owner).toEqual(['Group A']);
    expect(byId['T-0002'].consultant).toEqual(['User02', 'User03']);
    expect(byId['T-0003'].owner).toEqual([]);
    expect(byId['T-0003'].consultant).toEqual([]);
  });

  it('历史快照（v2 planSnapshot）含 owner', async () => {
    const v2 = await api('GET', `/api/plans/${planId}/history/2`);
    expect(v2.code).toBe(0);
    const byId = Object.fromEntries(v2.data.planSnapshot.tasks.map((t: Task) => [t.id, t]));
    expect(byId['T-0001'].owner).toEqual(['User01']);
    expect(byId['T-0002'].owner).toEqual(['Group A']);
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
    expect(byId['T-0001'].owner).toEqual(['User01']);
    expect(byId['T-0002'].owner).toEqual(['Group A']);
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
      task('T-0001', 'A', { input: { start: '2026-08-26', end: null, duration: '5d' }, deps: [], owner: ['User01'] }),
      task('T-0002', 'B', { input: { start: '2026-08-31', end: null, duration: '3d' }, deps: [{ predecessorId: 'T-0001', type: 'FS', lag: null, lagSign: 1, raw: '1FS' }], owner: ['Group A'], consultant: ['User02'] }),
    ]);

    const s1 = schedule(base);
    const s2 = schedule(withOwner);

    expect(s2.computed).toEqual(s1.computed);
    expect(s2.diagnostics).toEqual(s1.diagnostics);
    // 不产生任何与人员字段相关的诊断（TaskField 已不含人员字段，这里额外兜底看 message）
    expect(s2.diagnostics.every((d) => !(d.message ?? '').includes('负责人') && !(d.message ?? '').includes('顾问人'))).toBe(true);
  });

  it('owner 字段不出现在任何 Diagnostic 中', () => {
    const p = buildPlan([
      task('T-0001', 'A', { input: { start: '2026-08-26', end: null, duration: '5d' }, deps: [], owner: ['外部张三'], consultant: ['外部李四'] }),
    ]);
    const s = schedule(p);
    expect(s.diagnostics.some((d) => (d.message ?? '').includes('负责人') || (d.message ?? '').includes('顾问人'))).toBe(false);
  });
});

/* ===================== d·导出含 owner ===================== */
describe('d·导出含负责人', () => {
  const plan = buildPlan([
    task('T-0001', '设计', { input: { start: '2026-08-26', end: null, duration: '5d' }, deps: [], owner: ['User01', 'User02'], consultant: ['User13'] }),
    task('T-0002', '联调', { input: { start: '2026-08-31', end: null, duration: '3d' }, deps: [], owner: ['Group A'] }),
    task('T-0003', '未指派', { input: { start: '2026-09-03', end: null, duration: '2d' }, deps: [], owner: [] }),
  ]);
  const sched = schedule(plan);

  it('CSV 含「负责人」「顾问人」列，顺序插在「依赖」与「来源」之间', () => {
    const csv = toCsv(plan, sched);
    const headerLine = csv.replace(/^﻿/, '').split('\r\n')[0];
    expect(headerLine).toContain('负责人');
    expect(headerLine).toContain('顾问人');
    // 期望表头：依赖,负责人,顾问人,来源（保持相对顺序）
    const idxDep = headerLine.indexOf('依赖');
    const idxOwner = headerLine.indexOf('负责人');
    const idxConsultant = headerLine.indexOf('顾问人');
    const idxSrc = headerLine.indexOf('来源');
    expect(idxDep).toBeGreaterThan(-1);
    expect(idxOwner).toBeGreaterThan(idxDep);
    expect(idxConsultant).toBeGreaterThan(idxOwner);
    expect(idxSrc).toBeGreaterThan(idxConsultant);
    expect(headerLine.split(',').length).toBe(14);
    // 'Group A' 含空格但无逗号 → 不被拆成两列
    expect(csv).toContain('Group A');
    // 多人用顿号拼接，不用逗号（否则会撑出额外 CSV 列）
    expect(csv).toContain('User01、User02');
    expect(csv).toContain('User13');
  });

  it('MSPDI 里顾问人只进 Notes，不生成 Resource / Assignment', () => {
    const xml = toMsProjectXml(plan, sched);
    // 顾问人 User13 不应成为资源
    const resourceNames = [...xml.matchAll(/<Resources>[\s\S]*?<\/Resources>/g)]
      .map((m) => m[0])
      .join('');
    expect(resourceNames).toContain('<Name>User01</Name>');
    expect(resourceNames).toContain('<Name>User02</Name>');
    expect(resourceNames).not.toContain('<Name>User13</Name>');
    // 但信息不丢：写进任务 Notes
    expect(xml).toContain('顾问人：User13');
  });

  it('MSPDI 含 <Resources> + <Assignments>，owner 进入 ResourceName', () => {
    const xml = toMsProjectXml(plan, sched);
    expect(xml).toContain('<Resources>');
    expect(xml).toContain('<Assignments>');
    // 被使用的负责人作为资源，其名称 = 负责人
    expect(xml).toContain('<Name>User01</Name>');
    expect(xml).toContain('<Name>Group A</Name>');
    // 空 owner 任务不应生成 Assignment。
    // T-0001 有 2 个负责人（User01 / User02）→ 2 条；T-0002 一个（Group A）→ 1 条；共 3 条。
    const assignmentCount = (xml.match(/<Assignment>/g) ?? []).length;
    expect(assignmentCount).toBe(3);
  });
});
