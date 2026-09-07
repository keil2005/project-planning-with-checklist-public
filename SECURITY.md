# Security Policy

## Supported Versions

| Version | Supported          |
|---------|--------------------|
| 1.0.x   | ✅ Active          |
| < 1.0   | ❌ End of life (pre-release) |

> 我们会在每个 minor/major 发布后支持**前一个 major** 再多一个 minor（标准 N-1 策略）。

---

## Reporting a Vulnerability

> **请勿在 GitHub Issues 公开披露安全漏洞。**

📧 **披露邮箱**：`<SECURITY_EMAIL_TODO>`（占位——v1.0 GA 前替换为真实邮箱）

可用通道（按推荐顺序）：

1. **邮件**（首选）— 上面邮箱
2. **GitHub Security Advisories**：[仓库 Security tab → "New draft security advisory"](https://github.com/keil2005/project-planning-with-checklist-public/security/advisories/new)（私有）
3. **加密** — 接收 PGP 公钥请求后我们 PGP 回复

### 报告内容

请尽量包含：

- 漏洞类型（XSS / SQLi / 鉴权绕过 / 信息泄露 / RCE / DoS ...）
- 受影响版本
- 复现步骤（PoC / curl 命令 / screenshot）
- 影响范围（数据损坏 / 越权读 / 越权写 / 远程代码执行 / 拒绝服务）
- 是否已公开（Twitter / 博客 / CVE 申请）

### 我们的承诺

| 阶段 | 时间 |
|---|---|
| 确认收到 | 48 小时内 |
| 初步评估 + 严重等级 | 7 天内 |
| 修复（CRITICAL / HIGH） | 30 天内 |
| 修复（MEDIUM） | 90 天内 |
| 修复（LOW） | next minor |
| CVE 分配（如需） | 修复发布同时 |
| 致谢（除非匿名请求） | advisory 发布时 |

我们会在你同意的前提下在 advisory credits 里致谢。

---

## 安全设计原则（用户与运维必读）

### 1. 网络暴露面

- Project Planning with Checklist **不是为公网设计**。**只跑在受信任网络**（内网 / VPN / Tailscale）
- 默认监听 `127.0.0.1`，需要外部访问必须显式 `--host 0.0.0.0`
- 反向代理（Nginx / Caddy）必须强制 HTTPS（Let's Encrypt）
- 防火墙只开放 Project Planning with Checklist 端口；其他内网端口（3306/5432/6379）**不暴露**

### 2. 鉴权（v1.0 起强制）

- 首次启动**必须**通过环境变量 `ADMIN_USER` + `ADMIN_PASSWORD` 创建管理员
- 默认密码**至少 12 位**，含数字 + 字母 + 特殊字符
- 个人免费路线下，建议**只在团队内网使用**，不要把链接丢给公网

### 3. 数据备份

```bash
# 备份 data 目录（默认 ./data，可改 DATA_DIR）
tar -czf ppwc-backup-$(date +%Y%m%d).tar.gz data/
```

最低频率：**每周一次**。生产环境：**每天 + 异地（NAS / S3）**。

### 4. 依赖更新

```bash
npm audit                       # 看漏洞
npm audit fix                   # 自动修
npm audit fix --force           # 包含 major（大改）
```

CI 在每个 PR 跑 `npm audit --omit=dev`，HIGH/CRITICAL 阻塞 merge。

### 5. 反向代理推荐配置（Nginx）

```nginx
server {
  listen 443 ssl http2;
  server_name ppwc.example.com;

  ssl_certificate     /etc/letsencrypt/live/ppwc/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/ppwc/privkey.pem;

  # 强制 HTTPS
  add_header Strict-Transport-Security "max-age=31536000" always;
  add_header X-Frame-Options "SAMEORIGIN" always;
  add_header X-Content-Type-Options "nosniff" always;

  # 隐藏版本
  server_tokens off;

  client_max_body_size 5m;     # plan.json 一般 < 1MB

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

---

## 已知非漏洞

下面这些是**设计选择**而非漏洞：

| 设计 | 原因 |
|---|---|
| 数据文件 JSON 明文 | on-prem 自托管 = 本地数据加密由 OS 负责（FDE / FileVault） |
| 单实例内存锁 | 个人免费路线下足够；多实例支持是 P2 路线（见 IMPL_ROADMAP） |
| `putd` 编辑锁 30s heartbeat | 平衡「崩溃后能解锁」与「正常用户不抢锁」 |
| 无 CSRF token（SPA + SameSite cookie） | httpOnly + SameSite=Lax + double-submit 模式 v1.1 加 |

---

## 致谢

| 报告者 | 披露 | 修复版本 |
|---|---|---|
| （暂无） | — | — |
