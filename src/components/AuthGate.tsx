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
 *   - v1.2.0：全部文案走 i18n；标题栏加 CN/EN 切换（登录前也可切语言）
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
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import CloseIcon from '@mui/icons-material/Close';
import TranslateIcon from '@mui/icons-material/Translate';
import { ApiError, api, type InviteInfo } from '../api';
import { useStore } from '../store';
import { AUTH_ERR } from '../../shared/types';
import { t, useT, useLangStore, langLabel } from '../i18n';

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
  const tr = useT();
  const toggleLang = useLangStore((s) => s.toggle);

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
        <span className="font-semibold">{tr('auth.appName')}</span>
        <Box sx={{ flex: 1 }} />
        <Tooltip title={tr('toolbar.langTooltip')}>
          <IconButton size="small" onClick={toggleLang}>
            <TranslateIcon fontSize="small" />
          </IconButton>
        </Tooltip>
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
            {tr('auth.connecting')}
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
            <Tab value="login" label={tr('auth.tabLogin')} />
            <Tab value="register" label={inviteTokenFromUrl ? tr('auth.tabRegisterInvited') : tr('auth.tabRegister')} />
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
  const tr = useT();
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
          {tr('auth.loginHint')}
        </Typography>
        {err && (
          <Alert severity="error" className="mb-2">
            {err}
          </Alert>
        )}
        <TextField
          label={tr('auth.username')}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          fullWidth
          size="small"
          autoFocus
          margin="dense"
          autoComplete="username"
        />
        <TextField
          label={tr('auth.password')}
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
          {tr('auth.loginBtn')}
        </Button>
      </DialogActions>
    </>
  );
}

/* ------------------------------ Register Form ------------------------------ */

function RegisterForm({ inviteTokenFromUrl }: { inviteTokenFromUrl: string }): JSX.Element {
  const register = useStore((s) => s.register);
  const tr = useT();
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
          {inviteTokenFromUrl ? tr('auth.registerHint') : tr('auth.registerHintPlain')}
        </Typography>
        {err && (
          <Alert severity="error" className="mb-2">
            {err}
          </Alert>
        )}
        {inviteToken && (
          <Alert severity={inviteInfo ? 'success' : 'warning'} className="mb-2">
            {inviteInfo
              ? tr('auth.inviteValid', {
                  role: inviteInfo.role,
                  expires: new Date(inviteInfo.expiresAt).toLocaleString(),
                })
              : tr('auth.inviteInvalid')}
          </Alert>
        )}
        <TextField
          label={tr('auth.usernameRule')}
          value={username}
          onChange={(e) => setUsername(e.target.value.toLowerCase())}
          fullWidth
          size="small"
          autoFocus
          margin="dense"
        />
        <TextField
          label={tr('auth.displayNameLabel')}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          fullWidth
          size="small"
          margin="dense"
          placeholder={tr('auth.displayNamePlaceholder')}
        />
        <TextField
          label={tr('auth.passwordRule')}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          fullWidth
          size="small"
          type="password"
          margin="dense"
          autoComplete="new-password"
        />
        <TextField
          label={tr('auth.inviteCode')}
          value={inviteToken}
          onChange={(e) => setInviteToken(e.target.value.trim())}
          fullWidth
          size="small"
          margin="dense"
          placeholder={tr('auth.invitePlaceholder')}
          disabled={Boolean(inviteTokenFromUrl)}
        />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button variant="contained" disabled={!canSubmit} onClick={() => void submit()}>
          {tr('auth.registerBtn')}
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
  const tr = useT();
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
          {tr('auth.hello', { name: sessionUser ?? tr('auth.unknownUser') })}
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
                    {w.workspaceId === currentWsId && <Chip size="small" color="primary" label={tr('auth.current')} />}
                    <Chip size="small" variant="outlined" label={tr('auth.memberCount', { n: w.members.length })} />
                  </span>
                }
                secondary={w.members.map((m) => m.displayName).join('、') || tr('auth.emptyWorkspace')}
              />
            </ListItemButton>
          ))}
        </List>
        {workspaces.length === 1 && (
          <Box className="mt-2 text-[12px] text-text-muted">
            {tr('auth.onlyOneWs')}
            <Link
              component="button"
              variant="body2"
              className="ml-2"
              onClick={() => openDialog('roster')}
            >
              {tr('auth.manageTeam')}
            </Link>
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2, justifyContent: 'space-between' }}>
        <Button onClick={() => void logout()} color="inherit" size="small">
          {tr('auth.logoutBtn')}
        </Button>
        <Box sx={{ flex: 1 }} />
        <Button onClick={() => closeDialog('user')} color="inherit" size="small">
          {tr('auth.close')}
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
        return t('auth.err.invalidCredentials');
      case AUTH_ERR.WEAK_PASSWORD:
        return t('auth.err.weakPassword');
      case AUTH_ERR.USERNAME_TAKEN:
        return t('auth.err.usernameTaken');
      case AUTH_ERR.AUTH_REQUIRED:
        return t('auth.err.authRequired');
      case AUTH_ERR.INVITE_INVALID:
        return t('auth.err.inviteInvalid');
      case AUTH_ERR.INVITE_EXPIRED:
        return t('auth.err.inviteExpired');
      case AUTH_ERR.INVITE_CONSUMED:
        return t('auth.err.inviteConsumed');
      case AUTH_ERR.WORKSPACE_FORBIDDEN:
        return t('auth.err.workspaceForbidden');
      default:
        return e.message || t('auth.err.code', { code: e.code });
    }
  }
  return e instanceof Error ? e.message : t('auth.err.unknown');
}
