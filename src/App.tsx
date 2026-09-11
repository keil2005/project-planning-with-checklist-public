/**
 * src/App.tsx —— 布局层。
 *
 * 结构：Toolbar → 诊断条 → 左右可拖拽分栏（表格 / 甘特）→ 对话框 → Snackbar。
 * 左右两个滚动容器的 scrollTop 严格同步（K16：ROW_H 一致 + 单一逻辑滚动位置）。
 *
 * v1.3.1 (2026-09-10) 优雅版：诊断条改扁平卡片式；空态加插画 + 双 CTA；
 * preview 条扁平化；分栏分隔条 hover 提示。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Collapse from '@mui/material/Collapse';
import IconButton from '@mui/material/IconButton';
import LinearProgress from '@mui/material/LinearProgress';
import Snackbar from '@mui/material/Snackbar';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import EventNoteIcon from '@mui/icons-material/EventNote';
import RocketLaunchIcon from '@mui/icons-material/RocketLaunch';
import AddIcon from '@mui/icons-material/Add';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { AuthGate } from './components/AuthGate';
import Dialogs from './components/Dialogs';
import GanttChart from './components/GanttChart';
import { RosterDialog } from './components/RosterDialog';
import TaskTable from './components/TaskTable';
import TodoDrawer from './components/TodoDrawer';
import Toolbar from './components/Toolbar';
import ErrorBoundary from './components/ErrorBoundary';
import { useStore } from './store';
import { useT, errLabel } from './i18n';
import type { Diagnostic } from '../shared/types';

/* ============================ 诊断条 ============================ */

function DiagnosticsBar(): JSX.Element | null {
  const diagnostics = useStore((s) => s.diagnostics);
  const plan = useStore((s) => s.plan);
  const selectTask = useStore((s) => s.selectTask);
  const [open, setOpen] = useState(true);
  const tr = useT();

  const { errors, warns } = useMemo(() => {
    return {
      errors: diagnostics.filter((d) => d.level === 'error'),
      warns: diagnostics.filter((d) => d.level === 'warn'),
    };
  }, [diagnostics]);

  if (!plan || diagnostics.length === 0) return null;

  const seqOf = (taskId?: string): string => {
    if (!taskId) return '-';
    const t = plan.tasks.find((x) => x.id === taskId);
    return t ? tr('diag.rowN', { seq: t.seq }) : taskId;
  };

  const renderItem = (d: Diagnostic, i: number): JSX.Element => (
    <button
      key={`${d.code}-${d.taskId ?? ''}-${i}`}
      type="button"
      onClick={() => d.taskId && selectTask(d.taskId)}
      className={`pg-diagnostics__chip pg-diagnostics__chip--${d.level}`}
      title={d.message}
    >
      <span className="pg-num font-semibold">{seqOf(d.taskId)}</span>
      <span className="pg-diagnostics__chip-code">[{d.code}]</span>
      <span className="pg-diagnostics__chip-msg">{errLabel(d.code)}：{d.message}</span>
    </button>
  );

  return (
    <div className="pg-diagnostics">
      <div className="flex items-center gap-2">
        <span className="pg-diagnostics__pill pg-diagnostics__pill--error">
          <ErrorOutlineIcon sx={{ fontSize: 14 }} /> {tr('diag.errors', { n: errors.length })}
        </span>
        <span className="pg-diagnostics__pill pg-diagnostics__pill--warn">
          <WarningAmberIcon sx={{ fontSize: 14 }} /> {tr('diag.warns', { n: warns.length })}
        </span>
        <span className="pg-diagnostics__hint">{tr('diag.hint')}</span>
        <div className="flex-1" />
        <IconButton size="small" onClick={() => setOpen((v) => !v)} title={open ? tr('diag.collapse') : tr('diag.expand')}>
          {open ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
        </IconButton>
      </div>
      <Collapse in={open}>
        <div className="pg-diagnostics__items">
          {errors.map(renderItem)}
          {warns.map(renderItem)}
        </div>
      </Collapse>
    </div>
  );
}

/* ============================ 日历生效横幅 ============================ */

function CalendarBanner(): JSX.Element | null {
  const calendar = useStore((s) => s.calendar);
  const calendarLoading = useStore((s) => s.calendarLoading);
  const tr = useT();
  if (calendarLoading || !calendar) return null;

  const curYear = new Date().getFullYear();
  const covered = calendar.coveredYears.has(curYear);

  if (covered) {
    const years = [...calendar.coveredYears].sort((a, b) => a - b).join('、');
    return (
      <div className="pg-banner pg-banner--ok">
        <span className="pg-banner__dot" />
        {tr('banner.calendarOk', { years })}
      </div>
    );
  }
  return (
    <div className="pg-banner pg-banner--warn">
      <span className="pg-banner__dot pg-banner__dot--warn" />
      {tr('banner.calendarWarn', { year: curYear })}
    </div>
  );
}

/* ============================ 空态（v1.3.1 优雅版） ============================ */

function EmptyState(): JSX.Element {
  const openDialog = useStore((s) => s.openDialog);
  const user = useStore((s) => s.session.user);
  const tr = useT();
  return (
    <div className="pg-empty">
      <div className="pg-empty__icon">
        <EventNoteIcon sx={{ fontSize: 36 }} />
      </div>
      <div>
        <div className="pg-empty__title">{tr('empty.title')}</div>
        <div className="pg-empty__subtitle">
          {user
            ? tr('empty.subtitleAuthed')
            : tr('empty.subtitleGuest')}
        </div>
      </div>
      <div className="pg-empty__actions">
        <Button
          variant="contained"
          startIcon={<RocketLaunchIcon />}
          disabled={!user}
          onClick={() => openDialog('planPicker')}
        >
          {tr('empty.openPlan')}
        </Button>
        <Button
          variant="outlined"
          startIcon={<AddIcon />}
          disabled={!user}
          onClick={() => openDialog('planPicker')}
        >
          {tr('empty.newPlan')}
        </Button>
      </div>
      {!user && <div className="text-[12px] text-[var(--text-subtle)]">{tr('empty.pickUserFirst')}</div>}
    </div>
  );
}

/* ============================ 主体 ============================ */

export default function App(): JSX.Element {
  const init = useStore((s) => s.init);
  const plan = useStore((s) => s.plan);
  const busy = useStore((s) => s.busy);
  const toast = useStore((s) => s.toast);
  const clearToast = useStore((s) => s.clearToast);
  const preview = useStore((s) => s.preview);
  const exitPreview = useStore((s) => s.exitPreview);
  const tr = useT();

  useEffect(() => {
    void init();
  }, [init]);

  const leftScroll = useRef<HTMLDivElement | null>(null);
  const rightScroll = useRef<HTMLDivElement | null>(null);
  const syncing = useRef(false);

  const sync = useCallback((from: HTMLDivElement | null, to: HTMLDivElement | null) => {
    if (syncing.current || !from || !to) return;
    if (to.scrollTop === from.scrollTop) return;
    syncing.current = true;
    to.scrollTop = from.scrollTop;
    window.requestAnimationFrame(() => {
      syncing.current = false;
    });
  }, []);

  const onLeftScroll = useCallback(() => sync(leftScroll.current, rightScroll.current), [sync]);
  const onRightScroll = useCallback(() => sync(rightScroll.current, leftScroll.current), [sync]);

  return (
    <ErrorBoundary>
    <div className="flex h-full flex-col">
      <Toolbar />
      {busy && <LinearProgress style={{ height: 2 }} />}

      {preview && (
        <div className="pg-preview">
          <Chip size="small" color="warning" label={tr('preview.banner', { version: preview.version })} />
          <span className="truncate">
            {tr('preview.by', { editor: preview.editor, notes: preview.notes })}
          </span>
          <div className="flex-1" />
          <Button size="small" variant="outlined" color="warning" onClick={() => void exitPreview()}>
            {tr('preview.exit')}
          </Button>
        </div>
      )}

      <CalendarBanner />

      <DiagnosticsBar />

      <div className="min-h-0 flex-1">
        {plan ? (
          <PanelGroup direction="horizontal" autoSaveId="pg-split">
            <Panel defaultSize={45} minSize={22}>
              <TaskTable scrollRef={leftScroll} onScroll={onLeftScroll} />
            </Panel>
            <PanelResizeHandle className="pg-resize-handle" />
            <Panel defaultSize={55} minSize={22}>
              <GanttChart scrollRef={rightScroll} onScroll={onRightScroll} />
            </Panel>
          </PanelGroup>
        ) : (
          <EmptyState />
        )}
      </div>

      <Dialogs />
      <TodoDrawer />
      <RosterDialog />
      <AuthGateShell />

      <Snackbar
        open={toast !== null}
        autoHideDuration={5000}
        onClose={clearToast}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        {toast ? (
          <Alert severity={toast.severity} onClose={clearToast} variant="filled">
            {toast.message}
          </Alert>
        ) : undefined}
      </Snackbar>
    </div>
    </ErrorBoundary>
  );
}

/**
 * AuthGateShell —— 把 store.dialogs.user 转成受控 props 给 AuthGate，
 * 让登录门禁可被 useStore 订阅（避免在 store 里直接渲染 React 组件造成耦合）。
 */
function AuthGateShell(): JSX.Element {
  const open = useStore((s) => s.dialogs.user);
  return <AuthGate open={open} />;
}
