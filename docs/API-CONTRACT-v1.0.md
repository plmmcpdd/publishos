# API 契约 v1.0 — 发布网关
> 版本: 1.0 | 状态: 定版 | 适用: 外部开发团队（Codex/人类）

---

## 变更日志

| 版本 | 日期 | 变更 |
|------|------|------|
| v0.1 | 2026-06-04 | 初稿，含内容/发布/客户端/审计核心接口 |
| v1.0 | 2026-06-04 | **纳入 4 项安全补漏**: ① account_binding_id 隔离 ② device_token/task_token 分离 ③ 审核网关 /approve /reject ④ S3 预签名 URL 15 分钟过期 |

---

## 认证体系

### 三种 JWT Token

所有接口通过 `Authorization: Bearer <token>` 认证。Token 共用同一个 `JWT_SECRET` 签名，但 `payload.type` 字段区分用途。

| Token 类型 | payload | 用途 | 有效期 | 获取方式 |
|------------|---------|------|--------|----------|
| **user** | `{ type: "user", id: "user_001", role: "admin" }` | 运营团队操作 | 24h | 内部 IAM 系统签发 |
| **device** | `{ type: "device", device_id: "mac_001", client_id: "client_abc", capabilities: ["tiktok_web"] }` | 客户端 App 轮询队列 | 7d | `POST /v1/client/register` |
| **task** | `{ type: "task", job_id: "job_xyz", device_id: "mac_001" }` | 客户端回传单条任务状态 | 24h | 任务下发时由网关生成，随队列返回 |

### 安全规则

- **Task Token 只能操作指定 job。** 中间件验证 `payload.job_id === req.params.id`，不匹配返回 403。
- **Device Token 绑定硬件。** `device_id` 由客户端 App 在首次运行时生成（基于硬件指纹 + 随机 salt），不可篡改。
- **Task Token 不能拉取队列。** 用 task token 调用 `GET /v1/client/queue` 返回 403。

---

## 1. 内容管理 (Content)

### POST /v1/content
**中国交付团队**创建内容。素材授权链不完整时直接 422 阻断。

**Headers:** `Authorization: Bearer {user_token}`

**Request Body:**
```json
{
  "client_id": "client_abc123",
  "title": "HVAC Tips for Summer",
  "description": "Full script or content brief",
  "caption": "Beat the heat... #hvac #summer",
  "hashtags": ["hvac", "summer", "airconditioning"],
  "video_url": "https://s3.amazonaws.com/.../video.mp4",
  "thumbnail_url": "https://s3.amazonaws.com/.../thumb.jpg",
  "ai_generated": true,
  "ai_tools": ["runway", "gpt4"],
  "platforms": ["tiktok", "instagram", "facebook"],
  "schedule_at": "2026-06-15T14:00:00Z",
  "metadata": {
    "industry": "hvac",
    "campaign": "summer_2026",
    "content_type": "educational"
  },
  "assets": [
    {
      "type": "stock_video",
      "source": "envato",
      "license_id": "env_789",
      "url": "https://s3.amazonaws.com/.../clip.mp4",
      "authorization_doc_url": "https://s3.amazonaws.com/.../auth.pdf",
      "description": "AC unit b-roll footage"
    },
    {
      "type": "client_owned",
      "source": "client_direct",
      "url": "https://s3.amazonaws.com/.../onsite.mp4",
      "description": "Customer's service team photo"
    }
  ]
}
```

**422 阻断示例（素材缺授权）:**
```json
{
  "error": "License reference required for stock assets",
  "assets": ["https://s3.amazonaws.com/.../clip.mp4"]
}
```

**Response 201:**
```json
{
  "content_id": "cnt_abc123",
  "status": "pending_review",
  "created_at": "2026-06-10T09:00:00Z",
  "compliance_check": {
    "status": "pending",
    "checks": ["copyright", "ai_disclosure", "platform_policy"]
  }
}
```

---

### GET /v1/content
运营后台列表查询。

**Query Parameters:**
- `status` — `pending_review` | `rejected` | `approved` | `published` | `failed`
- `client_id` — 客户过滤

**Response:**
```json
{
  "data": [
    {
      "id": "cnt_abc123",
      "clientId": "client_abc123",
      "title": "...",
      "status": "approved",
      "assets": [...],
      "publishJobs": [
        {
          "id": "job_xyz789",
          "platform": "tiktok",
          "status": "dispatched",
          "accountBinding": { "platform": "tiktok", "accountUsername": "@acme_hvac" }
        }
      ]
    }
  ]
}
```

---

### GET /v1/content/:id
内容详情。

---

### POST /v1/content/:id/approve
**美国运营团队**审核通过。通过后才能创建发布任务。

**Request Body:**
```json
{ "notes": "Copyright clear, AI labels confirmed" }
```

---

### POST /v1/content/:id/reject
审核拒绝。

**Request Body:**
```json
{
  "reason": "copyright_risk",
  "detail": "Asset env_789 license does not cover sub-licensing to client"
}
```

---

## 2. 发布任务 (PublishJob)

### POST /v1/publish-jobs
为**已审核通过**的内容创建发布任务。自动调度（5 分钟内执行的立即 dispatch）。

**Headers:** `Authorization: Bearer {user_token}`

**Request Body:**
```json
{
  "content_id": "cnt_abc123",
  "account_binding_id": "bind_tiktok_acme_001",
  "platform": "tiktok",
  "schedule_at": "2026-06-15T14:00:00Z",
  "publish_options": {
    "privacy": "public",
    "allow_comments": true,
    "allow_duet": false,
    "allow_stitch": false,
    "ai_generated_label": true
  }
}
```

**Response 201:**
```json
{
  "job_id": "job_xyz789",
  "status": "dispatched",
  "content_id": "cnt_abc123",
  "platform": "tiktok",
  "account_binding_id": "bind_tiktok_acme_001",
  "created_at": "2026-06-10T09:05:00Z"
}
```

**错误码:**
- `422` — content 未 approved
- `422` — account_binding 平台与请求 platform 不匹配
- `404` — content_id 或 account_binding_id 不存在

---

### GET /v1/publish-jobs
列表查询。支持 `status`, `content_id`, `platform` 筛选。

---

### POST /v1/publish-jobs/:id/cancel
取消未执行的任务。已 published/failed 的不可取消。

---

## 3. 客户端接口 (Client App)

### POST /v1/client/register
Electron 客户端首次运行时注册，获取 `device_token`。

**Request Body:**
```json
{
  "device_id": "mac_001_abc123",    // 硬件指纹 + 随机 salt
  "client_id": "client_abc123",
  "capabilities": ["tiktok_web", "instagram_web"]
}
```

**Response:**
```json
{
  "device_token": "eyJhbGc...",
  "device_id": "mac_001_abc123",
  "expires_at": "2026-06-17T09:00:00Z"
}
```

---

### GET /v1/client/queue
客户端轮询拉取待发布任务。**这是核心接口**，每次返回 ≤10 条 `dispatched` 状态的任务。

**Headers:** `Authorization: Bearer {device_token}`

**Query:** `?device_id=mac_001_abc123&client_version=1.0.0`

**Response:**
```json
{
  "device_id": "mac_001_abc123",
  "queue": [
    {
      "job_id": "job_xyz789",
      "job_token": "eyJhbGc...",           // ← 一次性回传凭证
      "content_id": "cnt_abc123",
      "title": "HVAC Tips for Summer",
      "description": "Full script...",
      "caption": "Beat the heat...",
      "media_url": "https://s3-presigned-15min.../video.mp4",
      "thumbnail_url": "https://s3-presigned-15min.../thumb.jpg",
      "platform": "tiktok",
      "publish_config": {
        "ai_generated_label": true,
        "privacy": "public",
        "allow_comments": true,
        "allow_duet": false
      },
      "account_binding_id": "bind_tiktok_acme_001",
      "account_username": "@acme_hvac",
      "scheduled_at": "2026-06-15T14:00:00Z",
      "deadline": "2026-06-15T14:30:00Z"     // 30 分钟 grace period
    }
  ]
}
```

**关键设计:**
- `media_url` 是 **15 分钟过期的 S3 预签名 URL**。客户端必须在有效期内下载视频，否则重新轮询获取新 URL。
- `job_token` 只能用于 `POST /v1/tasks/:job_id/status`，不能用于拉取队列或其他操作。
- 每次轮询时网关自动刷新 `Device.lastSeen` 和 `online` 状态。

---

### POST /v1/client/heartbeat
客户端心跳，每 30-60 秒上报一次。

**Headers:** `Authorization: Bearer {device_token}`

**Request Body:**
```json
{
  "status": "online",
  "capabilities": ["tiktok_web", "instagram_web"],
  "active_sessions": {
    "tiktok": { "logged_in": true, "session_age_hours": 48 },
    "instagram": { "logged_in": false }
  }
}
```

---

## 4. 状态回传 (Status Callback)

### POST /v1/tasks/:id/status
客户端完成（或失败）发布后回传。**必须用 task_token。**

**Headers:** `Authorization: Bearer {task_token}`

**Request Body (成功):**
```json
{
  "status": "published",
  "platform_post_id": "7435925695869501496",
  "platform_post_url": "https://www.tiktok.com/@acme_hvac/video/7435925695869501496",
  "published_at": "2026-06-15T14:03:22Z",
  "device_fingerprint": {
    "os": "macos_14.5",
    "browser": "chrome_124",
    "ip_geo": "US-NY"
  },
  "screenshot_url": "https://s3.amazonaws.com/.../screenshot.png"
}
```

**Request Body (失败):**
```json
{
  "status": "failed",
  "error": {
    "code": "tiktok_login_required",
    "message": "Session expired, login page detected at /upload",
    "retryable": true
  },
  "device_fingerprint": {
    "os": "macos_14.5",
    "browser": "chrome_124"
  }
}
```

**Error Codes (标准化):**
| Code | 含义 | retryable | 处理建议 |
|------|------|-----------|----------|
| `tiktok_login_required` | 登录态过期 | true | 客户端托盘弹窗，通知客户重新登录 |
| `tiktok_captcha_triggered` | 触发验证码 | false | 人工介入，手动完成上传 |
| `tiktok_upload_blocked` | 上传接口被风控拦截 | false | 暂停该账号 24h，检查 shadowban |
| `network_error` | 客户端网络异常 | true | 自动重试，指数退避 |
| `file_download_failed` | S3 预签名 URL 过期或下载失败 | true | 重新轮询队列获取新 URL |
| `platform_api_error` | 平台返回非预期错误 | 视情况 | 记录日志，运营人工排查 |

**Response:**
```json
{
  "job_id": "job_xyz789",
  "status": "published",
  "content_id": "cnt_abc123",
  "platform": "tiktok",
  "updated_at": "2026-06-15T14:03:25Z"
}
```

---

## 5. 账号绑定 (AccountBinding)

### POST /v1/account-bindings
绑定客户社交账号。密码**不存储**在服务器，仅标记由客户端 App 管理登录态。

**Request Body:**
```json
{
  "client_id": "client_abc123",
  "platform": "tiktok",
  "account_username": "@acme_hvac",
  "credentials": {
    "type": "client_app_managed",
    "notes": "Customer logs in via Electron App, session stored locally"
  },
  "business_location": {
    "country": "US",
    "state": "NY",
    "city": "Buffalo"
  },
  "active": true
}
```

---

### GET /v1/account-bindings/:id/health
查询账号健康状态，供 Dashboard 展示。

**Response:**
```json
{
  "binding_id": "bind_tiktok_acme_001",
  "status": "active",
  "last_publish": "2026-06-14T10:00:00Z",
  "health_score": 95,
  "warnings": [],
  "client_session": {
    "device_id": "mac_001_abc123",
    "last_seen": "2026-06-15T13:50:00Z",
    "session_valid": true
  }
}
```

---

## 6. 审计 (Audit)

### GET /v1/audit
审计日志查询。支持 `action`, `target_type`, `from`, `to` 筛选。

---

### GET /v1/audit/publish-summary
发布统计看板数据。

**Response:**
```json
{
  "total": 156,
  "by_status": { "published": 140, "failed": 12, "cancelled": 4 },
  "by_platform": {
    "tiktok": { "total": 80, "success": 72, "failed": 8 },
    "instagram": { "total": 76, "success": 68, "failed": 4 }
  },
  "errors": {
    "tiktok_login_required": 5,
    "tiktok_upload_blocked": 3,
    "network_error": 4
  }
}
```

---

## 数据模型关系图

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────┐
│   Client    │────<│ AccountBinding (N) │────<│ PublishJob  │
│  (客户)     │     │ (平台账号绑定)      │     │ (发布任务)   │
└─────────────┘     └──────────────────┘     └─────────────┘
       │                                          │
       │                                          │
       │                    ┌─────────────┐       │
       └───────────────────<│   Content   │───────┘
                            │  (内容)      │
                            └─────────────┘
                                   │
                                   │
                            ┌─────────────┐
                            │ContentAsset │
                            │ (素材授权)   │
                            └─────────────┘
```

---

## 状态机

### Content 状态
```
pending_review → approved → [PublishJob created] → published
     ↓ rejected              ↓ failed
```

### PublishJob 状态
```
pending → dispatched → client_confirmed → publishing → published
   ↓         ↓               ↓
cancelled  (timeout)      failed
```

---

## 外部团队接入 Checklist

- [ ] 替换 `generatePresignedUrl()` 为 AWS SDK `getSignedUrl`
- [ ] 配置 `JWT_SECRET` 环境变量（≥32 字符，生产环境用 AWS Secrets Manager）
- [ ] 配置 `DATABASE_URL` 指向 AWS RDS PostgreSQL
- [ ] 配置 `S3_BUCKET` 和 AWS IAM 凭证
- [ ] 添加 rate limiting（建议: device_token 100 req/15min, user_token 1000 req/15min）
- [ ] 添加 structured logging（Pino）替代 console.log
- [ ] 部署到 AWS ECS/Fargate 或 EC2（US-East-1）
- [ ] 配置 Tailscale 或 AWS Client VPN 让中国团队访问内容创建 API
- [ ] 设置数据库自动备份（RDS 7 天保留）

---

## 待外部团队确认

1. **TikTok web 端 AI 标签 DOM selector** — 需要真实账号登录后检测 `data-e2e="ai-generated-toggle"` 或类似字段的确切路径
2. **Instagram Graph API 的 `is_ai_generated` 字段** — Meta 文档声称支持，需要真实 API 调用验证
3. **X API v2 媒体上传 + 标签流程** — 确认 `media_upload` → `post tweet` 时是否能在 metadata 中标记 AI 生成
4. **S3 预签名 URL 在客户端的下载策略** — 视频文件可能 50-100MB，是否需要分片下载或断点续传
