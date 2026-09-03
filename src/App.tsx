/**
 * src/App.tsx —— 布局层。
 *
 * 结构：Toolbar → 诊断条 → 左右可拖拽分栏（表格 / 甘特）→ 对话框 → Snackbar。
 * 左右两个滚动容器的 scrollTop 严格同步（K16：ROW_H 一致 + 单一逻辑滚动位置）。
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
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import Dialogs from './components/Dialogs';
import GanttChart from './components/GanttChart';
import TaskTable from './components/TaskTable';
import TodoDrawer from './components/TodoDrawer';
import Toolbar from './components/Toolbar';
import ErrorBoundary from './components/ErrorBoundary';
import { useStore } from './store';
import { ERR_CODE_LABEL, type Diagnostic } from '../shared/types';

/* ============================ 诊断条 ============================ */

function DiagnosticsBar(): JSX.Element | null {
  const diagnostics = useStore((s) => s.diagnostics);
  const plan = useStore((s) => s.plan);
  const selectTask = useStore((s) => s.selectTask);
  const [open, setOpen] = useState(true);

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
    return t ? `行${t.seq}` : taskId;
  };

  const renderItem = (d: Diagnostic, i: number): JSX.Element => (
    <button
      key={`${d.code}-${d.taskId ?? ''}-${i}`}
      type="button"
      onClick={() => d.taskId && selectTask(d.taskId)}
      className={`mr-2 mb-1 inline-flex max-w-full items-center gap-1 rounded border px-2 py-[2px] text-left text-[12px] ${
        d.level === 'error'
          ? 'border-red-300 bg-red-50 text-red-700 hover:bg-red-100'
          : 'border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100'
      }`}
      title={d.message}
    >
      <span className="font-semibold">{seqOf(d.taskId)}</span>
      <span className="opacity-70">[{d.code}]</span>
      <span className="truncate">{ERR_CODE_LABEL[d.code] ?? ''}：{d.message}</span>
    </button>
  );

  return (
    <div className="border-b border-slate-200 bg-slate-50 px-3 py-1">
      <div className="flex items-center gap-3">
        <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-red-600">
          <ErrorOutlineIcon fontSize="inherit" /> {errors.length} 个错误
        </span>
        <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-amber-600">
          <WarningAmberIcon fontSize="inherit" /> {warns.length} 个提醒
        </span>
        <span className="text-[12px] text-slate-500">（错误会阻止保存，点击可定位到行）</span>
        <div className="flex-1" />
        <IconButton onClick={() => setOpen((v) => !v)} title={open ? '折叠' : '展开'}>
          {open ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
        </IconButton>
      </div>
      <Collapse in={open}>
        <div className="max-h-24 overflow-auto pt-1">
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
  if (calendarLoading || !calendar) return null;

  const curYear = new Date().getFullYear();
  const covered = calendar.coveredYears.has(curYear);

  if (covered) {
    const years = [...calendar.coveredYears].sort((a, b) => a - b).join('、');
    return (
      <div className="pg-banner pg-banner--ok">
        <span className="pg-banner__dot" />
        工作日历已生效（覆盖年份 {years}）
      </div>
    );
  }
  return (
    <div className="pg-banner pg-banner--warn">
      <span className="pg-banner__dot pg-banner__dot--warn" />
      当前年份（{curYear}）未在日历覆盖范围内，已降级为仅周末规则
    </div>
  );
}

/* ============================ 空态 ============================ */

function EmptyState(): JSX.Element {
  const openDialog = useStore((s) => s.openDialog);
  const user = useStore((s) => s.session.user);
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-slate-500">
      <div className="text-[15px]">尚未打开任何计划</div>
      <div className="flex gap-2">
        <Button variant="contained" disabled={!user} onClick={() => openDialog('planPicker')}>
          打开 / 新建计划
        </Button>
      </div>
      {!user && <div className="text-[12px]">请先选择身份</div>}
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
        <div className="flex items-center gap-2 border-b border-amber-300 bg-amber-50 px-3 py-1 text-[12px] text-amber-800">
          <Chip size="small" color="warning" label={`正在预览 v${preview.version}（只读）`} />
          <span className="truncate">
            由 {preview.editor} 提交：{preview.notes}
          </span>
          <div className="flex-1" />
          <Button size="small" variant="outlined" color="warning" onClick={() => void exitPreview()}>
            退出预览
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
            <PanelResizeHandle className="w-[4px] cursor-col-resize bg-slate-200 transition-colors hover:bg-blue-400" />
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
