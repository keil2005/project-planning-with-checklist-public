/**
 * src/components/FilterBar.tsx —— 筛选工具条。
 *
 * 两个出口：
 *   - `FilterBar`：左侧表格顶部，带「Assign to me」、「Cross-functional」、已筛列 chips、行数与清除全部；
 *   - `FilterStatusBar`：右侧甘特顶部，**等高只读**，只显示筛选摘要与行数。
 *
 * ★ 为什么甘特侧也要有一条：左右两个滚动容器的 scrollTop 严格同步（K16 行对齐）。
 *   若只在左侧加一条，两侧容器可视高度不同 → 可滚动范围不同 → 滚到底部时一边到头、
 *   一边没到，同步赋值被浏览器 clamp，行就错位了。所以甘特侧必须有等高的占位条。
 *
 * ★ 过滤只影响显示：排程、诊断、导出、保存一律基于全量任务（见 store.useVisibleTasks 注释）。
 */

import { useState, useMemo, type ReactElement } from 'react';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Checkbox from '@mui/material/Checkbox';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import Popover from '@mui/material/Popover';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import AssignmentIndIcon from '@mui/icons-material/AssignmentInd';
import FilterListOffIcon from '@mui/icons-material/FilterListOff';
import GroupWorkIcon from '@mui/icons-material/GroupWork';
import { useRowCounts, useStore, useTeams } from '../store';
import { COLUMNS } from '../columns';
import {
  activeColumnKeys,
  describeColumnFilter,
  describeCrossFunctional,
  isFilterActive,
  type FilterState,
} from '../filter';
import { t, useT } from '../i18n';

/** 列名查表（chips 文案用；走 i18n 与表头一致） */
function labelOf(key: string): string {
  return t(`col.${key}`);
}

/** 筛选条件的自然语言摘要（甘特侧等高条与 tooltip 共用）。
 * 接收可选 teams —— 没有时跳过 cross-functional 片段（避免在非 React 上下文里违反 hooks 规则）。 */
export function filterSummary(filter: FilterState, me: string | null, teams?: readonly { id: string; name: string }[]): string {
  const parts: string[] = [];
  if (filter.onlyMine) parts.push(t('filter.summaryOnlyMine', { me: me ?? t('filter.summaryNoIdentity') }));
  if (filter.crossTeamIds.length > 0 && teams) {
    parts.push(t('filter.summaryCrossFunctional', { teams: describeCrossFunctional(filter, teams) }));
  }
  for (const key of activeColumnKeys(filter, COLUMNS.map((c) => c.key))) {
    const f = filter.byColumn[key];
    if (f) parts.push(describeColumnFilter(key, f, labelOf(key)));
  }
  return parts.length === 0 ? t('filter.noFilter') : parts.join(t('filter.sep'));
}

/**
 * 「Cross-functional」按钮 + Popover。
 *
 * 仅筛选视角，不可写数据：勾选团队 → setCrossFunctional；勾「包含无团队人员」→ setCrossIncludeUnassigned。
 * 父子组件由 React 重渲染，无需 Provider。
 */
function CrossFunctionalMenu(): ReactElement | null {
  const tr = useT();
  const teams = useTeams();
  const selectedIds = useStore((s) => s.filter.crossTeamIds);
  const includeUnassigned = useStore((s) => s.filter.crossIncludeUnassigned);
  const setCrossFunctional = useStore((s) => s.setCrossFunctional);
  const setCrossIncludeUnassigned = useStore((s) => s.setCrossIncludeUnassigned);

  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [query, setQuery] = useState('');
  const open = anchorEl !== null;

  const allTeams = useMemo(
    () => [...teams].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true })),
    [teams],
  );
  const shownTeams = useMemo(
    () => allTeams.filter((t) => t.name.toLowerCase().includes(query.trim().toLowerCase())),
    [allTeams, query],
  );

  const allChecked = allTeams.length > 0 && selectedIds.length === allTeams.length;
  const someChecked = selectedIds.length > 0 && selectedIds.length < allTeams.length;

  const toggleTeam = (id: string, checked: boolean): void => {
    const set = new Set(selectedIds);
    if (checked) set.add(id);
    else set.delete(id);
    // 按 allTeams 顺序输出，保持稳定
    setCrossFunctional(allTeams.filter((t) => set.has(t.id)).map((t) => t.id));
  };

  const onSelectAll = (checked: boolean): void => {
    setCrossFunctional(checked ? allTeams.map((t) => t.id) : []);
  };

  const closeMenu = (): void => {
    setAnchorEl(null);
    setQuery('');
  };

  const active = selectedIds.length > 0;
  const tip = allTeams.length === 0 ? tr('filter.crossFunctionalTipNoTeams') : tr('filter.crossFunctionalTip');

  return (
    <>
      <Tooltip title={tip}>
        <span>
          <Button
            size="small"
            variant={active ? 'contained' : 'outlined'}
            startIcon={<GroupWorkIcon />}
            disabled={allTeams.length === 0}
            onClick={(e) => setAnchorEl(e.currentTarget)}
            className="pg-cross-btn"
          >
            {tr('filter.crossFunctional')}
          </Button>
        </span>
      </Tooltip>
      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={closeMenu}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        slotProps={{ paper: { className: 'pg-filter-popover' } }}
      >
        <div className="pg-filter-popover-inner" style={{ minWidth: 260 }}>
          <div className="pg-filter-title">{tr('filter.crossFunctionalTitle')}</div>
          {allTeams.length === 0 ? (
            <div className="pg-filter-empty">{tr('filter.crossNoTeams')}</div>
          ) : (
            <>
              <TextField
                size="small"
                fullWidth
                placeholder={tr('filter.crossSearchPlaceholder')}
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
                      onChange={(e) => onSelectAll(e.target.checked)}
                    />
                  }
                  label={<span className="pg-filter-label">{tr('filter.crossSelectAll')}</span>}
                />
                <Divider />
                {shownTeams.length === 0 && <div className="pg-filter-empty">{tr('filter.noMatch')}</div>}
                {shownTeams.map((team) => (
                  <FormControlLabel
                    key={team.id}
                    control={
                      <Checkbox
                        size="small"
                        checked={selectedIds.includes(team.id)}
                        onChange={(e) => toggleTeam(team.id, e.target.checked)}
                      />
                    }
                    label={
                      <span className="pg-filter-label" title={team.name}>
                        <span
                          aria-hidden
                          style={{
                            display: 'inline-block',
                            width: 10,
                            height: 10,
                            borderRadius: 2,
                            background: team.color,
                            marginRight: 6,
                            verticalAlign: 'middle',
                          }}
                        />
                        {team.name}
                      </span>
                    }
                  />
                ))}
              </div>
              <Divider />
              <FormControlLabel
                className="pg-filter-switch"
                control={
                  <Switch
                    size="small"
                    checked={includeUnassigned}
                    onChange={(e) => setCrossIncludeUnassigned(e.target.checked)}
                  />
                }
                label={
                  <span className="pg-filter-label" title={tr('filter.crossIncludeUnassignedHelp')}>
                    {tr('filter.crossIncludeUnassigned')}
                  </span>
                }
              />
            </>
          )}
        </div>
      </Popover>
    </>
  );
}

/* ============================ 左侧（可操作） ============================ */

export function FilterBar(): JSX.Element {
  const tr = useT();
  const filter = useStore((s) => s.filter);
  const me = useStore((s) => s.session.user);
  const teams = useTeams();
  const setOnlyMine = useStore((s) => s.setOnlyMine);
  const setColumnFilter = useStore((s) => s.setColumnFilter);
  const clearAllFilters = useStore((s) => s.clearAllFilters);
  const { shown, total } = useRowCounts();

  const active = isFilterActive(filter);
  const keys = activeColumnKeys(filter, COLUMNS.map((c) => c.key));
  const summary = filterSummary(filter, me, teams);

  return (
    <div className="pg-filter-bar">
      <Tooltip
        title={me ? tr('filter.onlyMineTip', { me }) : tr('filter.onlyMineTipNoId')}
      >
        <span>
          <Button
            size="small"
            variant={filter.onlyMine ? 'contained' : 'outlined'}
            startIcon={<AssignmentIndIcon />}
            disabled={!me}
            onClick={() => setOnlyMine(!filter.onlyMine)}
            className="pg-assign-btn"
          >
            {tr('filter.assignToMe')}
          </Button>
        </span>
      </Tooltip>

      <Divider orientation="vertical" flexItem className="pg-filter-divider" />

      <CrossFunctionalMenu />

      <Divider orientation="vertical" flexItem className="pg-filter-divider" />

      <div className="pg-filter-chips" title={summary}>
        {keys.length === 0 ? (
          <span className="pg-filter-idle">{tr('filter.noFilter')}</span>
        ) : (
          keys.map((k) => {
            const f = filter.byColumn[k];
            if (!f) return null;
            return (
              <Chip
                key={k}
                size="small"
                variant="outlined"
                color="primary"
                label={describeColumnFilter(k, f, labelOf(k))}
                onDelete={() => setColumnFilter(k, null)}
              />
            );
          })
        )}
      </div>

      <span className="pg-filter-count">{tr('filter.showingRows', { shown, total })}</span>

      <Tooltip title={tr('filter.clearAllTip')}>
        <span>
          <Button
            size="small"
            startIcon={<FilterListOffIcon />}
            disabled={!active}
            onClick={clearAllFilters}
          >
            {tr('filter.clearAll')}
          </Button>
        </span>
      </Tooltip>
    </div>
  );
}

/* ============================ 右侧（只读等高条） ============================ */

export function FilterStatusBar(): JSX.Element {
  const tr = useT();
  const filter = useStore((s) => s.filter);
  const me = useStore((s) => s.session.user);
  const teams = useTeams();
  const { shown, total } = useRowCounts();
  const active = isFilterActive(filter);

  return (
    <div className="pg-filter-bar pg-filter-bar--readonly">
      <span
        className={`pg-filter-chips ${active ? 'pg-filter-chips--active' : ''}`}
        title={filterSummary(filter, me, teams)}
      >
        {active
          ? `${tr('filter.activePrefix')}${filterSummary(filter, me, teams)}`
          : tr('filter.noFilter')}
      </span>
      <span className="pg-filter-count">{tr('filter.showingRows', { shown, total })}</span>
    </div>
  );
}
