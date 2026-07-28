# PublishOS staging deployment (template)

Cloudflare Tunnel is intentionally out of scope for this gate. Use a later gate to assign the HTTPS domain.

1. **Server, sudo:** install Node 22.23.1 and create the non-login `publishos-staging` user.
2. **Server, sudo:** create `/opt/publishos-staging/releases`, `/var/lib/publishos-staging/uploads`, `/var/log/publishos-staging`, and `/etc/publishos-staging`. Release files are root/deploy-managed and data/log directories are writable only by `publishos-staging`.
3. **Server, deploy user:** upload an immutable release to `/opt/publishos-staging/releases/<commit>`; run `npm ci` and `npm run build` there. Atomically update `current` to that release with `ln -sfn`.
4. **Server, sudo:** copy `.env.staging.example` to `/etc/publishos-staging/publishos-staging.env`, set mode `0640`, owner `root:publishos-staging`, and replace placeholders. Keep `DATABASE_URL=file:/var/lib/publishos-staging/publishos-staging.db` and all TikTok/background flags false.
5. **Server, deploy user:** run `npm run db:migrate:deploy`; do not use `db:migrate` for deployment.
6. **Server, sudo:** install the systemd template, run `systemctl daemon-reload`, then start `publishos-staging`. Verify `/health`, `/ready`, and `ss -ltn` shows only `127.0.0.1:3300`.
7. **Server, sudo:** stop with `systemctl stop publishos-staging`. Roll back by atomically repointing `current` to the prior release and restarting. Retire the Bridge token and isolate/archive the SQLite database when the staging environment is retired.

Do not run Node as root. Keep SQLite, uploads, logs, and the root-owned environment file outside release directories and Git.
