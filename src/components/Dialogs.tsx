/**
 * src/components/Dialogs.tsx —— 全部对话框集合。
 *
 *   PlanPickerDialog  计划列表 + 新建计划（名称 + 首版变更纪要必填）
 *   SaveNotesDialog   保存：变更纪要必填（前端禁用 + 服务端二次校验，K12），失败展示 diagnostics
 *   HistoryDrawer     版本列表 → 预览（只读）/ 回滚为新版本（二次确认 + 纪要必填）
 *   NonWorkingDayDialog 非工作日确认
 *   CalendarSettingsDialog 工作日历设置
 *   ExportTodosDialog Markdown TODO 导出（U05）
 *
 * 约束：所有版本号一律由服务端生成，此处显示的「将生成 v(n+1)」仅为预期值提示（K13）。
 * v1.2.0：文案全部走 i18n（t('dlg.*')）；旧 UserGateDialog 已由 AuthGate 取代并删除。
 */

import { useEffect, useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import Drawer from '@mui/material/Drawer';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import TextField from '@mui/material/TextField';
import CloseIcon from '@mui/icons-material/Close';
import { useStore } from '../store';
import { formatTimestampLocal, isValidISODate, nextWorkingDay } from '../../shared/datetime';
import { NOTES_MAX_LEN, type CalendarConfigData, type Diagnostic } from '../../shared/types';
import { useT, errLabel } from '../i18n';

/* ============================ 公共片段 ============================ */

interface NotesFieldProps {
  value: string;
  onChange: (v: string) => void;
  label?: string;
  autoFocus?: boolean;
}

/** 变更纪要输入框（必填，长度上限 NOTES_MAX_LEN） */
function NotesField({ value, onChange, label, autoFocus = false }: NotesFieldProps): JSX.Element {
  const tr = useT();
  const over = value.length > NOTES_MAX_LEN;
  return (
    <TextField
      label={label ?? tr('dlg.notesLabel')}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      multiline
      minRows={3}
      maxRows={8}
      fullWidth
      autoFocus={autoFocus}
      error={over}
      inputProps={{ maxLength: NOTES_MAX_LEN + 50 }}
      helperText={tr('dlg.notesHelper', { n: value.length, max: NOTES_MAX_LEN })}
      placeholder={tr('dlg.notesPlaceholder')}
    />
  );
}

function DiagnosticList({ items }: { items: Diagnostic[] }): JSX.Element | null {
  const tr = useT();
  if (items.length === 0) return null;
  return (
    <Alert severity="error" className="mt-2">
      <div className="mb-1 font-semibold">{tr('dlg.serverRejected')}</div>
      <ul className="ml-4 list-disc">
        {items.map((d, i) => (
          <li key={`${d.code}-${d.taskId ?? ''}-${i}`} className="text-[12px]">
            [{d.code}] {errLabel(d.code)}：{d.message}
          </li>
        ))}
      </ul>
    </Alert>
  );
}

/* ============================ 计划选择 / 新建 ============================ */

function PlanPickerDialog(): JSX.Element {
  const open = useStore((s) => s.dialogs.planPicker);
  const plans = useStore((s) => s.plans);
  const busy = useStore((s) => s.busy);
  const currentPlanId = useStore((s) => s.plan?.planId ?? null);
  const listPlans = useStore((s) => s.listPlans);
  const openPlan = useStore((s) => s.openPlan);
  const createPlan = useStore((s) => s.createPlan);
  const closeDialog = useStore((s) => s.closeDialog);
  const tr = useT();

  const [creating, setCreating] = useState<boolean>(false);
  const [name, setName] = useState<string>('');
  const [notes, setNotes] = useState<string>('创建计划');
  const [skipHolidays, setSkipHolidays] = useState<boolean>(false);

  useEffect(() => {
    if (open) void listPlans();
  }, [open, listPlans]);

  useEffect(() => {
    if (!open) {
      setCreating(false);
      setName('');
      setNotes('创建计划');
      setSkipHolidays(false);
    }
  }, [open]);

  const canCreate = name.trim() !== '' && notes.trim() !== '' && notes.length <= NOTES_MAX_LEN && !busy;

  return (
    <Dialog open={open} maxWidth="sm" fullWidth onClose={() => closeDialog('planPicker')}>
      <DialogTitle className="flex items-center justify-between">
        <span>{tr('dlg.openOrCreate')}</span>
        <IconButton size="small" onClick={() => closeDialog('planPicker')}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        {plans.length === 0 ? (
          <Alert severity="info">{tr('dlg.noPlans')}</Alert>
        ) : (
          <List dense>
            {plans.map((p) => (
              <ListItemButton
                key={p.planId}
                selected={p.planId === currentPlanId}
                onClick={() => void openPlan(p.planId)}
              >
                <ListItemText
                  primary={
                    <span className="flex items-center gap-2">
                      <span className="font-medium">{p.name}</span>
                      <Chip size="small" variant="outlined" label={`v${p.version}`} />
                      <Chip size="small" variant="outlined" label={tr('dlg.rowCount', { n: p.taskCount })} />
                    </span>
                  }
                  secondary={tr('dlg.lastModified', { time: formatTimestampLocal(p.updatedAt), by: p.updatedBy })}
                />
              </ListItemButton>
            ))}
          </List>
        )}

        <Divider className="my-3" />

        {creating ? (
          <div className="flex flex-col gap-3">
            <TextField
              label={tr('dlg.planName')}
              value={name}
              autoFocus
              fullWidth
              onChange={(e) => setName(e.target.value)}
              placeholder={tr('dlg.planNamePlaceholder')}
            />
            <NotesField value={notes} onChange={setNotes} label={tr('dlg.firstNotesLabel')} />
            <FormControlLabel
              control={
                <Checkbox
                  size="small"
                  checked={skipHolidays}
                  onChange={(e) => setSkipHolidays(e.target.checked)}
                />
              }
              label={
                <span className="flex flex-col text-[13px]">
                  <span>{tr('dlg.skipHolidays')}</span>
                  <span className="text-[11px] text-slate-500">{tr('dlg.skipHolidaysHint')}</span>
                </span>
              }
            />
          </div>
        ) : (
          <Button variant="outlined" onClick={() => setCreating(true)}>
            {tr('dlg.newPlan')}
          </Button>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={() => closeDialog('planPicker')}>{tr('common.cancel')}</Button>
        {creating && (
          <Button
            variant="contained"
            disabled={!canCreate}
            onClick={() => void createPlan(name.trim(), notes.trim(), skipHolidays)}
          >
            {tr('dlg.create')}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

/* ============================ 保存 ============================ */

function SaveNotesDialog(): JSX.Element {
  const open = useStore((s) => s.dialogs.save);
  const plan = useStore((s) => s.plan);
  const busy = useStore((s) => s.busy);
  const saveDiagnostics = useStore((s) => s.saveDiagnostics);
  const save = useStore((s) => s.save);
  const closeDialog = useStore((s) => s.closeDialog);
  const tr = useT();

  const [notes, setNotes] = useState<string>('');

  useEffect(() => {
    if (open) setNotes('');
  }, [open]);

  const expected = plan ? plan.version + 1 : 1;
  const canSubmit = notes.trim() !== '' && notes.length <= NOTES_MAX_LEN && !busy;

  return (
    <Dialog open={open} maxWidth="sm" fullWidth onClose={() => closeDialog('save')}>
      <DialogTitle>{tr('dlg.saveTitle')}</DialogTitle>
      <DialogContent dividers>
        <DialogContentText className="mb-2 text-[12px]">
          {tr('dlg.saveBody', { next: expected, cur: plan?.version ?? '-' })}
        </DialogContentText>
        <NotesField value={notes} onChange={setNotes} autoFocus />
        <DiagnosticList items={saveDiagnostics} />
      </DialogContent>
      <DialogActions>
        <Button onClick={() => closeDialog('save')}>{tr('common.cancel')}</Button>
        <Button variant="contained" disabled={!canSubmit} onClick={() => void save(notes.trim())}>
          {tr('common.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/* ============================ 变更记录 ============================ */

function HistoryDrawer(): JSX.Element {
  const open = useStore((s) => s.dialogs.history);
  const history = useStore((s) => s.history);
  const plan = useStore((s) => s.plan);
  const preview = useStore((s) => s.preview);
  const busy = useStore((s) => s.busy);
  const mode = useStore((s) => s.session.mode);
  const loadHistory = useStore((s) => s.loadHistory);
  const previewVersion = useStore((s) => s.previewVersion);
  const restoreVersion = useStore((s) => s.restoreVersion);
  const closeDialog = useStore((s) => s.closeDialog);
  const tr = useT();

  const [restoreTarget, setRestoreTarget] = useState<number | null>(null);
  const [notes, setNotes] = useState<string>('');

  useEffect(() => {
    if (open) void loadHistory();
  }, [open, loadHistory]);

  const sorted = useMemo(() => [...history].sort((a, b) => b.version - a.version), [history]);

  const canRestore = restoreTarget !== null && notes.trim() !== '' && notes.length <= NOTES_MAX_LEN && !busy;

  const openRestore = (version: number): void => {
    setRestoreTarget(version);
    setNotes(tr('dlg.restoreNotesDefault', { v: version }));
  };

  return (
    <>
      <Drawer anchor="right" open={open} onClose={() => closeDialog('history')}>
        <div className="flex h-full w-[420px] flex-col">
          <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
            <div className="text-[14px] font-semibold">
              {tr('dlg.historyTitle')}
              {plan ? tr('dlg.historyPlanSuffix', { name: plan.name }) : ''}
              <span className="ml-2 text-[12px] font-normal text-slate-500">
                {tr('dlg.versionCount', { n: sorted.length })}
              </span>
            </div>
            <IconButton size="small" onClick={() => closeDialog('history')}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </div>

          {mode !== 'EDITING' && (
            <Alert severity="info" className="m-2 text-[12px]">
              {tr('dlg.historyHint')}
            </Alert>
          )}

          <div className="min-h-0 flex-1 overflow-auto">
            {sorted.length === 0 ? (
              <div className="p-3 text-[12px] text-slate-500">{tr('dlg.noHistory')}</div>
            ) : (
              <List dense>
                {sorted.map((v) => {
                  const isCurrent = plan !== null && preview === null && v.version === plan.version;
                  const isPreviewing = preview !== null && preview.version === v.version;
                  return (
                    <div key={v.version} className="border-b border-slate-100 px-3 py-2">
                      <div className="flex items-center gap-2">
                        <Chip size="small" color={isCurrent ? 'primary' : 'default'} label={`v${v.version}`} />
                        <span className="text-[12px] text-slate-600">{formatTimestampLocal(v.timestamp)}</span>
                        <span className="text-[12px] font-medium">{v.editor}</span>
                        {isCurrent && <Chip size="small" variant="outlined" label={tr('dlg.current')} />}
                        {isPreviewing && <Chip size="small" color="warning" label={tr('dlg.previewing')} />}
                      </div>
                      <div className="mt-1 whitespace-pre-wrap break-words text-[12px] text-slate-700">
                        {v.notes}
                      </div>
                      <div className="mt-1 flex gap-2">
                        <Button size="small" variant="text" onClick={() => void previewVersion(v.version)}>
                          {tr('dlg.preview')}
                        </Button>
                        <Button
                          size="small"
                          variant="text"
                          color="warning"
                          disabled={mode !== 'EDITING'}
                          onClick={() => openRestore(v.version)}
                        >
                          {tr('dlg.restoreAsNew')}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </List>
            )}
          </div>
        </div>
      </Drawer>

      {/* 回滚二次确认 */}
      <Dialog open={restoreTarget !== null} maxWidth="sm" fullWidth onClose={() => setRestoreTarget(null)}>
        <DialogTitle>{tr('dlg.restoreAsNew')}</DialogTitle>
        <DialogContent dividers>
          <DialogContentText className="mb-2 text-[12px]">
            {tr('dlg.restoreBody', { target: restoreTarget ?? '-', next: plan ? plan.version + 1 : '-' })}
          </DialogContentText>
          <NotesField value={notes} onChange={setNotes} label={tr('dlg.restoreReasonLabel')} autoFocus />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRestoreTarget(null)}>{tr('common.cancel')}</Button>
          <Button
            variant="contained"
            color="warning"
            disabled={!canRestore}
            onClick={() => {
              const target = restoreTarget;
              setRestoreTarget(null);
              if (target !== null) void restoreVersion(target, notes.trim());
            }}
          >
            {tr('dlg.confirmRestore')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

/* ============================ 非工作日确认 ============================ */

function NonWorkingDayDialog(): JSX.Element {
  const pending = useStore((s) => s.pendingNonWorking);
  const calendar = useStore((s) => s.calendar);
  const updateCell = useStore((s) => s.updateCell);
  const close = useStore((s) => s.closeNonWorkingPrompt);
  const tr = useT();

  const open = pending !== null;
  const date = pending?.value ?? '';
  const label = calendar && date ? calendar.labelOf(date) : null;
  const display = label ?? tr('dlg.weekend');

  const keep = (): void => {
    if (!pending) return;
    updateCell(pending.taskId, pending.field, pending.value);
    close();
  };

  const defer = (): void => {
    if (!pending || !calendar) {
      close();
      return;
    }
    updateCell(pending.taskId, pending.field, nextWorkingDay(pending.value, calendar));
    close();
  };

  return (
    <Dialog open={open} maxWidth="xs" fullWidth onClose={close}>
      <DialogTitle>{tr('dlg.nonWorkTitle')}</DialogTitle>
      <DialogContent dividers>
        <DialogContentText className="text-[13px]">
          {tr('dlg.nonWorkBody', {
            field: pending?.field === 'start' ? tr('col.start') : tr('col.end'),
            date,
            display,
          })}
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={close}>{tr('common.cancel')}</Button>
        <Button color="warning" variant="outlined" onClick={defer}>
          {tr('dlg.deferToNext', { d: calendar && date ? nextWorkingDay(date, calendar) : '' })}
        </Button>
        <Button variant="contained" onClick={keep}>
          {tr('dlg.keepDate')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/* ============================ 工作日历设置 ============================ */

interface CalendarSectionProps {
  title: string;
  items: string[];
  newVal: string;
  onNewChange: (v: string) => void;
  onAdd: (v: string) => void;
  onRemove: (d: string) => void;
}

function CalendarSection({ title, items, newVal, onNewChange, onAdd, onRemove }: CalendarSectionProps): JSX.Element {
  const tr = useT();
  return (
    <div className="mb-3">
      <div className="mb-1 text-[12px] font-semibold text-slate-700">{title}</div>
      <div className="flex flex-wrap gap-1">
        {items.length === 0 && <span className="text-[12px] text-slate-400">{tr('dlg.emptyList')}</span>}
        {items.map((d) => (
          <Chip key={d} size="small" label={d} onDelete={() => onRemove(d)} />
        ))}
      </div>
      <div className="mt-1 flex items-center gap-2">
        <TextField
          size="small"
          type="date"
          value={newVal}
          onChange={(e) => onNewChange(e.target.value)}
          InputLabelProps={{ shrink: true }}
        />
        <Button size="small" variant="outlined" disabled={!isValidISODate(newVal)} onClick={() => onAdd(newVal)}>
          {tr('common.add')}
        </Button>
      </div>
    </div>
  );
}

function ensureYear(cfg: CalendarConfigData, y: number): CalendarConfigData {
  if (!cfg.userHolidays[y]) cfg.userHolidays[y] = [];
  if (!cfg.makeup[y]) cfg.makeup[y] = [];
  if (!cfg.userRemoved[y]) cfg.userRemoved[y] = [];
  if (!cfg.coveredYears.includes(y)) cfg.coveredYears = [...cfg.coveredYears, y].sort((a, b) => a - b);
  return cfg;
}

function CalendarSettingsDialog(): JSX.Element | null {
  const open = useStore((s) => s.dialogs.calendar);
  const config = useStore((s) => s.calendarConfig);
  const saving = useStore((s) => s.calendarSaving);
  const user = useStore((s) => s.session.user);
  const closeDialog = useStore((s) => s.closeDialog);
  const saveCalendarConfig = useStore((s) => s.saveCalendarConfig);
  const tr = useT();

  const [draft, setDraft] = useState<CalendarConfigData | null>(null);
  const [year, setYear] = useState<number>(2026);
  const [newDate, setNewDate] = useState<{ hol: string; mk: string; rm: string }>({ hol: '', mk: '', rm: '' });

  const clone = (cfg: CalendarConfigData): CalendarConfigData =>
    JSON.parse(JSON.stringify(cfg)) as CalendarConfigData;

  useEffect(() => {
    if (open && config) {
      setDraft(clone(config));
      setYear(config.coveredYears[0] ?? new Date().getFullYear());
      setNewDate({ hol: '', mk: '', rm: '' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, config]);

  // 配置尚未加载（或弹窗尚未初始化 draft）时不渲染内容，避免空白弹窗闪烁
  if (!draft) return null;

  const addDate = (kind: 'hol' | 'mk' | 'rm', raw: string): void => {
    const d = raw.trim();
    if (!isValidISODate(d)) return;
    const y = Number(d.slice(0, 4));
    setDraft((prev) => {
      if (!prev) return prev;
      const cfg = ensureYear(clone(prev), y);
      const key = kind === 'hol' ? 'userHolidays' : kind === 'mk' ? 'makeup' : 'userRemoved';
      const arr = cfg[key][y];
      if (!arr.includes(d)) arr.push(d);
      arr.sort();
      return cfg;
    });
    setNewDate((p) => ({ ...p, [kind]: '' }));
  };

  const removeDate = (kind: 'hol' | 'mk' | 'rm', d: string): void => {
    const y = Number(d.slice(0, 4));
    setDraft((prev) => {
      if (!prev) return prev;
      const cfg = clone(prev);
      const key = kind === 'hol' ? 'userHolidays' : kind === 'mk' ? 'makeup' : 'userRemoved';
      if (cfg[key][y]) cfg[key][y] = cfg[key][y].filter((x) => x !== d);
      return cfg;
    });
  };

  const canSubmit = !!user && !saving;

  const submit = (): void => {
    if (!draft || !user) return;
    void saveCalendarConfig(draft, user).then(() => closeDialog('calendar'));
  };

  const yearList = draft.coveredYears;
  const hol = draft.userHolidays[year] ?? [];
  const mk = draft.makeup[year] ?? [];
  const rm = draft.userRemoved[year] ?? [];

  return (
    <Dialog open={open} maxWidth="sm" fullWidth onClose={() => closeDialog('calendar')}>
      <DialogTitle className="flex items-center justify-between">
        <span>{tr('dlg.calendarTitle')}</span>
        <IconButton size="small" onClick={() => closeDialog('calendar')}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        <DialogContentText className="mb-2 text-[12px]">{tr('dlg.calendarHint')}</DialogContentText>

        <div className="mb-3 flex flex-wrap gap-1">
          {yearList.map((y) => (
            <Chip
              key={y}
              size="small"
              clickable
              color={y === year ? 'primary' : 'default'}
              label={String(y)}
              onClick={() => setYear(y)}
            />
          ))}
          <Chip
            size="small"
            variant="outlined"
            label={tr('dlg.addCurrentYear')}
            onClick={() => {
              const y = new Date().getFullYear();
              setDraft((prev) => (prev ? ensureYear(clone(prev), y) : prev));
              setYear(y);
            }}
          />
        </div>

        <CalendarSection
          title={tr('dlg.userHolidays')}
          items={hol}
          newVal={newDate.hol}
          onNewChange={(v) => setNewDate((p) => ({ ...p, hol: v }))}
          onAdd={(v) => addDate('hol', v)}
          onRemove={(d) => removeDate('hol', d)}
        />
        <CalendarSection
          title={tr('dlg.makeupDays')}
          items={mk}
          newVal={newDate.mk}
          onNewChange={(v) => setNewDate((p) => ({ ...p, mk: v }))}
          onAdd={(v) => addDate('mk', v)}
          onRemove={(d) => removeDate('mk', d)}
        />
        <CalendarSection
          title={tr('dlg.userRemoved')}
          items={rm}
          newVal={newDate.rm}
          onNewChange={(v) => setNewDate((p) => ({ ...p, rm: v }))}
          onAdd={(v) => addDate('rm', v)}
          onRemove={(d) => removeDate('rm', d)}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={() => closeDialog('calendar')}>{tr('common.cancel')}</Button>
        <Button variant="contained" disabled={!canSubmit} onClick={submit}>
          {saving ? tr('dlg.saving') : tr('common.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/* ============================ Markdown TODO 导出（U05 增量） ============================ */

/**
 * 范围选择 dialog。
 *  - 默认 scope=mine；未选身份时 mine 项 disabled + 提示
 *  - 确认 → store.exportTodos(scope) → 关闭 dialog；服务端 Content-Disposition 触发下载
 */
function ExportTodosDialog(): JSX.Element | null {
  const open = useStore((s) => s.dialogs.exportTodos);
  const user = useStore((s) => s.session.user);
  const closeDialog = useStore((s) => s.closeDialog);
  const exportTodos = useStore((s) => s.exportTodos);
  const tr = useT();

  const [scope, setScope] = useState<'mine' | 'all'>('mine');

  // 每次打开重置回 mine（用户上次选 all 时，再次进入仍以 mine 兜底，避免误触"全部"）
  useEffect(() => {
    if (open) setScope('mine');
  }, [open]);

  const handleClose = (): void => {
    closeDialog('exportTodos');
  };

  const handleOk = (): void => {
    exportTodos(scope);
    handleClose();
  };

  const hasUser = !!user && user.trim() !== '';
  const userLabel = hasUser ? user : tr('exportMd.noIdentity');

  return (
    <Dialog open={open} maxWidth="xs" fullWidth onClose={handleClose}>
      <DialogTitle className="flex items-center justify-between">
        <span>{tr('exportMd.title')}</span>
        <IconButton size="small" onClick={handleClose} aria-label={tr('common.close')}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        <DialogContentText className="mb-2 text-[13px]">{tr('exportMd.desc')}</DialogContentText>
        <RadioGroup
          value={scope}
          onChange={(e) => setScope(e.target.value as 'mine' | 'all')}
        >
          <FormControlLabel
            value="mine"
            control={<Radio />}
            disabled={!hasUser}
            label={
              <span>
                {tr('exportMd.mine')}
                <span className={hasUser ? 'ml-1 text-slate-500' : 'ml-1 text-slate-400'}>
                  （{userLabel}）
                </span>
              </span>
            }
          />
          <FormControlLabel
            value="all"
            control={<Radio />}
            label={tr('exportMd.allLabel')}
          />
        </RadioGroup>
        {!hasUser && (
          <Alert severity="info" className="mt-2 text-[12px]">
            {tr('exportMd.needIdentity')}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>{tr('common.cancel')}</Button>
        <Button
          variant="contained"
          onClick={handleOk}
          disabled={scope === 'mine' && !hasUser}
        >
          {tr('exportMd.download')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/* ============================ 汇总导出 ============================ */

export default function Dialogs(): JSX.Element {
  return (
    <>
      <PlanPickerDialog />
      <SaveNotesDialog />
      <HistoryDrawer />
      <NonWorkingDayDialog />
      <CalendarSettingsDialog />
      <ExportTodosDialog />
    </>
  );
}
