/**
 * server/calendarService.ts —— 全局工作日历落盘服务（仅负责 fs，不含判定逻辑）。
 *
 * 落盘位置（DATA_DIR 根，不进 plan schema）：
 *   calendar.json         当前配置（最新版本）
 *   calendar-history.json 版本历史（严格 append-only：仅追加，绝不删改既有记录）
 *
 * 判定逻辑见 shared/calendar-build.ts（buildWorkCalendar），本文件不持有任何业务判定。
 */

import fs from 'node:fs';
import { BUILTIN_HOLIDAYS, BUILTIN_MAKEUP, COVERED_YEARS } from '../shared/china-holidays';
import { isValidISODate } from '../shared/datetime';
import {
  DomainError,
  ErrCode,
  type CalendarConfigData,
  type ISODate,
} from '../shared/types';
import { calendarFile, calendarHistoryFile } from './config';

/* ========================= 历史文件结构 ========================= */

interface CalendarHistoryEntry {
  version: number;
  timestamp: string;
  editor: string;
  summary: string;
  configSnapshot: CalendarConfigData;
}

interface CalendarHistoryFile {
  schemaVersion: 1;
  resourceId: 'GLOBAL_CALENDAR';
  versions: CalendarHistoryEntry[];
}

const RESOURCE_ID = 'GLOBAL_CALENDAR' as const;

/* ========================= 辅助 ========================= */

/** 克隆 Date 映射（年份 key 归一为 number），用于 seed 落盘 */
function cloneDateMap(src: Record<number, ISODate[]>): Record<number, ISODate[]> {
  const out: Record<number, ISODate[]> = {};
  for (const [k, v] of Object.entries(src)) out[Number(k)] = [...v];
  return out;
}

/** 种子覆盖年份 = coveredYears ∪ 内置数据年份，保证 userHolidays / userRemoved 各年键齐备 */
function seedYears(): number[] {
  const set = new Set<number>(COVERED_YEARS);
  for (const y of Object.keys(BUILTIN_MAKEUP)) set.add(Number(y));
  for (const y of Object.keys(BUILTIN_HOLIDAYS)) set.add(Number(y));
  return [...set].sort((a, b) => a - b);
}

/* ========================= 结构校验 ========================= */

/** 解析并校验年份数组（key 合法：1–9999 整数） */
function parseYearArray(raw: unknown): number[] {
  if (!Array.isArray(raw)) {
    throw new DomainError(ErrCode.ERR_VALIDATION, 'coveredYears 必须为数组');
  }
  const set = new Set<number>();
  for (const item of raw) {
    const y = typeof item === 'string' ? Number(item) : item;
    if (typeof y !== 'number' || !Number.isInteger(y) || y < 1 || y > 9999) {
      throw new DomainError(ErrCode.ERR_VALIDATION, `coveredYears 含非法年份：${String(item)}`);
    }
    set.add(y);
  }
  return [...set].sort((a, b) => a - b);
}

/** 解析并校验「年份 → ISODate[]」映射：年份 key 合法、元素为合法 ISODate、数组去重 */
function parseDateMap(raw: unknown, field: string): Record<number, ISODate[]> {
  if (typeof raw !== 'object' || raw === null) {
    throw new DomainError(ErrCode.ERR_VALIDATION, `${field} 必须为对象`);
  }
  const result: Record<number, ISODate[]> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const year = Number(k);
    if (!Number.isInteger(year) || year < 1 || year > 9999) {
      throw new DomainError(ErrCode.ERR_VALIDATION, `${field} 年份 key 非法：${k}`);
    }
    if (!Array.isArray(v)) {
      throw new DomainError(ErrCode.ERR_VALIDATION, `${field}[${k}] 必须为数组`);
    }
    const set = new Set<string>();
    for (const item of v) {
      if (typeof item !== 'string' || !isValidISODate(item)) {
        throw new DomainError(ErrCode.ERR_VALIDATION, `${field}[${k}] 含非法日期：${String(item)}`);
      }
      set.add(item);
    }
    result[year] = [...set];
  }
  return result;
}

/**
 * 结构校验 + 归一化。
 *   - schemaVersion 必须为 1
 *   - coveredYears / 各 Date 映射的年份 key 合法
 *   - 所有日期为合法 ISODate，数组元素去重
 * 非法 → DomainError(ERR_VALIDATION, 1001)，由错误中间件转 400。
 */
export function validateCalendarConfig(raw: unknown): CalendarConfigData {
  if (typeof raw !== 'object' || raw === null) {
    throw new DomainError(ErrCode.ERR_VALIDATION, '缺少 calendar 配置');
  }
  const c = raw as Record<string, unknown>;

  if (c.schemaVersion !== 1) {
    throw new DomainError(ErrCode.ERR_VALIDATION, 'schemaVersion 必须为 1');
  }

  const coveredYears = parseYearArray(c.coveredYears);
  const userHolidays = parseDateMap(c.userHolidays, 'userHolidays');
  const userRemoved = parseDateMap(c.userRemoved, 'userRemoved');
  const makeup = parseDateMap(c.makeup, 'makeup');

  const version = typeof c.version === 'number' && Number.isFinite(c.version) ? c.version : 0;
  const updatedBy = typeof c.updatedBy === 'string' ? c.updatedBy : '';
  const updatedAt = typeof c.updatedAt === 'string' ? c.updatedAt : '';

  return {
    schemaVersion: 1,
    version,
    updatedBy,
    updatedAt,
    userHolidays,
    userRemoved,
    makeup,
    coveredYears,
  };
}

/* ========================= 历史追加（append-only） ========================= */

/** 向 calendar-history.json 追加一条记录；已有记录绝不被修改或删除 */
function appendHistory(entry: CalendarHistoryEntry): void {
  let file: CalendarHistoryFile;
  if (fs.existsSync(calendarHistoryFile())) {
    file = JSON.parse(fs.readFileSync(calendarHistoryFile(), 'utf8')) as CalendarHistoryFile;
  } else {
    file = { schemaVersion: 1, resourceId: RESOURCE_ID, versions: [] };
  }
  file.versions.push(entry);
  fs.writeFileSync(calendarHistoryFile(), JSON.stringify(file, null, 2));
}

/* ========================= 对外 API ========================= */

/** 读取当前全局日历配置；文件缺失时自动种子化（幂等） */
export function readCalendar(): CalendarConfigData {
  if (!fs.existsSync(calendarFile())) {
    return seedIfAbsent();
  }
  return JSON.parse(fs.readFileSync(calendarFile(), 'utf8')) as CalendarConfigData;
}

/** 若 calendar.json 不存在则写入种子；已存在则原样返回（幂等、不覆盖用户修改） */
export function seedIfAbsent(): CalendarConfigData {
  if (fs.existsSync(calendarFile())) {
    return JSON.parse(fs.readFileSync(calendarFile(), 'utf8')) as CalendarConfigData;
  }
  const now = new Date().toISOString();
  const years = seedYears();
  const emptyByYear: Record<number, ISODate[]> = {};
  for (const y of years) emptyByYear[y] = [];

  const seed: CalendarConfigData = {
    schemaVersion: 1,
    version: 1,
    updatedBy: 'system',
    updatedAt: now,
    userHolidays: { ...emptyByYear },
    userRemoved: { ...emptyByYear },
    makeup: cloneDateMap(BUILTIN_MAKEUP),
    coveredYears: [...COVERED_YEARS],
  };

  fs.writeFileSync(calendarFile(), JSON.stringify(seed, null, 2));
  appendHistory({
    version: 1,
    timestamp: now,
    editor: 'system',
    summary: '初始化内置 2026 工作日历',
    configSnapshot: seed,
  });
  return seed;
}

/**
 * 保存全局日历配置：version 自增、updatedBy / updatedAt 由服务端权威写入，
 * 落盘 calendar.json 并向 calendar-history.json append 一条完整快照。
 */
export function saveCalendar(
  cfg: CalendarConfigData,
  editor: string,
  summary?: string,
): CalendarConfigData {
  const prev = fs.existsSync(calendarFile())
    ? (JSON.parse(fs.readFileSync(calendarFile(), 'utf8')) as CalendarConfigData)
    : null;
  const newVersion = (prev?.version ?? 0) + 1;
  const now = new Date().toISOString();

  const entry: CalendarConfigData = {
    schemaVersion: 1,
    version: newVersion,
    updatedBy: editor,
    updatedAt: now,
    userHolidays: cfg.userHolidays,
    userRemoved: cfg.userRemoved,
    makeup: cfg.makeup,
    coveredYears: cfg.coveredYears,
  };

  fs.writeFileSync(calendarFile(), JSON.stringify(entry, null, 2));
  appendHistory({
    version: newVersion,
    timestamp: now,
    editor,
    summary: summary ?? '',
    configSnapshot: entry,
  });
  return entry;
}
