/**
 * shared/__tests__/calendar.test.ts —— 工作日历纯函数单测（T01）。
 *
 * 夹具（导出以便 T07 复用）：
 *   - WEEKEND_ONLY：仅周六日非工作，无节假日，coveredYears 为空集。断言不受 2026 节假日数据影响。
 *   - CAL_2026：由内置 2026 数据构建（含节假日 + 6 个补班日），coveredYears = new Set([2026])。
 */

import { describe, it, expect } from 'vitest';
import { BUILTIN_HOLIDAYS, BUILTIN_MAKEUP, HOLIDAY_LABELS, COVERED_YEARS } from '../china-holidays';
import {
  addDuration,
  subDuration,
  diffDuration,
  lagToDays,
  addWorkingDays,
  countWorkingDays,
  nextWorkingDay,
  prevWorkingDay,
  isWorkingDay,
  parseISODate,
} from '../datetime';
import type { WorkCalendar, ISODate, Duration, Plan, Task } from '../types';
import { schedule } from '../scheduler';

function isWeekend(d: ISODate): boolean {
  const day = parseISODate(d).day(); // 0=周日, 6=周六
  return day === 0 || day === 6;
}

export const WEEKEND_ONLY: WorkCalendar = {
  isWorking: (d) => !isWeekend(d),
  isHoliday: () => false,
  isMakeup: () => false,
  labelOf: () => null,
  coveredYears: new Set<number>(),
};

export const CAL_2026: WorkCalendar = (() => {
  const hol = new Set<ISODate>(BUILTIN_HOLIDAYS[2026] ?? []);
  const mk = new Set<ISODate>(BUILTIN_MAKEUP[2026] ?? []);
  const labels = HOLIDAY_LABELS;
  return {
    isWorking: (d) => {
      if (mk.has(d)) return true; // 调休补班：周末变工作日
      if (hol.has(d)) return false; // 法定放假日
      return !isWeekend(d); // 否则排除周末
    },
    isHoliday: (d) => hol.has(d) && !mk.has(d),
    isMakeup: (d) => mk.has(d),
    labelOf: (d) => labels[d] ?? null,
    coveredYears: new Set<number>(COVERED_YEARS),
  };
})();

/** 时长便捷构造 */
function dur(value: number, unit: 'd' | 'w' | 'm'): Duration {
  return { value, unit };
}

/** 工作日数（与 addDuration 因子一致） */
function wdOf(d: Duration): number {
  return d.unit === 'd' ? d.value : d.unit === 'w' ? d.value * 5 : d.value * 20;
}

describe('E1~E10 工作日口径自检（WEEKEND_ONLY，2026-08-26=周三）', () => {
  it('E1 addDuration 5d 正向 → 09-02', () => {
    expect(addDuration('2026-08-26', dur(5, 'd'), 1, WEEKEND_ONLY)).toBe('2026-09-02');
  });
  it('E2 subDuration 5d 逆向（往返闭合）→ 08-26', () => {
    expect(subDuration('2026-09-02', dur(5, 'd'), WEEKEND_ONLY)).toBe('2026-08-26');
  });
  it('E3 addDuration 1m 正向 → 09-23', () => {
    expect(addDuration('2026-08-26', dur(1, 'm'), 1, WEEKEND_ONLY)).toBe('2026-09-23');
  });
  it('E4 subDuration 1m 逆向（往返闭合）→ 08-26', () => {
    expect(subDuration('2026-09-23', dur(1, 'm'), WEEKEND_ONLY)).toBe('2026-08-26');
  });
  it('E5 subDuration 1d 跨周末逆向 → 08-28', () => {
    expect(subDuration('2026-08-31', dur(1, 'd'), WEEKEND_ONLY)).toBe('2026-08-28');
  });
  it('E6 lagToDays 3d 逆向 → -5', () => {
    expect(lagToDays(dur(3, 'd'), -1, '2026-08-26', WEEKEND_ONLY)).toBe(-5);
  });
  it('E7 lagToDays 1w 正向 → +7', () => {
    expect(lagToDays(dur(1, 'w'), 1, '2026-09-02', WEEKEND_ONLY)).toBe(7);
  });
  it('E8 addDuration 1d 周五起 → end 落周六（半开排他）', () => {
    expect(addDuration('2026-08-28', dur(1, 'd'), 1, WEEKEND_ONLY)).toBe('2026-08-29');
  });
  it('E9 addDuration 5d 周一起 → 09-05', () => {
    expect(addDuration('2026-08-31', dur(5, 'd'), 1, WEEKEND_ONLY)).toBe('2026-09-05');
  });
  it('E10 countWorkingDays 08-26..08-31（半开）→ 3', () => {
    expect(countWorkingDays('2026-08-26', '2026-08-31', WEEKEND_ONLY)).toBe(3);
  });
});

describe('addWorkingDays', () => {
  it('周五 +1（起点计入第 1 个）→ 当日', () => {
    expect(addWorkingDays('2026-08-28', 1, WEEKEND_ONLY)).toBe('2026-08-28');
  });
  it('周一 +5 → 当周五 09-11', () => {
    expect(addWorkingDays('2026-09-07', 5, WEEKEND_ONLY)).toBe('2026-09-11');
  });
  it('周二 +5（起点计第 1 个，跨周末）→ 下周一 09-14', () => {
    // 09-08 周二起：09-08,09,10,11,09-14(周一) 为第 1~5 个工作日
    expect(addWorkingDays('2026-09-08', 5, WEEKEND_ONLY)).toBe('2026-09-14');
  });
  it('跨年：12-31 周四 +2 → 2027-01-01', () => {
    expect(addWorkingDays('2026-12-31', 2, WEEKEND_ONLY)).toBe('2027-01-01');
  });
  it('负数方向：09-01 周二 -3 → 08-28 周五', () => {
    expect(addWorkingDays('2026-09-01', -3, WEEKEND_ONLY)).toBe('2026-08-28');
  });
});

describe('countWorkingDays', () => {
  it('含周末：08-26..08-31 → 3', () => {
    expect(countWorkingDays('2026-08-26', '2026-08-31', WEEKEND_ONLY)).toBe(3);
  });
  it('含节假日（CAL_2026）：10-01..10-09 → 仅 10-08 计 1', () => {
    expect(countWorkingDays('2026-10-01', '2026-10-09', CAL_2026)).toBe(1);
  });
  it('补班周六计入（CAL_2026）：10-09..10-12 → 09(周五)+10(补班周六)=2', () => {
    expect(countWorkingDays('2026-10-09', '2026-10-12', CAL_2026)).toBe(2);
  });
  it('反向区间返回负数', () => {
    expect(countWorkingDays('2026-08-31', '2026-08-26', WEEKEND_ONLY)).toBe(-3);
  });
});

describe('nextWorkingDay / prevWorkingDay / isWorkingDay', () => {
  it('nextWorkingDay 跳过周末：08-29(周六) → 08-31(周一)', () => {
    expect(nextWorkingDay('2026-08-29', WEEKEND_ONLY)).toBe('2026-08-31');
  });
  it('prevWorkingDay 跳过周末：08-30(周日) → 08-28(周五)', () => {
    expect(prevWorkingDay('2026-08-30', WEEKEND_ONLY)).toBe('2026-08-28');
  });
  it('isWorkingDay 周末返回 false', () => {
    expect(isWorkingDay('2026-08-29', WEEKEND_ONLY)).toBe(false);
    expect(isWorkingDay('2026-08-28', WEEKEND_ONLY)).toBe(true);
  });
});

describe('diffDuration 工作日归约 + round-trip', () => {
  const S = '2026-08-26';
  it('20 工作日 → {1,m}', () => {
    const end = addDuration(S, dur(1, 'm'), 1, WEEKEND_ONLY);
    expect(diffDuration(S, end, WEEKEND_ONLY)).toEqual({ value: 1, unit: 'm' });
  });
  it('10 工作日 → {2,w}', () => {
    const end = addDuration(S, dur(2, 'w'), 1, WEEKEND_ONLY);
    expect(diffDuration(S, end, WEEKEND_ONLY)).toEqual({ value: 2, unit: 'w' });
  });
  it('3 工作日 → {3,d}', () => {
    const end = addDuration(S, dur(3, 'd'), 1, WEEKEND_ONLY);
    expect(diffDuration(S, end, WEEKEND_ONLY)).toEqual({ value: 3, unit: 'd' });
  });
  it('round-trip：diffDuration(S, addDuration(S,dur)) 工作日数与 dur 等价', () => {
    const cases: Duration[] = [
      dur(1, 'm'),
      dur(2, 'w'),
      dur(3, 'd'),
      dur(5, 'd'),
      dur(1, 'w'),
      dur(4, 'w'),
    ];
    for (const c of cases) {
      const end = addDuration(S, c, 1, WEEKEND_ONLY);
      expect(countWorkingDays(S, end, WEEKEND_ONLY)).toBe(wdOf(c));
    }
  });
});

describe('CAL_2026 日历真源', () => {
  it('2026-10-01 国庆 → 非工作', () => {
    expect(CAL_2026.isWorking('2026-10-01')).toBe(false);
  });
  it('2026-10-10 补班周六 → 工作', () => {
    expect(CAL_2026.isWorking('2026-10-10')).toBe(true);
  });
  it('2026-10-10 isMakeup → true', () => {
    expect(CAL_2026.isMakeup('2026-10-10')).toBe(true);
  });
  it('2026-10-10 labelOf → null（补班日不着色）', () => {
    expect(CAL_2026.labelOf('2026-10-10')).toBeNull();
  });
  it('2026-10-01 labelOf → 国庆', () => {
    expect(CAL_2026.labelOf('2026-10-01')).toBe('国庆');
  });
});

describe('未覆盖年份降级（仅周末规则）', () => {
  it('2027-05-01 实际为周六 → 非工作（五一不强制放假，但周末仍排除）', () => {
    expect(CAL_2026.isWorking('2027-05-01')).toBe(false);
  });
  it('2027-05-03 周一 → 工作（验证未覆盖年无节假日数据、仅周末规则）', () => {
    expect(CAL_2026.isWorking('2027-05-03')).toBe(true);
  });
  it('2027-01-02 周六 → 非工作（降级后仍排除周末）', () => {
    expect(CAL_2026.isWorking('2027-01-02')).toBe(false);
  });
});

describe('非工作日起点归一化（期望行为，勿修正）', () => {
  it("addDuration('2026-08-29'周六, 1d) → '2026-09-01'", () => {
    expect(addDuration('2026-08-29', dur(1, 'd'), 1, WEEKEND_ONLY)).toBe('2026-09-01');
  });
  it("subDuration('2026-09-01', 1d) 归一到周一 → '2026-08-31'", () => {
    expect(subDuration('2026-09-01', dur(1, 'd'), WEEKEND_ONLY)).toBe('2026-08-31');
  });
});

describe('rollupParent 父子工期口径（注入 WEEKEND_ONLY）', () => {
  /** 构造：父 P 带一子 C1，C1 起点 08-26 时长 1m → end 09-23。 */
  function makePlan(): Plan {
    const c1: Task = {
      id: 'C1',
      seq: 1,
      name: '子任务',
      parentId: 'P',
      input: { start: '2026-08-26', end: null, duration: '1m' },
      deps: [],
    };
    const p: Task = {
      id: 'P',
      seq: 0,
      name: '父任务',
      parentId: null,
      input: { start: null, end: null, duration: null },
      deps: [],
    };
    return { tasks: [p, c1] } as Plan;
  }

  it('父 rollup 区间 08-26→09-23 经日历归约应为 {1,m}（非 {28,d}）', () => {
    const res = schedule(makePlan(), { calendar: WEEKEND_ONLY });
    const parent = res.computed['P'];
    expect(parent.isParent).toBe(true);
    expect(parent.start).toBe('2026-08-26');
    expect(parent.end).toBe('2026-09-23');
    // 关键断言：父子同一口径，父工期走工作日归约，而非 28 自然日。
    expect(parent.duration).toEqual({ value: 1, unit: 'm' });
    expect(parent.duration).not.toEqual({ value: 28, unit: 'd' });
  });
});
