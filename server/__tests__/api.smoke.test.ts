/**
 * server · HTTP 冒烟 + 版本历史测试（覆盖任务 c + e）。
 * 直接以 routes.createApiRouter 组装 app（不触发 index.main 的端口占用与 sweeper）。
 * 数据目录指向临时目录，避免污染项目 data/。
 * 运行：npm test
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// 必须在动态 import('../routes') 之前设置，config 在 import 时读取
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-gantt-smoke-'));
process.env.DATA_DIR = DATA_DIR;
process.env.ANCHOR_DATE = '2026-08-26';
process.env.LOCK_TIMEOUT_MS = '800';
process.env.LOCK_SWEEP_MS = '100';

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

let planId = '';
let lockToken = '';

describe('c+e·HTTP 冒烟与版本历史', () => {
  it('GET /api/health → ok', async () => {
    const r = await api('GET', '/api/health');
    expect(r.code).toBe(0);
    expect(r.data.ok).toBe(true);
    expect(typeof r.data.dataDir).toBe('string');
  });

  it('GET /api/users → 返回空数组（v1.2.0 起人员名单来自 workspace members，邀请制）', async () => {
    const r = await api('GET', '/api/users');
    expect(r.code).toBe(0);
    expect(Array.isArray(r.data)).toBe(true);
    expect(r.data).toHaveLength(0);
  });

  it('POST /api/plans（带 notes）→ 创建 v1', async () => {
    const r = await api('POST', '/api/plans', { name: '冒烟计划', editor: 'Alice', notes: '初始版本' });
    expect(r.code).toBe(0);
    expect(r.data.planId).toMatch(/^p-/);
    expect(r.data.version).toBe(1);
    planId = r.data.planId;
  });

  it('POST /api/plans（skipHolidays=true）→ calendar.skipHolidays 写入', async () => {
    const r = await api('POST', '/api/plans', {
      name: '跳过节假日计划',
      editor: 'Alice',
      notes: '开启真实日历',
      skipHolidays: true,
    });
    expect(r.code).toBe(0);
    expect(r.data.calendar?.skipHolidays).toBe(true);
  });

  it('POST /api/plans 缺省 skipHolidays → 默认 false', async () => {
    const r = await api('POST', '/api/plans', { name: '全工作日计划', editor: 'Alice', notes: '默认' });
    expect(r.code).toBe(0);
    expect(r.data.calendar?.skipHolidays).toBe(false);
  });

  it('POST /api/plans 缺 notes → 1002', async () => {
    const r = await api('POST', '/api/plans', { name: 'x', editor: 'Alice', notes: '   ' });
    expect(r.code).toBe(1002);
  });

  it('acquire 锁成功（含 lockToken）', async () => {
    const r = await api('POST', `/api/locks/${planId}/acquire`, { user: 'Alice' });
    expect(r.code).toBe(0);
    expect(r.data.status).toBe('EDITING');
    expect(r.data.holder).toBe('Alice');
    expect(typeof r.data.lockToken).toBe('string');
    lockToken = r.data.lockToken;
  });

  it('他人 acquire → 409 / 2001（编辑权被持有）', async () => {
    const r = await api('POST', `/api/locks/${planId}/acquire`, { user: 'Bob' });
    expect(r.status).toBe(409);
    expect(r.code).toBe(2001);
  });

  it('PUT /api/plans/:id 保存（带 notes + 任务 + 依赖）→ 生成 v2', async () => {
    const created = (await api('GET', `/api/plans/${planId}`)).data;
    const body = {
      ...created,
      version: 1,
      tasks: [
        { id: 'T-0001', seq: 1, name: '需求分析', parentId: null, input: { start: '2026-08-26', end: null, duration: '5d' }, deps: [] },
        {
          id: 'T-0002',
          seq: 2,
          name: '设计',
          parentId: null,
          input: { start: '2026-08-31', end: null, duration: '3d' },
          deps: [{ predecessorId: 'T-0001', type: 'FS', lag: null, lagSign: 1, raw: '1FS' }],
        },
      ],
    };
    const r = await api('PUT', `/api/plans/${planId}`, {
      plan: body,
      editor: 'Alice',
      notes: '录入需求与设计',
      lockToken,
      baseVersion: 1,
    });
    expect(r.code).toBe(0);
    expect(r.data.version).toBe(2);
  });

  it('PUT 缺 notes → 1002（服务端二次校验）', async () => {
    const created = (await api('GET', `/api/plans/${planId}`)).data;
    const body = { ...created, version: 2, tasks: created.tasks };
    const r = await api('PUT', `/api/plans/${planId}`, {
      plan: body,
      editor: 'Alice',
      notes: '',
      lockToken,
      baseVersion: 2,
    });
    expect(r.code).toBe(1002);
  });

  it('GET /export?format=xml → 含日历/Start/PredecessorLink', async () => {
    const res = await fetch(`${baseUrl}/api/plans/${planId}/export?format=xml`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/xml');
    const xml = await res.text();
    // T03：导出应使用真实工作日历（单一真源），日历名不再是 Natural(7x8h)
    expect(xml).toContain('WorkCalendar(5d×8h)');
    // 周末非工作（<DayType>1</DayType> 周日 + <DayWorking>0</DayWorking>）
    expect(xml).toContain('<DayType>1</DayType>');
    expect(xml).toContain('<DayWorking>0</DayWorking>');
    expect(xml).toContain('<Start>');
    expect(xml).toContain('<PredecessorLink>');
    expect(xml).toContain('<Type>1</Type>'); // FS
  });

  it('GET /export?format=csv → 含 UTF-8 BOM', async () => {
    const res = await fetch(`${baseUrl}/api/plans/${planId}/export?format=csv`);
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf[0]).toBe(0xef);
    expect(buf[1]).toBe(0xbb);
    expect(buf[2]).toBe(0xbf);
  });

  it('release 锁 → ok，状态 IDLE', async () => {
    const r = await api('POST', `/api/locks/${planId}/release`, { user: 'Alice', lockToken });
    expect(r.code).toBe(0);
    const st = await api('GET', `/api/locks/${planId}`);
    expect(st.data.status).toBe('IDLE');
  });

  it('GET /history → 含 v1、v2', async () => {
    const r = await api('GET', `/api/plans/${planId}/history`);
    expect(r.code).toBe(0);
    const versions = r.data.map((v: any) => v.version).sort();
    expect(versions).toEqual([1, 2]);
  });

  it('POST /restore 回滚 v1 → 生成新版本（旧版本不丢）', async () => {
    // 重新抢锁
    const acq = await api('POST', `/api/locks/${planId}/acquire`, { user: 'Carol' });
    expect(acq.code).toBe(0);
    const token = acq.data.lockToken;

    const r = await api('POST', `/api/plans/${planId}/restore`, {
      version: 1,
      editor: 'Carol',
      notes: '回滚测试',
      lockToken: token,
    });
    expect(r.code).toBe(0);
    expect(r.data.version).toBe(3); // 回滚生成新版本

    // 历史仍包含 v1 与 v2（append-only，旧版本不丢）
    const hist = await api('GET', `/api/plans/${planId}/history`);
    const versions = hist.data.map((v: any) => v.version).sort();
    expect(versions).toEqual([1, 2, 3]);

    // 回滚版本 notes 带 "[回滚自 v1]" 前缀（前缀加在版本 notes，不改计划名）
    const v3 = await api('GET', `/api/plans/${planId}/history/3`);
    expect(v3.code).toBe(0);
    expect(v3.data.notes).toContain('[回滚自 v1]');

    // 旧 v1 快照仍可读
    const v1 = await api('GET', `/api/plans/${planId}/history/1`);
    expect(v1.code).toBe(0);
    expect(v1.data.version).toBe(1);

    await api('POST', `/api/locks/${planId}/release`, { user: 'Carol', lockToken: token });
  });

  it('GET /plans → 列表包含本计划', async () => {
    const r = await api('GET', '/api/plans');
    expect(r.code).toBe(0);
    expect(r.data.some((p: any) => p.planId === planId)).toBe(true);
  });
});
