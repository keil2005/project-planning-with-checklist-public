/**
 * src/components/TodoDrawer.tsx —— 任务的第二维明细表格（todo 交付清单）。
 *
 * 交互（U04）：
 *  - 主表格 TODO 列点 x/y 徽章 → 从右侧滑出本抽屉；
 *  - 抽屉内是「标准 todo」：checkbox（done）+ 文本（自动换行）+ assignee（可选，单人）
 *    + 上移/下移 + 删除 + 底部添加；
 *  - 顶部显示 x/y 进度；空清单显示添加引导。
 *
 * 一致性（用户裁定）：todo.assignee 被指派后，若不在任务负责人/顾问人里，由 normalizePlan()
 * 自动并入负责人（单向只增），本组件无需处理——每次 todoOp 返回后走 normalizePlan 即自动生效。
 *
 * 协同（方案 B）：todo 是独立并发资源，**不要求计划级排他锁**——只要登录且非预览态即可编辑，
 * 见 useCanEditTodo。文本用 textarea 自动换行（长文本完整显示），抽屉宽 720px（原 360 翻倍）。
 */

import { useEffect, useRef, useState } from 'react';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import CloseIcon from '@mui/icons-material/Close';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { useCanEditTodo, useOwnerCandidates, useStore } from '../store';
import { todosProgress } from '../../shared/todo';
import { useT } from '../i18n';
import type { TodoItem } from '../../shared/types';

/* ============================ 单个 todo 项 ============================ */

interface TodoRowProps {
  taskId: string;
  todo: TodoItem;
  index: number;
  total: number;
  disabled: boolean;
  candidates: string[];
}

function TodoRow({ taskId, todo, index, total, disabled, candidates }: TodoRowProps): JSX.Element {
  const tr = useT();
  const updateTodo = useStore((s) => s.updateTodo);
  const deleteTodo = useStore((s) => s.deleteTodo);
  const moveTodo = useStore((s) => s.moveTodo);

  // 文本编辑：本地 draft，失焦/回车提交（避免每个按键触发全量重算）
  const [draft, setDraft] = useState<string>(todo.text);
  useEffect(() => {
    setDraft(todo.text);
  }, [todo.text]);

  // textarea 自动撑高：长文本自动换行显示完整（用户需求「todo 自动换行」）
  const textRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);

  const commitText = (): void => {
    const t = draft.trim();
    if (t === '') {
      setDraft(todo.text);
      return;
    }
    if (t !== todo.text) void updateTodo(taskId, todo.id, { text: t });
  };

  return (
    <div className="pg-todo-row">
      <Checkbox
        size="small"
        checked={todo.done}
        disabled={disabled}
        inputProps={{ 'aria-label': tr('todo.markDoneAria', { text: todo.text }) }}
        onChange={(e) => void updateTodo(taskId, todo.id, { done: e.target.checked })}
      />
      <textarea
        ref={textRef}
        rows={1}
        className={`pg-todo-text ${todo.done ? 'pg-todo-text--done' : ''}`}
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commitText}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commitText();
            (e.currentTarget as HTMLTextAreaElement).blur();
          }
        }}
      />
      <AutocompleteAssignee
        value={todo.assignee ?? ''}
        disabled={disabled}
        candidates={candidates}
        onCommit={(a) => void updateTodo(taskId, todo.id, { assignee: a })}
      />
      <div className="pg-todo-actions">
        <IconButton
          size="small"
          disabled={disabled || index <= 0}
          aria-label={tr('todo.moveUpAria', { text: todo.text })}
          onClick={() => void moveTodo(taskId, todo.id, -1)}
        >
          <ArrowUpwardIcon fontSize="small" />
        </IconButton>
        <IconButton
          size="small"
          disabled={disabled || index >= total - 1}
          aria-label={tr('todo.moveDownAria', { text: todo.text })}
          onClick={() => void moveTodo(taskId, todo.id, 1)}
        >
          <ArrowDownwardIcon fontSize="small" />
        </IconButton>
        <IconButton
          size="small"
          disabled={disabled}
          aria-label={tr('todo.deleteAria', { text: todo.text })}
          onClick={() => void deleteTodo(taskId, todo.id)}
        >
          <DeleteOutlineIcon fontSize="small" />
        </IconButton>
      </div>
    </div>
  );
}

/* ============================ assignee 下拉 ============================ */

interface AssigneeProps {
  value: string;
  disabled: boolean;
  candidates: string[];
  onCommit: (assignee: string) => void;
}

function AutocompleteAssignee({ value, disabled, candidates, onCommit }: AssigneeProps): JSX.Element {
  const tr = useT();
  return (
    <Autocomplete
      freeSolo
      size="small"
      options={candidates}
      value={value === '' ? null : value}
      disabled={disabled}
      clearOnBlur={false}
      filterOptions={(opts, state) => {
        const q = state.inputValue.trim().toLowerCase();
        if (q === '') return opts;
        return opts.filter((o) => o.toLowerCase().includes(q));
      }}
      onChange={(_e, v) => onCommit(typeof v === 'string' ? v.trim() : '')}
      renderInput={(params) => <TextField {...params} variant="standard" placeholder={tr('todo.assigneePlaceholder')} />}
      sx={{ width: 132, flex: '0 0 132px' }}
    />
  );
}

/* ============================ 抽屉主体 ============================ */

export default function TodoDrawer(): JSX.Element {
  const tr = useT();
  const plan = useStore((s) => s.plan);
  const todoDrawerTaskId = useStore((s) => s.todoDrawerTaskId);
  const closeTodoDrawer = useStore((s) => s.closeTodoDrawer);
  const addTodo = useStore((s) => s.addTodo);
  const canEdit = useCanEditTodo();
  const candidates = useOwnerCandidates();

  const task = plan?.tasks.find((t) => t.id === todoDrawerTaskId) ?? null;
  const open = todoDrawerTaskId !== null && task !== null;

  const [newText, setNewText] = useState<string>('');

  const todos = task?.todos ?? [];
  const { done, total } = todosProgress(todos);

  const submitNew = (): void => {
    const t = newText.trim();
    if (t === '' || !task) return;
    void addTodo(task.id, t);
    setNewText('');
  };

  return (
    <Drawer anchor="right" open={open} onClose={closeTodoDrawer}>
      <Box className="pg-todo-drawer" role="presentation">
        {/* 头部 */}
        <div className="pg-todo-head">
          <div className="min-w-0">
            <Typography className="pg-todo-title" noWrap>
              {task?.name || tr('todo.unnamedTask')}
            </Typography>
            <Typography className="pg-todo-subtitle">
              {total === 0
                ? tr('todo.headerNone')
                : tr('todo.headerProgress', { done, total })}
            </Typography>
          </div>
          <IconButton size="small" aria-label={tr('todo.closeAria')} onClick={closeTodoDrawer}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </div>

        {/* 明细列表 */}
        <div className="pg-todo-list">
          {todos.length === 0 ? (
            <div className="pg-todo-empty">{tr('todo.emptyHint')}</div>
          ) : (
            todos.map((td, i) => (
              <TodoRow
                key={td.id}
                taskId={task?.id ?? ''}
                todo={td}
                index={i}
                total={todos.length}
                disabled={!canEdit}
                candidates={candidates}
              />
            ))
          )}
        </div>

        {/* 添加新项 */}
        <div className="pg-todo-add">
          <TextField
            size="small"
            variant="outlined"
            placeholder={canEdit ? tr('todo.addInputEdit') : tr('todo.addInputPreview')}
            value={newText}
            disabled={!canEdit}
            onChange={(e) => setNewText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submitNew();
              }
            }}
            sx={{ flex: 1 }}
          />
          <Button variant="contained" size="small" disabled={!canEdit || newText.trim() === ''} onClick={submitNew}>
            {tr('todo.addBtn')}
          </Button>
        </div>
      </Box>
    </Drawer>
  );
}
