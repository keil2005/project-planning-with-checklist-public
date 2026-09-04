/**
 * server/config.ts —— 配置层。
 *
 * 优先级：env > config/app.config.json > 内置默认值（K15）。
 * 所有磁盘路径只能从这里取，业务代码禁止出现字面量路径。
 */

import fs from 'node:fs';
import path from 'node:path';
import { todayISO } from '../shared/datetime';
import { isValidISODate } from '../shared/datetime';
import type { ISODate, LockCfgPublic } from '../shared/types';

export interface LockCfg extends LockCfgPublic {}

export interface ScheduleCfg {
  /** 'TODAY' 或 'YYYY-MM-DD' */
  anchorDate: string;
  defaultDuration: string;
}

/** 保存后自动同步到共享端（仅 Mac 本地开发机开启；共享端/Windows 默认关闭） */
export interface AutoSyncConfig {
  /** 总开关 */
  enabled: boolean;
  /** 需要同步的计划名（精确匹配 plan.name） */
  planNames: string[];
  /** 共享端 plan-gantt 的 data 目录（程序读取位置，绝对路径） */
  shareDataDir: string;
  /** 共享端三件套导出目录（PM tool/Project-A，绝对路径） */
  shareExportDir: string;
  /** 防抖毫秒：多次保存合并为一次同步 */
  debounceMs: number;
}

export interface AppConfig {
  port: number;
  /** 绝对路径 */
  dataDir: string;
  lock: LockCfg;
  schedule: ScheduleCfg;
  autoSync: AutoSyncConfig;
  /** 项目根（绝对路径） */
  projectRoot: string;
  /** 前端构建产物目录（绝对路径） */
  distDir: string;
  /** 服务版本号（用于 /api/health） */
  appVersion: string;
}

const DEFAULTS = {
  port: 3001,
  dataDir: './data',
  lock: { timeoutMs: 30_000, heartbeatMs: 10_000, sweepMs: 5_000, pollMs: 5_000 } as LockCfg,
  schedule: { anchorDate: 'TODAY', defaultDuration: '1d' } as ScheduleCfg,
  autoSync: {
    enabled: false,
    planNames: [] as string[],
    shareDataDir: '',
    shareExportDir: '',
    debounceMs: 4000,
  } as AutoSyncConfig,
};

/** server/ 的上一级即项目根 */
const PROJECT_ROOT: string = path.resolve(__dirname, '..');

interface RawFileConfig {
  port?: number;
  dataDir?: string;
  lock?: Partial<LockCfg>;
  schedule?: Partial<ScheduleCfg>;
  autoSync?: Partial<AutoSyncConfig>;
}

function readJsonConfig(relPath: string): RawFileConfig {
  const file = path.resolve(PROJECT_ROOT, relPath);
  try {
    if (!fs.existsSync(file)) return {};
    return JSON.parse(fs.readFileSync(file, 'utf8')) as RawFileConfig;
  } catch (e) {
    // 配置文件损坏不应阻断启动，退回默认值并告警
    console.warn(`[config] 读取配置文件失败（${relPath}）：${String(e)}`);
    return {};
  }
}

function readFileConfig(): RawFileConfig {
  // 基础配置（可用 CONFIG_FILE 环境变量覆盖），再叠加本地专属覆盖（不进部署、不入库）
  const base = readJsonConfig(process.env.CONFIG_FILE ?? 'config/app.config.json');
  const local = readJsonConfig('config/app.config.local.json');
  return { ...base, ...local };
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function readAppVersion(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(PROJECT_ROOT, 'package.json'), 'utf8')) as {
      version?: string;
    };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/** 加载配置并自举数据目录 */
export function load(): AppConfig {
  const file = readFileConfig();

  const port = envInt('PORT', file.port ?? DEFAULTS.port);
  const dataDirRaw = process.env.DATA_DIR ?? file.dataDir ?? DEFAULTS.dataDir;

  const lock: LockCfg = {
    timeoutMs: envInt('LOCK_TIMEOUT_MS', file.lock?.timeoutMs ?? DEFAULTS.lock.timeoutMs),
    heartbeatMs: envInt('LOCK_HEARTBEAT_MS', file.lock?.heartbeatMs ?? DEFAULTS.lock.heartbeatMs),
    sweepMs: envInt('LOCK_SWEEP_MS', file.lock?.sweepMs ?? DEFAULTS.lock.sweepMs),
    pollMs: envInt('LOCK_POLL_MS', file.lock?.pollMs ?? DEFAULTS.lock.pollMs),
  };

  const scheduleCfg: ScheduleCfg = {
    anchorDate: process.env.ANCHOR_DATE ?? file.schedule?.anchorDate ?? DEFAULTS.schedule.anchorDate,
    defaultDuration:
      process.env.DEFAULT_DURATION ?? file.schedule?.defaultDuration ?? DEFAULTS.schedule.defaultDuration,
  };

  const autoSync: AutoSyncConfig = {
    enabled: file.autoSync?.enabled === true,
    planNames: Array.isArray(file.autoSync?.planNames)
      ? (file.autoSync!.planNames as unknown[]).filter((n): n is string => typeof n === 'string')
      : [],
    shareDataDir: typeof file.autoSync?.shareDataDir === 'string' ? file.autoSync.shareDataDir : '',
    shareExportDir: typeof file.autoSync?.shareExportDir === 'string' ? file.autoSync.shareExportDir : '',
    debounceMs: envInt('AUTO_SYNC_DEBOUNCE_MS', file.autoSync?.debounceMs ?? DEFAULTS.autoSync.debounceMs),
  };

  const cfg: AppConfig = {
    port,
    dataDir: path.resolve(PROJECT_ROOT, dataDirRaw),
    lock,
    schedule: scheduleCfg,
    autoSync,
    projectRoot: PROJECT_ROOT,
    distDir: path.resolve(PROJECT_ROOT, 'dist'),
    appVersion: readAppVersion(),
  };

  // 目录自举
  fs.mkdirSync(path.join(cfg.dataDir, 'plans'), { recursive: true });
  return cfg;
}

export const config: AppConfig = load();

/* ------------------------------ 路径辅助 ------------------------------ */

export function plansRoot(): string {
  return path.join(config.dataDir, 'plans');
}

export function planDir(planId: string): string {
  return path.join(plansRoot(), planId);
}

export function planFile(planId: string): string {
  return path.join(planDir(planId), 'plan.json');
}

export function historyFile(planId: string): string {
  return path.join(planDir(planId), 'history.json');
}

/** todo 独立资源（方案 B：多人并发编辑 todo，脱离计划级排他锁） */
export function todosFile(planId: string): string {
  return path.join(planDir(planId), 'todos.json');
}

/** 全局工作日历当前配置（DATA_DIR 根，不进 plan schema） */
export function calendarFile(): string {
  return path.join(config.dataDir, 'calendar.json');
}

/** 全局工作日历版本历史（严格 append-only，DATA_DIR 根） */
export function calendarHistoryFile(): string {
  return path.join(config.dataDir, 'calendar-history.json');
}

/** 排程锚点日期：配置为 'TODAY' 时取当天 */
export function resolveAnchorDate(): ISODate {
  const raw = config.schedule.anchorDate;
  if (isValidISODate(raw)) return raw;
  return todayISO();
}

export function scheduleOptionsFromConfig(): { anchorDate: ISODate; defaultDuration: string } {
  return { anchorDate: resolveAnchorDate(), defaultDuration: config.schedule.defaultDuration };
}
