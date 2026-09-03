/**
 * src/components/TaskTable.tsx —— 左侧任务表格（受控）。
 *
 * 列：行ID(只读) / 任务名称 / 开始 / 结束 / 时长 / 依赖 / 行操作
 *
 * 铁律：
 *   - 只写 task.input，绝不写 computed（K4）；单元格显示优先 input，缺省显示 computed 并灰色斜体；
 *   - 依赖列显示用 formatDepsExpr(deps, idToSeq)，落盘是稳定 ID（K5）；
 *   - 行高严格取 ROW_H（CSS 变量 --row-h），与甘特图共用同一逻辑滚动位置（K16）；
 *   - 排程结果只读取 store.sched，绝不在组件内做日期运算（K8）。
 */

import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject, type MouseEvent } from 'react';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Autocomplete from '@mui/material/Autocomplete';
import TextField from '@mui/material/TextField';
import AddIcon from '@mui/icons-material/Add';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import ArrowRightIcon from '@mui/icons-material/ArrowRight';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import FormatIndentDecreaseIcon from '@mui/icons-material/FormatIndentDecrease';
import FormatIndentIncreaseIcon from '@mui/icons-material/FormatIndentIncrease';
import { useCanEdit, useOwnerCandidates, useStore, useVisibleTasks } from '../store';
import DatePickerPopover from './DatePickerPopover';
import {
  buildIdSeqMaps,
  computeDepthMap,
  formatDepsExpr,
  groupDiagnosticsByTask,
  hasChildren,
} from '../../shared/scheduler';
import { formatDuration, isValidISODate } from '../../shared/datetime';
import {
  DERIVE_SOURCE_LABEL,
  ErrCode,
  ROW_H,
  type Diagnostic,
  type Task,
  type TaskComputed,
  type TaskField,
} from '../../shared/types';

/* ============================ 常量 ============================ */

/** 列宽（与表头、数据行共用同一 grid 模板）；负责人列（120px）插「依赖」后、「操作」前（K22） */
const GRID_COLUMNS = '52px minmax(160px, 1fr) 96px 96px 78px 110px 120px 136px';

/** 表格最小宽度，小于此宽度出现横向滚动条 */
const MIN_TABLE_WIDTH = 850;

/* ============================ 工具 ============================ */

/** 从某任务的诊断集合中挑出作用于指定字段的一条（error 优先） */
function pickDiag(list: Diagnostic[] | undefined, field: TaskField): Diagnostic | null {
  if (!list || list.length === 0) return null;
  const hit = list.filter((d) => d.field === field);
  if (hit.length === 0) return null;
  return hit.find((d) => d.level === 'error') ?? hit[0];
}

/** 行级诊断（没有 field 的诊断，如循环依赖）挂到「任务名称」列 */
function pickRowDiag(list: Diagnostic[] | undefined): Diagnostic | null {
  if (!list || list.length === 0) return null;
  const hit = list.filter((d) => d.field === undefined || d.field === 'name');
  if (hit.length === 0) return null;
  return hit.find((d) => d.level === 'error') ?? hit[0];
}

function diagClass(d: Diagnostic | null): string {
  if (!d) return '';
  return d.level === 'error' ? 'pg-input--error' : 'pg-input--warn';
}

/* ============================ 单元格 ============================ */

interface CellInputProps {
  value: string;
  disabled: boolean;
  derived: boolean;
  diagnostic: Diagnostic | null;
  placeholder?: string;
  title?: string;
  /** 存在解析错误时保留用户原文，避免输入被规整逻辑抹掉 */
  preserveDraft?: boolean;
  indentPx?: number;
  onCommit: (value: string) => void;
  onEnter?: () => void;
  onFocusCell?: () => void;
}

/**
 * 受控单元格：输入过程只改本地 draft，失焦 / 回车才提交，避免每个按键触发全量重算。
 */
function CellInput(props: CellInputProps): JSX.Element {
  const {
    value,
    disabled,
    derived,
    diagnostic,
    placeholder = '',
    title,
    preserveDraft = false,
    indentPx = 0,
    onCommit,
    onEnter,
    onFocusCell,
  } = props;

  const [draft, setDraft] = useState<string>(value);
  const [editing, setEditing] = useState<boolean>(false);

  useEffect(() => {
    if (!editing && !preserveDraft) setDraft(value);
  }, [value, editing, preserveDraft]);

  const commit = useCallback(
    (next: string): void => {
      if (next === value) return;
      onCommit(next);
    },
    [onCommit, value],
  );

  const tip = useMemo(() => {
    if (diagnostic) return `[${diagnostic.code}] ${diagnostic.message}`;
    return title ?? '';
  }, [diagnostic, title]);

  const input = (
    <input
      className={`pg-input ${derived ? 'pg-input--derived' : ''} ${diagClass(diagnostic)}`}
      style={indentPx > 0 ? { paddingLeft: indentPx } : undefined}
      value={draft}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => {
        setEditing(true);
        onFocusCell?.();
      }}
      onBlur={() => {
        setEditing(false);
        commit(draft);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          setEditing(false);
          commit(draft);
          (e.currentTarget as HTMLInputElement).blur();
          onEnter?.();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          setDraft(value);
          setEditing(false);
          (e.currentTarget as HTMLInputElement).blur();
        }
      }}
    />
  );

  if (tip === '') return input;
  return (
    <Tooltip title={tip} placement="top" enterDelay={400} disableInteractive>
      <span className="w-full">{input}</span>
    </Tooltip>
  );
}

/* ============================ 负责人联想单元格 ============================ */

/** 命中子串高亮（大小写不敏感，保留原序） */
function HighlightOwner({ text, query }: { text: string; query: string }): JSX.Element {
  const q = query.trim();
  if (q === '') return <>{text}</>;
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark style={{ background: '#fde68a', color: 'inherit', padding: '0 1px', borderRadius: 2 }}>
        {text.slice(idx, idx + q.length)}
      </mark>
      {text.slice(idx + q.length)}
    </>
  );
}

interface OwnerAutocompleteProps {
  value: string;
  disabled: boolean;
  candidates: string[];
  onCommit: (v: string) => void;
}

/**
 * 负责人单元格：只读展示 owner；点击/聚焦进入 Autocomplete 联想编辑。
 *  - 空输入展示完整候选（原序）；非空输入大小写不敏感子串过滤、命中高亮（K21/Q5）；
 *  - freeSolo：无命中时下拉显示「使用 "xxx"」自由文本项，确认即以自由文本保存（P0-6）；
 *  - 确认时 trim 首尾、保留中间空格、不归一大小写（K21）；Esc 取消；失焦确认；
 *  - popper 浮层呈现，不撑行高（K22，ROW_H=32）。
 */
function OwnerAutocomplete(props: OwnerAutocompleteProps): JSX.Element {
  const { value, disabled, candidates, onCommit } = props;
  const [editing, setEditing] = useState<boolean>(false);
  const [inputValue, setInputValue] = useState<string>(value);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const committedRef = useRef<boolean>(false);

  const finish = useCallback(
    (raw: string): void => {
      if (committedRef.current) return;
      committedRef.current = true;
      const v = raw.trim();
      onCommit(v);
      // 延迟到下一 tick 再卸载 Autocomplete，避免「选中即同步卸载」触发 MUI portal 的
      // removeChild 竞态（React 18 下会抛渲染期异常、整页白屏、内存态数据看似丢失）。
      window.setTimeout(() => setEditing(false), 0);
    },
    [onCommit],
  );

  const startEdit = useCallback((): void => {
    if (disabled) return;
    committedRef.current = false;
    setInputValue(value);
    setEditing(true);
  }, [disabled, value]);

  // 进入编辑态时聚焦输入框。
  // ⚠️ useEffect 必须在 early return 之前「无条件」调用：否则 editing 由 false→true 切换时，
  // 本组件会多渲染一个 hook，触发 React "Rendered more hooks than during the previous render"，
  // 因为没有 ErrorBoundary 而整页卸载（即用户看到的"点击负责人后闪退、内容被清空"）。
  useEffect(() => {
    if (!editing) return;
    const el = inputRef.current;
    if (el) {
      el.focus();
      el.select();
    }
  }, [editing]);

  // 只读态
  if (!editing) {
    return (
      <div
        className={`pg-input ${disabled ? 'pg-input--disabled' : ''}`}
        style={disabled ? undefined : { cursor: 'pointer' }}
        title={disabled ? undefined : '点击设置负责人'}
        onClick={startEdit}
      >
        {value ? value : <span className="text-slate-400">—</span>}
      </div>
    );
  }

  // 编辑态：Autocomplete（popper 浮层）
  return (
    <Autocomplete
      freeSolo
      disablePortal={false}
      forcePopupIcon={false}
      selectOnFocus
      clearOnBlur={false}
      blurOnSelect
      openOnFocus
      size="small"
      options={candidates}
      inputValue={inputValue}
      onInputChange={(_e, v) => setInputValue(v)}
      getOptionLabel={(o) => o}
      filterOptions={(opts, state) => {
        const q = state.inputValue.trim().toLowerCase();
        if (q === '') return opts;
        return opts.filter((o) => o.toLowerCase().includes(q));
      }}
      isOptionEqualToValue={(o, v) => o === v}
      onChange={(_e, val, reason) => {
        if (reason === 'selectOption' || reason === 'createOption') {
          finish(val ?? '');
        }
      }}
      onBlur={() => finish(inputValue)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          committedRef.current = true;
          setEditing(false);
        }
      }}
      renderOption={(optionProps, option, { inputValue: iv }) => {
        const isFree = option === iv && !candidates.includes(option);
        return (
          <li {...optionProps}>
            {isFree ? (
              <span>
                使用 <strong>&ldquo;{option}&rdquo;</strong>
              </span>
            ) : (
              <HighlightOwner text={option} query={iv} />
            )}
          </li>
        );
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          inputRef={inputRef}
          variant="standard"
          size="small"
          autoFocus
          placeholder="输入或选择负责人"
          sx={{
            '& .MuiInputBase-root': { height: 24, fontSize: 12 },
            '& .MuiInput-underline:before': { borderBottom: 'none' },
            '& .MuiInput-underline:after': { borderBottom: 'none' },
            '& .MuiInputBase-input': { padding: '0 4px' },
          }}
        />
      )}
    />
  );
}

/* ============================ 行 ============================ */

interface RowProps {
  task: Task;
  computed: TaskComputed | undefined;
  depth: number;
  isParent: boolean;
  collapsed: boolean;
  idToSeq: Map<string, number>;
  diagnostics: Diagnostic[] | undefined;
  canEdit: boolean;
  selected: boolean;
}

function TaskRow(props: RowProps): JSX.Element {
  const { task, computed, depth, isParent, collapsed, idToSeq, diagnostics, canEdit, selected } = props;

  const updateCell = useStore((s) => s.updateCell);
  const addRow = useStore((s) => s.addRow);
  const deleteRow = useStore((s) => s.deleteRow);
  const indent = useStore((s) => s.indent);
  const outdent = useStore((s) => s.outdent);
  const moveRow = useStore((s) => s.moveRow);
  const toggleCollapse = useStore((s) => s.toggleCollapse);
  const selectTask = useStore((s) => s.selectTask);
  const candidates = useOwnerCandidates();
  const calendar = useStore((s) => s.calendar);
  const openNonWorkingPrompt = useStore((s) => s.openNonWorkingPrompt);

  // 开始/结束日期的月历弹窗状态
  const [dateField, setDateField] = useState<'start' | 'end' | null>(null);
  const [dateAnchor, setDateAnchor] = useState<HTMLElement | null>(null);
  const openDatePopover = (field: 'start' | 'end') => (e: MouseEvent<HTMLElement>): void => {
    setDateAnchor(e.currentTarget);
    setDateField(field);
  };

  const depsText = formatDepsExpr(task.deps, idToSeq);
  const depsDiag = pickDiag(diagnostics, 'deps');
  const startDiag = pickDiag(diagnostics, 'start');
  const endDiag = pickDiag(diagnostics, 'end');
  const durationDiag = pickDiag(diagnostics, 'duration');
  const rowDiag = pickRowDiag(diagnostics);

  const startText = task.input.start ?? computed?.start ?? '';
  const endText = task.input.end ?? computed?.end ?? '';
  const durationText = task.input.duration ?? (computed ? formatDuration(computed.duration) : '');

  const srcStart = computed?.fieldSources.start ?? 'INPUT';
  const srcEnd = computed?.fieldSources.end ?? 'INPUT';
  const srcDuration = computed?.fieldSources.duration ?? 'INPUT';

  const parentTip = '由子任务汇总，不可手填';
  const timeDisabled = !canEdit || isParent;

  const onEnterNewRow = (): void => addRow(task.id);

  /** 时间字段提交：手填落到非工作日时，挂起确认弹窗；否则直接写 input */
  const commitTime = (field: 'start' | 'end', value: string): void => {
    if (value && isValidISODate(value) && calendar && !calendar.isWorking(value)) {
      openNonWorkingPrompt({ taskId: task.id, field, value });
    } else {
      updateCell(task.id, field, value);
    }
  };

  return (
    <div
      className={`pg-row ${selected ? 'pg-row--selected' : ''} ${isParent ? 'pg-row--parent' : ''}`}
      style={{ gridTemplateColumns: GRID_COLUMNS, minWidth: MIN_TABLE_WIDTH, height: ROW_H }}
      onMouseDown={() => selectTask(task.id)}
    >
      {/* 行号（只读，等于依赖表达式里引用的编号） */}
      <div className="pg-cell justify-center text-[12px] text-slate-500">{task.seq}</div>

      {/* 任务名称：折叠三角 + 层级缩进 */}
      <div className="pg-cell gap-[2px]">
        <span style={{ width: depth * 16 }} />
        {isParent ? (
          <IconButton
            size="small"
            style={{ padding: 0, width: 18, height: 18 }}
            title={collapsed ? '展开子任务' : '折叠子任务'}
            onClick={(e) => {
              e.stopPropagation();
              toggleCollapse(task.id);
            }}
          >
            {collapsed ? <ArrowRightIcon fontSize="small" /> : <ArrowDropDownIcon fontSize="small" />}
          </IconButton>
        ) : (
          <span style={{ width: 18 }} />
        )}
        <CellInput
          value={task.name}
          disabled={!canEdit}
          derived={false}
          diagnostic={rowDiag}
          placeholder="任务名称"
          onCommit={(v) => updateCell(task.id, 'name', v)}
          onEnter={onEnterNewRow}
          onFocusCell={() => selectTask(task.id)}
        />
      </div>

      {/* 开始 */}
      <div className="pg-cell pg-cell--date">
        <div className="pg-date-wrap">
          <CellInput
            value={startText}
            disabled={timeDisabled}
            derived={srcStart !== 'INPUT'}
            diagnostic={startDiag}
            placeholder="YYYY-MM-DD"
            title={isParent ? parentTip : DERIVE_SOURCE_LABEL[srcStart]}
            onCommit={(v) => commitTime('start', v)}
            onEnter={onEnterNewRow}
            onFocusCell={() => selectTask(task.id)}
          />
          <IconButton
            size="small"
            className="pg-cal-btn"
            disabled={timeDisabled}
            title="选择日期"
            onClick={openDatePopover('start')}
          >
            <CalendarMonthIcon fontSize="small" />
          </IconButton>
        </div>
        <DatePickerPopover
          anchorEl={dateAnchor}
          open={dateField === 'start'}
          value={startText}
          calendar={calendar}
          onSelect={(iso) => commitTime('start', iso)}
          onClose={() => setDateField(null)}
        />
      </div>

      {/* 结束（半开区间：不含当天） */}
      <div className="pg-cell pg-cell--date">
        <div className="pg-date-wrap">
          <CellInput
            value={endText}
            disabled={timeDisabled}
            derived={srcEnd !== 'INPUT'}
            diagnostic={endDiag}
            placeholder="YYYY-MM-DD"
            title={isParent ? parentTip : DERIVE_SOURCE_LABEL[srcEnd]}
            onCommit={(v) => commitTime('end', v)}
            onEnter={onEnterNewRow}
            onFocusCell={() => selectTask(task.id)}
          />
          <IconButton
            size="small"
            className="pg-cal-btn"
            disabled={timeDisabled}
            title="选择日期"
            onClick={openDatePopover('end')}
          >
            <CalendarMonthIcon fontSize="small" />
          </IconButton>
        </div>
        <DatePickerPopover
          anchorEl={dateAnchor}
          open={dateField === 'end'}
          value={endText}
          calendar={calendar}
          onSelect={(iso) => commitTime('end', iso)}
          onClose={() => setDateField(null)}
        />
      </div>

      {/* 时长 */}
      <div className="pg-cell">
        <CellInput
          value={durationText}
          disabled={timeDisabled}
          derived={srcDuration !== 'INPUT'}
          diagnostic={durationDiag}
          placeholder="5d / 2w / 1m"
          title={isParent ? parentTip : DERIVE_SOURCE_LABEL[srcDuration]}
          onCommit={(v) => updateCell(task.id, 'duration', v)}
          onEnter={onEnterNewRow}
          onFocusCell={() => selectTask(task.id)}
        />
      </div>

      {/* 依赖 */}
      <div className="pg-cell">
        <CellInput
          value={depsText}
          disabled={!canEdit}
          derived={false}
          diagnostic={depsDiag}
          placeholder="2FS,3FF+1w"
          title="填前置任务行号：3 / 2FS / 3FF+1w / 7ss-3d，多条用逗号分隔"
          preserveDraft={depsDiag?.code === ErrCode.ERR_DEP_PARSE || depsDiag?.code === ErrCode.ERR_DEP_TARGET_MISSING}
          onCommit={(v) => updateCell(task.id, 'deps', v)}
          onEnter={onEnterNewRow}
          onFocusCell={() => selectTask(task.id)}
        />
      </div>

      {/* 负责人 */}
      <div className="pg-cell">
        <OwnerAutocomplete
          value={task.owner ?? ''}
          disabled={!canEdit}
          candidates={candidates}
          onCommit={(v) => updateCell(task.id, 'owner', v)}
        />
      </div>

      {/* 行操作 */}
      <div className="pg-cell justify-end gap-0">
        <Tooltip title="在下方插入同级行（Enter）">
          <span>
            <IconButton size="small" disabled={!canEdit} onClick={() => addRow(task.id)} style={{ padding: 2 }}>
              <AddIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="缩进为上一行的子任务">
          <span>
            <IconButton size="small" disabled={!canEdit} onClick={() => indent(task.id)} style={{ padding: 2 }}>
              <FormatIndentIncreaseIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="升级一层">
          <span>
            <IconButton size="small" disabled={!canEdit} onClick={() => outdent(task.id)} style={{ padding: 2 }}>
              <FormatIndentDecreaseIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="上移">
          <span>
            <IconButton size="small" disabled={!canEdit} onClick={() => moveRow(task.id, -1)} style={{ padding: 2 }}>
              <ArrowUpwardIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="下移">
          <span>
            <IconButton size="small" disabled={!canEdit} onClick={() => moveRow(task.id, 1)} style={{ padding: 2 }}>
              <ArrowDownwardIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title={isParent ? '删除该行及其所有子任务' : '删除该行'}>
          <span>
            <IconButton
              size="small"
              color="error"
              disabled={!canEdit}
              onClick={() => deleteRow(task.id)}
              style={{ padding: 2 }}
            >
              <DeleteOutlineIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </div>
    </div>
  );
}

/* ============================ 主体 ============================ */

export interface TaskTableProps {
  /** 与甘特图共用的垂直滚动同步（K16） */
  scrollRef: MutableRefObject<HTMLDivElement | null>;
  onScroll: () => void;
}

export default function TaskTable({ scrollRef, onScroll }: TaskTableProps): JSX.Element {
  const plan = useStore((s) => s.plan);
  const sched = useStore((s) => s.sched);
  const diagnostics = useStore((s) => s.diagnostics);
  const selectedTaskId = useStore((s) => s.selectedTaskId);
  const addRow = useStore((s) => s.addRow);
  const canEdit = useCanEdit();
  const visible = useVisibleTasks();

  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const idToSeq = useMemo(() => (plan ? buildIdSeqMaps(plan.tasks).idToSeq : new Map<string, number>()), [plan]);
  const depthMap = useMemo(() => (plan ? computeDepthMap(plan.tasks) : new Map<string, number>()), [plan]);
  const diagByTask = useMemo(() => groupDiagnosticsByTask(diagnostics), [diagnostics]);
  const parentSet = useMemo(() => {
    const set = new Set<string>();
    if (!plan) return set;
    for (const t of plan.tasks) if (t.parentId) set.add(t.parentId);
    return set;
  }, [plan]);

  /* 选中行自动滚入可视区（诊断条点击定位用） */
  useEffect(() => {
    if (!selectedTaskId) return;
    const el = rowRefs.current.get(selectedTaskId);
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [selectedTaskId]);

  if (!plan) return <div className="pg-scroll" />;

  return (
    <div className="flex h-full flex-col overflow-hidden border-r border-slate-200 bg-white">
      <div ref={scrollRef} className="pg-scroll" onScroll={onScroll}>
        {/* 表头 */}
        <div
          className="pg-head pg-sticky-head text-[12px]"
          style={{ gridTemplateColumns: GRID_COLUMNS, minWidth: MIN_TABLE_WIDTH }}
        >
          <div className="pg-cell justify-center">行号</div>
          <div className="pg-cell">任务名称</div>
          <div className="pg-cell">开始</div>
          <div className="pg-cell">结束</div>
          <div className="pg-cell">时长</div>
          <div className="pg-cell">依赖</div>
          <div className="pg-cell">负责人</div>
          <div className="pg-cell justify-end">操作</div>
        </div>

        {/* 数据行 */}
        {visible.map((t) => (
          <div
            key={t.id}
            ref={(el) => {
              if (el) rowRefs.current.set(t.id, el);
              else rowRefs.current.delete(t.id);
            }}
          >
            <TaskRow
              task={t}
              computed={sched?.computed[t.id]}
              depth={sched?.computed[t.id]?.depth ?? depthMap.get(t.id) ?? 0}
              isParent={sched?.computed[t.id]?.isParent ?? (parentSet.has(t.id) || hasChildren(plan.tasks, t.id))}
              collapsed={t.collapsed === true}
              idToSeq={idToSeq}
              diagnostics={diagByTask.get(t.id)}
              canEdit={canEdit}
              selected={selectedTaskId === t.id}
            />
          </div>
        ))}

        {/* 追加行 */}
        <div
          className="pg-row"
          style={{ gridTemplateColumns: GRID_COLUMNS, minWidth: MIN_TABLE_WIDTH, height: ROW_H }}
        >
          <div className="pg-cell justify-center text-slate-400">+</div>
          <div className="pg-cell">
            <button
              type="button"
              disabled={!canEdit}
              onClick={() => addRow()}
              className="text-[12px] text-blue-600 disabled:cursor-not-allowed disabled:text-slate-400"
            >
              新增一行
            </button>
          </div>
          <div className="pg-cell" />
          <div className="pg-cell" />
          <div className="pg-cell" />
          <div className="pg-cell" />
          <div className="pg-cell" />
          <div className="pg-cell" />
        </div>

        {/* 底部留白，保证最后一行可完整滚出 */}
        <div style={{ height: ROW_H * 2 }} />
      </div>

      {!canEdit && (
        <div className="border-t border-slate-200 bg-slate-50 px-3 py-1 text-[12px] text-slate-500">
          只读模式：点击工具栏「编辑」获取编辑权后方可修改
        </div>
      )}
    </div>
  );
}
