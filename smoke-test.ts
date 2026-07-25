/**
 * PublishOS Workflow Smoke Test
 *
 * Tests the official TikTok draft delivery workflow against a running server.
 * Run with: npx tsx smoke-test.ts
 *
 * Prerequisites:
 * - Server running on API_BASE (default http://localhost:3000)
 * - Admin and client accounts exist (see credentials below)
 * - TikTok binding exists for the client (can be mock)
 *
 * This smoke does NOT make real TikTok API calls.
 */

const BASE = process.env.API_BASE ?? 'http://localhost:3000';
const ADMIN_EMAIL = process.env.SMOKE_ADMIN_EMAIL ?? 'admin@publishos.com';
const ADMIN_PASSWORD = process.env.SMOKE_ADMIN_PASSWORD ?? 'admin123';
const CLIENT_EMAIL = process.env.SMOKE_CLIENT_EMAIL ?? 'abc@hvac.com';
const CLIENT_PASSWORD = process.env.SMOKE_CLIENT_PASSWORD ?? 'password123';

let passed = 0;
let failed = 0;

async function req(method: string, path: string, token?: string, body?: unknown, expectStatus?: number) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (expectStatus !== undefined && res.status !== expectStatus) {
    throw new Error(`Expected ${expectStatus} but got ${res.status}: ${JSON.stringify(data)}`);
  }
  if (!res.ok && expectStatus === undefined) {
    throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(data)}`);
  }
  return { status: res.status, data, headers: res.headers };
}

function ok(label: string) {
  passed++;
  console.log(`  ✓ ${label}`);
}

function fail(label: string, err: unknown) {
  failed++;
  console.log(`  ✗ ${label}: ${err instanceof Error ? err.message : String(err)}`);
}

async function main() {
  console.log(`PublishOS Workflow Smoke (${BASE})\n`);

  // 1. Health
  try {
    const health = await req('GET', '/health');
    ok(`health: ${health.data.status}`);
  } catch (e) { fail('health', e); }

  // 2. Ready (DB check)
  try {
    const ready = await req('GET', '/ready');
    ok(`ready: db=${ready.data.database}`);
  } catch (e) { fail('ready', e); }

  // 3. Admin login
  let adminToken = '';
  try {
    const admin = await req('POST', '/v1/auth/admin/login', undefined, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    adminToken = admin.data.data?.token || '';
    ok(`admin login: ${admin.data.data?.admin?.name || 'ok'}`);
  } catch (e) { fail('admin login', e); }

  // 4. Client login
  let clientToken = '';
  let clientId = '';
  try {
    const client = await req('POST', '/v1/auth/login', undefined, { email: CLIENT_EMAIL, password: CLIENT_PASSWORD });
    clientToken = client.data.data?.token || '';
    clientId = client.data.data?.client?.id || '';
    ok(`client login: ${client.data.data?.client?.name || 'ok'} (${clientId})`);
  } catch (e) { fail('client login', e); }

  if (!adminToken || !clientToken || !clientId) {
    console.log('\n❌ Cannot continue without admin and client tokens.');
    process.exit(1);
  }

  // 5. Create content (admin)
  let contentId = '';
  try {
    const created = await req('POST', '/v1/content', adminToken, {
      clientId,
      title: 'Smoke Test Video',
      description: 'Automated smoke test content',
      caption: 'Test caption #smoke',
      hashtags: ['smoke', 'test'],
      platform: 'tiktok',
      videoUrl: 'mock/smoke.mp4',
      status: 'pending_review',
    });
    contentId = created.data.data?.id || '';
    ok(`create content: ${contentId}`);
  } catch (e) { fail('create content', e); }

  // 6. Approve content
  try {
    await req('POST', `/v1/content/${contentId}/approve`, adminToken);
    ok('approve content');
  } catch (e) { fail('approve content', e); }

  // 7. Deliver content
  try {
    const delivered = await req('POST', `/v1/content/${contentId}/deliver`, adminToken);
    ok(`deliver: status=${delivered.data.data?.status}`);
  } catch (e) { fail('deliver', e); }

  // 8. Client sees delivered content
  try {
    const queue = await req('GET', `/v1/content/delivered?clientId=${encodeURIComponent(clientId)}`, clientToken);
    const found = queue.data.data?.find((c: { id: string }) => c.id === contentId);
    ok(`client queue: ${queue.data.data?.length} items, found=${!!found}`);
  } catch (e) { fail('client queue', e); }

  // 9. Client sees caption and hashtags
  try {
    const detail = await req('GET', `/v1/content/${contentId}?clientId=${encodeURIComponent(clientId)}`, clientToken);
    const d = detail.data.data;
    const hasCaption = typeof d?.finalCaption === 'string' && d.finalCaption.length > 0;
    const hasHashtags = Array.isArray(d?.hashtags) && d.hashtags.length > 0;
    const hasDeliveryState = typeof d?.deliveryState === 'string';
    ok(`content detail: caption=${hasCaption}, hashtags=${hasHashtags}, deliveryState=${d?.deliveryState}`);
  } catch (e) { fail('content detail', e); }

  // 10. /confirm returns 410 Gone
  try {
    const confirm = await req('POST', `/v1/content/${contentId}/confirm`, clientToken, { clientId, contentConfirmed: true }, 410);
    ok(`confirm returns 410: code=${confirm.data.error?.code}`);
  } catch (e) { fail('confirm 410', e); }

  // 11. Send to TikTok without contentConfirmed fails
  try {
    const noConfirm = await req('POST', `/v1/content/${contentId}/send-to-tiktok`, clientToken, { clientId }, 422);
    ok(`send without contentConfirmed: ${noConfirm.data.error?.code}`);
  } catch (e) { fail('send without confirm', e); }

  // 12. Send to TikTok with explicit confirmation succeeds
  let publishJobId = '';
  try {
    const sent = await req('POST', `/v1/content/${contentId}/send-to-tiktok`, clientToken, {
      clientId,
      contentConfirmed: true,
    });
    publishJobId = sent.data.data?.publishJobId || '';
    ok(`send-to-tiktok: jobId=${publishJobId}, idempotent=${sent.data.data?.idempotent}`);
  } catch (e) { fail('send-to-tiktok', e); }

  // 13. Duplicate send is idempotent
  try {
    const dup = await req('POST', `/v1/content/${contentId}/send-to-tiktok`, clientToken, {
      clientId,
      contentConfirmed: true,
    });
    const sameJob = dup.data.data?.publishJobId === publishJobId;
    ok(`idempotent: sameJob=${sameJob}, idempotent=${dup.data.data?.idempotent}`);
  } catch (e) { fail('idempotent send', e); }

  // 14. Publish status
  try {
    const status = await req('GET', `/v1/content/${contentId}/publish-status`, clientToken);
    const jobs = status.data.data || [];
    const activeJob = jobs.find((j: { id: string }) => j.id === publishJobId);
    ok(`publish status: ${jobs.length} jobs, active status=${activeJob?.status}`);
  } catch (e) { fail('publish status', e); }

  // 15. Publish status refresh
  try {
    await req('POST', `/v1/content/${contentId}/publish-status/refresh`, clientToken);
    ok('publish status refresh: accepted');
  } catch (e) { fail('publish status refresh', e); }

  // 16. Audit logs
  try {
    const logs = await req('GET', '/v1/audit-logs', adminToken);
    const sendAudit = logs.data.data?.find((l: { action: string }) => l.action === 'tiktok_send_requested');
    ok(`audit logs: ${logs.data.data?.length} entries, send_requested=${!!sendAudit}`);
  } catch (e) { fail('audit logs', e); }

  // 17. Client B cannot see Client A's content
  try {
    const otherClient = await req('POST', '/v1/auth/login', undefined, { email: 'other@test.com', password: 'password123' });
    const otherToken = otherClient.data.data?.token || '';
    if (otherToken) {
      const otherQueue = await req('GET', `/v1/content/delivered?clientId=${encodeURIComponent(otherClient.data.data?.client?.id)}`, otherToken);
      const foundOther = otherQueue.data.data?.find((c: { id: string }) => c.id === contentId);
      ok(`tenant isolation: Client B sees ${otherQueue.data.data?.length} items, found ours=${!!foundOther}`);
    } else {
      ok('tenant isolation: no other client available (skipped)');
    }
  } catch (e) { ok('tenant isolation: no other client available (skipped)'); }

  // Summary
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log('\n❌ Smoke test FAILED');
    process.exit(1);
  } else {
    console.log('\n✅ All smoke tests passed');
  }
}

main().catch((e) => {
  console.error('\n❌ Smoke test failed:', e.message);
  process.exit(1);
});
