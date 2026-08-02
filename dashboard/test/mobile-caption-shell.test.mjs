import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM } from 'jsdom';

const html = await readFile(new URL('../public/h/index.html', import.meta.url), 'utf8');
const script = await readFile(new URL('../public/h/app.js', import.meta.url), 'utf8');

function validResponse(overrides = {}) {
  return {
    title: 'Safe title', targetTikTokAccount: '@safe-account', caption: 'Safe caption',
    hashtags: ['#one', '#中文'], captionText: 'Safe caption\n\n#one #中文',
    expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(), ...overrides,
  };
}

async function page({ status = 200, body = validResponse(), clipboardRejects = false } = {}) {
  const fetchCalls = [];
  const clipboardCalls = [];
  const dom = new JSDOM(html, {
    url: `https://handoff.example.test/h/#${'A'.repeat(43)}`,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  Object.defineProperty(dom.window.navigator, 'clipboard', { configurable: true, value: {
    writeText: async (value) => { clipboardCalls.push(value); if (clipboardRejects) throw new Error('denied'); },
  } });
  dom.window.fetch = async (...args) => {
    fetchCalls.push(args);
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  dom.window.eval(script);
  await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
  return { dom, fetchCalls, clipboardCalls };
}

test('static shell contains no content/token data and uses only local resources with restrictive policy', () => {
  assert.doesNotMatch(html, /Safe caption|opaque-token|tiktok\.com|https:\/\//i);
  assert.match(html, /default-src 'none'/);
  assert.match(html, /frame-ancestors 'none'/);
  assert.match(html, /no-store/);
  assert.doesNotMatch(script, /localStorage|sessionStorage|console\.|location\.(assign|replace)|window\.open/);
});

test('reads and immediately clears fragment, resolves by same-origin POST body, and renders safe fields', async () => {
  const { dom, fetchCalls } = await page();
  assert.equal(dom.window.location.hash, '');
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0][0], '/v1/mobile-caption-handoffs/resolve');
  assert.equal(fetchCalls[0][1].method, 'POST');
  assert.equal(fetchCalls[0][1].credentials, 'omit');
  assert.equal(fetchCalls[0][1].headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(fetchCalls[0][1].body), { token: 'A'.repeat(43) });
  assert.equal(dom.window.document.querySelector('#content-title').textContent, 'Safe title');
  assert.equal(dom.window.document.querySelector('#target-account').textContent, '@safe-account');
  assert.equal(dom.window.document.querySelector('#caption-text').value, 'Safe caption\n\n#one #中文');
  assert.equal(dom.window.document.querySelector('#hashtags').textContent, '#one #中文');
  dom.window.close();
});

test('copies exact caption after a user click and gives success or manual-copy failure feedback', async () => {
  const success = await page();
  success.dom.window.document.querySelector('#copy-caption').click();
  await new Promise((resolve) => success.dom.window.setTimeout(resolve, 0));
  assert.deepEqual(success.clipboardCalls, ['Safe caption\n\n#one #中文']);
  assert.equal(success.dom.window.document.querySelector('#copy-status').textContent, 'Caption copied');
  success.dom.window.close();

  const failure = await page({ clipboardRejects: true });
  failure.dom.window.document.querySelector('#copy-caption').click();
  await new Promise((resolve) => failure.dom.window.setTimeout(resolve, 0));
  assert.match(failure.dom.window.document.querySelector('#copy-status').textContent, /Long-press/);
  assert.equal(failure.dom.window.document.querySelector('#caption-text').readOnly, true);
  failure.dom.window.close();
});

test('expired, revoked, and unknown responses render non-identifying unavailable states', async () => {
  for (const status of [410, 404]) {
    const result = await page({ status });
    assert.equal(result.dom.window.document.querySelector('#caption-panel').hidden, true);
    assert.equal(result.dom.window.document.querySelector('#unavailable').hidden, false);
    assert.doesNotMatch(result.dom.window.document.body.textContent, /Safe title|Safe caption|safe-account/);
    result.dom.window.close();
  }
});
