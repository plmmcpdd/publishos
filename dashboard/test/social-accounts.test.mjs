import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../src/pages/SocialAccounts.tsx', import.meta.url), 'utf8');
const api = await readFile(new URL('../src/api.ts', import.meta.url), 'utf8');

test('social accounts is read-only and does not display access-token expiry', () => {
  assert.doesNotMatch(source, /fetchTikTokAuthUrl|disconnectTikTokBinding|过期时间|expiresAt/);
  assert.doesNotMatch(api, /export async function (fetchTikTokAuthUrl|disconnectTikTokBinding)/);
});

test('social accounts directs operators to client-owned connection', () => {
  assert.match(source, /客户尚未连接 TikTok。请客户在 PublishOS Client 的 Settings 中完成连接。/);
  assert.match(source, /需要客户在 PublishOS Client 中重新授权。/);
  assert.match(source, /数据采集状态/);
  assert.match(source, /最近成功采集时间/);
});
