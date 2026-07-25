/**
 * Smoke test: health → login → content CRUD → deliver → client login → queue
 * Run with: npx tsx smoke-test.ts
 */
const BASE = process.env.API_BASE ?? 'http://localhost:3000';

async function req(method: string, path: string, token?: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

async function main() {
  console.log('PublishOS smoke test...\n');

  // 1. Health
  const health = await req('GET', '/health');
  console.log('✓ health', health);

  // 2. Admin login
  const admin = await req('POST', '/v1/auth/admin/login', undefined, {
    email: 'admin@publishos.com',
    password: 'admin123',
  });
  console.log('✓ admin login:', admin.data?.admin?.name);

  // 3. Client login
  const client = await req('POST', '/v1/auth/login', undefined, {
    email: 'abc@hvac.com',
    password: 'password123',
  });
  const clientId = client.data?.client?.id;
  console.log('✓ client login:', client.data?.client?.name, 'id=' + clientId);

  // 4. List clients
  const clients = await req('GET', '/v1/client');
  console.log('✓ clients:', clients.data?.length);

  // 5. List content
  const contents = await req('GET', `/v1/content?clientId=${clientId}`);
  console.log('✓ content items:', contents.data?.length);

  // 6. Create content
  const created = await req('POST', '/v1/content', undefined, {
    clientId,
    title: 'Smoke Test Video',
    description: 'Automated smoke test',
    platform: 'tiktok',
    videoUrl: 'mock/test.mp4',
    status: 'draft',
  });
  const contentId = created.data?.id;
  console.log('✓ created content:', contentId);

  // 7. Deliver content
  const delivered = await req('POST', `/v1/content/${contentId}/deliver`);
  console.log('✓ delivered:', delivered.data?.status);

  // 8. Client sees delivered content
  const queue = await req('GET', `/v1/content/delivered?clientId=${clientId}`);
  console.log('✓ client queue:', queue.data?.length, 'items');

  // 9. Confirm publish
  const confirmed = await req('POST', `/v1/content/${contentId}/confirm`, undefined, {
    clientId,
    deviceId: 'smoke-test-device',
  });
  console.log('✓ confirmed:', confirmed.data?.status);

  // 10. Audit logs
  const logs = await req('GET', '/v1/audit-logs');
  console.log('✓ audit logs:', logs.data?.length);

  console.log('\n✅ All smoke tests passed.');
}

main().catch((e) => {
  console.error('\n❌ Smoke test failed:', e.message);
  process.exit(1);
});
