/**
 * src/components/TeamManagerDialog.tsx —— 团队与人员管理（v1.4.1+ 引入）。
 *
 * 入口：Toolbar → "团队管理"
 *
 * 设计要点：
 *   - 单一 Dialog 两个 Tab：「团队」/「人员」；人员可属于多个团队（chip 多选）；
 *   - 操作走 store actions（addTeam/updateTeam/removeTeam/addPerson/...）；
 *   - 删除团队级联：把团队成员从该团队的 teamIds 里剔除，但人员条目本身不删；
 *   - 删除人员：从注册表移除；若同名仍被任务引用，下次 normalizePlan 会自动重建无元数据条目（保持「任务里的野名字仍可见」语义）；
 *   - 数据落盘走现有 dirty→save 路径，无需新 API；
 *   - 6 色默认调色板（TEAM_COLORS）；用户在 picker 里能选现有 6 色或自定义 hex。
 */

import { useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import Select from '@mui/material/Select';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditIcon from '@mui/icons-material/Edit';
import { useStore, useTeams, usePeople } from '../store';
import { useT } from '../i18n';
import {
  TEAM_COLORS,
  type Person,
  type Team,
} from '../../shared/types';

type TabKey = 'teams' | 'people';

/**
 * 把父层已翻译好的模板里的 {name} 占位填成实际名称。
 *
 * ★ 为什么不用 `t(key, { name })`：TeamsTab 里团队循环变量就叫 `t`，
 *   会把 i18n 的 `t` 遮蔽掉，必须走这个显式插值 helper（语义与 i18n.tsx 的 split/join 一致）。
 */
function fillName(template: string, name: string): string {
  return template.split('{name}').join(name);
}

export function TeamManagerDialog(): JSX.Element | null {
  const tr = useT();
  const open = useStore((s) => s.dialogs.teamManager);
  const closeDialog = useStore((s) => s.closeDialog);
  const teams = useTeams();
  const people = usePeople();
  const addTeam = useStore((s) => s.addTeam);
  const updateTeam = useStore((s) => s.updateTeam);
  const removeTeam = useStore((s) => s.removeTeam);
  const addPerson = useStore((s) => s.addPerson);
  const updatePerson = useStore((s) => s.updatePerson);
  const removePerson = useStore((s) => s.removePerson);

  const [tab, setTab] = useState<TabKey>('teams');

  if (!open) return null;
  return (
    <Dialog open onClose={() => closeDialog('teamManager')} maxWidth="md" fullWidth>
      <DialogTitle sx={{ pr: 6 }}>
        {tr('team.title')}
        <IconButton
          aria-label="close"
          onClick={() => closeDialog('teamManager')}
          sx={{ position: 'absolute', right: 8, top: 8 }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ minHeight: 480 }}>
        <Tabs value={tab} onChange={(_, v) => setTab(v as TabKey)} sx={{ mb: 2 }}>
          <Tab value="teams" label={`${tr('team.tabTeams')} (${teams.length})`} />
          <Tab value="people" label={`${tr('team.tabPeople')} (${people.length})`} />
        </Tabs>

        {tab === 'teams' && (
          <TeamsTab
            teams={teams}
            people={people}
            onAdd={(name, color) => addTeam({ name, color })}
            onUpdate={updateTeam}
            onRemove={(id) => removeTeam(id)}
            confirmLabel={tr('team.confirmDeleteTeam')}
            teamEmptyLabel={tr('team.emptyTeams')}
          />
        )}
        {tab === 'people' && (
          <PeopleTab
            people={people}
            teams={teams}
            onAdd={(name, gender) => addPerson({ name, gender, teamIds: [] })}
            onUpdate={updatePerson}
            onRemove={(id) => removePerson(id)}
            confirmLabel={tr('team.confirmDeletePerson')}
            peopleEmptyLabel={tr('team.emptyPeople')}
          />
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={() => closeDialog('teamManager')}>{tr('common.close')}</Button>
      </DialogActions>
    </Dialog>
  );
}

/* =========================== Teams Tab =========================== */

interface TeamsTabProps {
  teams: Team[];
  people: Person[];
  onAdd: (name: string, color: string) => string;
  onUpdate: (id: string, patch: Partial<Omit<Team, 'id'>>) => void;
  onRemove: (id: string) => void;
  confirmLabel: string;
  teamEmptyLabel: string;
}

function TeamsTab(props: TeamsTabProps): JSX.Element {
  const tr = useT();
  const { teams, people, onAdd, onUpdate, onRemove, confirmLabel, teamEmptyLabel } = props;
  const [adding, setAdding] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftColor, setDraftColor] = useState(TEAM_COLORS[0]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState(TEAM_COLORS[0]);

  const peopleByTeam = countPeopleByTeam(people);

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1 }}>
        <Button
          variant="outlined"
          size="small"
          startIcon={<AddIcon />}
          onClick={() => { setAdding(true); setDraftName(''); setDraftColor(TEAM_COLORS[teams.length % TEAM_COLORS.length]); }}
        >
          {tr('team.add')}
        </Button>
      </Box>

      {adding && (
        <Box sx={{ display: 'flex', gap: 1, mb: 2, alignItems: 'center' }}>
          <TextField
            size="small"
            label={tr('team.name')}
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            autoFocus
            sx={{ minWidth: 240 }}
          />
          <ColorPicker value={draftColor} onChange={setDraftColor} />
          <Button
            variant="contained"
            size="small"
            disabled={draftName.trim() === ''}
            onClick={() => {
              onAdd(draftName.trim(), draftColor);
              setAdding(false);
              setDraftName('');
            }}
          >
            {tr('team.add')}
          </Button>
          <Button size="small" onClick={() => setAdding(false)}>{tr('common.cancel')}</Button>
        </Box>
      )}

      {teams.length === 0 ? (
        <Box sx={{ color: 'text.secondary', py: 4, textAlign: 'center' }}>{teamEmptyLabel}</Box>
      ) : (
        teams.map((t) => {
          const isEditing = editingId === t.id;
          const count = peopleByTeam.get(t.id) ?? 0;
          return (
            <Box
              key={t.id}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                py: 1,
                borderBottom: '1px solid',
                borderColor: 'divider',
              }}
            >
              <Chip
                label={t.name}
                sx={{
                  bgcolor: t.color,
                  color: 'common.white',
                  fontWeight: 600,
                  minWidth: 120,
                }}
              />
              {isEditing ? (
                <>
                  <TextField
                    size="small"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    autoFocus
                    sx={{ minWidth: 200 }}
                  />
                  <ColorPicker value={editColor} onChange={setEditColor} />
                  <Button
                    size="small"
                    variant="contained"
                    disabled={editName.trim() === ''}
                    onClick={() => {
                      onUpdate(t.id, { name: editName.trim(), color: editColor });
                      setEditingId(null);
                    }}
                  >
                    {tr('common.save')}
                  </Button>
                  <Button size="small" onClick={() => setEditingId(null)}>{tr('common.cancel')}</Button>
                </>
              ) : (
                <>
                  <Box sx={{ color: 'text.secondary', fontSize: 13, flex: 1 }}>
                    {tr('team.membersCount', { n: count })}
                  </Box>
                  <Tooltip title={tr('team.edit')}>
                    <IconButton
                      size="small"
                      onClick={() => {
                        setEditingId(t.id);
                        setEditName(t.name);
                        setEditColor(t.color);
                      }}
                    >
                      <EditIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title={tr('team.delete')}>
                    <IconButton
                      size="small"
                      onClick={() => {
                        if (window.confirm(fillName(confirmLabel, t.name))) onRemove(t.id);
                      }}
                    >
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </>
              )}
            </Box>
          );
        })
      )}
    </Box>
  );
}

/* =========================== People Tab =========================== */

interface PeopleTabProps {
  people: Person[];
  teams: Team[];
  onAdd: (name: string, gender?: 'male' | 'female') => string;
  onUpdate: (id: string, patch: Partial<Omit<Person, 'id'>>) => void;
  onRemove: (id: string) => void;
  confirmLabel: string;
  peopleEmptyLabel: string;
}

function PeopleTab(props: PeopleTabProps): JSX.Element {
  const tr = useT();
  const { people, teams, onAdd, onUpdate, onRemove, confirmLabel, peopleEmptyLabel } = props;
  const [adding, setAdding] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftGender, setDraftGender] = useState<'male' | 'female' | undefined>(undefined);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editGender, setEditGender] = useState<'male' | 'female' | undefined>(undefined);
  const [editTeams, setEditTeams] = useState<string[]>([]);

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1 }}>
        <Button
          variant="outlined"
          size="small"
          startIcon={<AddIcon />}
          onClick={() => { setAdding(true); setDraftName(''); setDraftGender(undefined); }}
        >
          {tr('team.add')}
        </Button>
      </Box>

      {adding && (
        <Box sx={{ display: 'flex', gap: 1, mb: 2, alignItems: 'center' }}>
          <TextField
            size="small"
            label={tr('person.name')}
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            autoFocus
            sx={{ minWidth: 220 }}
          />
          <Select
            size="small"
            value={draftGender ?? 'unset'}
            onChange={(e) => {
              const v = e.target.value;
              setDraftGender(v === 'male' || v === 'female' ? v : undefined);
            }}
            sx={{ minWidth: 120 }}
          >
            <MenuItem value="unset">{tr('person.genderUnset')}</MenuItem>
            <MenuItem value="male">{tr('person.genderMale')}</MenuItem>
            <MenuItem value="female">{tr('person.genderFemale')}</MenuItem>
          </Select>
          <Button
            variant="contained"
            size="small"
            disabled={draftName.trim() === ''}
            onClick={() => {
              onAdd(draftName.trim(), draftGender);
              setAdding(false);
              setDraftName('');
              setDraftGender(undefined);
            }}
          >
            {tr('team.add')}
          </Button>
          <Button size="small" onClick={() => setAdding(false)}>{tr('common.cancel')}</Button>
        </Box>
      )}

      {people.length === 0 ? (
        <Box sx={{ color: 'text.secondary', py: 4, textAlign: 'center' }}>{peopleEmptyLabel}</Box>
      ) : (
        people.map((p) => {
          const isEditing = editingId === p.id;
          return (
            <Box
              key={p.id}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                py: 1,
                borderBottom: '1px solid',
                borderColor: 'divider',
              }}
            >
              <GenderTag gender={p.gender} />
              {isEditing ? (
                <>
                  <TextField
                    size="small"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    autoFocus
                    sx={{ minWidth: 180 }}
                  />
                  <RadioGroup
                    row
                    value={editGender ?? 'unset'}
                    onChange={(e) => {
                      const v = (e.target as HTMLInputElement).value;
                      setEditGender(v === 'male' || v === 'female' ? v : undefined);
                    }}
                  >
                    <FormControlLabel value="unset" control={<Radio size="small" />} label={tr('person.genderUnset')} />
                    <FormControlLabel value="male" control={<Radio size="small" />} label={tr('person.genderMale')} />
                    <FormControlLabel value="female" control={<Radio size="small" />} label={tr('person.genderFemale')} />
                  </RadioGroup>
                  <Select
                    multiple
                    size="small"
                    value={editTeams}
                    onChange={(e) => {
                      const v = e.target.value;
                      setEditTeams(Array.isArray(v) ? v : []);
                    }}
                    renderValue={(selected) => {
                      const ids = selected as string[];
                      if (ids.length === 0) return tr('team.unassigned');
                      return ids.map((tid) => teams.find((t) => t.id === tid)?.name ?? tid).join('、');
                    }}
                    sx={{ minWidth: 180, maxWidth: 280 }}
                    displayEmpty
                  >
                    {teams.map((t) => (
                      <MenuItem key={t.id} value={t.id} dense>
                        <Chip
                          size="small"
                          label={t.name}
                          sx={{ bgcolor: t.color, color: 'common.white', height: 20 }}
                        />
                      </MenuItem>
                    ))}
                  </Select>
                  <Button
                    size="small"
                    variant="contained"
                    disabled={editName.trim() === ''}
                    onClick={() => {
                      onUpdate(p.id, {
                        name: editName.trim(),
                        gender: editGender,
                        teamIds: editTeams,
                      });
                      setEditingId(null);
                    }}
                  >
                    {tr('common.save')}
                  </Button>
                  <Button size="small" onClick={() => setEditingId(null)}>{tr('common.cancel')}</Button>
                </>
              ) : (
                <>
                  <Box sx={{ flex: '0 0 180px', fontWeight: 500 }}>{p.name}</Box>
                  <Box sx={{ display: 'flex', gap: 0.5, flex: 1, flexWrap: 'wrap' }}>
                    {p.teamIds.length === 0 ? (
                      <Box sx={{ color: 'text.disabled', fontSize: 12 }}>{tr('team.unassigned')}</Box>
                    ) : (
                      p.teamIds.map((tid) => {
                        const t = teams.find((x) => x.id === tid);
                        if (!t) return null;
                        return (
                          <Chip
                            key={tid}
                            size="small"
                            label={t.name}
                            sx={{ bgcolor: t.color, color: 'common.white', height: 22 }}
                          />
                        );
                      })
                    )}
                  </Box>
                  <Tooltip title={tr('team.edit')}>
                    <IconButton
                      size="small"
                      onClick={() => {
                        setEditingId(p.id);
                        setEditName(p.name);
                        setEditGender(p.gender);
                        setEditTeams([...p.teamIds]);
                      }}
                    >
                      <EditIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title={tr('team.delete')}>
                    <IconButton
                      size="small"
                      onClick={() => {
                        if (window.confirm(fillName(confirmLabel, p.name))) onRemove(p.id);
                      }}
                    >
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </>
              )}
            </Box>
          );
        })
      )}
    </Box>
  );
}

/* =========================== helpers =========================== */

/** 微信风性别小色点（♂ 蓝 / ♀ 粉 / 未指定不渲染） */
export function GenderTag({ gender }: { gender?: 'male' | 'female' }): JSX.Element | null {
  const tr = useT();
  if (gender !== 'male' && gender !== 'female') return null;
  const sym = gender === 'male' ? tr('genderTag.male') : tr('genderTag.female');
  const fg = gender === 'male' ? '#1d4ed8' : '#be185d';
  const bg = gender === 'male' ? '#dbeafe' : '#fce7f3';
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 16,
        height: 16,
        borderRadius: '50%',
        bgcolor: bg,
        color: fg,
        fontSize: 11,
        fontWeight: 700,
        lineHeight: 1,
        mr: 0.5,
        flex: '0 0 16px',
      }}
      aria-label={gender === 'male' ? 'male' : 'female'}
    >
      {sym}
    </Box>
  );
}

/** MUI Select 里塞一组色块挑一个（保留与 i18n 一致的 label） */
function ColorPicker({ value, onChange }: { value: string; onChange: (v: string) => void }): JSX.Element {
  return (
    <Select
      size="small"
      value={value}
      onChange={(e) => onChange(e.target.value as string)}
      sx={{ minWidth: 130 }}
      renderValue={(v) => (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Box sx={{ width: 16, height: 16, borderRadius: '4px', bgcolor: v as string }} />
          <span>{v as string}</span>
        </Box>
      )}
    >
      {TEAM_COLORS.map((c) => (
        <MenuItem key={c} value={c} dense>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box sx={{ width: 16, height: 16, borderRadius: '4px', bgcolor: c }} />
            <span>{c}</span>
          </Box>
        </MenuItem>
      ))}
    </Select>
  );
}

function countPeopleByTeam(people: Person[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of people) {
    for (const tid of p.teamIds) m.set(tid, (m.get(tid) ?? 0) + 1);
  }
  return m;
}