/**
 * src/components/Toolbar.tsx —— 工具栏。
 *
 * 编辑锁按钮三态（§2.6 / 需求 12）：
 *   IDLE            → 「编辑」可点
 *   我持有           → 「正在编辑（我）· 退出编辑」
 *   他人持有         → 「Bob 正在编辑」禁用 + Tooltip
 *
 * v1.2.0：全部文案走 i18n（t('toolbar.*')）；右下角新增 CN/EN 语言切换按钮。
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
import LogoutIcon from '@mui/icons-material/Logout';
import PersonIcon from '@mui/icons-material/Person';
import GroupsIcon from '@mui/icons-material/Groups';
import RefreshIcon from '@mui/icons-material/Refresh';
import SaveIcon from '@mui/icons-material/Save';
import TodayIcon from '@mui/icons-material/Today';
import TranslateIcon from '@mui/icons-material/Translate';
import LightModeIcon from '@mui/icons-material/LightMode';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import DesktopWindowsIcon from '@mui/icons-material/DesktopWindows';
import { useCanEdit, useHasError, useStore } from '../store';
import { useT, useLangStore, langLabel } from '../i18n';
import { useThemeMode, type ThemeMode } from '../theme';
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
  const authed = useStore((s) => s.authed);
  const logout = useStore((s) => s.logout);
  const criticalPathOn = useStore((s) => s.criticalPathOn);
  const toggleCriticalPath = useStore((s) => s.toggleCriticalPath);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const canEdit = useCanEdit();
  const hasError = useHasError();

  const [exportAnchor, setExportAnchor] = useState<HTMLElement | null>(null);

  const tr = useT();
  const lang = useLangStore((s) => s.lang);
  const toggleLang = useLangStore((s) => s.toggle);
  const themeMode = useThemeMode();

  const themeButtons: { value: ThemeMode; icon: JSX.Element; label: string }[] = [
    { value: 'light', icon: <LightModeIcon fontSize="small" />, label: tr('toolbar.themeLight') },
    { value: 'dark', icon: <DarkModeIcon fontSize="small" />, label: tr('toolbar.themeDark') },
    { value: 'system', icon: <DesktopWindowsIcon fontSize="small" />, label: tr('toolbar.themeSystem') },
  ];

  const lockLabel = useMemo(() => {
    if (canEdit) return tr('toolbar.editingMe');
    if (lock?.status === 'EDITING' && lock.holder && lock.holder !== session.user) {
      return tr('toolbar.editingBy', { holder: lock.holder });
    }
    return tr('toolbar.edit');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEdit, lock, session.user, lang]);

  const otherHolding = lock?.status === 'EDITING' && !!lock.holder && lock.holder !== session.user;
  const saveDisabled = !canEdit || !dirty || hasError || busy;

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border-strong bg-surface px-3 py-[6px]">
      {/* 计划名 + 版本 */}
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate text-[14px] font-semibold">{plan ? plan.name : tr('toolbar.noPlan')}</span>
        {plan && <Chip size="small" variant="outlined" label={`v${plan.version}`} />}
        {dirty && <Chip size="small" color="warning" label={tr('toolbar.dirty')} />}
      </div>

      <Divider orientation="vertical" flexItem />

      {/* 身份 */}
      <Tooltip title={authed ? tr('toolbar.userTooltipAuthed') : tr('toolbar.userTooltipGuest')}>
        <Button startIcon={<PersonIcon />} variant="text" onClick={() => openDialog('user')}>
          {session.user ?? tr('toolbar.notLoggedIn')}
        </Button>
      </Tooltip>

      {/* 团队花名册（已登录才显示） */}
      {authed && (
        <Tooltip title={tr('toolbar.rosterTooltip')}>
          <Button startIcon={<GroupsIcon />} variant="text" onClick={() => openDialog('roster')}>
            {tr('toolbar.team')}
          </Button>
        </Tooltip>
      )}

      {/* 注销 */}
      {authed && (
        <Tooltip title={tr('toolbar.logoutTooltip')}>
          <Button startIcon={<LogoutIcon />} variant="text" onClick={() => void logout()}>
            {tr('toolbar.logout')}
          </Button>
        </Tooltip>
      )}

      <Divider orientation="vertical" flexItem />

      {/* 编辑锁 */}
      <Tooltip
        title={
          otherHolding
            ? tr('toolbar.lockHeldBy', { holder: lock?.holder ?? '' })
            : tr('toolbar.lockHint')
        }
      >
        <span>
          {canEdit ? (
            <Button
              startIcon={<LockIcon />}
              color="success"
              variant="contained"
              onClick={() => void exitEditMode()}
            >
              {tr('toolbar.exitEdit', { label: lockLabel })}
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
            ? tr('toolbar.saveTooltipError')
            : !canEdit
              ? tr('toolbar.saveTooltipNoEdit')
              : !dirty
                ? tr('toolbar.saveTooltipClean')
                : tr('toolbar.saveTooltipOk')
        }
      >
        <span>
          <Button startIcon={<SaveIcon />} variant="contained" disabled={saveDisabled} onClick={() => openDialog('save')}>
            {tr('toolbar.save')}
          </Button>
        </span>
      </Tooltip>

      <Button startIcon={<FolderOpenIcon />} variant="text" disabled={!session.user} onClick={() => openDialog('planPicker')}>
        {tr('toolbar.open')}
      </Button>
      <Button startIcon={<FileOpenIcon />} variant="text" disabled={!session.user} onClick={() => fileInputRef.current?.click()}>
        {tr('toolbar.import')}
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
        {tr('toolbar.new')}
      </Button>
      <Button startIcon={<RefreshIcon />} variant="text" disabled={!plan} onClick={() => void refreshPlan()}>
        {tr('toolbar.refresh')}
      </Button>

      <Divider orientation="vertical" flexItem />

      {/* 导出 */}
      <Button
        startIcon={<DownloadIcon />}
        variant="text"
        disabled={!plan}
        onClick={(e) => setExportAnchor(e.currentTarget)}
      >
        {tr('toolbar.export')}
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
          {tr('toolbar.exportCsvItem')}
        </MenuItem>
        <MenuItem
          onClick={() => {
            setExportAnchor(null);
            openDialog('exportTodos');
          }}
        >
          {tr('toolbar.exportMd')}
        </MenuItem>
      </Menu>

      <Button startIcon={<HistoryIcon />} variant="text" disabled={!plan} onClick={() => openDialog('history')}>
        {tr('toolbar.history')}
      </Button>

      <Button
        startIcon={<CalendarMonthIcon />}
        variant="text"
        disabled={!session.user}
        onClick={() => openDialog('calendar')}
      >
        {tr('toolbar.calendar')}
      </Button>

      <div className="flex-1" />

      {/* 语言切换 */}
      <Tooltip title={tr('toolbar.langTooltip')}>
        <Button startIcon={<TranslateIcon />} variant="text" onClick={toggleLang}>
          {langLabel(lang)}
        </Button>
      </Tooltip>

      {/* 缩放 + 今天 */}
      <ToggleButtonGroup
        size="small"
        exclusive
        value={zoom}
        onChange={(_e, v: ZoomLevel | null) => v && setZoom(v)}
      >
        <ToggleButton value="day">{tr('toolbar.zoomDay')}</ToggleButton>
        <ToggleButton value="week">{tr('toolbar.zoomWeek')}</ToggleButton>
        <ToggleButton value="month">{tr('toolbar.zoomMonth')}</ToggleButton>
      </ToggleButtonGroup>
      <Button startIcon={<TodayIcon />} variant="text" disabled={!plan} onClick={jumpToday}>
        {tr('toolbar.today')}
      </Button>

      {/* 关键路径开关（Q3-4，2026-09-08）：ToggleButton 独占式；开时叶子层显示红色下划线 + 甘特条下红线 */}
      <Tooltip title={tr('toolbar.criticalPathHint')}>
        <Button
          size="small"
          variant={criticalPathOn ? 'contained' : 'outlined'}
          color={criticalPathOn ? 'error' : 'inherit'}
          disabled={!plan}
          onClick={toggleCriticalPath}
          aria-pressed={criticalPathOn}
          sx={{ ml: 0.5 }}
        >
          {tr('toolbar.criticalPath')}
        </Button>
      </Tooltip>

      {/* 主题切换（2026-09-08）：三态 ToggleButtonGroup，互斥；图标 + 文字 tooltip */}
      <Tooltip title={tr('toolbar.themeHint')}>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={themeMode.mode}
          onChange={(_e, v: ThemeMode | null) => v && themeMode.setMode(v)}
          aria-label="theme-mode"
          sx={{ ml: 1 }}
        >
          {themeButtons.map((b) => (
            <ToggleButton key={b.value} value={b.value} aria-label={b.label} title={b.label}>
              {b.icon}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </Tooltip>
    </div>
  );
}
