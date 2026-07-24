# Prisma migration baseline

PublishOS now includes `0_init`, a baseline generated from commit `611e2fa62a930c94f237b45863c21c1c64fc5485`, followed by `20260724000000_phase1c_oauth_state`.

For a new database, configure `DATABASE_URL` and run:

```sh
npx prisma migrate deploy --config prisma.config.ts
npx prisma migrate status --config prisma.config.ts
```

For an existing database that predates Prisma Migrate, first take a backup and confirm its schema exactly matches the `0_init` baseline. Then, once only, record the baseline without applying it:

```sh
npx prisma migrate resolve --applied 0_init --config prisma.config.ts
npx prisma migrate deploy --config prisma.config.ts
npx prisma migrate status --config prisma.config.ts
```

Verify that `OAuthAuthorizationState` exists and state hashes remain unique. Do not run `prisma db push` in production. Never resolve the baseline on an unverified database, and do not treat code merge as evidence that production migration has run. This Phase 1C work did not access any production database.
