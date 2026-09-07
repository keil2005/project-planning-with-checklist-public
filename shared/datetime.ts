/**
 * shared/datetime.ts —— 日期与时长纯函数层（前后端共用，零副作用）。
 *
 * ★ 全局最重要的约定（系统设计 §2.1 / K3）：端点式（ENDPOINT）时间语义
 *    end = addDuration(start, duration) = 最后工作日（inclusive，"下班时间"）。
 *    区间为闭 [start, end]（含结束日），甘特条占满 end 那天。
 *    'd' → +N 天；'w' → +7N 天；'m' → dayjs add(N,'month')（自带月末夹取）。
 *
 * 所有业务日期都是 'YYYY-MM-DD' 字符串，严格解析（dayjs strict 模式）。
 *
 * v1.2.1：end 由「半开右边界 last+1d」改为「最后工作日本身」（含日），
 * 贴合用户语义（"结束日期 = 那天下班时间"）。mpp import / 甘特条 / 测试同步对齐。
 */

import dayjs, { type Dayjs } from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import {
  DomainError,
  ErrCode,
  type Duration,
  type DurationUnit,
  type ISODate,
  type WorkCalendar,
  NATURAL_CALENDAR,
} from './types';

dayjs.extend(customParseFormat);

export const ISO_DATE_FORMAT = 'YYYY-MM-DD';

/** 时长文本解析正则：单位可缺省（缺省 d），大小写不敏感 */
const DURATION_RE = /^\s*(\d+(?:\.\d+)?)\s*([dwmDWM])?\s*$/;

/* ============================ 日期 ============================ */

/** 严格解析 'YYYY-MM-DD'；失败抛 ERR_INVALID_DATE(1007) */
export function parseISODate(s: ISODate | null | undefined): Dayjs {
  if (s === null || s === undefined || typeof s !== 'string' || s.trim() === '') {
    throw new DomainError(ErrCode.ERR_INVALID_DATE, '日期不能为空，格式要求 YYYY-MM-DD');
  }
  const d = dayjs(s.trim(), ISO_DATE_FORMAT, true);
  if (!d.isValid()) {
    throw new DomainError(ErrCode.ERR_INVALID_DATE, `非法日期「${s}」，格式要求 YYYY-MM-DD`);
  }
  return d;
}

export function formatISODate(d: Dayjs): ISODate {
  return d.format(ISO_DATE_FORMAT);
}

export function isValidISODate(s: unknown): boolean {
  if (typeof s !== 'string') return false;
  return dayjs(s.trim(), ISO_DATE_FORMAT, true).isValid();
}

/** 今天（本地时区自然日） */
export function todayISO(): ISODate {
  return dayjs().format(ISO_DATE_FORMAT);
}

/** 当前 UTC 时间戳字符串（K2） */
export function nowTimestamp(): string {
  return new Date().toISOString();
}

/* ============================ 时长 ============================ */

/**
 * 解析时长文本：'5d' / '2w' / '1m' / '5'（缺省 d）。
 * 小数仅 'd' 允许并向上取整为整日；其它情形抛 ERR_DURATION_PARSE(1008)。
 */
export function parseDuration(text: string | null | undefined): Duration {
  if (text === null || text === undefined || typeof text !== 'string' || text.trim() === '') {
    throw new DomainError(ErrCode.ERR_DURATION_PARSE, '时长不能为空，示例：5d / 2w / 1m');
  }
  const m = DURATION_RE.exec(text);
  if (!m) {
    throw new DomainError(ErrCode.ERR_DURATION_PARSE, `非法时长「${text}」，示例：5d / 2w / 1m`);
  }
  const rawValue = Number(m[1]);
  const unit = (m[2] ?? 'd').toLowerCase() as DurationUnit;
  if (!Number.isFinite(rawValue)) {
    throw new DomainError(ErrCode.ERR_DURATION_PARSE, `非法时长「${text}」`);
  }
  let value = rawValue;
  if (!Number.isInteger(rawValue)) {
    if (unit !== 'd') {
      throw new DomainError(ErrCode.ERR_DURATION_PARSE, `小数时长仅支持「天(d)」，收到「${text}」`);
    }
    value = Math.ceil(rawValue);
  }
  if (value <= 0) {
    throw new DomainError(ErrCode.ERR_DURATION_PARSE, `时长必须大于 0，收到「${text}」`);
  }
  return { value, unit };
}

/** 安全解析：失败返回 null（供 UI 预校验使用） */
export function tryParseDuration(text: string | null | undefined): Duration | null {
  try {
    return parseDuration(text);
  } catch {
    return null;
  }
}

export function formatDuration(d: Duration | null | undefined): string {
  if (!d) return '';
  return `${d.value}${d.unit}`;
}

/* ============================ 加减 ============================ */

/**
 * date ± duration（ENDPOINT 语义，工作日口径）。
 *
 * 规范 end 唯一确定（半开排他边界 [start, end)）：
 *   - sign > 0（正向，已知 start 求 end）：从 start 起数第 N 个工作日（起点若非工作日先
 *     nextWorkingDay 归一、并记作第 1 个），返回「第 N 个工作日 + 1 自然日」。
 *   - sign < 0（逆向，已知 end 求 start）：先退出排他边界（end - 1 自然日），再倒推第 N 个工作日，
 *     为严格逆运算，不 +1 自然日。两分支不共用收尾（§3.2 旧伪代码的 +1 收尾在负向是错的）。
 *
 * 单位 → 工作日幅值因子：d→1，w→5，m→20。
 *
 * @param sign 1 表示加，-1 表示减
 * @param cal 工作日历；缺省 NATURAL_CALENDAR（全工作日，等价于旧自然日语义）
 */
export function addDuration(
  date: ISODate,
  dur: Duration,
  sign: 1 | -1 = 1,
  cal: WorkCalendar = NATURAL_CALENDAR,
): ISODate {
  const wd = Math.abs(dur.value) * durationFactor(dur.unit);
  if (sign > 0) {
    // 正向：date 是第 1 个工作日，终点 = 第 wd 个（inclusive，end = "下班时间"）
    return addWorkingDays(date, wd, cal);
  }
  // 逆向：end (inclusive) 倒数第 wd 个 = 起点
  return addWorkingDays(date, -wd, cal);
}

export function subDuration(date: ISODate, dur: Duration, cal: WorkCalendar = NATURAL_CALENDAR): ISODate {
  return addDuration(date, dur, -1, cal);
}

/** 单位 → 工作日幅值因子（d→1, w→5, m→20） */
function durationFactor(unit: DurationUnit): number {
  switch (unit) {
    case 'd':
      return 1;
    case 'w':
      return 5;
    case 'm':
      return 20;
    default:
      return 1;
  }
}

/** ≥date 的第一个工作日（date 本身若是工作日则为其自身） */
export function nextWorkingDay(date: ISODate, cal: WorkCalendar = NATURAL_CALENDAR): ISODate {
  let d = parseISODate(date);
  while (!cal.isWorking(formatISODate(d))) {
    d = d.add(1, 'day');
  }
  return formatISODate(d);
}

/** ≤date 的最后一个工作日（date 本身若是工作日则为其自身） */
export function prevWorkingDay(date: ISODate, cal: WorkCalendar = NATURAL_CALENDAR): ISODate {
  let d = parseISODate(date);
  while (!cal.isWorking(formatISODate(d))) {
    d = d.add(-1, 'day');
  }
  return formatISODate(d);
}

/** 该自然日是否工作日 */
export function isWorkingDay(date: ISODate, cal: WorkCalendar = NATURAL_CALENDAR): boolean {
  return cal.isWorking(date);
}

/**
 * 从 start 起数 |n| 个工作日（含起点归一后自身记第 1 个）。
 * n >= 0 正向（nextWorkingDay 起点归一），n < 0 逆向（prevWorkingDay 起点归一）。
 */
export function addWorkingDays(start: ISODate, n: number, cal: WorkCalendar = NATURAL_CALENDAR): ISODate {
  if (n >= 0) {
    let d = cal.isWorking(start) ? parseISODate(start) : parseISODate(nextWorkingDay(start, cal));
    let remaining = n;
    while (remaining > 0) {
      remaining -= 1;
      if (remaining > 0) {
        d = parseISODate(nextWorkingDay(formatISODate(d.add(1, 'day')), cal));
      }
    }
    return formatISODate(d);
  }
  let d = cal.isWorking(start) ? parseISODate(start) : parseISODate(prevWorkingDay(start, cal));
  let remaining = -n;
  while (remaining > 0) {
    remaining -= 1;
    if (remaining > 0) {
      d = parseISODate(prevWorkingDay(formatISODate(d.add(-1, 'day')), cal));
    }
  }
  return formatISODate(d);
}

/**
 * 闭区间 [a, b] 内的工作日数（a、b 均计入）。b < a 时返回负数。
 * 与 K3 端点式（end = 最后工作日本身 inclusive）对齐：start/end 都算 1 个工作日的两端。
 */
export function countWorkingDays(a: ISODate, b: ISODate, cal: WorkCalendar = NATURAL_CALENDAR): number {
  const sa = parseISODate(a);
  const sb = parseISODate(b);
  const forward = sb.isSame(sa) || sb.isAfter(sa);
  const sign = forward ? 1 : -1;
  const lo = forward ? sa : sb;
  const hi = forward ? sb : sa;
  let cur = lo;
  let cnt = 0;
  while (!cur.isAfter(hi)) {
    if (cal.isWorking(formatISODate(cur))) cnt += 1;
    cur = cur.add(1, 'day');
  }
  return cnt * sign;
}

export function addDays(date: ISODate, days: number): ISODate {
  return formatISODate(parseISODate(date).add(days, 'day'));
}

/** b - a，单位「天」（可为负） */
export function diffDays(a: ISODate, b: ISODate): number {
  return parseISODate(b).diff(parseISODate(a), 'day');
}

/**
 * 逆运算：由 [start, end) 推算时长，单位优先级 m > w > d（§2.1）。
 */
/**
 * 逆运算：由 [start, end) 推算时长，按工作日数归约，优先级 m(≥20 且%20==0) > w(≥5 且%5==0) > d（§2.1）。
 * 例：20 工作日→1m，10 工作日→2w，3 工作日→3d。
 */
export function diffDuration(start: ISODate, end: ISODate, cal: WorkCalendar = NATURAL_CALENDAR): Duration {
  const wd = countWorkingDays(start, end, cal);
  if (wd >= 20 && wd % 20 === 0) {
    return { value: wd / 20, unit: 'm' };
  }
  if (wd >= 5 && wd % 5 === 0) {
    return { value: wd / 5, unit: 'w' };
  }
  return { value: wd, unit: 'd' };
}

/* ============================ 聚合 ============================ */

export function minDate(dates: Array<ISODate | null | undefined>): ISODate | null {
  let best: ISODate | null = null;
  for (const d of dates) {
    if (!d) continue;
    if (best === null || d < best) best = d;
  }
  return best;
}

export function maxDate(dates: Array<ISODate | null | undefined>): ISODate | null {
  let best: ISODate | null = null;
  for (const d of dates) {
    if (!d) continue;
    if (best === null || d > best) best = d;
  }
  return best;
}

/**
 * 偏移换算为「天」（带符号）。
 * 必须以依赖所引用的前置端点日期为锚，'m' 才能取到真实自然月长度（§2.3）。
 */
/**
 * 偏移换算为「自然日跨度」（带符号）。必须以依赖所引用的前置端点日期为锚（工作日感知）。
 * 返回 diffDays(anchor, addDuration(anchor, lag, sign, cal))。
 */
export function lagToDays(lag: Duration | null, sign: 1 | -1, anchor: ISODate, cal: WorkCalendar = NATURAL_CALENDAR): number {
  if (!lag) return 0;
  return diffDays(anchor, addDuration(anchor, lag, sign, cal));
}

/** 偏移文本，如 '+1w' / '-3d'；无偏移返回 '' */
export function formatLag(lag: Duration | null, sign: 1 | -1): string {
  if (!lag) return '';
  return `${sign < 0 ? '-' : '+'}${lag.value}${lag.unit}`;
}

/** ISO UTC 时间戳 → 本地可读文本（仅 UI 展示用，K2） */
export function formatTimestampLocal(ts: string): string {
  const d = dayjs(ts);
  return d.isValid() ? d.format('YYYY-MM-DD HH:mm') : ts;
}

export { dayjs };
