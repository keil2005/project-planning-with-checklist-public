/**
 * src/components/AuthGate.tsx —— 启动身份协作门禁（替代旧的 UserGateDialog）。
 *
 * 流程（每步失败可回退）：
 *   1) 启动 → 用 cookie 探测 /api/auth/me
 *   2) 已登录 → 进入 workspace 选择 / 加载团队花名册
 *   3) 未登录 → 显示登录 + 注册双 tab（注册可填邀请码）
 *
 * 设计取舍：
 *   - 全屏 Dialog（maxWidth=xs），强制首启不可关闭（避免无身份 session 写入服务端）
 *   - 邀请码可从 URL ?invite=... 读取（团队成员共享链接场景）
 *   - 错误展示用 Alert 而非 toast（与登录流程同框，避免分散注意力）
 */

import { useEffect, useMemo, useState } from 'react';
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
import LinearProgress from '@mui/material/LinearProgress';
import Link from '@mui/material/Link';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import CloseIcon from '@mui/icons-material/Close';
import { ApiError, api, type InviteInfo } from '../api';
import { useStore } from '../store';
import { AUTH_ERR } from '../../shared/types';

type Mode = 'login' | 'register';

interface AuthGateProps {
  /** 受控开关（来自 store.dialogs.user） */
  open: boolean;
}

/**
 * AuthGate 入口：探测登录态，按需切换子页面。
 */
export function AuthGate({ open }: AuthGateProps): JSX.Element {
  const initAuth = useStore((s) => s.initAuth);
  const authReady = useStore((s) => s.authReady);
  const authed = useStore((s) => s.authed);
  const closeDialog = useStore((s) => s.closeDialog);

  // 启动时探测
  useEffect(() => {
    if (open && !authReady) void initAuth();
  }, [open, authReady, initAuth]);

  // 读取 URL 中的 invite token
  const inviteTokenFromUrl = useMemo(() => {
    if (typeof window === 'undefined') return '';
    const u = new URL(window.location.href);
    return u.searchParams.get('invite') ?? '';
  }, []);

  const [mode, setMode] = useState<Mode>(inviteTokenFromUrl ? 'register' : 'login');

  return (
    <Dialog
      open={open}
      maxWidth="xs"
      fullWidth
      // 未登录且未完成探测前禁止关闭，避免绕开门禁写入脏数据
      disableEscapeKeyDown={!authed}
      onClose={() => {
        if (authed) closeDialog('user');
      }}
      PaperProps={{ sx: { borderRadius: 2 } }}
    >
      <DialogTitle className="flex items-center gap-2">
        <LockOutlinedIcon fontSize="small" color="primary" />
        <span className="font-semibold">Project Planning with Checklist</span>
        <Box sx={{ flex: 1 }} />
        {authed && (
          <IconButton size="small" onClick={() => closeDialog('user')}>
            <CloseIcon fontSize="small" />
          </IconButton>
        )}
      </DialogTitle>
      <Divider />
      {!authReady ? (
        <Box sx={{ p: 3 }}>
          <Typography variant="body2" color="text.secondary" className="mb-2">
            正在连接服务…
          </Typography>
          <LinearProgress />
        </Box>
      ) : authed ? (
        <WorkspacePicker />
      ) : (
        <>
          <Tabs
            value={mode}
            onChange={(_, v) => setMode(v as Mode)}
            variant="fullWidth"
            sx={{ borderBottom: 1, borderColor: 'divider' }}
          >
            <Tab value="login" label="登录" />
            <Tab value="register" label={inviteTokenFromUrl ? '注册（收到邀请）' : '注册'} />
          </Tabs>
          {mode === 'login' ? <LoginForm /> : <RegisterForm inviteTokenFromUrl={inviteTokenFromUrl} />}
        </>
      )}
    </Dialog>
  );
}

/* ------------------------------ Login Form ------------------------------ */

function LoginForm(): JSX.Element {
  const login = useStore((s) => s.login);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (): Promise<void> => {
    setErr(null);
    setBusy(true);
    try {
      await login(username.trim(), password);
    } catch (e) {
      setErr(humanAuthError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <DialogContent dividers>
        <Typography variant="body2" color="text.secondary" className="mb-3">
          用账号密码登录。如果是首次启动，请用部署时配置的 admin 账号登录。
        </Typography>
        {err && (
          <Alert severity="error" className="mb-2">
            {err}
          </Alert>
        )}
        <TextField
          label="用户名"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          fullWidth
          size="small"
          autoFocus
          margin="dense"
          autoComplete="username"
        />
        <TextField
          label="密码"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          fullWidth
          size="small"
          type="password"
          margin="dense"
          autoComplete="current-password"
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit();
          }}
        />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button variant="contained" disabled={busy || username.trim() === '' || password === ''} onClick={() => void submit()}>
          登录
        </Button>
      </DialogActions>
    </>
  );
}

/* ------------------------------ Register Form ------------------------------ */

function RegisterForm({ inviteTokenFromUrl }: { inviteTokenFromUrl: string }): JSX.Element {
  const register = useStore((s) => s.register);
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [inviteToken, setInviteToken] = useState(inviteTokenFromUrl);
  const [inviteInfo, setInviteInfo] = useState<InviteInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 有邀请码时先查邀请详情（公开端点）
  useEffect(() => {
    if (!inviteToken) {
      setInviteInfo(null);
      return;
    }
    void api
      .getInviteInfo(inviteToken)
      .then((info) => setInviteInfo(info))
      .catch(() => setInviteInfo(null));
  }, [inviteToken]);

  const submit = async (): Promise<void> => {
    setErr(null);
    setBusy(true);
    try {
      await register(username.trim(), password, displayName.trim() || username.trim(), inviteToken || undefined);
    } catch (e) {
      setErr(humanAuthError(e));
    } finally {
      setBusy(false);
    }
  };

  const canSubmit =
    !busy &&
    username.trim() !== '' &&
    password.length >= 10 &&
    (displayName.trim() !== '' || username.trim() !== '');

  return (
    <>
      <DialogContent dividers>
        <Typography variant="body2" color="text.secondary" className="mb-3">
          创建账号。{inviteTokenFromUrl ? '检测到邀请链接，注册后会自动加入对应工作区。' : '无邀请码时会自动创建个人工作区。'}
        </Typography>
        {err && (
          <Alert severity="error" className="mb-2">
            {err}
          </Alert>
        )}
        {inviteToken && (
          <Alert severity={inviteInfo ? 'success' : 'warning'} className="mb-2">
            {inviteInfo
              ? `邀请有效 · 角色：${inviteInfo.role} · 过期：${new Date(inviteInfo.expiresAt).toLocaleString()}`
              : '邀请链接无效或已过期。仍可注册，会落到个人工作区。'}
          </Alert>
        )}
        <TextField
          label="用户名（3-32 位小写字母/数字/_/-）"
          value={username}
          onChange={(e) => setUsername(e.target.value.toLowerCase())}
          fullWidth
          size="small"
          autoFocus
          margin="dense"
        />
        <TextField
          label="显示名"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          fullWidth
          size="small"
          margin="dense"
          placeholder="团队里怎么叫你（默认 = 用户名）"
        />
        <TextField
          label="密码（至少 10 字符）"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          fullWidth
          size="small"
          type="password"
          margin="dense"
          autoComplete="new-password"
        />
        <TextField
          label="邀请码（可选）"
          value={inviteToken}
          onChange={(e) => setInviteToken(e.target.value.trim())}
          fullWidth
          size="small"
          margin="dense"
          placeholder="团队成员邀请链接里 ?invite= 后那段"
          disabled={Boolean(inviteTokenFromUrl)}
        />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button variant="contained" disabled={!canSubmit} onClick={() => void submit()}>
          注册并登录
        </Button>
      </DialogActions>
    </>
  );
}

/* ------------------------------ Workspace Picker ------------------------------ */

function WorkspacePicker(): JSX.Element {
  const workspaces = useStore((s) => s.workspaces);
  const currentWsId = useStore((s) => s.currentWorkspaceId);
  const switchWorkspace = useStore((s) => s.switchWorkspace);
  const listWorkspaces = useStore((s) => s.listWorkspaces);
  const logout = useStore((s) => s.logout);
  const closeDialog = useStore((s) => s.closeDialog);
  const openDialog = useStore((s) => s.openDialog);
  const sessionUser = useStore((s) => s.session.user);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (workspaces.length === 0) void listWorkspaces();
  }, [workspaces.length, listWorkspaces]);

  const handlePick = async (wsId: string): Promise<void> => {
    setBusy(true);
    try {
      await switchWorkspace(wsId);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <DialogContent dividers>
        <Typography variant="body2" color="text.secondary" className="mb-2">
          你好，<b>{sessionUser ?? '未知'}</b>。选一个工作区继续：
        </Typography>
        <List dense>
          {workspaces.map((w) => (
            <ListItemButton
              key={w.workspaceId}
              selected={w.workspaceId === currentWsId}
              disabled={busy}
              onClick={() => void handlePick(w.workspaceId)}
            >
              <ListItemText
                primary={
                  <span className="flex items-center gap-2">
                    <span className="font-medium">{w.name}</span>
                    {w.workspaceId === currentWsId && <Chip size="small" color="primary" label="当前" />}
                    <Chip size="small" variant="outlined" label={`${w.members.length} 人`} />
                  </span>
                }
                secondary={w.members.map((m) => m.displayName).join('、') || '空工作区'}
              />
            </ListItemButton>
          ))}
        </List>
        {workspaces.length === 1 && (
          <Box className="mt-2 text-[12px] text-slate-500">
            只有 1 个工作区，自动进入。
            <Link
              component="button"
              variant="body2"
              className="ml-2"
              onClick={() => openDialog('roster')}
            >
              管理团队
            </Link>
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2, justifyContent: 'space-between' }}>
        <Button onClick={() => void logout()} color="inherit" size="small">
          注销
        </Button>
        <Box sx={{ flex: 1 }} />
        <Button onClick={() => closeDialog('user')} color="inherit" size="small">
          关闭
        </Button>
      </DialogActions>
    </>
  );
}

/* ------------------------------ Error Mapping ------------------------------ */

function humanAuthError(e: unknown): string {
  if (e instanceof ApiError) {
    switch (e.code) {
      case AUTH_ERR.INVALID_CREDENTIALS:
        return '用户名或密码不正确';
      case AUTH_ERR.WEAK_PASSWORD:
        return '密码至少 10 字符';
      case AUTH_ERR.USERNAME_TAKEN:
        return '用户名已被占用';
      case AUTH_ERR.AUTH_REQUIRED:
        return '请先登录';
      case AUTH_ERR.INVITE_INVALID:
        return '邀请链接无效';
      case AUTH_ERR.INVITE_EXPIRED:
        return '邀请链接已过期';
      case AUTH_ERR.INVITE_CONSUMED:
        return '邀请链接已被使用';
      case AUTH_ERR.WORKSPACE_FORBIDDEN:
        return '无权限访问该工作区';
      default:
        return e.message || `错误 ${e.code}`;
    }
  }
  return e instanceof Error ? e.message : '未知错误';
}
