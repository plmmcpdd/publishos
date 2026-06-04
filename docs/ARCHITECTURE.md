# 技术架构文档 — 发布网关
> 版本: 1.0 | 适用: 外部开发团队（AWS 部署）

---

## 架构总览

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              中国团队（内容生产）                               │
│  ┌──────────────────┐                                                       │
│  │ 扣子/Coze 工作流   │  ← 内容生成、脚本改写（已有，不改动）                   │
│  │ 内容生产工具       │                                                       │
│  └────────┬─────────┘                                                       │
│           │                                                                  │
│           │  通过 Tailscale VPN 隧道                                            │
│           ▼                                                                  │
│  ┌──────────────────┐     ┌──────────────────┐                               │
│  │  Bastion Host    │────▶│  发布网关 API    │  ← 仅开放 443 端口             │
│  │  (跳板机)         │     │  (AWS ECS)       │                               │
│  └──────────────────┘     └────────┬─────────┘                               │
│                                     │                                        │
└─────────────────────────────────────┼────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              美国 AWS 区域 (us-east-1)                        │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────┐       │
│  │                         VPC (10.0.0.0/16)                         │       │
│  │                                                                  │       │
│  │  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │       │
│  │  │  Public Sub  │    │  Private Sub │    │  Private Sub │      │       │
│  │  │  (ALB/ECS)   │    │  (ECS Tasks) │    │  (RDS/S3)    │      │       │
│  │  │  10.0.1.0/24 │    │  10.0.2.0/24 │    │  10.0.3.0/24│      │       │
│  │  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘      │       │
│  │         │                  │                   │              │       │
│  │         ▼                  ▼                   ▼              │       │
│  │  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │       │
│  │  │  AWS ALB     │───▶│  ECS Fargate │───▶│  RDS         │      │       │
│  │  │  (HTTPS)     │    │  (Node.js)   │    │  PostgreSQL  │      │       │
│  │  └──────────────┘    └──────────────┘    └──────────────┘      │       │
│  │         │                  │                   │              │       │
│  │         │                  └───────────────────┘              │       │
│  │         │                         │                              │       │
│  │         │                         ▼                              │       │
│  │         │                  ┌──────────────┐                     │       │
│  │         │                  │  AWS S3      │                     │       │
│  │         │                  │  (内容存储)   │                     │       │
│  │         │                  └──────────────┘                     │       │
│  │         │                                                       │       │
│  │         └───────────────────────────────────────────────────────┘       │
│  │                              │                                           │
│  └──────────────────────────────┼───────────────────────────────────────────┘
│                                 │
│                                 ▼
│  ┌──────────────────────────────────────────────────────────────────┐       │
│  │  Secrets Manager / Systems Manager                                │       │
│  │  - JWT_SECRET                                                     │       │
  │  │  - DATABASE_URL                                                   │       │
│  │  - S3 credentials                                                   │       │
│  └──────────────────────────────────────────────────────────────────┘       │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────┐       │
│  │  Tailscale / AWS Client VPN                                       │       │
│  │  - 中国团队零信任接入                                               │       │
│  │  - 仅允许访问 Bastion Host (22/443)                                │       │
│  └──────────────────────────────────────────────────────────────────┘       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      │  Internet
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              客户端设备（客户本地）                             │
│  ┌──────────────────────────────────────────────────────────────────┐       │
│  │  Electron 桌面应用 (macOS/Windows)                                │       │
│  │  - 本地 Chromium 浏览器                                            │       │
│  │  - TikTok/Instagram 登录态持久化                                    │       │
│  │  - 视频下载 + 自动上传                                             │       │
│  └──────────────────────────────────────────────────────────────────┘       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 网络层

### VPC 设计

| 组件 | 配置 | 用途 |
|------|------|------|
| VPC | `10.0.0.0/16`, us-east-1 | 主网络隔离 |
| Public Subnet | `10.0.1.0/24` | ALB、NAT Gateway、Bastion Host |
| Private Subnet A | `10.0.2.0/24` | ECS Fargate 任务（无公网 IP） |
| Private Subnet B | `10.0.3.0/24` | RDS PostgreSQL、S3 VPC Endpoint |

**流量路径:**
1. 客户端 App → Internet → AWS ALB (Public Subnet) → ECS Fargate (Private Subnet A)
2. ECS → RDS (Private Subnet B, 5432)
3. ECS → S3 VPC Endpoint (Private Subnet B, 不经过公网)
4. 中国团队 → Tailscale → Bastion Host → ALB → ECS

### 零信任网络 (Tailscale)

**方案 A: Tailscale (推荐)**
- 在美国 VPC 的 Bastion Host 上安装 Tailscale
- 中国团队成员各自安装 Tailscale 客户端，加入同一 tailnet
- 配置 ACL: 中国团队设备只能访问 `tag:bastion` 的 22/443 端口
- 成本: $5/用户/月 (Business Plan)

**方案 B: AWS Client VPN**
- 在 VPC 中创建 Client VPN Endpoint
- 中国团队通过 OpenVPN 客户端连接
- 成本: $0.10/endpoint/小时 + $0.05/连接/小时
- 缺点: 配置复杂，连接稳定性不如 Tailscale

**推荐 Tailscale**，运维成本最低，且天然支持 mesh 网络。

---

## 计算层

### ECS Fargate (无服务器容器)

| 配置 | 建议 |
|------|------|
| Task CPU | 0.5 vCPU (起步) / 1 vCPU (生产) |
| Task Memory | 1 GB (起步) / 2 GB (生产) |
| 并发任务 | 2-4 个 |
| 自动扩展 | CPU > 70% 时扩展到 4 个任务 |
| 健康检查 | `/health` 每 30 秒 |

**为什么不用 EC2:**
- 不需要 SSH 管理服务器
- 自动补丁和安全更新
- 按实际使用付费，无运行成本

### 容器镜像

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY prisma ./prisma
RUN npx prisma generate
COPY dist ./dist
EXPOSE 3000
CMD ["node", "dist/server.js"]
```

---

## 数据层

### RDS PostgreSQL

| 配置 | 建议 |
|------|------|
| 实例类型 | db.t3.micro (起步) / db.t3.medium (生产) |
| 存储 | 20 GB GP2, 自动扩展 |
| 多可用区 | 生产环境启用 |
| 备份 | 7 天自动备份 + 每日快照 |
| 加密 | 启用存储加密 (KMS) |
| 公网访问 | **禁用** |

### S3 存储策略

| 桶 | 用途 | 访问策略 |
|----|------|----------|
| `publish-gateway-assets` | 视频/缩略图/素材 | 私有，仅通过预签名 URL 访问 |
| `publish-gateway-screenshots` | 发布成功截图存证 | 私有，保留 90 天 |
| `publish-gateway-docs` | 授权文档/发票 | 私有，长期保留 |
| `publish-gateway-logs` | 审计日志备份 | 归档存储，保留 3 年 |

**S3 预签名 URL 策略:**
- 有效期: 15 分钟 (900 秒)
- 签名算法: AWS4-HMAC-SHA256
- 客户端下载失败 → 重新轮询 `/v1/client/queue` 获取新 URL

---

## 安全层

### Secrets Manager

所有敏感配置通过 AWS Secrets Manager 注入，**绝不硬编码**。

| Secret 名称 | 内容 | 轮换策略 |
|-------------|------|----------|
| `publish-gateway/jwt-secret` | JWT_SECRET (≥32 字符随机串) | 每 90 天 |
| `publish-gateway/db-credentials` | DATABASE_URL | 每 90 天 |
| `publish-gateway/s3-credentials` | AWS_ACCESS_KEY_ID + AWS_SECRET | 每 90 天 |
| `publish-gateway/tailscale-auth` | TAILSCALE_AUTH_KEY | 每次部署 |

**ECS 任务通过 `secrets` 字段注入:**
```json
{
  "secrets": [
    {
      "name": "JWT_SECRET",
      "valueFrom": "arn:aws:secretsmanager:...:secret:publish-gateway/jwt-secret"
    }
  ]
}
```

### IAM 权限模型

| 角色 | 权限 |
|------|------|
| `ecs-task-role` | 读取 Secrets Manager、写入 S3、写入 CloudWatch Logs |
| `bastion-role` | 仅允许 Tailscale 入站 22/443，无 ECS/RDS 直接访问 |
| `rds-role` | 仅允许 ECS 安全组访问 5432 |

### 中国团队访问控制

- 内容创建 API (`POST /v1/content`) 仅允许 Tailscale 网段 IP 访问
- 建议在 ALB 层配置 WAF 规则，拒绝非 Tailscale 网段的 `POST /v1/content` 请求
- 运营审核 API (`POST /v1/content/:id/approve`) 建议额外要求 MFA

---

## 部署流程

### CI/CD 建议 (GitHub Actions)

```yaml
name: Deploy to ECS
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Configure AWS Credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::...:role/github-actions-deploy
          aws-region: us-east-1
      - name: Build and Push Docker Image
        run: |
          docker build -t publish-gateway:${{ github.sha }} .
          docker push publish-gateway:${{ github.sha }}
      - name: Deploy to ECS
        run: |
          aws ecs update-service --cluster publish-gateway --service api --force-new-deployment
```

### 环境分离

| 环境 | AWS 账户 | 数据库 | 用途 |
|------|----------|--------|------|
| dev | 美国公司测试账户 | 本地 Docker Postgres | 开发调试 |
| staging | 美国公司主账户 | RDS (t3.micro) | 集成测试 |
| production | 美国公司主账户 | RDS (t3.medium, 多AZ) | 生产 |

---

## 监控与告警

### CloudWatch 指标

| 指标 | 告警阈值 | 动作 |
|------|----------|------|
| ECS CPU 利用率 | > 80% 持续 5 分钟 | Slack 告警 + 自动扩展 |
| RDS 连接数 | > 80% 最大连接数 | 邮件告警 |
| API 5xx 错误率 | > 1% 持续 5 分钟 | PagerDuty 告警 |
| 任务失败率 | > 10% 当日 | 运营 Slack 告警 |

### 日志聚合

- ECS 任务日志 → CloudWatch Logs (`/aws/ecs/publish-gateway`)
- 结构化日志格式: JSON，包含 `trace_id`, `user_id`, `duration_ms`
- 日志保留: 30 天 (CloudWatch) + 3 年 (S3 归档)

---

## 成本估算（月度）

| 服务 | 起步 | 生产 (50 客户) |
|------|------|----------------|
| ECS Fargate | $25 (2 tasks, 0.5 vCPU) | $150 (4 tasks, 1 vCPU) |
| RDS PostgreSQL | $15 (db.t3.micro) | $150 (db.t3.medium, 多AZ) |
| ALB | $20 | $25 |
| S3 存储 | $10 (100GB) | $50 (500GB) |
| Secrets Manager | $5 | $10 |
| CloudWatch | $5 | $20 |
| Tailscale | $15 (3 users) | $50 (10 users) |
| **总计** | **~$95** | **~$455** |

---

## 数据隔离合规

### 中美数据边界

| 数据类型 | 存储位置 | 访问方式 | 清除策略 |
|----------|----------|----------|----------|
| 客户个人信息 | 美国 RDS | 仅美国运营团队 | 客户终止后 90 天删除 |
| 社交账号凭证 | **不存储** | 客户端本地管理 | N/A |
| 内容素材 | 美国 S3 | 预签名 URL | 客户终止后 30 天删除 |
| 视频工程文件 | 中国本地 | 加密后传输到美国 | 中国本地 7 天内清除 |
| 审计日志 | 美国 RDS + S3 | 运营后台查询 | 保留 3 年 |

### 数据不出境原则

- 客户个人数据、社交账号数据、发布记录**不存储在中国服务器**
- 中国团队的工作产物（脚本、工程文件）在**加密传输到美国 S3 后，中国本地副本应在 7 天内清除**
- 建议在中国团队工作站上配置自动清理脚本，删除超过 7 天的本地项目文件

---

## 外部团队部署 Checklist

- [ ] 创建 AWS 账户（美国公司名义）
- [ ] 配置 VPC + 3 个子网 (Public/Private A/Private B)
- [ ] 创建 RDS PostgreSQL（禁用公网访问，启用加密）
- [ ] 创建 S3 桶（私有，启用版本控制）
- [ ] 配置 Secrets Manager（JWT_SECRET, DB_URL, S3 credentials）
- [ ] 创建 ECS 集群 + Fargate 服务
- [ ] 配置 ALB + HTTPS（ACM 证书）
- [ ] 配置 Tailscale tailnet + ACL 规则
- [ ] 部署 Bastion Host（Tailscale + 仅允许 22/443）
- [ ] 配置 GitHub Actions OIDC 角色（无需长期 AWS 凭证）
- [ ] 配置 CloudWatch 告警 + Slack 集成
- [ ] 执行首次数据库迁移 (`npx prisma migrate deploy`)
- [ ] 验证端到端: 创建 content → 审核 → 创建 job → 客户端注册 → 拉取队列 → 回传状态

---

## 紧急回滚

- 数据库: RDS 快照 + 时间点恢复（PITR）
- 代码: ECS 强制新部署回滚到上一镜像标签
- 配置: Secrets Manager 版本历史恢复
- 网络: Tailscale ACL 规则秒级生效，可立即切断中国团队访问
