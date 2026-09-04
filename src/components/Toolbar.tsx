/**
 * src/components/Toolbar.tsx —— 工具栏。
 *
 * 编辑锁按钮三态（§2.6 / 需求 12）：
 *   IDLE            → 「编辑」可点
 *   我持有           → 「正在编辑（我）· 退出编辑」
 *   他人持有         → 「Bob 正在编辑」禁用 + Tooltip
 */

import { useMemo, useRef, useState } from 'react';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Tooltip from '@mui/material/Tooltip';
import AddIcon from '@mui/icons-material/Add';
import DownloadIcon from '@mui/icons-material/Download';
import EditIcon from '@mui/icons-material/Edit';
import FileOpenIcon from '@mui/icons-material/FileOpen';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import HistoryIcon from '@mui/icons-material/History';
import LockIcon from '@mui/icons-material/Lock';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import PersonIcon from '@mui/icons-material/Person';
import RefreshIcon from '@mui/icons-material/Refresh';
import SaveIcon from '@mui/icons-material/Save';
import TodayIcon from '@mui/icons-material/Today';
import { useCanEdit, useHasError, useStore } from '../store';
import type { ZoomLevel } from '../../shared/types';

export default function Toolbar(): JSX.Element {
  const plan = useStore((s) => s.plan);
  const session = useStore((s) => s.session);
  const lock = useStore((s) => s.lock);
  const dirty = useStore((s) => s.dirty);
  const zoom = useStore((s) => s.zoom);
  const preview = useStore((s) => s.preview);
  const busy = useStore((s) => s.busy);

  const openDialog = useStore((s) => s.openDialog);
  const enterEditMode = useStore((s) => s.enterEditMode);
  const exitEditMode = useStore((s) => s.exitEditMode);
  const setZoom = useStore((s) => s.setZoom);
  const exportPlan = useStore((s) => s.exportPlan);
  const jumpToday = useStore((s) => s.jumpToday);
  const refreshPlan = useStore((s) => s.refreshPlan);
  const importPlan = useStore((s) => s.importPlan);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const canEdit = useCanEdit();
  const hasError = useHasError();

  const [exportAnchor, setExportAnchor] = useState<HTMLElement | null>(null);

  const lockLabel = useMemo(() => {
    if (canEdit) return '正在编辑（我）';
    if (lock?.status === 'EDITING' && lock.holder && lock.holder !== session.user) {
      return `${lock.holder} 正在编辑`;
    }
    return '编辑';
  }, [canEdit, lock, session.user]);

  const otherHolding = lock?.status === 'EDITING' && !!lock.holder && lock.holder !== session.user;
  const saveDisabled = !canEdit || !dirty || hasError || busy;

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-slate-300 bg-white px-3 py-[6px]">
      {/* 计划名 + 版本 */}
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate text-[14px] font-semibold">{plan ? plan.name : '（未打开计划）'}</span>
        {plan && <Chip size="small" variant="outlined" label={`v${plan.version}`} />}
        {dirty && <Chip size="small" color="warning" label="未保存" />}
      </div>

      <Divider orientation="vertical" flexItem />

      {/* 身份 */}
      <Tooltip title="点击切换身份（无登录，仅用于记录变更人）">
        <Button startIcon={<PersonIcon />} variant="text" onClick={() => openDialog('user')}>
          {session.user ?? '选择身份'}
        </Button>
      </Tooltip>

      <Divider orientation="vertical" flexItem />

      {/* 编辑锁 */}
      <Tooltip title={otherHolding ? `编辑权由 ${lock?.holder} 持有，30 秒无心跳后自动释放` : '同一时刻仅一人可编辑'}>
        <span>
          {canEdit ? (
            <Button
              startIcon={<LockIcon />}
              color="success"
              variant="contained"
              onClick={() => void exitEditMode()}
            >
              {lockLabel} · 退出编辑
            </Button>
          ) : (
            <Button
              startIcon={<EditIcon />}
              variant="outlined"
              disabled={!plan || otherHolding || !session.user || preview !== null}
              onClick={() => void enterEditMode()}
            >
              {lockLabel}
            </Button>
          )}
        </span>
      </Tooltip>

      {/* 保存 */}
      <Tooltip
        title={
          hasError
            ? '存在 error 级诊断，请先修复后再保存'
            : !canEdit
              ? '请先进入编辑模式'
              : !dirty
                ? '没有需要保存的修改'
                : '保存并生成新版本（变更纪要必填）'
        }
      >
        <span>
          <Button startIcon={<SaveIcon />} variant="contained" disabled={saveDisabled} onClick={() => openDialog('save')}>
            保存
          </Button>
        </span>
      </Tooltip>

      <Button startIcon={<FolderOpenIcon />} variant="text" disabled={!session.user} onClick={() => openDialog('planPicker')}>
        打开
      </Button>
      <Button startIcon={<FileOpenIcon />} variant="text" disabled={!session.user} onClick={() => fileInputRef.current?.click()}>
        导入
      </Button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".mpp,.mpx,.xml,.xer,.pod"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void importPlan(f);
        }}
      />
      <Button startIcon={<AddIcon />} variant="text" disabled={!session.user} onClick={() => openDialog('planPicker')}>
        新建
      </Button>
      <Button startIcon={<RefreshIcon />} variant="text" disabled={!plan} onClick={() => void refreshPlan()}>
        刷新
      </Button>

      <Divider orientation="vertical" flexItem />

      {/* 导出 */}
      <Button
        startIcon={<DownloadIcon />}
        variant="text"
        disabled={!plan}
        onClick={(e) => setExportAnchor(e.currentTarget)}
      >
        导出
      </Button>
      <Menu anchorEl={exportAnchor} open={exportAnchor !== null} onClose={() => setExportAnchor(null)}>
        <MenuItem
          onClick={() => {
            setExportAnchor(null);
            exportPlan('mspdi');
          }}
        >
          MS Project XML（MSPDI）
        </MenuItem>
        <MenuItem
          onClick={() => {
            setExportAnchor(null);
            exportPlan('csv');
          }}
        >
          CSV（Excel 可直接打开）
        </MenuItem>
        <MenuItem
          onClick={() => {
            setExportAnchor(null);
            openDialog('exportTodos');
          }}
        >
          Markdown 清单…
        </MenuItem>
      </Menu>

      <Button startIcon={<HistoryIcon />} variant="text" disabled={!plan} onClick={() => openDialog('history')}>
        变更记录
      </Button>

      <Button
        startIcon={<CalendarMonthIcon />}
        variant="text"
        disabled={!session.user}
        onClick={() => openDialog('calendar')}
      >
        日历设置
      </Button>

      <div className="flex-1" />

      {/* 缩放 + 今天 */}
      <ToggleButtonGroup
        size="small"
        exclusive
        value={zoom}
        onChange={(_e, v: ZoomLevel | null) => v && setZoom(v)}
      >
        <ToggleButton value="day">日</ToggleButton>
        <ToggleButton value="week">周</ToggleButton>
        <ToggleButton value="month">月</ToggleButton>
      </ToggleButtonGroup>
      <Button startIcon={<TodayIcon />} variant="text" disabled={!plan} onClick={jumpToday}>
        今天
      </Button>
    </div>
  );
}
