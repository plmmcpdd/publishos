import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const script = path.join(root, 'deploy', 'staging-preflight.sh');

function setupDir(dir: string) {
  mkdirSync(path.join(dir, 'prisma', 'migrations'), { recursive: true });
  mkdirSync(path.join(dir, 'dist'), { recursive: true });
  mkdirSync(path.join(dir, 'deploy', 'systemd'), { recursive: true });
  writeFileSync(path.join(dir, 'dist', 'server.js'), '');
  writeFileSync(path.join(dir, 'deploy', 'systemd', 'publishos-staging.service.example'), '');
}

function makeEnvFile(dir: string, tokenValue: string, extraLines: string[] = []) {
  const envFile = path.join(dir, 'publishos-staging.env');
  const lines = [
    'APP_ENV=staging',
    'HOST=127.0.0.1',
    'PORT=3300',
    'DATABASE_URL=file:/var/lib/publishos-staging/test.db',
    'OPS_BRAIN_BRIDGE_ENABLED=true',
    `OPS_BRAIN_BRIDGE_TOKEN=${tokenValue}`,
    'TIKTOK_INTEGRATION_ENABLED=false',
    'BACKGROUND_JOBS_ENABLED=false',
    ...extraLines,
  ];
  writeFileSync(envFile, lines.join('\n') + '\n');
  return envFile;
}

function runScript(envFile: string, dir: string) {
  let stdout = '';
  let stderr = '';
  let status: number | null = null;
  try {
    const out = execFileSync('bash', [script], {
      cwd: dir,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        PUBLISHOS_STAGING_ENV_FILE: envFile,
        NODE_ENV: 'production',
      },
      timeout: 15_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    stdout = out.toString();
    status = 0;
  } catch (err: unknown) {
    const e = err as { stdout?: Buffer; stderr?: Buffer; status?: number | null };
    stdout = (e.stdout ?? Buffer.from('')).toString();
    stderr = (e.stderr ?? Buffer.from('')).toString();
    status = e.status ?? null;
  }
  return { status, stdout, stderr };
}

function runPreflight(tokenValue: string) {
  const dir = mkdtempSync(path.join(tmpdir(), 'preflight-exec-'));
  setupDir(dir);
  const envFile = makeEnvFile(dir, tokenValue);
  const result = runScript(envFile, dir);
  rmSync(dir, { recursive: true, force: true });
  return result;
}

describe('staging preflight executable matrix', () => {
  const token64 = 'A'.repeat(64);
  const token32 = 'B'.repeat(32);
  const token31 = 'C'.repeat(31);

  it('passes with a 64-character token', () => {
    const { status, stdout, stderr } = runPreflight(token64);
    expect(status).toBe(0);
    expect(stdout).toContain('preflight passed');
    expect(stderr).toBe('');
    expect(stdout + stderr).not.toContain(token64);
  });

  it('passes with a 32-character token', () => {
    const { status, stdout, stderr } = runPreflight(token32);
    expect(status).toBe(0);
    expect(stdout).toContain('preflight passed');
    expect(stderr).toBe('');
    expect(stdout + stderr).not.toContain(token32);
  });

  it('fails with a 31-character token', () => {
    const { status, stdout, stderr } = runPreflight(token31);
    expect(status).not.toBe(0);
    expect(stderr).toContain('Bridge token is too short');
    expect(stdout + stderr).not.toContain(token31);
  });

  it('passes with a double-quoted 32-character token', () => {
    const { status, stdout, stderr } = runPreflight(`"${token32}"`);
    expect(status).toBe(0);
    expect(stdout).toContain('preflight passed');
    expect(stderr).toBe('');
  });

  it('fails when OPS_BRAIN_BRIDGE_TOKEN is missing', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'preflight-missing-'));
    setupDir(dir);
    const envFile = path.join(dir, 'publishos-staging.env');
    writeFileSync(envFile, [
      'APP_ENV=staging', 'HOST=127.0.0.1', 'PORT=3300',
      'DATABASE_URL=file:/var/lib/publishos-staging/test.db',
      'OPS_BRAIN_BRIDGE_ENABLED=true',
      'TIKTOK_INTEGRATION_ENABLED=false', 'BACKGROUND_JOBS_ENABLED=false',
    ].join('\n') + '\n');

    const { status, stderr } = runScript(envFile, dir);
    rmSync(dir, { recursive: true, force: true });

    expect(status).not.toBe(0);
    expect(stderr).toContain('missing environment key: OPS_BRAIN_BRIDGE_TOKEN');
  });

  it('fails with an empty token', () => {
    const { status, stderr } = runPreflight('');
    expect(status).not.toBe(0);
    expect(stderr).toContain('Bridge token is too short');
  });

  it('handles shell special characters without command injection', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'preflight-shell-'));
    const id = `${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2)}`;
    const dollarMarker = path.join(tmpdir(), `preflight-inj-dollar-${id}`);
    const backtickMarker = path.join(tmpdir(), `preflight-inj-backtick-${id}`);
    const token = `X$(touch ${dollarMarker})_Y\`touch ${backtickMarker}\`_Z`;
    setupDir(dir);
    const envFile = makeEnvFile(dir, token);

    expect(existsSync(dollarMarker)).toBe(false);
    expect(existsSync(backtickMarker)).toBe(false);

    const { status, stdout, stderr } = runScript(envFile, dir);
    rmSync(dir, { recursive: true, force: true });

    expect(token.length).toBeGreaterThanOrEqual(32);
    expect(status).toBe(0);
    expect(stdout).toContain('preflight passed');
    expect(existsSync(dollarMarker)).toBe(false);
    expect(existsSync(backtickMarker)).toBe(false);
    expect(stdout + stderr).not.toContain(token);
  });
});
