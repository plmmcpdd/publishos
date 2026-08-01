import { describe, expect, it } from 'vitest';
import { execFileSync, execSync } from 'node:child_process';
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

function setupGitRepo(dir: string) {
  execSync('git init && git add -A && git -c user.email="test@test" -c user.name="Test" commit -m "initial" --allow-empty', { cwd: dir, stdio: 'pipe' });
}

function makeEnvFile(dir: string, tokenValue: string, extraLines: string[] = []) {
  const envFile = path.join(dir, 'publishos-staging.env');
  const lines = [
    'APP_ENV=staging',
    'HOST=127.0.0.1',
    'PORT=3300',
    'DATABASE_URL=file:/var/lib/publishos-staging/test.db',
    'OPS_BRAIN_BRIDGE_ENABLED=false',
    `OPS_BRAIN_BRIDGE_TOKEN=${tokenValue}`,
    'TIKTOK_INTEGRATION_ENABLED=false',
    'BACKGROUND_JOBS_ENABLED=false',
    'METRICS_CRON_ENABLED=false',
    'TIKTOK_RECONCILIATION_CRON_ENABLED=false',
    ...extraLines,
  ];
  writeFileSync(envFile, lines.join('\n') + '\n');
  return envFile;
}

function runScript(envFile: string, dir: string, mockBinDir?: string, expectedTikTok?: 'true' | 'false') {
  let stdout = '';
  let stderr = '';
  let status: number | null = null;
  try {
    const out = execFileSync('bash', [script], {
      cwd: dir,
      env: {
        PATH: mockBinDir ? `${mockBinDir}:${process.env.PATH}` : process.env.PATH,
        HOME: process.env.HOME,
        PUBLISHOS_STAGING_ENV_FILE: envFile,
        NODE_ENV: 'production',
        ...(expectedTikTok ? { EXPECTED_TIKTOK_INTEGRATION_ENABLED: expectedTikTok } : {}),
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

  it('passes when TikTok is enabled and explicitly expected', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'preflight-tiktok-enabled-'));
    setupDir(dir);
    setupGitRepo(dir);
    const envFile = makeEnvFile(dir, token32, ['TIKTOK_INTEGRATION_ENABLED=true']);
    const result = runScript(envFile, dir, undefined, 'true');
    rmSync(dir, { recursive: true, force: true });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('preflight passed');
  });

  it('fails closed when TikTok is enabled without an explicit expectation', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'preflight-tiktok-fail-closed-'));
    setupDir(dir);
    const envFile = makeEnvFile(dir, token32, ['TIKTOK_INTEGRATION_ENABLED=true']);
    const result = runScript(envFile, dir);
    rmSync(dir, { recursive: true, force: true });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('TikTok integration does not match the declared expectation');
  });

  it('fails when OPS_BRAIN_BRIDGE_TOKEN is missing', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'preflight-missing-'));
    setupDir(dir);
    const envFile = path.join(dir, 'publishos-staging.env');
    writeFileSync(envFile, [
      'APP_ENV=staging', 'HOST=127.0.0.1', 'PORT=3300',
      'DATABASE_URL=file:/var/lib/publishos-staging/test.db',
      'OPS_BRAIN_BRIDGE_ENABLED=false',
      'TIKTOK_INTEGRATION_ENABLED=false', 'BACKGROUND_JOBS_ENABLED=false',
      'METRICS_CRON_ENABLED=false', 'TIKTOK_RECONCILIATION_CRON_ENABLED=false',
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

  it('fails when git rev-parse HEAD fails', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'preflight-git-fail-'));
    setupDir(dir);
    const envFile = makeEnvFile(dir, 'B'.repeat(32));
    // Create a mock git that fails for rev-parse
    const wrapperDir = path.join(dir, 'bin');
    mkdirSync(wrapperDir);
    writeFileSync(path.join(wrapperDir, 'git'), '#!/bin/bash\nif [[ "$3" == "rev-parse" ]]; then\n  echo "fatal: not a git repository" >&2\n  exit 128\nfi\nexec /usr/bin/git "$@"\n');
    execSync(`chmod +x ${path.join(wrapperDir, 'git')}`);
    const result = runScript(envFile, dir, wrapperDir);
    rmSync(dir, { recursive: true, force: true });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('git rev-parse HEAD failed');
  });

  it('fails when git returns empty SHA', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'preflight-git-empty-'));
    setupDir(dir);
    const envFile = makeEnvFile(dir, 'B'.repeat(32));
    // Create a mock git that returns empty for rev-parse
    const wrapperDir = path.join(dir, 'bin');
    mkdirSync(wrapperDir);
    writeFileSync(path.join(wrapperDir, 'git'), '#!/bin/bash\nif [[ "$3" == "rev-parse" ]]; then\n  echo ""\n  exit 0\nfi\nexec /usr/bin/git "$@"\n');
    execSync(`chmod +x ${path.join(wrapperDir, 'git')}`);
    const result = runScript(envFile, dir, wrapperDir);
    rmSync(dir, { recursive: true, force: true });
    // Empty SHA should fail the validation
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('git commit is empty');
  });

  it('fails when git returns invalid SHA format', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'preflight-git-invalid-'));
    setupDir(dir);
    const envFile = makeEnvFile(dir, 'B'.repeat(32));
    // Create a mock git that returns invalid SHA
    const wrapperDir = path.join(dir, 'bin');
    mkdirSync(wrapperDir);
    writeFileSync(path.join(wrapperDir, 'git'), '#!/bin/bash\nif [[ "$3" == "rev-parse" ]]; then\n  echo "not-a-valid-sha"\n  exit 0\nfi\nexec /usr/bin/git "$@"\n');
    execSync(`chmod +x ${path.join(wrapperDir, 'git')}`);
    const result = runScript(envFile, dir, wrapperDir);
    rmSync(dir, { recursive: true, force: true });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('git commit is not a valid 40-character hex SHA');
  });

  it('passes with valid git repository and complete SHA', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'preflight-git-valid-'));
    setupDir(dir);
    setupGitRepo(dir);
    const envFile = makeEnvFile(dir, 'B'.repeat(32));
    const result = runScript(envFile, dir);
    rmSync(dir, { recursive: true, force: true });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('preflight passed');
    expect(result.stdout).toMatch(/commit [0-9a-f]{40}/);
    expect(result.stderr).toBe('');
  });

});
