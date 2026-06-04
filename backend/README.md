# Backend Reference Implementation

## Publish Gateway

Backend reference implementation by @研发.

**Status:** Files not yet committed to this repo. The backend scaffold is compiled and ready.

**Tech Stack:** Node.js + TypeScript + Prisma + Express

**Files to be added:**
```
backend/publish-gateway/
  src/
    routes/content.ts
    routes/publish-jobs.ts
    routes/client.ts
    routes/tasks.ts
    routes/audit.ts
  prisma/
    schema.prisma
  README.md
  package.json
  tsconfig.json
```

**Key Features:**
- 7 database tables (Prisma schema)
- 5 route groups (content, publish-jobs, client, tasks, audit)
- device_token / task_token separation
- account_binding_id isolation
- S3 presigned URL generation (15-min expiry)
- Approve/Reject audit gateway

**Quick Start:**
```bash
cd backend/publish-gateway
npm install
npm run dev
```

**API Contract:** See `docs/API-CONTRACT-v1.0.md`

## Deployment Target

AWS US-East VPC (pending AWS account setup by @gid T)
- EC2 (t3.medium for gateway)
- RDS PostgreSQL
- S3 (media storage + pre-signed URLs)
- Secrets Manager (credentials)
- Tailscale (zero-trust VPN for China team access)
