/**
 * server/demoSeed.ts —— 首次启动自动注入演示数据。
 *
 * 数据虚构规则（PRIVACY-1）：**严禁**包含真实业务代号（任何真实项目/客户/产品）。
 * 演示项目代号：Toy Race Car（虚构玩具赛车产品开发）。
 *
 * 触发条件：
 *   - DATA_DIR 完全空（新装）
 *   - 已有至少一个 admin 用户（由 env ADMIN_USER/PASSWORD 自举）
 *   - demo workspace 是首个 workspace
 *
 * 注入内容：
 *   - Toy Race Car 计划（12 任务 + 4 todo）
 *     涵盖：概念 → 设计 → 工程样机 → 测试 → 认证 → 量产 → 上市
 *   - 2 个演示用户（invitee1 / invitee2，owner/editor）
 */

import fs from 'node:fs';
import path from 'node:path';
import { config } from './config';
import { planFile, historyFile, todosFile } from './config';
import { SCHEMA_VERSION, type Plan } from '../shared/types';
import { normalizePlan } from '../shared/scheduler';
import { applyTodoOp, makeTodoId } from '../shared/todo';
import { nowTimestamp } from '../shared/datetime';

const SEED_PLAN_NAME = 'Toy Race Car';

interface SeedResult {
  seeded: boolean;
  plansCreated: string[];
  reason?: string;
}

function workspacePlansDir(_workspaceId: string): string {
  // 开源版 v1.0：单 workspace 模式（DATA_DIR 直接存 plans，workspaceId 仅作元信息）
  // v1.1 起改为 data/workspaces/<wsId>/plans/<planId>/
  return path.join(config.dataDir, 'plans');
}

function atomicWriteJson(file: string, obj: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(obj, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, file);
}

/** 主入口：检查是否需要 seed，若需要就注入 */
export function seedDemoPlanIfEmpty(
  workspaceId: string,
  createdBy: string,
): SeedResult {
  const root = workspacePlansDir(workspaceId);
  // 已有任何 plan 目录就不 seed
  if (fs.existsSync(root)) {
    const existing = fs.readdirSync(root).filter((d) => {
      const full = path.join(root, d);
      return fs.statSync(full).isDirectory();
    });
    if (existing.length > 0) {
      return { seeded: false, plansCreated: [], reason: '已有计划，跳过 seed' };
    }
  }

  const ts = nowTimestamp();
  const planId = 'p-seed-racecar-0001';

  // Toy Race Car：12 任务从概念到上市的全流程演示
  const raceCar: Plan = normalizePlan({
    schemaVersion: SCHEMA_VERSION,
    planId,
    name: SEED_PLAN_NAME,
    version: 1,
    createdAt: ts,
    updatedAt: ts,
    updatedBy: createdBy,
    nextTaskSeq: 13,
    calendar: {
      mode: 'NATURAL',
      holidays: [],
      skipHolidays: true, // 玩具赛车项目跳周末 + 国定节假日
      anchorDate: '2026-09-07',
      defaultDuration: '3d',
    },
    tasks: [
      // === 概念 ===
      buildTask('T-RC-01', 1, '市场调研与竞品分析', 'pm', 2, '2d', ['Mia'], [], { start: '2026-09-07' }),
      buildTask('T-RC-02', 2, '产品概念定义', 'pm', 1, '2d', ['Mia'], ['T-RC-01'], {}),
      // === 设计 ===
      buildTask('T-RC-03', 3, '外观设计草图', 'design', 2, '3d', ['Leo'], ['T-RC-02'], {}),
      buildTask('T-RC-04', 4, '结构工程设计', 'eng', 1, '4d', ['Kai', 'Leo'], ['T-RC-02'], {}),
      // === 工程样机 ===
      buildTask('T-RC-05', 5, '模具设计', 'eng', 1, '5d', ['Kai'], ['T-RC-03', 'T-RC-04'], {}),
      buildTask('T-RC-06', 6, '首版样机制作', 'eng', 2, '7d', ['Kai', 'Theo'], ['T-RC-05'], {}),
      // === 测试 ===
      buildTask('T-RC-07', 7, '耐久性测试', 'qa', 2, '5d', ['Theo'], ['T-RC-06'], {}),
      buildTask('T-RC-08', 8, '儿童安全测试', 'qa', 1, '3d', ['Theo'], ['T-RC-06'], {}),
      buildTask('T-RC-09', 9, '设计优化迭代', 'design', 1, '4d', ['Leo', 'Kai'], ['T-RC-07', 'T-RC-08'], {}),
      // === 认证 ===
      buildTask('T-RC-10', 10, '安规认证送检', 'pm', 1, '7d', ['Mia'], ['T-RC-09'], {}),
      // === 量产 + 上市 ===
      buildTask('T-RC-11', 11, '量产试产', 'eng', 2, '5d', ['Kai'], ['T-RC-10'], {}),
      buildTask('T-RC-12', 12, '上市发布', 'pm', 1, '2d', ['Mia'], ['T-RC-11'], {}),
    ],
  });

  // 给 Toy Race Car 注入 4 个 todo（分布在不同阶段）
  const t2Todos = applyTodoOp([], { op: 'add', text: '梳理目标年龄段与价位带' }, makeTodoId);
  const t4Todos = applyTodoOp([], { op: 'add', text: '确认塑料件材料选型' }, makeTodoId);
  const t8Todos = applyTodoOp([], { op: 'add', text: '完成 EN71 / ASTM F963 自查清单' }, makeTodoId);
  const t12Todos = applyTodoOp([], { op: 'add', text: '准备电商详情页与开箱视频' }, makeTodoId);

  atomicWriteJson(planFile(raceCar.planId), raceCar);
  atomicWriteJson(historyFile(raceCar.planId), {
    schemaVersion: SCHEMA_VERSION,
    planId: raceCar.planId,
    versions: [
      {
        version: 1,
        timestamp: ts,
        editor: createdBy,
        notes: 'demo seed（首次启动自动注入）',
        planSnapshot: raceCar,
      },
    ],
  });
  atomicWriteJson(todosFile(raceCar.planId), {
    schemaVersion: 1,
    planId: raceCar.planId,
    revision: 1,
    byTask: {
      'T-RC-02': t2Todos,
      'T-RC-04': t4Todos,
      'T-RC-08': t8Todos,
      'T-RC-12': t12Todos,
    },
  });

  return { seeded: true, plansCreated: [planId] };
}

interface BuildTaskInput {
  start?: string;
  end?: string;
}

function buildTask(
  id: string,
  seq: number,
  name: string,
  category: string,
  _durationDays: number,
  duration: string,
  owner: string[],
  deps: string[],
  extra: BuildTaskInput,
): Record<string, unknown> {
  return {
    id,
    name,
    category,
    duration,
    owner,
    consultant: [],
    deps: deps.map((dep) => ({ id: dep, type: 'FS', lag: 0 })),
    progress: 0,
    priority: 'normal',
    notes: '',
    todos: [],
    start: extra.start,
    end: extra.end,
    seq,
  };
}
