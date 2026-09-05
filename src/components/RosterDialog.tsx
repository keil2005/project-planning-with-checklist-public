/**
 * src/components/RosterDialog.tsx —— 团队花名册管理。
 *
 * 入口：Toolbar → "团队"
 *
 * 功能（按角色权限）：
 *   - 任何人：查看当前 workspace 成员列表 + 邀请码状态
 *   - owner：创建邀请链接（一次性 / 7d）、撤销邀请、移除成员
 *
 * 设计：
 *   - 邀请码生成后立刻可复制（弹窗内显示完整 URL，前端拼装）
 *   - 不再展示成员用户名（避免 PII 暴露），仅显示 displayName
 */

import { useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import Snackbar from '@mui/material/Snackbar';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import CloseIcon from '@mui/icons-material/Close';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import PersonAddAlt1Icon from '@mui/icons-material/PersonAddAlt1';
import { api } from '../api';
import { useStore } from '../store';
import type { PublicWorkspaceInfo } from '../../shared/types';

export function RosterDialog(): JSX.Element {
  const open = useStore((s) => s.dialogs.roster);
  const closeDialog = useStore((s) => s.closeDialog);
  const workspaces = useStore((s) => s.workspaces);
  const currentWsId = useStore((s) => s.currentWorkspaceId);
  const myRole = useStore((s) => s.currentWorkspaceRole);
  const loadWorkspaces = useStore((s) => s.listWorkspaces);
  const sessionUserId = useStore((s) => s.sessionUserId);

  const [invites, setInvites] = useState<
    Array<{
      token: string;
      role: string;
      status: string;
      createdBy: string;
      createdAt: string;
      expiresAt: string;
      consumedBy?: string;
    }>
  >([]);
  const [newInviteRole, setNewInviteRole] = useState<'editor' | 'viewer'>('editor');
  const [newInviteUrl, setNewInviteUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [snack, setSnack] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const isOwner = myRole === 'owner';
  const currentWs: PublicWorkspaceInfo | undefined = workspaces.find((w) => w.workspaceId === currentWsId);

  const loadInvites = async (): Promise<void> => {
    if (!currentWsId) return;
    try {
      const list = await api.listInvites(currentWsId);
      setInvites(list);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '读取邀请列表失败');
    }
  };

  useEffect(() => {
    if (open && currentWsId) {
      void loadInvites();
      if (workspaces.length === 0) void loadWorkspaces();
    }
  }, [open, currentWsId, workspaces.length, loadWorkspaces]);

  const createInvite = async (): Promise<void> => {
    if (!currentWsId) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api.createInvite(currentWsId, newInviteRole);
      const url = `${window.location.origin}/?invite=${encodeURIComponent(r.token)}`;
      setNewInviteUrl(url);
      void loadInvites();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '创建邀请失败');
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (token: string): Promise<void> => {
    if (!currentWsId) return;
    setBusy(true);
    try {
      await api.revokeInvite(currentWsId, token);
      void loadInvites();
      setSnack('已撤销邀请');
    } catch (e) {
      setErr(e instanceof Error ? e.message : '撤销失败');
    } finally {
      setBusy(false);
    }
  };

  const removeMember = async (userId: string, name: string): Promise<void> => {
    if (!currentWsId) return;
    if (!confirm(`确认移除 ${name} ？对方将失去此工作区访问权。`)) return;
    setBusy(true);
    try {
      await api.removeMember(currentWsId, userId);
      void loadWorkspaces();
      setSnack(`已移除 ${name}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '移除失败');
    } finally {
      setBusy(false);
    }
  };

  const copyUrl = async (): Promise<void> => {
    if (!newInviteUrl) return;
    await navigator.clipboard.writeText(newInviteUrl);
    setSnack('链接已复制到剪贴板');
  };

  return (
    <>
      <Dialog open={open} maxWidth="sm" fullWidth onClose={() => closeDialog('roster')}>
        <DialogTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <PersonAddAlt1Icon fontSize="small" color="primary" />
            团队花名册
            {currentWs && (
              <Chip
                size="small"
                variant="outlined"
                label={currentWs.name}
                className="ml-1"
              />
            )}
          </span>
          <IconButton size="small" onClick={() => closeDialog('roster')}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          {err && (
            <Alert severity="error" className="mb-2" onClose={() => setErr(null)}>
              {err}
            </Alert>
          )}

          {/* 成员列表 */}
          <Box className="mb-3">
            <div className="mb-1 text-[13px] font-semibold">成员（{currentWs?.members.length ?? 0}）</div>
            {currentWs && currentWs.members.length > 0 ? (
              <List dense>
                {currentWs.members.map((m) => (
                  <ListItem
                    key={m.userId}
                    secondaryAction={
                      isOwner && m.userId !== sessionUserId ? (
                        <Tooltip title="移除">
                          <IconButton
                            edge="end"
                            size="small"
                            disabled={busy}
                            onClick={() => void removeMember(m.userId, m.displayName)}
                          >
                            <DeleteOutlineIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      ) : null
                    }
                  >
                    <ListItemText
                      primary={
                        <span className="flex items-center gap-2">
                          <span className="font-medium">{m.displayName}</span>
                          {m.userId === sessionUserId && <Chip size="small" label="我" />}
                          <Chip
                            size="small"
                            variant="outlined"
                            color={m.role === 'owner' ? 'primary' : 'default'}
                            label={
                              m.role === 'owner' ? '管理员' : m.role === 'editor' ? '可编辑' : '只读'
                            }
                          />
                        </span>
                      }
                      secondary={`加入于 ${new Date(m.joinedAt).toLocaleDateString()}`}
                    />
                  </ListItem>
                ))}
              </List>
            ) : (
              <Alert severity="info">这个工作区还没有成员。</Alert>
            )}
          </Box>

          {isOwner && (
            <>
              <Divider className="my-3" />

              {/* 创建邀请 */}
              <div className="mb-1 text-[13px] font-semibold">邀请新成员</div>
              <Box className="mb-3 flex items-center gap-2">
                <Select
                  size="small"
                  value={newInviteRole}
                  onChange={(e) => setNewInviteRole(e.target.value as 'editor' | 'viewer')}
                  sx={{ minWidth: 120 }}
                >
                  <MenuItem value="editor">可编辑</MenuItem>
                  <MenuItem value="viewer">只读</MenuItem>
                </Select>
                <Button
                  variant="contained"
                  startIcon={<PersonAddAlt1Icon />}
                  disabled={busy}
                  onClick={() => void createInvite()}
                >
                  生成邀请链接
                </Button>
              </Box>
              {newInviteUrl && (
                <Box className="mb-3 flex items-center gap-2 rounded border border-emerald-200 bg-emerald-50 p-2">
                  <TextField
                    size="small"
                    value={newInviteUrl}
                    fullWidth
                    inputProps={{ readOnly: true, style: { fontSize: 12 } }}
                  />
                  <Tooltip title="复制">
                    <IconButton size="small" onClick={() => void copyUrl()}>
                      <ContentCopyIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Box>
              )}

              {/* 邀请列表 */}
              <div className="mb-1 text-[13px] font-semibold">邀请链接（{invites.length}）</div>
              {invites.length === 0 ? (
                <Alert severity="info">还没有发出过邀请。</Alert>
              ) : (
                <List dense>
                  {invites.map((i) => (
                    <ListItem
                      key={i.token}
                      secondaryAction={
                        i.status === 'pending' ? (
                          <Tooltip title="撤销">
                            <IconButton edge="end" size="small" disabled={busy} onClick={() => void revoke(i.token)}>
                              <DeleteOutlineIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        ) : null
                      }
                    >
                      <ListItemText
                        primary={
                          <span className="flex items-center gap-2">
                            <span className="font-mono text-[12px]">
                              {i.token.slice(0, 12)}…{i.token.slice(-4)}
                            </span>
                            <Chip
                              size="small"
                              variant="outlined"
                              label={
                                i.status === 'pending'
                                  ? '待使用'
                                  : i.status === 'consumed'
                                  ? '已使用'
                                  : i.status === 'revoked'
                                  ? '已撤销'
                                  : '已过期'
                              }
                              color={
                                i.status === 'pending'
                                  ? 'primary'
                                  : i.status === 'consumed'
                                  ? 'success'
                                  : 'default'
                              }
                            />
                            <Chip
                              size="small"
                              variant="outlined"
                              label={i.role === 'owner' ? '管理员' : i.role === 'editor' ? '可编辑' : '只读'}
                            />
                          </span>
                        }
                        secondary={`${new Date(i.createdAt).toLocaleString()} · 过期 ${new Date(
                          i.expiresAt,
                        ).toLocaleString()}`}
                      />
                    </ListItem>
                  ))}
                </List>
              )}
            </>
          )}

          {!isOwner && (
            <Alert severity="info" className="mt-2">
              只读或可编辑成员不能管理邀请。需要 owner 权限。
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => closeDialog('roster')}>关闭</Button>
        </DialogActions>
      </Dialog>
      <Snackbar
        open={snack !== null}
        autoHideDuration={2500}
        onClose={() => setSnack(null)}
        message={snack ?? ''}
      />
    </>
  );
}
