/**
 * src/components/ColumnFilterMenu.tsx —— 表头的漏斗按钮 + 下拉筛选面板（Excel 风格）。
 *
 * 三类列的面板形态：
 *   - enum（负责人 / 顾问人 / 时长 / 依赖）：搜索 + 全选 + 值勾选 +「(空白)」开关；
 *   - text（任务名称）：包含 / 不包含 / 开头是 / 等于 + 关键词；
 *   - date（开始 / 结束）：早于 / 不早于 / 介于（含两端）+ 日期输入。
 *
 * 交互取舍：
 *   - **勾选即时生效**，不设「确定」按钮（Excel 的自动筛选也是勾选即筛），面板只留「清除本列」；
 *   - 枚举列勾满全部且保留空值 = 等价于没筛选 → 直接删掉该列条件，漏斗不高亮；
 *   - 面板内所有点击都 stopPropagation，避免触发表头的列宽拖拽。
 */

import { useMemo, useState } from 'react';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import Popover from '@mui/material/Popover';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Tooltip from '@mui/material/Tooltip';
import FilterAltIcon from '@mui/icons-material/FilterAlt';
import { useStore, useColumnValues } from '../store';
import type { ColumnKey } from '../columns';
import {
  BLANK_LABEL,
  DATE_OP_LABEL,
  TEXT_OP_LABEL,
  defaultFilterFor,
  filterKindOf,
  type DateOp,
  type EnumFilter,
  type TextOp,
} from '../filter';

export interface ColumnFilterMenuProps {
  columnKey: ColumnKey;
  /** 列名，用于 tooltip 与面板标题 */
  label: string;
}

export default function ColumnFilterMenu({ columnKey, label }: ColumnFilterMenuProps): JSX.Element | null {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [query, setQuery] = useState<string>('');

  const current = useStore((s) => s.filter.byColumn[columnKey] ?? null);
  const setColumnFilter = useStore((s) => s.setColumnFilter);
  const allValues = useColumnValues(columnKey);

  const kind = filterKindOf(columnKey);

  /* 枚举列：候选值按搜索词过滤（只在展示层过滤，勾选状态不受影响） */
  const shownValues = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === '') return allValues;
    return allValues.filter((v) => v.toLowerCase().includes(q));
  }, [allValues, query]);

  // hooks 全部调用完之后再提前返回，避免 hook 数量随分支变化
  if (!kind) return null;

  const active = current !== null;
  const open = anchor !== null;

  const close = (): void => setAnchor(null);

  const clear = (): void => {
    setColumnFilter(columnKey, null);
  };

  /* ---------------- 枚举列 ---------------- */

  /** 当前生效的枚举条件；没筛选时视为「全选 + 含空」 */
  const eff: EnumFilter =
    current && current.kind === 'enum'
      ? current
      : { kind: 'enum', values: allValues, blanks: true };

  const commitEnum = (nextValues: string[], blanks: boolean): void => {
    // 勾满 + 含空 == 没筛选，直接删条件，避免漏斗无谓高亮
    if (nextValues.length === allValues.length && blanks) {
      setColumnFilter(columnKey, null);
      return;
    }
    setColumnFilter(columnKey, { kind: 'enum', values: nextValues, blanks });
  };

  const toggleValue = (v: string, checked: boolean): void => {
    const set = new Set(eff.values);
    if (checked) set.add(v);
    else set.delete(v);
    // 保持候选值顺序，避免勾选后列表跳动
    commitEnum(allValues.filter((x) => set.has(x)), eff.blanks);
  };

  const allChecked = allValues.length > 0 && eff.values.length === allValues.length;
  const someChecked = eff.values.length > 0 && eff.values.length < allValues.length;

  const renderEnumPanel = (): JSX.Element => (
    <>
      <TextField
        size="small"
        fullWidth
        placeholder="搜索"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        inputProps={{ className: 'pg-filter-input' }}
      />
      <div className="pg-filter-list">
        <FormControlLabel
          control={
            <Checkbox
              size="small"
              checked={allChecked}
              indeterminate={someChecked}
              onChange={(e) => commitEnum(e.target.checked ? allValues : [], e.target.checked ? eff.blanks : false)}
            />
          }
          label={<span className="pg-filter-label">（全选）</span>}
        />
        <Divider />
        {shownValues.length === 0 && <div className="pg-filter-empty">无匹配值</div>}
        {shownValues.map((v) => (
          <FormControlLabel
            key={v}
            control={
              <Checkbox size="small" checked={eff.values.includes(v)} onChange={(e) => toggleValue(v, e.target.checked)} />
            }
            label={
              <span className="pg-filter-label" title={v}>
                {v}
              </span>
            }
          />
        ))}
        {shownValues.length > 0 && (
          <FormControlLabel
            control={
              <Checkbox size="small" checked={eff.blanks} onChange={(e) => commitEnum(eff.values, e.target.checked)} />
            }
            label={<span className="pg-filter-label pg-filter-label--blank">{BLANK_LABEL}</span>}
          />
        )}
      </div>
    </>
  );

  /* ---------------- 文本列 ---------------- */

  const renderTextPanel = (): JSX.Element => {
    const f = current && current.kind === 'text' ? current : { kind: 'text' as const, op: 'contains' as TextOp, value: '' };
    return (
      <>
        <div className="pg-filter-title">显示名称{TEXT_OP_LABEL[f.op]}：</div>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={f.op}
          onChange={(_e, v: TextOp | null) => v && setColumnFilter(columnKey, { kind: 'text', op: v, value: f.value })}
        >
          {(Object.keys(TEXT_OP_LABEL) as TextOp[]).map((op) => (
            <ToggleButton key={op} value={op} className="pg-filter-toggle">
              {TEXT_OP_LABEL[op]}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        <TextField
          size="small"
          fullWidth
          autoFocus
          placeholder="关键词"
          value={f.value}
          onChange={(e) => setColumnFilter(columnKey, { kind: 'text', op: f.op, value: e.target.value })}
          inputProps={{ className: 'pg-filter-input' }}
        />
        <div className="pg-filter-hint">留空 = 该列不筛选</div>
      </>
    );
  };

  /* ---------------- 日期列 ---------------- */

  const renderDatePanel = (): JSX.Element => {
    const def = defaultFilterFor(columnKey);
    const f =
      current && current.kind === 'date'
        ? current
        : (def as { kind: 'date'; op: DateOp; from: string; to: string });
    const setOp = (op: DateOp): void => setColumnFilter(columnKey, { kind: 'date', op, from: f.from, to: f.to });
    return (
      <>
        <div className="pg-filter-title">{label}：</div>
        <ToggleButtonGroup size="small" exclusive value={f.op} onChange={(_e, v: DateOp | null) => v && setOp(v)}>
          {(Object.keys(DATE_OP_LABEL) as DateOp[]).map((op) => (
            <ToggleButton key={op} value={op} className="pg-filter-toggle">
              {DATE_OP_LABEL[op]}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        <input
          type="date"
          className="pg-date-input"
          value={f.from}
          onChange={(e) => setColumnFilter(columnKey, { kind: 'date', op: f.op, from: e.target.value, to: f.to })}
        />
        {f.op === 'between' && (
          <>
            <div className="pg-filter-title">至</div>
            <input
              type="date"
              className="pg-date-input"
              value={f.to}
              onChange={(e) => setColumnFilter(columnKey, { kind: 'date', op: f.op, from: f.from, to: e.target.value })}
            />
          </>
        )}
        <div className="pg-filter-hint">空日期的行不参与日期筛选</div>
      </>
    );
  };

  return (
    <>
      <Tooltip title={active ? `已筛选「${label}」，点击修改` : `筛选「${label}」`}>
        <IconButton
          size="small"
          className={`pg-th-filter ${active ? 'pg-th-filter--on' : ''}`}
          aria-label={`筛选${label}`}
          onClick={(e) => {
            e.stopPropagation();
            setAnchor(e.currentTarget);
          }}
        >
          <FilterAltIcon fontSize="small" />
        </IconButton>
      </Tooltip>

      <Popover
        open={open}
        anchorEl={anchor}
        onClose={close}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        slotProps={{ paper: { className: 'pg-filter-popover' } }}
      >
        <div onMouseDown={(e) => e.stopPropagation()}>
          {kind === 'enum' && renderEnumPanel()}
          {kind === 'text' && renderTextPanel()}
          {kind === 'date' && renderDatePanel()}
          <Divider />
          <div className="pg-filter-actions">
            <Button size="small" disabled={!active} onClick={clear}>
              清除本列
            </Button>
            <div style={{ flex: 1 }} />
            <Button size="small" onClick={close}>
              关闭
            </Button>
          </div>
        </div>
      </Popover>
    </>
  );
}
