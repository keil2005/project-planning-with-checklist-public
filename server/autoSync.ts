/**
 * server/autoSync.ts —— 保存后自动同步到共享端（仅 Mac 本地开发机，config.autoSync.enabled）。
 *
 * 同步两处（每次全量）：
 *   1) DATA_DIR/plans/<planId>/ → <shareDataDir>/plans/<planId>/   （共享端程序读取位置）
 *   2) 三件套（CSV / MSPDI XML / plan.json）→ <shareExportDir>/    （团队 Excel / MS Project）
 *
 * 设计要点：
 *   - 防抖：debounceMs 内多次保存合并为一次同步。
 *   - 异步执行，失败不阻断保存（仅告警日志）。
 *   - 共享端 / Windows 不开启（config.autoSync.enabled 默认 false），且 Windows 无 rsync，
 *     所以本模块只在 Mac 本地通过 config/app.config.local.json 显式开启后才生效。
 *   - rsync 一律 --inplace（SMB 不支持原子 rename，否则留 .临时文件 残留）；
 *     三件套目标用 --delete 清旧版本号残留。
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildWorkCalendar } from '../shared/calendar-build';
import { normalizePlan, schedule } from '../shared/scheduler';
import type { Plan, ScheduleResult, TodoItem, WorkCalendar } from '../shared/types';
import * as calendarService from './calendarService';
import { config, planDir, scheduleOptionsFromConfig } from './config';
import { exportFileName, toCsv, toMsProjectXml } from './exporters';
import { planRepo, todoRepo } from './storage';

/** 与 routes.readPlanFresh 同语义：合并最新 todos 回 plan（todo 独立资源方案 B） */
function readPlanFresh(planId: string): Plan {
  const plan = planRepo.readPlan(planId);
  const byTask = todoRepo.snapshot(planId).byTask;
  return normalizePlan({
    ...plan,
    tasks: plan.tasks.map((t) => ({
      ...t,
      todos: Array.isArray(byTask[t.id]) ? (byTask[t.id] as TodoItem[]) : [],
    })),
  });
}

/** 服务端权威排程（与 routes.schedulePlan 同口径，保证导出日期/工期一致） */
function schedulePlan(plan: Plan, cal: WorkCalendar): ScheduleResult {
  const opts = scheduleOptionsFromConfig();
  return schedule(plan, {
    anchorDate: plan.calendar?.anchorDate ?? opts.anchorDate,
    defaultDuration: plan.calendar?.defaultDuration ?? opts.defaultDuration,
    calendar: cal,
  });
}

function runRsync(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('rsync', args, (err, _stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve();
    });
  });
}

/** 同步 plan 目录（plan.json + history.json + todos.json）到共享端 data/plans/ */
async function syncPlanDir(planId: string): Promise<void> {
  const src = planDir(planId);
  const dest = path.join(config.autoSync.shareDataDir, 'plans', planId);
  await runRsync(['-a', '--delete', '--inplace', `${src}/`, `${dest}/`]);
}

/** 生成三件套并同步到共享端 export 目录 */
async function syncExports(planId: string): Promise<void> {
  const plan = readPlanFresh(planId);
  const cal = buildWorkCalendar(calendarService.readCalendar());
  const sched = schedulePlan(plan, cal);

  const csv = toCsv(plan, sched);
  const xml = toMsProjectXml(plan, sched, cal);
  const planJson = JSON.stringify(plan, null, 2) + '\n';

  // 文件名与 sync-to-share.sh 三件套一致：{name}-v{version}.csv/.xml/.plan.json
  const csvName = exportFileName(plan, 'csv');
  const xmlName = exportFileName(plan, 'mspdi');
  const planJsonName = csvName.replace(/\.csv$/, '.plan.json');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-sync-'));
  try {
    fs.writeFileSync(path.join(tmp, csvName), csv, 'utf8');
    fs.writeFileSync(path.join(tmp, xmlName), xml, 'utf8');
    fs.writeFileSync(path.join(tmp, planJsonName), planJson, 'utf8');
    await runRsync(['-a', '--delete', '--inplace', `${tmp}/`, `${config.autoSync.shareExportDir}/`]);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function doSync(planId: string): Promise<void> {
  try {
    await syncPlanDir(planId);
    await syncExports(planId);
    console.info(`[autoSync] 已同步 ${planId} 到共享端`);
  } catch (e) {
    console.warn(`[autoSync] 同步 ${planId} 失败：${String(e)}`);
  }
}

/** 该计划是否在同步范围（enabled + 名字匹配） */
function shouldSync(planId: string): boolean {
  if (!config.autoSync.enabled || config.autoSync.planNames.length === 0) return false;
  const plan = planRepo.readPlan(planId);
  return config.autoSync.planNames.includes(plan.name);
}

/** 每 planId 一个防抖 timer */
const pending = new Map<string, NodeJS.Timeout>();

/** 计划变更通知（保存 / 回滚 / todo 变更后调用）；防抖合并 */
export function notifyPlanChanged(planId: string): void {
  if (!shouldSync(planId)) return;
  const prev = pending.get(planId);
  if (prev) clearTimeout(prev);
  const t = setTimeout(() => {
    pending.delete(planId);
    void doSync(planId);
  }, config.autoSync.debounceMs);
  pending.set(planId, t);
}
