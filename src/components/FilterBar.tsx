/**
 * src/components/FilterBar.tsx —— 筛选工具条。
 *
 * 两个出口：
 *   - `FilterBar`：左侧表格顶部，带「Assign to me」、已筛列 chips、行数与清除全部；
 *   - `FilterStatusBar`：右侧甘特顶部，**等高只读**，只显示筛选摘要与行数。
 *
 * ★ 为什么甘特侧也要有一条：左右两个滚动容器的 scrollTop 严格同步（K16 行对齐）。
 *   若只在左侧加一条，两侧容器可视高度不同 → 可滚动范围不同 → 滚到底部时一边到头、
 *   一边没到，同步赋值被浏览器 clamp，行就错位了。所以甘特侧必须有等高的占位条。
 *
 * ★ 过滤只影响显示：排程、诊断、导出、保存一律基于全量任务（见 store.useVisibleTasks 注释）。
 */

import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Tooltip from '@mui/material/Tooltip';
import AssignmentIndIcon from '@mui/icons-material/AssignmentInd';
import FilterListOffIcon from '@mui/icons-material/FilterListOff';
import { useRowCounts, useStore } from '../store';
import { COLUMNS } from '../columns';
import { activeColumnKeys, describeColumnFilter, isFilterActive, type FilterState } from '../filter';
import { t, useT } from '../i18n';

/** 列名查表（chips 文案用；走 i18n 与表头一致） */
function labelOf(key: string): string {
  return t(`col.${key}`);
}

/** 筛选条件的自然语言摘要（甘特侧等高条与 tooltip 共用） */
export function filterSummary(filter: FilterState, me: string | null): string {
  const parts: string[] = [];
  if (filter.onlyMine) parts.push(t('filter.summaryOnlyMine', { me: me ?? t('filter.summaryNoIdentity') }));
  for (const key of activeColumnKeys(filter, COLUMNS.map((c) => c.key))) {
    const f = filter.byColumn[key];
    if (f) parts.push(describeColumnFilter(key, f, labelOf(key)));
  }
  return parts.length === 0 ? t('filter.noFilter') : parts.join(t('filter.sep'));
}

/* ============================ 左侧（可操作） ============================ */

export function FilterBar(): JSX.Element {
  const tr = useT();
  const filter = useStore((s) => s.filter);
  const me = useStore((s) => s.session.user);
  const setOnlyMine = useStore((s) => s.setOnlyMine);
  const setColumnFilter = useStore((s) => s.setColumnFilter);
  const clearAllFilters = useStore((s) => s.clearAllFilters);
  const { shown, total } = useRowCounts();

  const active = isFilterActive(filter);
  const keys = activeColumnKeys(filter, COLUMNS.map((c) => c.key));
  const summary = filterSummary(filter, me);

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
  const { shown, total } = useRowCounts();
  const active = isFilterActive(filter);

  return (
    <div className="pg-filter-bar pg-filter-bar--readonly">
      <span className={`pg-filter-chips ${active ? 'pg-filter-chips--active' : ''}`} title={filterSummary(filter, me)}>
        {active
          ? `${tr('filter.activePrefix')}${filterSummary(filter, me)}`
          : tr('filter.noFilter')}
      </span>
      <span className="pg-filter-count">{tr('filter.showingRows', { shown, total })}</span>
    </div>
  );
}
