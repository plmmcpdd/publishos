# PublishOS — Architecture Document

## 1. 系统架构图

```
┌─────────────────────────────────────────────────────────────────────┐
│                           CLIENT SIDE                                │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐   │
│  │ Windows Client  │    │  macOS Client   │    │  macOS Client   │   │
│  │ (Electron)      │    │  (Electron)     │    │  (Electron)     │   │
│  │                 │    │  Apple Silicon  │    │  Intel          │   │
│  │ ┌───────────┐   │    │                 │    │                 │   │
│  │ │ Local     │   │    │ ┌───────────┐   │    │ ┌───────────┐   │   │
│  │ │ Browser   │   │    │ │ Local     │   │    │ │ Local     │   │   │
│  │ │ (Chromium)│   │    │ │ Browser   │   │    │ │ Browser   │   │   │
│  │ └───────────┘   │    │ │ (Chromium)│   │    │ │ (Chromium)│   │   │
│  └────────┬────────┘    │ └───────────┘   │    │ └───────────┘   │   │
│           │               └────────┬────────┘    └────────┬────────┘   │
│           │                        │                        │            │
│           │      Device Token      │      Device Token      │            │
│           │         (HTTPS)        │         (HTTPS)        │            │
│           ▼                        ▼                        ▼            │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ HTTPS (TLS 1.3)
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      AWS US-East VPC (us-east-1)                     │
│                                                                      │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐ │
│  │  API Gateway    │───▶│  Application    │───▶│  PostgreSQL     │ │
│  │  (ALB / Nginx)  │    │  Server         │    │  (RDS)          │ │
│  │                 │    │  (Node/Express) │    │                 │ │
│  │                 │    │                 │    │  ┌───────────┐ │ │
│  │                 │    │                 │    │  │ Content   │ │ │
│  │                 │    │                 │    │  │ Client    │ │ │
│  │                 │    │                 │    │  │ Audit     │ │ │
│  │                 │    │                 │    │  │ ...       │ │ │
│  │                 │    │                 │    │  └───────────┘ │ │
│  └────────┬────────┘    └────────┬────────┘    └────────┬────────┘ │
│           │                      │                      │           │
│           │                      │                      │           │
│           │                      ▼                      │           │
│           │            ┌─────────────────┐            │           │
│           │            │  S3 Bucket      │            │           │
│           │            │  (Media Storage)│            │           │
│           │            │                 │            │           │
│           │            │  ┌───────────┐ │            │           │
│           │            │  │ Videos    │ │            │           │
│           │            │  │ Images    │ │            │           │
│           │            │  │ Presigned │ │            │           │
│           │            │  │ URLs      │ │            │           │
│           │            │  └───────────┘ │            │           │
│           │            └─────────────────┘            │           │
│           │                      │                      │           │
│           │                      ▼                      │           │
│           │            ┌─────────────────┐            │           │
│           │            │ Secrets Manager  │            │           │
│           │            │ (Credentials)    │            │           │
│           │            │                  │            │           │
│           │            │ ┌─────────────┐ │            │           │
│           │            │ │ DB Password │ │            │           │
│           │            │ │ API Keys    │ │            │           │
│           │            │ │ JWT Secret  │ │            │           │
│           │            │ └─────────────┘ │            │           │
│           │            └─────────────────┘            │           │
│           │                                           │           │
│  ┌────────▼────────┐                                  │           │
│  │  Tailscale      │                                  │           │
│  │  Subnet Router  │◄─────────────────────────────────┘           │
│  │  (Bastion)      │                                                  │
│  └────────┬────────┘                                                  │
│           │ Tailscale VPN (WireGuard)                                  │
│           │ Only port 22/443                                           │
│           │ All ops audited                                            │
│           ▼                                                            │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ Zero-Trust VPN
                                    │ (No direct China internet access)
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         CHINA DELIVERY TEAM                          │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐   │
│  │  Content Team   │    │  Content Team   │    │  Content Team   │   │
│  │  (Workstation 1)│    │  (Workstation 2)│    │  (Workstation 3)│   │
│  │                 │    │                 │    │                 │   │
│  │  ┌───────────┐  │    │  ┌───────────┐  │    │  ┌───────────┐  │   │
│  │  │ Coze /    │  │    │  │ Coze /    │  │    │  │ Coze /    │  │   │
│  │  │ 扣子      │  │    │  │ 扣子      │  │    │  │ 扣子      │  │   │
│  │  │ Platform  │  │    │  │ Platform  │  │    │  │ Platform  │  │   │
│  │  └───────────┘  │    │  └───────────┘  │    │  └───────────┘  │   │
│  │                 │    │                 │    │                 │   │
│  │  Envato Elements│    │  Envato Elements│    │  Envato Elements│   │
│  │  Artgrid        │    │  Artgrid        │    │  Artgrid        │   │
│  └────────┬────────┘    └────────┬────────┘    └────────┬────────┘   │
│           │                      │                      │            │
│           └──────────────────────┼──────────────────────┘            │
│                                  │                                    │
│                                  │ Upload Content (HTTPS)             │
│                                  ▼                                    │
│                           ┌─────────────┐                            │
│                           │  Bastion    │                            │
│                           │  Host       │                            │
│                           │  (Jump Box) │                            │
│                           └─────────────┘                            │
│                                  │                                    │
│                                  │ SSH to US VPC                      │
│                                  ▼                                    │
│                           ┌─────────────┐                            │
│                           │  Tailscale  │                            │
│                           │  Coordination│                            │
│                           │  Server     │                            │
│                           └─────────────┘                            │
└─────────────────────────────────────────────────────────────────────┘
```

## 2. 网络架构

### 2.1 AWS VPC 设计 (us-east-1)

| 资源 | 规格 | 用途 | 月费用 |
|------|------|------|--------|
| EC2 (Application) | t3.medium | API Gateway + Application Server | ~$30 |
| RDS PostgreSQL | db.t3.micro | 主数据库 | ~$15 |
| S3 | Standard | 媒体存储 + 备份 | ~$5-20 |
| ALB | Application Load Balancer | HTTPS 终止 + 流量分发 | ~$20 |
| Secrets Manager | Standard | 凭证管理 | ~$0.40/secret |
| CloudWatch | Basic | 日志 + 监控 | ~$5-10 |
| **总计** | | | **~$75-100/月** |

### 2.2 安全组规则

| 来源 | 目标 | 端口 | 协议 | 说明 |
|------|------|------|------|------|
| 0.0.0.0/0 | ALB | 443 | HTTPS | 客户端 API 访问 |
| ALB | EC2 | 3000 | TCP | 内部应用通信 |
| EC2 | RDS | 5432 | TCP | 数据库访问 |
| EC2 | S3 | 443 | HTTPS | 媒体存储访问 |
| EC2 | Secrets Manager | 443 | HTTPS | 凭证获取 |
| Tailscale Subnet | EC2 | 22 | SSH | 运维管理 |
| Tailscale Subnet | RDS | 5432 | TCP | 数据库管理 |

**注意：** 80 端口不开放。所有 HTTP 请求强制重定向到 HTTPS。

### 2.3 Tailscale 零信任网络

| 组件 | 配置 | 说明 |
|------|------|------|
| 美国 VPC Subnet Router | EC2 实例运行 Tailscale | 中国团队访问 AWS 资源的入口 |
| 中国团队设备 | Tailscale 客户端 | 每台工作机安装，通过认证后加入网络 |
| ACL Rules | 最小权限 | 只允许 SSH (22) 和 HTTPS (443) |
| MagicDNS | 启用 | 设备通过主机名访问，不用记 IP |
| Audit Logging | 启用 | 所有网络访问记录日志 |

**ACL 示例：**
```json
{
  "acls": [
    {
      "action": "accept",
      "src": ["group:china-team"],
      "dst": ["tag:aws-vpc:22", "tag:aws-vpc:443"]
    }
  ]
}
```

## 3. 数据流

### 3.1 内容上传流程（中国团队）

```
[Content Team Workstation]
       │
       │ 1. Generate content in Coze
       │ 2. Upload to PublishOS Gateway
       │    POST /v1/contents
       │    Headers: Bearer {operator_jwt}
       │
       ▼
[Tailscale VPN] ──▶ [Bastion Host] ──▶ [AWS ALB]
       │
       ▼
[Application Server (EC2)]
       │
       ├─▶ Validate license chain
       ├─▶ Compliance check (AI label, ad copy)
       ├─▶ Store metadata in PostgreSQL
       ├─▶ Upload media to S3
       │
       ▼
[Response: 201 Created]
       content_id: "cnt_abc123"
       status: "pending_review"
```

### 3.2 内容审核流程（美国运营）

```
[US Operator Dashboard]
       │
       │ GET /v1/contents?status=pending_review
       │
       ▼
[AWS ALB] ──▶ [Application Server] ──▶ [PostgreSQL]
       │
       ▼
[Display: Content List with Audit Cards]
       │
       │ Operator clicks "Approve"
       │ POST /v1/contents/:id/approve
       │
       ▼
[Application Server]
       │
       ├─▶ Check license status (must be valid)
       ├─▶ Update content status to "approved"
       ├─▶ Create publish job
       ├─▶ Generate S3 presigned URL (15 min expiry)
       ├─▶ Write audit log
       │
       ▼
[Client App notified via WebSocket / Polling]
```

### 3.3 客户端发布流程

```
[Client App (Electron)]
       │
       │ 1. Poll /v1/queue (every 60s)
       │    Headers: Bearer {device_token}
       │
       ▼
[AWS ALB] ──▶ [Application Server]
       │
       ▼
[Response: Queue with tasks + presigned URLs]
       │
       │ 2. Download media from S3 presigned URL
       │ 3. Store locally (temp, 7-day cleanup)
       │ 4. Show notification to client
       │
       ▼
[Client clicks "Confirm Publish"]
       │
       │ 5. Open local Chromium browser
       │ 6. Navigate to TikTok upload page
       │ 7. Auto-fill: title, description, hashtags
       │ 8. Attach downloaded video
       │ 9. Client clicks TikTok's "Post" button
       │
       ▼
[Client completes TikTok native upload]
       │
       │ 10. Capture platform_post_id
       │ 11. POST /v1/tasks/:id/status
       │     Headers: Bearer {task_token}
       │     Body: { status: "published", ... }
       │
       ▼
[Application Server]
       │
       ├─▶ Update task status
       ├─▶ Write audit log
       ├─▶ Update metrics dashboard
       │
       ▼
[Dashboard reflects: Published ✅]
```

## 4. 安全策略

### 4.1 认证与授权

| 层级 | 机制 | 有效期 | 存储位置 |
|------|------|--------|----------|
| 运营人员 | JWT (RS256) | 24h | 浏览器 Cookie (httpOnly, secure) |
| 设备 | Device Token (HMAC) | 1年 | Electron keytar / macOS Keychain |
| 任务 | Task Token (HMAC) | 单次 | 内存（不持久化） |
| 内部服务 | mTLS (AWS ALB) | 永久 | AWS ACM |

### 4.2 数据加密

| 数据类型 | 传输加密 | 静态加密 | 说明 |
|----------|----------|----------|------|
| API 通信 | TLS 1.3 | — | 强制 HTTPS，HSTS 头 |
| 数据库 | TLS | RDS 加密 | AWS KMS 管理 |
| S3 媒体 | TLS | S3-SSE | AES-256 服务端加密 |
| 密码/Token | — | Secrets Manager | 自动轮换 |
| 客户端本地 | — | OS Keychain | 设备 token 加密存储 |

### 4.3 零信任原则

1. **永不信任，始终验证**：中国团队访问必须通过 Tailscale VPN + 设备认证
2. **最小权限**：每个 API Token 只能访问特定资源，不能横向越权
3. **假设已 breached**：审计日志记录所有操作，异常行为自动告警
4. **凭证不落地**：客户账号密码不存储在服务器，客户端本地浏览器管理

## 5. 部署策略

### 5.1 环境分层

| 环境 | 用途 | 数据 | 访问 |
|------|------|------|------|
| **Production** | 付费客户 | 真实数据 | 运营团队 + 客户端 |
| **Staging** | 内测/验收 | 脱敏数据 | 开发团队 + 运营 |
| **Development** | 开发调试 | 模拟数据 | 开发团队 |

### 5.2 CI/CD Pipeline (建议)

```
[GitHub Push] ──▶ [GitHub Actions]
       │
       ├─▶ Lint + Test
       ├─▶ Build Docker Image
       ├─▶ Push to ECR
       │
       ▼
[AWS CodeDeploy / ECS]
       │
       ├─▶ Staging Deploy (auto)
       ├─▶ Manual Approval
       ├─▶ Production Deploy (blue/green)
       │
       ▼
[Health Check] ──▶ [Rollback if failed]
```

### 5.3 数据库迁移

使用 Prisma Migrate：
```bash
npx prisma migrate dev    # Development
npx prisma migrate deploy # Production (CI/CD)
```

## 6. 监控与告警

### 6.1 监控指标

| 指标 | 告警阈值 | 响应 |
|------|----------|------|
| API 5xx 错误率 | > 1% | PagerDuty → 研发 |
| 响应时间 P95 | > 500ms | Slack 告警 |
| 发布成功率 | < 90% | 运营团队通知 |
| 客户端心跳丢失 | > 10 min | 客户关怀通知 |
| 数据库连接数 | > 80% | 自动扩容 |
| S3 存储容量 | > 80% | 扩容告警 |

### 6.2 日志策略

| 日志类型 | 保留期 | 存储 | 格式 |
|----------|--------|------|------|
| API 访问日志 | 90 天 | CloudWatch Logs | JSON |
| 审计日志 | 3 年 | S3 + Glacier | JSON + 签名 |
| 错误日志 | 30 天 | CloudWatch Logs | JSON + Stack |
| 客户端日志 | 7 天 | S3 (客户同意) | 匿名化 |

## 7. 备份与灾难恢复

### 7.1 备份策略

| 数据 | 频率 | 保留期 | 存储位置 |
|------|------|--------|----------|
| 数据库 | 每日自动快照 | 30 天 | RDS 快照 + S3 |
| 媒体文件 | 实时同步 | 永久 | S3 跨区域复制 |
| 审计日志 | 实时归档 | 3 年 | S3 + Glacier |

### 7.2 RTO / RPO

| 指标 | 目标 | 说明 |
|------|------|------|
| RTO (恢复时间) | < 4 小时 | 从备份恢复到服务可用 |
| RPO (数据丢失) | < 24 小时 | 最多丢失 24 小时数据 |
| 客户端影响 | 最小 | 客户端 App 可离线缓存，恢复后同步 |

## 8. 成本估算

### 8.1 AWS 月度成本（生产环境）

| 服务 | 规格 | 月费用 |
|------|------|--------|
| EC2 (App) | t3.medium | $30 |
| RDS PostgreSQL | db.t3.micro | $15 |
| S3 | 100GB Standard | $5 |
| ALB | 标准 | $20 |
| Secrets Manager | 10 secrets | $4 |
| CloudWatch | 基础 | $5 |
| Tailscale | 5 users | $25 |
| 数据传输 | 50GB/月 | $5 |
| **总计** | | **~$109/月** |

### 8.2 扩展成本（100 客户）

| 服务 | 升级 | 月费用 |
|------|------|--------|
| EC2 | t3.large | $60 |
| RDS | db.t3.small | $30 |
| S3 | 1TB | $23 |
| ALB | 标准 | $22 |
| **总计** | | **~$170/月** |

### 8.3 一次性费用

| 项目 | 费用 | 说明 |
|------|------|------|
| Route53 域名 | $12/年 | 域名注册 |
| ACM SSL 证书 | 免费 | AWS 免费 |
| 代码签名证书 | $200/年 | Electron App 签名 |

## 9. 技术栈

| 层 | 技术 | 版本 | 说明 |
|----|------|------|------|
| 客户端 | Electron | 30+ | 桌面跨平台 |
| 客户端 UI | React + Tailwind CSS | 18+ / 3+ | 界面框架 |
| 客户端状态 | Zustand | 4+ | 轻量状态管理 |
| 后端 | Node.js | 20 LTS | 运行时 |
| 后端框架 | Express | 4+ | Web 框架 |
| 数据库 | PostgreSQL | 15+ | 关系数据库 |
| ORM | Prisma | 5+ | 数据库访问 |
| 对象存储 | AWS S3 | — | 媒体文件 |
| 凭证管理 | AWS Secrets Manager | — | 安全凭证 |
| 监控 | CloudWatch + Sentry | — | 日志 + 错误追踪 |
| VPN | Tailscale | — | 零信任网络 |
| 部署 | Docker + ECS / EC2 | — | 容器化部署 |

## 10. 外部依赖与风险

| 依赖 | 风险 | 缓解措施 |
|------|------|----------|
| AWS 服务可用性 | 区域故障 | 多 AZ 部署，跨区域备份 |
| TikTok 平台政策 | 规则变更 | 监控 + 保险 + 合同免责 |
| Tailscale 服务 | 网络中断 | 本地缓存 + 重试机制 |
| 中国出口网络 | 不稳定 | Tailscale 自动重连 + 异步队列 |
| Prisma 版本 | 破坏性更新 | 锁定版本，定期升级测试 |

## 11. 版本历史

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-06-04 | Initial architecture for handoff |

---

**Document Status**: Final  
**Owner**: @研发 (Tech Lead)  
**Review Date**: 2026-09-04
