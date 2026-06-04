# PublishOS

US-based social media management platform for SMBs (HVAC, plumbing, AI startups).

Content production in China, compliance review in the US, publishing from the client's local browser.

## Handoff Package

| Document | Purpose |
|----------|---------|
| `docs/PRD.md` | Product Requirements Document |
| `docs/COMPLIANCE-SOP.md` | Compliance & legal SOP |
| `docs/ROADMAP.md` | 6-week implementation roadmap |
| `docs/API-CONTRACT-v1.0.md` | API contract v1.0 (backend + client) |
| `docs/ARCHITECTURE.md` | AWS VPC + Tailscale + deployment topology |
| `docs/TIKTOK-AUTOMATION-CHECKLIST.md` | TikTok web automation spike acceptance criteria |
| `docs/UI-SPEC.md` | Design spec (color tokens, typography, component states) |
| `backend/publish-gateway/` | Backend reference implementation (Node/Prisma/Express) |
| `design/` | Wireframe demos and design assets |

## Platform Priority

1. TikTok (P0) — client-local browser automation
2. Instagram (P1) — Meta Graph API
3. Facebook / X / YouTube Shorts (P2-P3)

## Quick Start

```bash
cd backend/publish-gateway
npm install
npm run dev
```

## Development Notes

This repo is the handoff package from the initial PM/Design/Eng team to the external development team (Codex + manual review).

- Architecture: Electron client + AWS US VPC gateway + China delivery team
- Security: device_token / task_token isolation, zero-trust VPN, S3 presigned URLs
- Compliance: AI disclosure labels, licensed stock assets, blue-collar ad compliance

See `docs/PRD.md` for full specs and `docs/ROADMAP.md` for milestones.
