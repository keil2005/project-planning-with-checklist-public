/**
 * server · 全局工作日历 API + 构建器单测（覆盖 T02）。
 * 直接以 routes.createApiRouter 组装 app（不触发 index.main 的端口占用与 sweeper）。
 * 数据目录指向临时目录，避免污染项目 data/。
 * 运行：npx vitest run server/__tests__/calendar-api.test.ts
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// 必须在动态 import('../routes' | '../calendarService') 之前设置，config 在 import 时读取
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-gantt-calendar-'));
process.env.DATA_DIR = DATA_DIR;
process.env.LOCK_TIMEOUT_MS = '800';
process.env.LOCK_SWEEP_MS = '100';

let server: import('node:http').Server;
let baseUrl = '';
// 动态 import，确保 config 已在 DATA_DIR 设定后加载
let calendarService: typeof import('../calendarService');

const USER = 'User01';

beforeAll(async () => {
  const express = (await import('express')).default;
  const routes = await import('../routes');
  calendarService = await import('../calendarService');
  const app = express();
  app.use(express.json({ limit: '20mb' }));
  app.use('/api', routes.createApiRouter());
  app.use(routes.errorMiddleware);
  await new Promise<void>((resolve) => {
    server = app.listen(0, resolve);
  });
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;

  // 保证测试前已种子化（首次生成 calendar.json + history 第 1 条）
  calendarService.seedIfAbsent();
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

async function acquireGlobalLock(user: string) {
  const r = await api('POST', `/api/locks/GLOBAL_CALENDAR/acquire`, { user });
  expect(r.code).toBe(0);
  return r.data.lockToken as string;
}

async function releaseGlobalLock(token: string) {
  await api('POST', `/api/locks/GLOBAL_CALENDAR/release`, { user: USER, lockToken: token });
}

const calendarPath = () => path.join(DATA_DIR, 'calendar.json');
const historyPath = () => path.join(DATA_DIR, 'calendar-history.json');

describe('T02·全局工作日历', () => {
  it('seedIfAbsent 首次生成 calendar.json：v1 / makeup[2026] 6 项 / coveredYears=[2026] / history 1 条', () => {
    const cfg = calendarService.seedIfAbsent(); // 幂等：第二次返回已存在文件
    expect(cfg.version).toBe(1);
    expect(cfg.makeup['2026']).toHaveLength(6);
    expect(cfg.coveredYears).toEqual([2026]);

    const hist = JSON.parse(fs.readFileSync(historyPath(), 'utf8'));
    expect(hist.versions).toHaveLength(1);
    expect(hist.versions[0].version).toBe(1);
    expect(hist.versions[0].editor).toBe('system');
    expect(hist.versions[0].summary).toContain('初始化');
    expect(hist.versions[0].configSnapshot.version).toBe(1);
  });

  it('GET /api/calendar → code:0，结构完整', async () => {
    const r = await api('GET', '/api/calendar');
    expect(r.code).toBe(0);
    expect(r.data.schemaVersion).toBe(1);
    expect(r.data.coveredYears).toEqual([2026]);
    expect(Array.isArray(r.data.makeup['2026'])).toBe(true);
    expect(Array.isArray(r.data.userHolidays['2026'])).toBe(true);
    expect(Array.isArray(r.data.userRemoved['2026'])).toBe(true);
  });

  it('PUT /api/calendar 未持锁 → 2002 或 2003', async () => {
    const cfg = (await api('GET', '/api/calendar')).data;
    const r = await api('PUT', '/api/calendar', {
      editor: USER,
      lockToken: '',
      config: cfg,
    });
    expect([2002, 2003]).toContain(r.code);
  });

  it('PUT /api/calendar 持锁提交 → v2，history 变 2 条且首条仍在（append-only）', async () => {
    const token = await acquireGlobalLock(USER);
    const cfg = (await api('GET', '/api/calendar')).data;
    cfg.userHolidays['2026'] = ['2026-03-10'];

    const r = await api('PUT', '/api/calendar', {
      editor: USER,
      lockToken: token,
      config: cfg,
      summary: '新增自定义假日',
    });
    expect(r.code).toBe(0);
    expect(r.data.version).toBe(2);

    const hist = JSON.parse(fs.readFileSync(historyPath(), 'utf8'));
    expect(hist.versions).toHaveLength(2);
    expect(hist.versions[0].version).toBe(1); // 首条仍在
    expect(hist.versions[0].editor).toBe('system');

    await releaseGlobalLock(token);
  });

  it('PUT /api/calendar 结构非法（日期 2026-13-45）→ 400(1001)', async () => {
    const token = await acquireGlobalLock(USER);
    const cfg = (await api('GET', '/api/calendar')).data;
    cfg.userHolidays['2026'] = ['2026-13-45'];

    const r = await api('PUT', '/api/calendar', {
      editor: USER,
      lockToken: token,
      config: cfg,
    });
    expect(r.code).toBe(1001); // ERR_VALIDATION → 400

    await releaseGlobalLock(token);
  });

  it('buildWorkCalendar：userRemoved / userHolidays / 补班 判定正确', async () => {
    const { buildWorkCalendar } = await import('../../shared/calendar-build');
    const base = calendarService.readCalendar();

    // A) 用户取消 2026-02-16（春节假日）→ 变为工作日
    const cfgA = {
      ...base,
      userRemoved: { ...base.userRemoved, 2026: ['2026-02-16'] },
    };
    expect(buildWorkCalendar(cfgA).isWorking('2026-02-16')).toBe(true);

    // B) 用户新增自定义假日 2026-03-10 → 非工作日
    const cfgB = {
      ...base,
      userHolidays: { ...base.userHolidays, 2026: ['2026-03-10'] },
    };
    expect(buildWorkCalendar(cfgB).isWorking('2026-03-10')).toBe(false);

    // C) 补班日 2026-10-10（周六）→ 工作日且 labelOf 为 null
    const cal = buildWorkCalendar(base);
    expect(cal.isWorking('2026-10-10')).toBe(true);
    expect(cal.labelOf('2026-10-10')).toBe(null);
    // 内置法定假日标签可用
    expect(cal.labelOf('2026-01-01')).toBe('元旦');
    // 补班日不算假日（不着色）
    expect(cal.isHoliday('2026-10-10')).toBe(false);
  });
});
