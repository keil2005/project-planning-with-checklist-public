/**
 * src/components/Dialogs.tsx —— 全部对话框集合。
 *
 *   UserGateDialog    启动强制「登录」（来源 GET /api/users，选择后由 store 记入 localStorage），每次启动第一步
 *   PlanPickerDialog  计划列表 + 新建计划（名称 + 首版变更纪要必填）
 *   SaveNotesDialog   保存：变更纪要必填（前端禁用 + 服务端二次校验，K12），失败展示 diagnostics
 *   HistoryDrawer     版本列表 → 预览（只读）/ 回滚为新版本（二次确认 + 纪要必填）
 *
 * 约束：所有版本号一律由服务端生成，此处显示的「将生成 v(n+1)」仅为预期值提示（K13）。
 */

import { useEffect, useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import TextField from '@mui/material/TextField';
import CloseIcon from '@mui/icons-material/Close';
import { useStore } from '../store';
import { formatTimestampLocal, isValidISODate, nextWorkingDay } from '../../shared/datetime';
import { ERR_CODE_LABEL, NOTES_MAX_LEN, type CalendarConfigData, type Diagnostic } from '../../shared/types';

/* ============================ 公共片段 ============================ */

interface NotesFieldProps {
  value: string;
  onChange: (v: string) => void;
  label?: string;
  autoFocus?: boolean;
}

/** 变更纪要输入框（必填，长度上限 NOTES_MAX_LEN） */
function NotesField({ value, onChange, label = '变更纪要（必填）', autoFocus = false }: NotesFieldProps): JSX.Element {
  const over = value.length > NOTES_MAX_LEN;
  return (
    <TextField
      label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      multiline
      minRows={3}
      maxRows={8}
      fullWidth
      autoFocus={autoFocus}
      error={over}
      inputProps={{ maxLength: NOTES_MAX_LEN + 50 }}
      helperText={`${value.length}/${NOTES_MAX_LEN}　说明本次改了什么、为什么改，便于日后追溯`}
      placeholder="例：联调依赖调整为 3FF+1w，上线日相应后移"
    />
  );
}

function DiagnosticList({ items }: { items: Diagnostic[] }): JSX.Element | null {
  if (items.length === 0) return null;
  return (
    <Alert severity="error" className="mt-2">
      <div className="mb-1 font-semibold">服务端校验未通过，请先修复以下问题：</div>
      <ul className="ml-4 list-disc">
        {items.map((d, i) => (
          <li key={`${d.code}-${d.taskId ?? ''}-${i}`} className="text-[12px]">
            [{d.code}] {ERR_CODE_LABEL[d.code] ?? ''}：{d.message}
          </li>
        ))}
      </ul>
    </Alert>
  );
}

/* ============================ 身份选择 ============================ */

function UserGateDialog(): JSX.Element {
  const open = useStore((s) => s.dialogs.user);
  const users = useStore((s) => s.users);
  const current = useStore((s) => s.session.user);
  const setUser = useStore((s) => s.setUser);
  const closeDialog = useStore((s) => s.closeDialog);

  const [filter, setFilter] = useState<string>('');
  const forced = current === null;
  const shown = users.filter((u) => u.toLowerCase().includes(filter.trim().toLowerCase()));

  return (
    <Dialog
      open={open}
      maxWidth="xs"
      fullWidth
      disableEscapeKeyDown={forced}
      onClose={() => {
        if (!forced) closeDialog('user');
      }}
    >
      <DialogTitle>登录</DialogTitle>
      <DialogContent dividers>
        <DialogContentText className="mb-2 text-[12px]">
          请选择你的名字登录。名单为系统内置成员，可在表格「负责人」列联想选择；每次启动需先登录以确认本次操作人。
        </DialogContentText>
        <TextField
          className="mb-2"
          size="small"
          fullWidth
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="筛选名单（子串，大小写不敏感）"
          inputProps={{ 'aria-label': '筛选用户名单' }}
        />
        <List dense>
          {shown.length === 0 ? (
            <ListItemText primary="无匹配名单" primaryTypographyProps={{ variant: 'body2', color: 'text.secondary' }} />
          ) : (
            shown.map((u) => (
              <ListItemButton key={u} selected={u === current} onClick={() => void setUser(u)}>
                <ListItemText primary={u} />
                {u === current && <Chip size="small" label="当前" />}
              </ListItemButton>
            ))
          )}
        </List>
      </DialogContent>
      <DialogActions>
        <Button disabled={forced} onClick={() => closeDialog('user')}>
          关闭
        </Button>
      </DialogActions>
    </Dialog>
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

  const [creating, setCreating] = useState<boolean>(false);
  const [name, setName] = useState<string>('');
  const [notes, setNotes] = useState<string>('创建计划');

  useEffect(() => {
    if (open) void listPlans();
  }, [open, listPlans]);

  useEffect(() => {
    if (!open) {
      setCreating(false);
      setName('');
      setNotes('创建计划');
    }
  }, [open]);

  const canCreate = name.trim() !== '' && notes.trim() !== '' && notes.length <= NOTES_MAX_LEN && !busy;

  return (
    <Dialog open={open} maxWidth="sm" fullWidth onClose={() => closeDialog('planPicker')}>
      <DialogTitle className="flex items-center justify-between">
        <span>打开或新建计划</span>
        <IconButton size="small" onClick={() => closeDialog('planPicker')}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        {plans.length === 0 ? (
          <Alert severity="info">还没有任何计划，请先新建一个。</Alert>
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
                      <Chip size="small" variant="outlined" label={`${p.taskCount} 行`} />
                    </span>
                  }
                  secondary={`${formatTimestampLocal(p.updatedAt)}　最后修改：${p.updatedBy}`}
                />
              </ListItemButton>
            ))}
          </List>
        )}

        <Divider className="my-3" />

        {creating ? (
          <div className="flex flex-col gap-3">
            <TextField
              label="计划名称"
              value={name}
              autoFocus
              fullWidth
              onChange={(e) => setName(e.target.value)}
              placeholder="例：2026 Q4 产品交付计划"
            />
            <NotesField value={notes} onChange={setNotes} label="首版变更纪要（必填）" />
          </div>
        ) : (
          <Button variant="outlined" onClick={() => setCreating(true)}>
            新建计划
          </Button>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={() => closeDialog('planPicker')}>取消</Button>
        {creating && (
          <Button
            variant="contained"
            disabled={!canCreate}
            onClick={() => void createPlan(name.trim(), notes.trim())}
          >
            创建
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

  const [notes, setNotes] = useState<string>('');

  useEffect(() => {
    if (open) setNotes('');
  }, [open]);

  const expected = plan ? plan.version + 1 : 1;
  const canSubmit = notes.trim() !== '' && notes.length <= NOTES_MAX_LEN && !busy;

  return (
    <Dialog open={open} maxWidth="sm" fullWidth onClose={() => closeDialog('save')}>
      <DialogTitle>保存并生成新版本</DialogTitle>
      <DialogContent dividers>
        <DialogContentText className="mb-2 text-[12px]">
          将在服务端追加一条不可篡改的历史记录，预计生成 <b>v{expected}</b>
          （最终版本号由服务端分配）。当前基线版本 v{plan?.version ?? '-'}。
        </DialogContentText>
        <NotesField value={notes} onChange={setNotes} autoFocus />
        <DiagnosticList items={saveDiagnostics} />
      </DialogContent>
      <DialogActions>
        <Button onClick={() => closeDialog('save')}>取消</Button>
        <Button variant="contained" disabled={!canSubmit} onClick={() => void save(notes.trim())}>
          保存
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

  const [restoreTarget, setRestoreTarget] = useState<number | null>(null);
  const [notes, setNotes] = useState<string>('');

  useEffect(() => {
    if (open) void loadHistory();
  }, [open, loadHistory]);

  const sorted = useMemo(() => [...history].sort((a, b) => b.version - a.version), [history]);

  const canRestore = restoreTarget !== null && notes.trim() !== '' && notes.length <= NOTES_MAX_LEN && !busy;

  const openRestore = (version: number): void => {
    setRestoreTarget(version);
    setNotes(`回滚到 v${version}`);
  };

  return (
    <>
      <Drawer anchor="right" open={open} onClose={() => closeDialog('history')}>
        <div className="flex h-full w-[420px] flex-col">
          <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
            <div className="text-[14px] font-semibold">
              变更记录{plan ? ` · ${plan.name}` : ''}
              <span className="ml-2 text-[12px] font-normal text-slate-500">共 {sorted.length} 个版本</span>
            </div>
            <IconButton size="small" onClick={() => closeDialog('history')}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </div>

          {mode !== 'EDITING' && (
            <Alert severity="info" className="m-2 text-[12px]">
              回滚属于写操作，需先在工具栏获取编辑权；预览为只读操作，随时可用。
            </Alert>
          )}

          <div className="min-h-0 flex-1 overflow-auto">
            {sorted.length === 0 ? (
              <div className="p-3 text-[12px] text-slate-500">暂无历史记录。</div>
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
                        {isCurrent && <Chip size="small" variant="outlined" label="当前" />}
                        {isPreviewing && <Chip size="small" color="warning" label="预览中" />}
                      </div>
                      <div className="mt-1 whitespace-pre-wrap break-words text-[12px] text-slate-700">
                        {v.notes}
                      </div>
                      <div className="mt-1 flex gap-2">
                        <Button size="small" variant="text" onClick={() => void previewVersion(v.version)}>
                          预览
                        </Button>
                        <Button
                          size="small"
                          variant="text"
                          color="warning"
                          disabled={mode !== 'EDITING'}
                          onClick={() => openRestore(v.version)}
                        >
                          回滚为新版本
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
        <DialogTitle>回滚为新版本</DialogTitle>
        <DialogContent dividers>
          <DialogContentText className="mb-2 text-[12px]">
            将把 <b>v{restoreTarget}</b> 的内容作为一个<b>新版本</b>追加到历史末尾（历史只增不改，原版本不会被删除）。
            预计生成 v{plan ? plan.version + 1 : '-'}。
          </DialogContentText>
          <NotesField value={notes} onChange={setNotes} label="回滚原因（必填）" autoFocus />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRestoreTarget(null)}>取消</Button>
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
            确认回滚
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

  const open = pending !== null;
  const date = pending?.value ?? '';
  const label = calendar && date ? calendar.labelOf(date) : null;
  const display = label ?? '周末';

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
      <DialogTitle>非工作日提示</DialogTitle>
      <DialogContent dividers>
        <DialogContentText className="text-[13px]">
          你填写的{pending?.field === 'start' ? '开始' : '结束'}日期 <b>{date}</b> 为 <b>{display}</b>
          ，并非工作日（周末或法定假日）。确认仍用，还是顺延到下一工作日？
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={close}>取消</Button>
        <Button color="warning" variant="outlined" onClick={defer}>
          顺延到下一工作日（{calendar && date ? nextWorkingDay(date, calendar) : ''}）
        </Button>
        <Button variant="contained" onClick={keep}>
          仍用该日
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
  return (
    <div className="mb-3">
      <div className="mb-1 text-[12px] font-semibold text-slate-700">{title}</div>
      <div className="flex flex-wrap gap-1">
        {items.length === 0 && <span className="text-[12px] text-slate-400">（空）</span>}
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
          添加
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
        <span>工作日历设置</span>
        <IconButton size="small" onClick={() => closeDialog('calendar')}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        <DialogContentText className="mb-2 text-[12px]">
          维护自定义节假日 / 补班日 / 移除的官方假日（按年份）。保存前会自动获取全局日历编辑锁。
        </DialogContentText>

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
            label="+ 当前年"
            onClick={() => {
              const y = new Date().getFullYear();
              setDraft((prev) => (prev ? ensureYear(clone(prev), y) : prev));
              setYear(y);
            }}
          />
        </div>

        <CalendarSection
          title="自定义节假日（userHolidays）"
          items={hol}
          newVal={newDate.hol}
          onNewChange={(v) => setNewDate((p) => ({ ...p, hol: v }))}
          onAdd={(v) => addDate('hol', v)}
          onRemove={(d) => removeDate('hol', d)}
        />
        <CalendarSection
          title="补班日（makeup）"
          items={mk}
          newVal={newDate.mk}
          onNewChange={(v) => setNewDate((p) => ({ ...p, mk: v }))}
          onAdd={(v) => addDate('mk', v)}
          onRemove={(d) => removeDate('mk', d)}
        />
        <CalendarSection
          title="移除的官方假日（userRemoved）"
          items={rm}
          newVal={newDate.rm}
          onNewChange={(v) => setNewDate((p) => ({ ...p, rm: v }))}
          onAdd={(v) => addDate('rm', v)}
          onRemove={(d) => removeDate('rm', d)}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={() => closeDialog('calendar')}>取消</Button>
        <Button variant="contained" disabled={!canSubmit} onClick={submit}>
          {saving ? '保存中…' : '保存'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/* ============================ 汇总导出 ============================ */

export default function Dialogs(): JSX.Element {
  return (
    <>
      <UserGateDialog />
      <PlanPickerDialog />
      <SaveNotesDialog />
      <HistoryDrawer />
      <NonWorkingDayDialog />
      <CalendarSettingsDialog />
    </>
  );
}
