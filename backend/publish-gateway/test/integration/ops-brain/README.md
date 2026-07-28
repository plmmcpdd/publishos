# Local Ops Brain Bridge Harness

This harness starts `createApp()` directly. It never imports `src/server.ts`, so it does not schedule the metrics cron or TikTok reconciliation.

Run the focused checks and three loopback HTTP runs with:

```bash
bash test/integration/ops-brain/run-tests.sh --lab /absolute/integration-lab
```

Every run creates a fresh SQLite database, CSPRNG bridge token and OS-selected port. The server binds only `127.0.0.1`; the harness replaces global `fetch` with a fail-on-use guard before importing the application. Successful runs remove database, port and token artifacts; failures preserve them under the supplied lab directory.

The fixture contains only `.test` identities and synthetic post IDs. It deliberately creates the same `contentRef` for two fictional tenants to prove exact tenant isolation.
