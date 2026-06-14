# PublishOS Demo 全盘排查与修复 Prompt

## 1. 项目背景

PublishOS 是一个蓝领行业社交媒体自动化发布工具。目标客户：HVAC/水管/电工等本地服务商。核心流程：运营在 Dashboard 创建内容 → 推送到客户客户端 → 客户确认 → 自动发布到 TikTok。

**当前阶段：** Phase 1 Demo 验证。需要把核心链路跑通，不做大重构。

**GitHub 仓库：** https://github.com/plmmcpdd/publishos
**服务器：** 104.238.181.32 (SSH root)

## 2. 服务器信息

```
服务器 IP: 104.238.181.32
SSH 用户: root
项目路径: /root/publishos
后端路径: /root/publishos/backend/publish-gateway
PM2 进程名: publishos-backend
Node 版本: 20+
数据库: SQLite (mock-sqlite 模式，数据文件: backend/publish-gateway/prisma/dev.db)
```

## 3. 项目结构

```
/root/publishos/
├── backend/publish-gateway/     # Express + Prisma 后端
│   ├── src/
│   │   ├── server.ts            # 主入口
│   │   ├── routes/
│   │   │   ├── auth.ts          # 登录/注册
│   │   │   ├── tiktok.ts        # TikTok OAuth
│   │   │   ├── content.ts       # 内容 CRUD + 发布
│   │   │   ├── client.ts        # 客户端 API
│   │   │   └── ...
│   │   ├── services/
│   │   │   ├── bannedWordsScanner.ts  # 违禁词扫描
│   │   │   └── licenseValidator.ts    # 版权校验
│   │   └── config/
│   │       └── bannedWords.ts    # 违禁词规则
│   ├── prisma/schema.prisma
│   └── uploads/                 # 上传的视频文件
├── client/                      # Electron 客户端
├── dashboard/                   # React 运营后台
└── smoke-test.ts                # 端到端测试
```

## 4. 当前已知问题

### P0 — 阻塞 Demo 演示
1. **TikTok OAuth 绑定流程未验证** — 客户端 Settings 页点击 "Connect TikTok" 需要能正常跳转授权并回调保存 token
2. **confirmContent 缺少 binding 校验** — 已修复代码（commit 8573fef），需确认服务器部署的是最新代码
3. **视频白屏** — 客户端 QueueScreen 渲染视频时可能崩溃（已有 ErrorBoundary 修复）
4. **客户端服务器地址硬编码** — `api.ts` 里 DEFAULT_SERVER 需要指向正确地址

### P1 — 影响体验
5. **密码 hash 泄露** — `/content/delivered` 返回的 client 对象不应包含 password 字段
6. **Token 日志泄露** — 服务端日志可能打印 JWT token
7. **build.yml 需要优化** — 只在手动触发/tag 时构建，artifact 保留 3 天

### P2 — 后续优化
8. **违禁词扫描未接入发布流程** — bannedWordsScanner 已有，但未在 confirmContent 中调用
9. **PublishLog 未写入** — 确认发布后应记录 PublishLog

## 5. 必须优先修复（P0/P1）

按顺序执行：

```
Step 1: 确认服务器代码是最新版本
  cd /root/publishos && git log --oneline -3
  确认包含 commit 8573fef (TikTok auth 路径修复)

Step 2: 重新构建并重启
  cd /root/publishos/backend/publish-gateway
  npm run build
  pm2 restart publishos-backend

Step 3: 验证核心 API
  curl http://127.0.0.1:3000/health
  curl -X POST http://127.0.0.1:3000/v1/auth/login \
    -H "Content-Type: application/json" \
    -d '{"email":"abc@hvac.com","password":"password123"}'
  curl http://127.0.0.1:3000/v1/tiktok/auth?clientId=test

Step 4: 检查密码泄露
  curl -s "http://127.0.0.1:3000/v1/content/delivered?clientId=demo-client-1" \
    | grep -c "password"

Step 5: 修复密码泄露（如存在）
  在 content.ts 的 serializeContent 函数中删除 password 字段

Step 6: 修复违禁词扫描（P2 但简单）
  在 content.ts 的 confirmContent 路由中调用 scanText()
  bannedWords 不通过时拒绝发布

Step 7: 修复 PublishLog 写入（P2 但简单）
  在 confirmContent 中创建 PublishLog 记录

Step 8: 重新构建并重启
  cd /root/publishos/backend/publish-gateway
  npm run build
  pm2 restart publishos-backend

Step 9: 运行 smoke test
  cd /root/publishos
  npx tsx smoke-test.ts

Step 10: 输出修复报告
```

## 6. 禁止操作清单

❌ **绝对不要：**
- 删除或清空 `prisma/dev.db`（数据库文件）
- 删除或清空 `uploads/` 目录（已上传的视频）
- 删除 `.env` 文件或修改其中的密钥
- 提交任何 secret/token/password 到 GitHub
- 修改 `smoke-test.ts` 中的测试账号密码
- 删除任何现有的 API 端点（只新增不删除）
- 重构数据库 schema（只新增字段不删除）
- 修改 `build.yml` 的触发条件
- 安装新的 npm 全局包
- 修改 Electron 客户端代码（只改后端和 dashboard）

✅ **可以做：**
- 新增 API 端点
- 新增 Prisma model 或字段
- 修改现有路由的逻辑
- 修改 dashboard 代码
- 修改后端服务代码
- 重新构建和重启服务
- 添加环境变量到 `.env`

## 7. 验收命令

```bash
# 健康检查
curl -s http://127.0.0.1:3000/health | python3 -m json.tool

# 管理员登录
curl -s -X POST http://127.0.0.1:3000/v1/auth/admin/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@publishos.com","password":"admin123"}'

# 客户登录
curl -s -X POST http://127.0.0.1:3000/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"abc@hvac.com","password":"password123"}'

# TikTok auth URL（不应返回 404）
curl -s "http://127.0.0.1:3000/v1/tiktok/auth?clientId=demo-client-1"

# 客户端队列（不应泄露 password）
curl -s "http://127.0.0.1:3000/v1/content/delivered?clientId=demo-client-1" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('password' in str(d))"

# 完整 smoke test
cd /root/publishos && npx tsx smoke-test.ts
```

**所有命令应该返回正常结果，不应该有 404/500 错误。**

## 8. 修复报告格式

```markdown
## PublishOS 修复报告

### 环境信息
- 服务器: 104.238.181.32
- Git commit: [最新 commit hash]
- PM2 状态: [online/error]

### 修复清单
| # | 问题 | 严重度 | 修复方式 | 状态 |
|---|------|--------|----------|------|
| 1 | xxx  | P0     | xxx      | ✅/❌ |

### 验收结果
- [ ] health 正常
- [ ] admin 登录正常
- [ ] client 登录正常
- [ ] tiktok auth URL 正常
- [ ] 无密码泄露
- [ ] smoke test 通过

### 未修复问题（如有）
- [问题描述] — 原因 — 建议

### 改动文件列表
- backend/publish-gateway/src/routes/xxx.ts — [改动说明]
```

## 9. Push 策略

**需要 push 到 GitHub 的改动：**
- 后端路由修复（server.ts, routes/*.ts, services/*.ts）
- Dashboard 页面修改
- Prisma schema 新增字段（但不删除现有字段）

**只在服务器临时验证的改动：**
- 环境变量调整
- PM2 配置调整
- 临时调试代码（验证后删除）

**Push 方法：**
```bash
cd /root/publishos
git add -A
git config user.email "dev@publishos.com"
git config user.name "PublishOS Dev"
git commit -m "fix: [描述]"
git remote set-url origin https://github.com/plmmcpdd/publishos.git
git push origin main
```

## 10. GitHub Workflow 权限问题

如果 push 被拒绝，报错 `refusing to allow a Personal Access Token to create or update workflow`：

**原因：** GitHub token 没有 `workflow` scope，无法修改 `.github/workflows/` 下的文件。

**解决方案：**
1. 不要修改 `.github/workflows/build.yml`
2. 或者只改非 workflow 文件，让 owner 手动 push workflow 改动
3. 或者让 owner 给一个带 `workflow` scope 的 token

**如果需要部署服务器但代码 push 不了：**
- 直接在服务器上 `git pull` 拉取已有代码
- 只做服务器端的修复（重启服务、修改 .env 等）
- 把需要 push 的改动记录在报告中，让 owner 后续处理

## 11. 参考信息

### 测试账号
| 角色 | 邮箱 | 密码 |
|------|------|------|
| 管理员 | admin@publishos.com | admin123 |
| 客户 | abc@hvac.com | password123 |
| 客户 | test@test.com | Laurelx2022 |

### API 端点
| 端点 | 方法 | 说明 |
|------|------|------|
| `/health` | GET | 健康检查 |
| `/v1/auth/admin/login` | POST | 管理员登录 |
| `/v1/auth/login` | POST | 客户登录 |
| `/v1/tiktok/auth` | GET | TikTok 授权 URL |
| `/v1/tiktok/callback` | GET | TikTok 回调 |
| `/v1/tiktok/bindings/:clientId` | GET | 查询绑定 |
| `/v1/content` | GET/POST | 内容列表/创建 |
| `/v1/content/delivered` | GET | 已推送内容 |
| `/v1/content/:id/deliver` | POST | 推送内容 |
| `/v1/content/:id/confirm` | POST | 确认发布 |

### Prisma 常用命令
```bash
cd /root/publishos/backend/publish-gateway
npx prisma generate        # 重新生成 client
npx prisma db push         # 推送 schema 变更（不丢数据）
npx prisma studio          # 打开数据库管理界面（需要端口转发）
```

### PM2 常用命令
```bash
pm2 status                 # 查看状态
pm2 logs publishos-backend # 查看日志
pm2 restart publishos-backend # 重启
pm2 flush publishos-backend   # 清空日志
```
