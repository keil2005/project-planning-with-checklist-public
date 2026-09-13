/**
 * server · demoSeed 守护（v1.4.1+ 历史 schema 与计划 schema 拆分后回归点）。
 *
 * 旧 bug：`server/demoSeed.ts` 写入 history.json 时错误地用了
 *   `schemaVersion: SCHEMA_VERSION`（=2）。`migrateHistory` 按
 *   `HISTORY_SCHEMA_VERSION`（=1）校验，导致首次 PUT 后读历史抛 ERR_INTERNAL (5000)。
 *
 * 本测试 **不会** 启动 express，直接调 `seedDemoPlanIfEmpty` + 走 `historyRepo.readHistoryMeta`
 * 完整闭环：seed 写入 → repo 读取 → 校验 schemaVersion 单调一致。
 *
 * 运行：npm test
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

// 必须在 config.demoSeed 动态 import 之前设置 DATA_DIR；ANCHOR_DATE 顺手兜底
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-gantt-demoseed-'));
process.env.DATA_DIR = DATA_DIR;
process.env.ANCHOR_DATE = '2026-08-26';
process.env.LOCK_TIMEOUT_MS = '800';
process.env.LOCK_SWEEP_MS = '100';

import { HISTORY_SCHEMA_VERSION, SCHEMA_VERSION } from '../../shared/types';

let planId: string;
let seedTs: { wsId: string; createdBy: string };
let readHistoryMeta: typeof import('../storage').historyRepo.readHistoryMeta;

beforeAll(async () => {
  // demoSeed 只在 plans/ 空时才注入；DATA_DIR 是新建空目录，自动满足
  const demoSeed = await import('../demoSeed');
  const result = demoSeed.seedDemoPlanIfEmpty('ws-test', 'seed-bot');
  expect(result.seeded).toBe(true);
  planId = result.plansCreated[0];

  // 同时也确保 storage 端的 historyRepo 在同一 DATA_DIR 下能正常读出 seed
  const storage = await import('../storage');
  readHistoryMeta = storage.historyRepo.readHistoryMeta.bind(storage.historyRepo);
  seedTs = { wsId: 'ws-test', createdBy: 'seed-bot' };
});

describe('demoSeed schemaVersion discipline', () => {
  it('计划 schemaVersion 与 HISTORY_SCHEMA_VERSION 解耦（防止旧 bug 复燃）', () => {
    // 本断言是「防止退化」的语义前置：v1.4.1 起二者刻意分家，常见误改是再并回去
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(2);
    expect(HISTORY_SCHEMA_VERSION).toBe(1);
    // 真实磁盘字段同样必须用正确常量；任何混淆就立刻 500
    const planFilePath = path.join(DATA_DIR, 'plans', planId, 'plan.json');
    const histFilePath = path.join(DATA_DIR, 'plans', planId, 'history.json');
    const plan = JSON.parse(fs.readFileSync(planFilePath, 'utf8'));
    const hist = JSON.parse(fs.readFileSync(histFilePath, 'utf8'));
    expect(plan.schemaVersion).toBe(SCHEMA_VERSION);
    expect(hist.schemaVersion).toBe(HISTORY_SCHEMA_VERSION);
  });

  it('historyRepo 可读出 seed 的 v1（最简闭环：migrateHistory 不抛 5000）', () => {
    // 真读一次：history.json 必须能解出来，否则就是 migrateHistory 抛 5000 的同款 bug
    const meta = readHistoryMeta(planId);
    expect(Array.isArray(meta)).toBe(true);
    expect(meta.length).toBe(1);
    expect(meta[0].version).toBe(1);
    expect(meta[0].notes).toMatch(/demo seed/);
  });
});
