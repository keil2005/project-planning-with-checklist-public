/**
 * shared/calendar-build.ts —— 工作日历纯函数构建器（前后端共用，零 fs、零 Node 依赖）。
 *
 * 把节假日 / 补班 / 用户自定义集合预编译为 Set<string>，使 isWorking 为 O(1) 查表。
 *
 * 判定不变量（严格按顺序，顺序错会导致补班日被周末规则误判为休息）：
 *   1) 补班日(makeup)                              → 工作日（覆盖周末默认）
 *   2) 周六 / 周日                                  → 非工作日
 *   3) 法定 / 自定义假日
 *      (BUILTIN_HOLIDAYS ∪ userHolidays − userRemoved) → 非工作日
 *   4) 其余                                          → 工作日
 *
 * 未覆盖年份（不在 cfg.coveredYears）降级：仅周末规则，无节假日数据。
 */

import { BUILTIN_HOLIDAYS, BUILTIN_MAKEUP, HOLIDAY_LABELS } from './china-holidays';
import type { CalendarConfigData, ISODate, WorkCalendar } from './types';

/** 解析 'YYYY-MM-DD' 为各字段（基于 UTC，避免本地时区漂移） */
function parseParts(date: ISODate): { year: number; month: number; day: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) {
    throw new Error(`非法日期字符串：${date}`);
  }
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

/** 该自然日是否周六 / 周日（基于 UTC，确定性） */
function isWeekend(date: ISODate): boolean {
  const { year, month, day } = parseParts(date);
  const wd = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return wd === 0 || wd === 6;
}

/** 预编译单年判定集合 */
interface YearSets {
  /** (BUILTIN_HOLIDAYS ∪ userHolidays) − userRemoved */
  holiday: Set<string>;
  /** 补班日（含内置补班，seed 时已填充） */
  makeup: Set<string>;
}

function compileYear(cfg: CalendarConfigData, year: number): YearSets {
  const holiday = new Set<string>(BUILTIN_HOLIDAYS[year] ?? []);
  for (const d of cfg.userHolidays[year] ?? []) holiday.add(d);
  for (const d of cfg.userRemoved[year] ?? []) holiday.delete(d);

  const makeup = new Set<string>(cfg.makeup[year] ?? []);

  return { holiday, makeup };
}

/**
 * 由 CalendarConfigData 构建 WorkCalendar。
 *
 * 纯函数、零副作用；服务端排程与前端甘特着色复用同一份判定逻辑（单一真源）。
 */
export function buildWorkCalendar(cfg: CalendarConfigData): WorkCalendar {
  const coveredYears = new Set<number>(cfg.coveredYears);
  const cache = new Map<number, YearSets>();

  const yearSets = (year: number): YearSets | undefined => {
    if (!coveredYears.has(year)) return undefined;
    let s = cache.get(year);
    if (!s) {
      s = compileYear(cfg, year);
      cache.set(year, s);
    }
    return s;
  };

  const isMakeup = (date: ISODate): boolean => {
    const { year } = parseParts(date);
    const s = yearSets(year);
    return s ? s.makeup.has(date) : false;
  };

  const isHoliday = (date: ISODate): boolean => {
    const { year } = parseParts(date);
    const s = yearSets(year);
    return s ? s.holiday.has(date) : false;
  };

  const isWorking = (date: ISODate): boolean => {
    const { year } = parseParts(date);
    const s = yearSets(year);
    if (s) {
      if (s.makeup.has(date)) return true; // 1) 补班覆盖周末默认
      if (isWeekend(date)) return false; // 2) 周末
      if (s.holiday.has(date)) return false; // 3) 法定 / 自定义假日
      return true; // 4) 其余工作日
    }
    // 未覆盖年份：降级为仅周末规则
    return !isWeekend(date);
  };

  const labelOf = (date: ISODate): string | null => {
    if (isMakeup(date)) return null; // 补班日不着色
    if (HOLIDAY_LABELS[date]) return HOLIDAY_LABELS[date];
    const { year } = parseParts(date);
    if (cfg.userHolidays[year]?.includes(date)) return '自定义';
    return null;
  };

  return {
    isWorking,
    isHoliday,
    isMakeup,
    labelOf,
    coveredYears,
  };
}
