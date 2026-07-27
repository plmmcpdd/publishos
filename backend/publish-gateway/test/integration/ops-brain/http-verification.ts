import { readFile } from 'node:fs/promises';
import http from 'node:http';
import jwt from 'jsonwebtoken';

interface Options { portFile: string; tokenFile: string; disabled?: boolean; }

function value(name: string): string {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`TEST_ENVIRONMENT: ${name} is required`);
  return process.argv[index + 1];
}

function request(port: number, path: string, token?: string): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port, path, method: 'GET', headers: token ? { Authorization: `Bearer ${token}` } : {} }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      response.on('end', () => {
        try { resolve({ status: response.statusCode || 0, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); }
        catch (error) { reject(error); }
      });
    });
    request.on('error', reject);
    request.end();
  });
}

function equal(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) throw new Error(`PUBLISHOS_API: ${label}; expected ${String(expected)}, got ${String(actual)}`);
}

async function main(): Promise<void> {
  const options: Options = { portFile: value('--port-file'), tokenFile: value('--token-file'), disabled: process.argv.includes('--disabled') };
  const port = Number((await readFile(options.portFile, 'utf8')).trim());
  const token = (await readFile(options.tokenFile, 'utf8')).trim();
  const ref = '2026-07-20_aaaaaaaaaaaa_example';
  const endpoint = `/v1/integrations/ops-brain/performance?clientId=example-client-a&contentRef=${encodeURIComponent(ref)}&days=365`;

  const ready = await request(port, '/ready');
  equal(ready.status, 200, 'ready status'); equal(ready.body.status, 'ready', 'ready body'); equal(ready.body.database, true, 'ready database');
  if (options.disabled) {
    equal((await request(port, endpoint, token)).status, 404, 'disabled bridge');
    process.stdout.write(JSON.stringify({ event: 'http_verification_passed', mode: 'disabled' }) + '\n');
    return;
  }
  equal((await request(port, endpoint)).status, 401, 'missing token');
  equal((await request(port, endpoint, 'incorrect-token-value-that-is-long-enough')).status, 401, 'incorrect token');
  const ordinaryJwt = jwt.sign({ sub: 'fictional-admin', tokenType: 'admin', role: 'admin' }, 'harness-jwt-secret-at-least-32-bytes', { algorithm: 'HS256', issuer: 'publishos', audience: 'publishos-api' });
  equal((await request(port, endpoint, ordinaryJwt)).status, 401, 'ordinary JWT');
  equal((await request(port, `/v1/integrations/ops-brain/performance?contentRef=${ref}`, token)).status, 400, 'missing clientId');
  equal((await request(port, '/v1/integrations/ops-brain/performance?clientId=example-client-a', token)).status, 400, 'missing contentRef');
  equal((await request(port, `/v1/integrations/ops-brain/performance?clientId=missing-client&contentRef=${ref}`, token)).status, 404, 'unknown client');
  equal((await request(port, '/v1/integrations/ops-brain/performance?clientId=example-client-a&contentRef=missing', token)).status, 404, 'unknown content');
  const response = await request(port, endpoint, token);
  equal(response.status, 200, 'authorized response');
  equal(response.body.schemaVersion, 'publishos.ops-brain.performance.v1', 'schemaVersion');
  equal(response.body.clientId, 'example-client-a', 'tenant identity');
  equal(response.body.content.id, 'example-content-a', 'content identity');
  equal(response.body.posts.length, 2, 'multiple posts');
  const first = response.body.posts.find((post: any) => post.publishedPostId === 'example-post-a1');
  equal(first.snapshots.length, 2, 'first post snapshots');
  equal(first.snapshots[0].observedAt, '2026-07-20T01:00:00.000Z', 'snapshot ascending order');
  equal(first.snapshots[1].views, 0, 'zero views');
  equal(first.snapshots[1].likes, null, 'null likes');
  equal(first.snapshots[1].shares, null, 'null shares');
  equal(response.body.latestTotals.views, 300, 'latest snapshot total');
  equal(response.body.availability.commentText, 'unavailable_from_current_api', 'comment availability');
  equal(response.body.collection.reauthorizationRequired, false, 'collection reauthorization A');
  const tenantB = await request(port, `/v1/integrations/ops-brain/performance?clientId=example-client-b&contentRef=${encodeURIComponent(ref)}&days=365`, token);
  equal(tenantB.status, 200, 'tenant B response');
  equal(tenantB.body.content.id, 'example-content-b', 'same ref stays tenant isolated');
  equal(tenantB.body.collection.reauthorizationRequired, true, 'collection reauthorization B');
  process.stdout.write(JSON.stringify({ event: 'http_verification_passed', mode: 'enabled' }) + '\n');
}

main().catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.message : 'PUBLISHOS_API: unknown failure'}\n`); process.exitCode = 1; });
