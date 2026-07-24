# PublishOS — API Contract v1.0

## 版本信息
- **Version**: 1.0
- **Date**: 2026-06-04
- **Author**: @研发 (Tech Lead)
- **Status**: Final

## 设计原则

1. **Device-Task Token Separation**: 客户端用 `device_token` 拉取队列，用 `task_token` 回传单条任务状态。`task_token` 是一次性的。
2. **Account Binding Isolation**: 一个客户可能有多个平台账号，通过 `account_binding_id` 隔离。
3. **S3 Presigned URLs**: 媒体文件通过 15 分钟过期的预签名 URL 下发，客户端无需 AWS 凭证。
4. **Compliance Gateway**: 所有内容必须经美国运营审核后才能进入客户端队列。
5. **Zero Knowledge Credentials**: 客户账号密码/API Token 不存储在服务器，由客户端本地浏览器管理。

## 认证

### Device Token
- 客户端 App 注册设备时获取，长期有效（可手动刷新）
- 用于：拉取队列 (`GET /v1/queue`)、获取设备配置、心跳
- 存储在客户端本地，Electron 的 `localStorage` 或 `keytar`

```json
Headers: Authorization: Bearer {device_token}
```

### Task Token
- 服务端在任务下发时生成，一次性使用
- 用于：回传任务状态 (`POST /v1/tasks/:id/status`)
- 任务完成后失效，不可复用

```json
Headers: Authorization: Bearer {task_token}
```

### 运营 Token
- 运营人员登录后台获取，JWT 格式，24 小时过期
- 用于：内容审核、查看审计日志、管理客户

```json
Headers: Authorization: Bearer {jwt_token}
```

---

## 接口列表

### 1. Content Management (中国团队)

#### POST /v1/contents
创建内容，由中国内容团队调用。

**Request Body:**
```json
{
  "client_id": "client_123",
  "title": "Summer HVAC Tune-Up Tips",
  "description": "Keep your AC running all summer with these 3 tips...",
  "media": [
    {
      "type": "video",
      "storage_key": "media/videos/hvac_summer_01.mp4",
      "license_ref": "envato_video_12345"
    }
  ],
  "ai_generated": true,
  "ai_disclosure": {
    "platform": "tiktok",
    "label": "ai-generated"
  },
  "platforms": ["tiktok"],
  "scheduled_at": "2026-06-06T15:00:00-04:00",
  "license_chain": [
    {
      "source": "envato",
      "id": "video_12345",
      "license_type": "elements_business",
      "subscription_id": "sub_abc",
      "expires_at": "2026-12-31"
    }
  ],
  "tags": ["hvac", "summer", "maintenance"],
  "target_hashtags": ["#HVAC", "#SummerTips", "#HomeMaintenance"]
}
```

**Response (201):**
```json
{
  "content_id": "cnt_abc123",
  "status": "pending_review",
  "created_at": "2026-06-04T10:00:00Z",
  "license_status": "valid",
  "compliance_check": {
    "ai_label_missing": false,
    "license_missing": false,
    "high_risk_ad_copy": false
  }
}
```

**Error (422):**
```json
{
  "error": "compliance_violation",
  "message": "License chain incomplete for media[0]",
  "details": {
    "license_status": "missing",
    "media_index": 0
  }
}
```

---

#### GET /v1/contents
查询内容列表，运营后台使用。

**Query Parameters:**
- `status`: `pending_review` | `approved` | `rejected` | `published` | `blocked_compliance`
- `client_id`: 筛选特定客户
- `from`: ISO 8601 开始时间
- `to`: ISO 8601 结束时间
- `limit`: 默认 20，最大 100
- `offset`: 分页偏移

**Response (200):**
```json
{
  "total": 156,
  "items": [
    {
      "content_id": "cnt_abc123",
      "client_id": "client_123",
      "client_name": "Joe's HVAC",
      "title": "Summer HVAC Tune-Up Tips",
      "status": "pending_review",
      "ai_generated": true,
      "license_status": "valid",
      "created_at": "2026-06-04T10:00:00Z",
      "scheduled_at": "2026-06-06T15:00:00-04:00"
    }
  ]
}
```

---

#### GET /v1/contents/:content_id
获取单条内容详情。

**Response (200):**
```json
{
  "content_id": "cnt_abc123",
  "client_id": "client_123",
  "title": "Summer HVAC Tune-Up Tips",
  "description": "...",
  "media": [...],
  "ai_generated": true,
  "ai_disclosure": { "platform": "tiktok", "label": "ai-generated" },
  "platforms": ["tiktok"],
  "scheduled_at": "...",
  "license_chain": [...],
  "status": "pending_review",
  "compliance_check": { ... },
  "audit_log": [
    {
      "action": "created",
      "actor": "team_cn_user_1",
      "timestamp": "2026-06-04T10:00:00Z"
    }
  ]
}
```

---

### 2. Content Approval (美国运营)

#### POST /v1/contents/:content_id/approve
审核通过内容。运营调用。

**Request Body:** (optional)
```json
{
  "notes": "Looks good, AI label correct, license valid."
}
```

**Response (200):**
```json
{
  "content_id": "cnt_abc123",
  "status": "approved",
  "approved_at": "2026-06-04T11:30:00Z",
  "approved_by": "operator_us_1",
  "notes": "Looks good..."
}
```

**Error (403):** 运营 Token 权限不足。

**Error (409):** 内容状态不是 `pending_review`。

**Error (422):** `license_status` 为 `missing` 或授权已过期，Approve 被禁用。

---

#### POST /v1/contents/:content_id/reject
审核驳回内容。运营调用。

**Request Body:**
```json
{
  "reason": "License chain incomplete for BGM",
  "reason_code": "license_missing",
  "suggested_fix": "Replace with Envato Elements track #music_6789"
}
```

**Response (200):**
```json
{
  "content_id": "cnt_abc123",
  "status": "rejected",
  "rejected_at": "2026-06-04T11:30:00Z",
  "rejected_by": "operator_us_1",
  "reason": "License chain incomplete for BGM",
  "reason_code": "license_missing"
}
```

**Reason Codes:**
- `license_missing`: 素材授权缺失
- `ai_label_missing`: AI 披露标签不正确
- `high_risk_ad_copy`: 广告文案含高风险用语
- `copyright_concern`: 版权风险
- `quality_issue`: 内容质量不达标
- `schedule_conflict`: 发布时间冲突
- `other`: 其他原因

---

### 3. Publish Jobs (发布任务)

#### POST /v1/publish-jobs
为已审核通过的内容创建发布任务。由系统自动或运营手动触发。

**Request Body:**
```json
{
  "content_id": "cnt_abc123",
  "account_binding_id": "bind_tiktok_joes_hvac",
  "platform": "tiktok",
  "publish_config": {
    "privacy": "public",
    "allow_comments": true,
    "allow_duet": true,
    "allow_stitch": false,
    "ai_label": "ai-generated"
  },
  "scheduled_at": "2026-06-06T15:00:00-04:00"
}
```

**Response (201):**
```json
{
  "job_id": "job_xyz789",
  "content_id": "cnt_abc123",
  "status": "queued",
  "account_binding_id": "bind_tiktok_joes_hvac",
  "platform": "tiktok",
  "created_at": "2026-06-04T12:00:00Z"
}
```

---

#### GET /v1/publish-jobs
查询发布任务列表。

**Query Parameters:**
- `status`: `queued` | `pending_client` | `publishing` | `published` | `failed` | `cancelled`
- `client_id`
- `account_binding_id`
- `limit`, `offset`

**Response (200):** 同 `GET /v1/contents` 格式，items 为 publish job 对象。

---

### 4. Client Queue (客户端 App)

#### POST /v1/client/register
客户端 App 首次启动时注册设备。

**Request Body:**
```json
{
  "client_id": "client_123",
  "device_name": "Joe's MacBook Pro",
  "device_type": "macos",
  "device_fingerprint": "sha256_hash_of_hardware_info"
}
```

**Response (201):**
```json
{
  "device_id": "dev_001",
  "device_token": "dtk_...",
  "client_id": "client_123",
  "expires_at": "2027-06-04T10:00:00Z"
}
```

---

#### GET /v1/queue
客户端拉取待发布任务队列。

**Headers:** `Authorization: Bearer {device_token}`

**Query Parameters:**
- `limit`: 默认 10

**Response (200):**
```json
{
  "items": [
    {
      "task_id": "task_001",
      "job_id": "job_xyz789",
      "content_id": "cnt_abc123",
      "account_binding_id": "bind_tiktok_joes_hvac",
      "title": "Summer HVAC Tune-Up Tips",
      "description": "Keep your AC running...",
      "media_url": "https://api.example.com/v1/media?key=local%3Avideos%2F...&exp=...&aud=...&sig=...",
      "media_type": "video",
      "platform": "tiktok",
      "ai_label_required": "ai-generated",
      "publish_config": {
        "privacy": "public",
        "allow_comments": true,
        "allow_duet": true,
        "allow_stitch": false
      },
      "scheduled_at": "2026-06-06T15:00:00-04:00",
      "task_token": "ttk_..."
    }
  ]
}
```

**Note:** `media_url` 是服务端签发的短时媒体 URL，默认 15 分钟后过期。数据库保存稳定 storage key（例如 `local:videos/<uuid>.mp4`），而非短时 URL；客户端必须在有效期内下载。

---

#### POST /v1/client/heartbeat
客户端心跳，保持设备在线状态。

**Headers:** `Authorization: Bearer {device_token}`

**Request Body:**
```json
{
  "device_status": "online",
  "browser_ready": true,
  "last_error": null
}
```

**Response (200):**
```json
{
  "server_time": "2026-06-04T10:00:00Z",
  "config_version": "1.0",
  "force_refresh": false
}
```

---

### 5. Task Status (客户端回传)

#### POST /v1/tasks/:task_id/status
客户端上报任务状态。使用 `task_token` 认证。

**Headers:** `Authorization: Bearer {task_token}`

**Request Body:**
```json
{
  "status": "published",
  "published_at": "2026-06-06T15:02:00-04:00",
  "platform_post_id": "tiktok_1234567890",
  "error": null,
  "device_fingerprint": "sha256_hash",
  "browser_info": {
    "user_agent": "Mozilla/5.0...",
    "platform": "macos",
    "version": "14.0"
  }
}
```

**Status Values:**
- `published`: 发布成功
- `failed`: 发布失败
- `cancelled`: 用户取消
- `timeout`: 客户端超时未响应

**Error Object (for failed):**
```json
{
  "code": "browser_error",
  "message": "TikTok upload page timed out",
  "stack": "optional",
  "retryable": true
}
```

**Response (200):**
```json
{
  "task_id": "task_001",
  "status": "published",
  "acknowledged_at": "2026-06-06T15:02:05Z"
}
```

**Error (401):** `task_token` 无效或已使用。

**Error (403):** `task_token` 与 `task_id` 不匹配。

---

### 6. Audit (审计日志)

#### GET /v1/audit
查询审计日志。运营后台和系统管理员使用。

**Headers:** `Authorization: Bearer {jwt_token}`

**Query Parameters:**
- `client_id`
- `content_id`
- `task_id`
- `actor_id`
- `action`: `created` | `approved` | `rejected` | `published` | `failed` | `cancelled`
- `from`, `to`
- `limit`, `offset`

**Response (200):**
```json
{
  "total": 1024,
  "items": [
    {
      "audit_id": "aud_001",
      "action": "published",
      "actor": "client_device_001",
      "actor_type": "device",
      "target_type": "task",
      "target_id": "task_001",
      "timestamp": "2026-06-06T15:02:00Z",
      "details": {
        "platform": "tiktok",
        "platform_post_id": "tiktok_1234567890",
        "ai_label_applied": true,
        "license_refs": ["envato_video_12345"]
      },
      "device_fingerprint": "sha256_hash",
      "ip_address": "xxx.xxx.xxx.xxx"
    }
  ]
}
```

---

### 7. Dashboard Metrics (运营数据)

#### GET /v1/metrics/dashboard
运营后台实时指标。

**Headers:** `Authorization: Bearer {jwt_token}`

**Response (200):**
```json
{
  "today": {
    "publish_success_rate": 0.94,
    "publish_count": 12,
    "pending_review_count": 3,
    "pending_client_count": 5
  },
  "last_7_days": {
    "publish_success_rate": 0.91,
    "total_published": 89
  },
  "health_alerts": [
    {
      "client_id": "client_456",
      "client_name": "CoolAir Systems",
      "alert_type": "shadowban_suspected",
      "severity": "high",
      "detected_at": "2026-06-04T08:00:00Z",
      "details": "Last 3 posts not appearing in hashtag search results"
    }
  ]
}
```

---

### 8. Account Health (账号健康)

#### GET /v1/account-bindings/:id/health
查询账号健康状态。

**Headers:** `Authorization: Bearer {jwt_token}`

**Response (200):**
```json
{
  "account_binding_id": "bind_tiktok_joes_hvac",
  "client_id": "client_123",
  "platform": "tiktok",
  "handle": "@joes_hvac_ri",
  "health_score": 87,
  "status": "healthy",
  "last_checked": "2026-06-04T09:00:00Z",
  "metrics": {
    "publish_success_rate_7d": 0.95,
    "post_visibility": "normal",
    "follower_growth_rate": "normal",
    "login_status": "valid"
  },
  "alerts": []
}
```

---

## 错误响应规范

所有错误响应遵循统一格式：

```json
{
  "error": "error_code_snake_case",
  "message": "Human readable description",
  "details": {},
  "request_id": "req_xxx"
}
```

**HTTP Status Codes:**

| Status | Meaning | When |
|--------|---------|------|
| 200 | OK | Success |
| 201 | Created | Resource created |
| 400 | Bad Request | Request body malformed |
| 401 | Unauthorized | Token missing or invalid |
| 403 | Forbidden | Token valid but permission denied |
| 404 | Not Found | Resource doesn't exist |
| 409 | Conflict | Resource state conflict (e.g., already approved) |
| 422 | Unprocessable | Business logic violation (e.g., license missing) |
| 429 | Too Many Requests | Rate limit exceeded |
| 500 | Server Error | Internal server error |

---

## 数据模型

详见 `prisma/schema.prisma` (后端参考实现)。

核心表：
- `Content` — 内容主表
- `ContentMedia` — 内容媒体关联
- `LicenseChain` — 素材授权链
- `PublishJob` — 发布任务
- `PublishTask` — 客户端任务实例
- `Client` — 客户
- `AccountBinding` — 平台账号绑定
- `AuditLog` — 审计日志
- `Device` — 客户端设备注册

## 版本历史

| Version | Date | Changes |
|---------|------|---------|
| 0.1 | 2026-06-04 | Initial draft |
| 1.0 | 2026-06-04 | Added 4 security patches: account_binding_id, device/task token separation, approval gateway, S3 presigned URLs |
