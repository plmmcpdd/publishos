import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');

describe('staging deployment package', () => {
  it('pins the verified Node 22 runtime and production migration command', () => {
    expect(read('../../.node-version').trim()).toBe('22.23.1');
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.engines.node).toBe('>=22.23.1 <23');
    expect(pkg.scripts['db:migrate:deploy']).toBe('prisma migrate deploy');
  });
  it('keeps service, environment, manifest, and preflight staging-safe', () => {
    const unit = read('deploy/systemd/publishos-staging.service.example');
    expect(unit).toContain('User=publishos-staging');
    expect(unit).toContain('EnvironmentFile=/etc/publishos-staging/publishos-staging.env');
    expect(unit).toContain('ExecStart=/usr/bin/node dist/server.js');
    const env = read('.env.staging.example');
    for (const value of ['HOST=127.0.0.1', 'PORT=3300', 'TIKTOK_INTEGRATION_ENABLED=false', 'BACKGROUND_JOBS_ENABLED=false']) expect(env).toContain(value);
    const manifest = read('deploy/staging-manifest.example.json');
    expect(manifest).toContain('/var/lib/publishos-staging/publishos-staging.db');
    expect(manifest).not.toMatch(/token|password|database_url/i);
    const preflight = read('deploy/staging-preflight.sh');
    expect(preflight).toContain('set -euo pipefail');
    expect(preflight).not.toContain('migrate deploy');
  });
});
