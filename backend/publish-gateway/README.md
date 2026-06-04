# Publish Gateway — Reference Implementation

> Backend scaffold for the social media publish gateway. Designed as a **reference implementation** for external development teams. This is not production-ready — it demonstrates the architecture, API contracts, and data model.

## Tech Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Runtime | Node.js 20 + TypeScript | Widest talent pool, fastest iteration |
| Framework | Express.js | Standard, well-documented, minimal magic |
| ORM | Prisma 7 | Schema-first, generates types, handles migrations |
| Database | PostgreSQL 15+ | AWS RDS compatible, ACID for audit trails |
| Auth | JWT (custom) | Three token types: `user` (ops), `device` (client app), `task` (one-time callback) |
| Object Storage | AWS S3 | Presigned URLs for media delivery to client apps |

## Project Structure

```
src/
  server.ts              # Express app entry point
  lib/
    prisma.ts            # Prisma client singleton
  middleware/
    auth.ts              # JWT auth: user / device / task token verification
  routes/
    content.ts           # Content CRUD + approval workflow
    publish-jobs.ts      # Job creation + dispatch + cancellation
    client.ts            # Device registration + queue polling + heartbeat
    tasks.ts             # Status callback from client apps (task-token auth)
    audit.ts             # Audit log query + publish summary dashboard
prisma/
  schema.prisma          # Full database schema (see Models below)
  config.ts              # Prisma 7 connection config
.env.example             # Required environment variables
```

## Data Model (Prisma Schema)

```
Client (1) ───< (N) AccountBinding (1) ───< (N) PublishJob
                                      
Content (1) ───< (1..N) PublishJob

Content (1) ───< (M) ContentAsset (素材授权)

PublishJob ───> JobHistory[] (状态变更日志)
Device (客户端设备) ───> Heartbeat
```

### Key Design Decisions

1. **AccountBinding** decouples clients from platforms. A client can have multiple TikTok/Instagram accounts, each with its own binding.
2. **Content** is immutable after creation. Changes require creating a new version. This prevents audit corruption.
3. **PublishJob** carries two tokens: `clientToken` (for queue polling) and `jobToken` (one-time use for status callback). This prevents replay attacks.
4. **Device** records client app hardware fingerprints. The `deviceId` is provided by the Electron app, not generated server-side.

## API Overview

### Content Management (运营团队 / 中国团队)

```
POST   /v1/content              ← 创建内容（含素材授权链校验）
GET    /v1/content              ← 列表（支持 status / client_id 筛选）
GET    /v1/content/:id          ← 详情
POST   /v1/content/:id/approve  ← 审核通过
POST   /v1/content/:id/reject   ← 审核拒绝
```

### Publish Jobs (调度器 / 运营团队)

```
POST   /v1/publish-jobs         ← 为已审核内容创建发布任务
GET    /v1/publish-jobs         ← 列表
POST   /v1/publish-jobs/:id/cancel  ← 取消未执行的任务
```

### Client App Interface (Electron 桌面端)

```
POST   /v1/client/register      ← 设备注册，获取 device_token
GET    /v1/client/queue        ← 轮询待发布任务（device_token）
POST   /v1/client/heartbeat     ← 心跳上报
```

### Status Callback (Client App → 网关)

```
POST   /v1/tasks/:id/status     ← 发布结果回传（task_token，一次性）
GET    /v1/tasks/:id            ← 任务详情（user_token）
```

### Audit & Dashboard

```
GET    /v1/audit                ← 审计日志查询
GET    /v1/audit/publish-summary ← 发布成功率 / 平台统计 / 错误归因
```

## Authentication

Three JWT token types, all signed with the same `JWT_SECRET` but carry different payloads:

### User Token (运营团队)
```json
{ "type": "user", "id": "user_us_001", "role": "admin" }
```
Used for: content creation, approval, job management, audit queries.

### Device Token (客户端 App)
```json
{ "type": "device", "device_id": "mac_001", "client_id": "client_abc", "capabilities": ["tiktok_web"] }
```
Used for: queue polling, heartbeat. Valid for 7 days. Re-register to refresh.

### Task Token (一次性回传)
```json
{ "type": "task", "job_id": "job_xyz", "device_id": "mac_001" }
```
Generated when a job is dispatched to the client queue. Valid for 24 hours. Can only be used to update the specific job it was issued for.

## S3 Presigned URLs

Media files (video, thumbnail) are delivered to client apps via **15-minute presigned S3 URLs**.

```typescript
// Current implementation: mock URL
// Replace with AWS SDK in production:
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
const url = await getSignedUrl(s3Client, new GetObjectCommand({ Bucket, Key }), { expiresIn: 900 });
```

Client apps must download the media within the expiry window. Failed downloads require re-polling the queue for a fresh URL.

## Running Locally

```bash
# 1. Install dependencies
npm install

# 2. Set up environment
cp .env.example .env
# Edit .env with your local Postgres URL and JWT secret

# 3. Generate Prisma client
npm run db:generate

# 4. Run migrations (requires running Postgres)
npm run db:migrate

# 5. Start dev server
npm run dev
```

## Health Check

```bash
curl http://localhost:3000/health
```

## What's Missing (Production Checklist)

This is a **reference scaffold**, not production code. External teams need to add:

- [ ] **Real AWS S3 integration** — replace `generatePresignedUrl()` mock with AWS SDK
- [ ] **Rate limiting** — add `express-rate-limit` per token type
- [ ] **Input sanitization** — stricter validation on `description`, `caption` (XSS prevention)
- [ ] **Error handling** — structured error responses with error codes
- [ ] **Logging** — replace `console.log` with structured logger (Pino/Winston)
- [ ] **Database connection pooling** — tune Prisma connection pool for AWS RDS
- [ ] **Secrets management** — move JWT_SECRET to AWS Secrets Manager / HashiCorp Vault
- [ ] **TLS termination** — assume AWS ALB or nginx handles TLS; app runs HTTP internally
- [ ] **Background job processor** — replace "auto-dispatch on creation" with a proper scheduler (Bull/BullMQ with Redis)
- [ ] **Webhook notifications** — notify client apps of new jobs via WebSocket instead of polling
- [ ] **TikTok web automation spike** — this backend is ready; the client-side Electron app needs the actual Playwright automation

## Security Notes

- **Account credentials never touch the server.** TikTok/Instagram passwords and session cookies are stored only in the Electron app's local Chromium profile. The server only knows "device online / session valid" via heartbeat.
- **Zero-trust network access.** The `Client` creation endpoint should be IP-restricted to the Tailscale VPN mesh connecting the China delivery team to the US VPC.
- **Audit immutability.** `AuditLog` records are append-only. No update or delete endpoint is exposed.
- **Job token isolation.** A task token obtained for job A cannot be replayed against job B. The middleware verifies `payload.job_id === req.params.id`.

## Contact

This reference implementation was produced by the internal product team as a handoff package for external development. Questions about the architecture should go to the PM; questions about the API contract should reference `api-contract-v0.1.md`.
