/**
 * src/components/DatePickerPopover.tsx —— 紧凑月历弹窗（开始/结束日期选取）。
 *
 * 设计：零依赖（不引入 @mui/x-date-pickers），自绘 7×N 月格；与甘特图共用 store.calendar
 * 的 isWorking/labelOf 标注周末与法定假日/补班。选中日期回填单元格，走与手动输入相同的
 * commitTime 口径（落非工作日时由调用方决定是否弹确认）。
 */

import { useEffect, useState } from 'react';
import Popover from '@mui/material/Popover';
import IconButton from '@mui/material/IconButton';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import type { WorkCalendar } from '../../shared/types';
import { t, useT } from '../i18n';

interface Props {
  anchorEl: HTMLElement | null;
  open: boolean;
  value: string;
  calendar: WorkCalendar | null;
  onSelect: (iso: string) => void;
  onClose: () => void;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function toISO(y: number, m: number, d: number): string {
  return `${y}-${pad2(m + 1)}-${pad2(d)}`;
}

/** 星期表头（i18n：单键逗号分隔，避免 7 个零碎键） */
function weekLabels(): string[] {
  return t('cal.weekLabels').split(',');
}

export default function DatePickerPopover({ anchorEl, open, value, calendar, onSelect, onClose }: Props): JSX.Element {
  const tr = useT();
  // 初始视图月份：优先取 value，否则今天
  const init = parseMonth(value);
  const [view, setView] = useState<{ y: number; m: number }>(init);

  useEffect(() => {
    if (open) setView(parseMonth(value));
    // 仅在弹窗打开时同步视图到当前值
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const firstWeekday = new Date(view.y, view.m, 1).getDay(); // 0=周日
  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <Popover
      anchorEl={anchorEl}
      open={open}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      transformOrigin={{ vertical: 'top', horizontal: 'left' }}
    >
      <div style={{ width: 240, padding: 8, fontFamily: 'system-ui, sans-serif', fontSize: 12 }}>
        {/* 头部：上/下月 + 标题 */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <IconButton size="small" onClick={() => shiftMonth(-1)}>
            <ChevronLeftIcon fontSize="small" />
          </IconButton>
          <span style={{ fontWeight: 600 }}>{tr('cal.monthTitle', { y: view.y, m: view.m + 1 })}</span>
          <IconButton size="small" onClick={() => shiftMonth(1)}>
            <ChevronRightIcon fontSize="small" />
          </IconButton>
        </div>

        {/* 星期表头 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', textAlign: 'center', color: 'var(--text-subtle)', marginBottom: 2 }}>
          {weekLabels().map((w) => (
            <div key={w} style={{ padding: '2px 0' }}>
              {w}
            </div>
          ))}
        </div>

        {/* 日期格 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
          {cells.map((d, i) => {
            if (d === null) return <div key={`e${i}`} />;
            const iso = toISO(view.y, view.m, d);
            const weekend = new Date(view.y, view.m, d).getDay() === 0 || new Date(view.y, view.m, d).getDay() === 6;
            const nonWorking = calendar ? !calendar.isWorking(iso) : false;
            const selected = value === iso;
            const label = calendar ? calendar.labelOf(iso) : null;

            const bg = selected ? 'var(--primary)' : nonWorking ? 'var(--holiday)' : weekend ? 'var(--surface-2)' : 'var(--surface)';
            const color = selected ? 'var(--text-on-primary)' : nonWorking ? 'var(--error)' : 'var(--text)';

            return (
              <button
                key={iso}
                type="button"
                title={label ?? (nonWorking ? tr('cal.nonWorking') : weekend ? tr('cal.weekend') : '')}
                onClick={() => {
                  onSelect(iso);
                  onClose();
                }}
                style={{
                  border: selected ? '1px solid var(--primary-hover)' : '1px solid transparent',
                  borderRadius: 4,
                  background: bg,
                  color,
                  padding: '4px 0',
                  cursor: 'pointer',
                  fontSize: 12,
                }}
              >
                {d}
              </button>
            );
          })}
        </div>

        <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-subtle)', display: 'flex', gap: 10 }}>
          <span>
            <span style={{ display: 'inline-block', width: 10, height: 10, background: 'var(--holiday)', borderRadius: 2, verticalAlign: 'middle' }} /> {tr('cal.nonWorking')}
          </span>
          <span>
            <span style={{ display: 'inline-block', width: 10, height: 10, background: 'var(--surface-2)', borderRadius: 2, verticalAlign: 'middle' }} /> {tr('cal.weekend')}
          </span>
        </div>
      </div>
    </Popover>
  );

  function shiftMonth(delta: number): void {
    setView((v) => {
      const m = v.m + delta;
      if (m < 0) return { y: v.y - 1, m: 11 };
      if (m > 11) return { y: v.y + 1, m: 0 };
      return { y: v.y, m };
    });
  }
}

/** 从 ISO 日期串解析视图月份；失败则返回当前月 */
function parseMonth(iso: string): { y: number; m: number } {
  const now = new Date();
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(iso);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]) - 1;
    if (y >= 1970 && mo >= 0 && mo <= 11) return { y, m: mo };
  }
  return { y: now.getFullYear(), m: now.getMonth() };
}
