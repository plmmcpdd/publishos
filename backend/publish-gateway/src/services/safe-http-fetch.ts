import dns from 'dns';
import http from 'http';
import https from 'https';
import net from 'net';
import { AppError } from '../middleware/errors';

const WEBSITE_MAX_BODY_BYTES = 2 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;
const WEBSITE_TYPES = new Set(['text/html', 'application/xhtml+xml', 'text/plain']);
const VIDEO_TYPES = new Set(['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm']);

type FetchPolicy = { acceptedTypes: Set<string>; maxBytes: number; accept: string };
type PinnedResponse = { status: number; headers: http.IncomingHttpHeaders; body: Buffer };

class Deadline {
  readonly at: number;
  constructor(timeoutMs = DEFAULT_TIMEOUT_MS) { this.at = Date.now() + timeoutMs; }
  remainingMs(): number { return Math.max(0, this.at - Date.now()); }
  error(): AppError { return new AppError(504, 'safe_fetch_timeout', 'Remote request timed out'); }
}

function ipv4Number(ip: string): number | undefined { const parts = ip.split('.'); if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part) || Number(part) > 255)) return undefined; return parts.reduce((total, part) => total * 256 + Number(part), 0); }
function inV4(ip: string, base: string, mask: number): boolean { const a = ipv4Number(ip); const b = ipv4Number(base); return a !== undefined && b !== undefined && (a >>> (32 - mask)) === (b >>> (32 - mask)); }
function expandIPv6(addr: string): string { if (!addr.includes('::')) return addr.split(':').map((g) => g.padStart(4, '0')).join(':'); const [left, right] = addr.split('::'); const lg = left ? left.split(':') : []; const rg = right ? right.split(':') : []; return [...lg, ...Array(Math.max(0, 8 - lg.length - rg.length)).fill('0000'), ...rg].map((g) => g.padStart(4, '0')).join(':'); }
const UNSAFE_V4 = ['0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16', '172.16.0.0/12', '192.0.0.0/24', '192.0.2.0/24', '192.168.0.0/16', '198.18.0.0/15', '198.51.100.0/24', '203.0.113.0/24', '224.0.0.0/4', '240.0.0.0/4'];
function isUnsafeV4(ip: string): boolean { return UNSAFE_V4.some((cidr) => { const [base, bits] = cidr.split('/'); return inV4(ip, base, Number(bits)); }); }

export function isUnsafeAddress(address: string): boolean {
  const lower = address.toLowerCase().replace(/^::ffff:/, '');
  if (net.isIP(lower) === 4) return isUnsafeV4(lower);
  if (net.isIP(address) !== 6) return true;
  const full = expandIPv6(address.toLowerCase().split('%')[0]);
  const mapped = full.match(/^0{0,4}:0{0,4}:0{0,4}:0{0,4}:0{0,4}:ffff:([0-9a-f]{4}):([0-9a-f]{4})$/);
  if (mapped) { const a = parseInt(mapped[1], 16); const b = parseInt(mapped[2], 16); return isUnsafeV4(`${a >> 8}.${a & 0xff}.${b >> 8}.${b & 0xff}`); }
  return full === '0000:0000:0000:0000:0000:0000:0000:0000' || full === '0000:0000:0000:0000:0000:0000:0000:0001' || /^f[cd]/.test(full) || /^fe[89ab]/.test(full) || /^ff/.test(full) || /^2001:0db8/.test(full);
}

function validateUrl(url: URL): void {
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !url.hostname) throw new AppError(400, 'unsafe_url', 'Remote URL could not be safely fetched');
  const port = url.port || (url.protocol === 'https:' ? '443' : '80');
  if ((url.protocol === 'https:' && port !== '443') || (url.protocol === 'http:' && port !== '80')) throw new AppError(400, 'unsafe_url', 'Remote URL could not be safely fetched');
}

async function beforeDeadline<T>(operation: Promise<T>, deadline: Deadline): Promise<T> {
  const remaining = deadline.remainingMs();
  if (!remaining) throw deadline.error();
  let timer: NodeJS.Timeout | undefined;
  const expiration = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(deadline.error()), remaining); });
  try { return await Promise.race([operation, expiration]); } finally { if (timer) clearTimeout(timer); }
}

async function resolvePublic(hostname: string, deadline: Deadline): Promise<string[]> {
  if (net.isIP(hostname)) return isUnsafeAddress(hostname) ? [] : [hostname];
  let records: dns.LookupAddress[];
  try { records = await beforeDeadline(dns.promises.lookup(hostname, { all: true, verbatim: true }), deadline); } catch (error) { if (error instanceof AppError) throw error; return []; }
  if (!records.length || records.some((record) => (record.family !== 4 && record.family !== 6) || net.isIP(record.address) !== record.family || isUnsafeAddress(record.address))) return [];
  return [...new Set(records.map((record) => record.address))];
}

function requestPinned(url: URL, addresses: string[], policy: FetchPolicy, deadline: Deadline): Promise<PinnedResponse> {
  return new Promise((resolve, reject) => {
    let req: http.ClientRequest | undefined; let res: http.IncomingMessage | undefined; let settled = false; let index = 0; let timer: NodeJS.Timeout | undefined;
    const finish = (error?: Error, value?: PinnedResponse) => {
      if (settled) return; settled = true; if (timer) clearTimeout(timer);
      if (error) { res?.destroy(error); req?.destroy(error); req?.socket?.destroy(error); reject(error); } else resolve(value!);
    };
    const timeout = () => finish(deadline.error());
    const remaining = deadline.remainingMs();
    if (!remaining) return timeout();
    timer = setTimeout(timeout, remaining);
    const transport = url.protocol === 'https:' ? https : http;
    try {
      req = transport.request(url, {
        method: 'GET',
        headers: { Accept: policy.accept, 'Accept-Encoding': 'identity', Host: url.host },
        servername: url.hostname,
        // This lookup returns only previously validated IPs. Node never gets a chance to resolve the hostname again.
        lookup: (_host, _options, callback) => { const address = addresses[index++ % addresses.length]; callback(null, address, net.isIP(address) as 4 | 6); },
      }, (response) => {
        res = response;
        response.once('aborted', () => finish(new AppError(502, 'safe_fetch_failed', 'Remote response was interrupted')));
        response.once('error', () => finish(new AppError(502, 'safe_fetch_failed', 'Remote response could not be safely fetched')));
        const status = response.statusCode || 0;
        if (status >= 300 && status < 400) { response.resume(); return finish(undefined, { status, headers: response.headers, body: Buffer.alloc(0) }); }
        const type = String(response.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase();
        if (status < 200 || status >= 300 || !policy.acceptedTypes.has(type)) return finish(new AppError(400, 'unsafe_url', 'Remote response could not be safely fetched'));
        const declared = Number(response.headers['content-length']);
        if (Number.isFinite(declared) && declared > policy.maxBytes) return finish(new AppError(413, 'response_too_large', 'Remote response is too large'));
        const chunks: Buffer[] = []; let size = 0;
        response.on('data', (chunk: Buffer) => { size += chunk.length; if (size > policy.maxBytes) finish(new AppError(413, 'response_too_large', 'Remote response is too large')); else chunks.push(chunk); });
        response.once('end', () => finish(undefined, { status, headers: response.headers, body: Buffer.concat(chunks) }));
      });
      req.once('error', (error) => finish(error instanceof AppError ? error : new AppError(502, 'safe_fetch_failed', 'Remote request could not be completed')));
      req.end();
    } catch { finish(new AppError(502, 'safe_fetch_failed', 'Remote request could not be completed')); }
  });
}

async function safeFetch(value: string, policy: FetchPolicy, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<{ url: string; body: Buffer }> {
  let current: URL;
  try { current = new URL(value); } catch { throw new AppError(400, 'unsafe_url', 'Remote URL could not be safely fetched'); }
  const deadline = new Deadline(timeoutMs);
  for (let count = 0; count <= MAX_REDIRECTS; count += 1) {
    validateUrl(current);
    const addresses = await resolvePublic(current.hostname, deadline);
    if (!addresses.length) throw new AppError(400, 'unsafe_url', 'Remote URL could not be safely fetched');
    const result = await requestPinned(current, addresses, policy, deadline);
    if (result.status >= 300 && result.status < 400) {
      const location = result.headers.location;
      if (!location || count === MAX_REDIRECTS) throw new AppError(400, 'unsafe_redirect', 'Remote URL could not be safely fetched');
      try { current = new URL(location, current); } catch { throw new AppError(400, 'unsafe_redirect', 'Remote URL could not be safely fetched'); }
      continue;
    }
    return { url: current.toString(), body: result.body };
  }
  throw new AppError(400, 'unsafe_redirect', 'Remote URL could not be safely fetched');
}

export async function safeFetchWebsite(value: string): Promise<{ url: string; body: string }> {
  const result = await safeFetch(value, { acceptedTypes: WEBSITE_TYPES, maxBytes: WEBSITE_MAX_BODY_BYTES, accept: 'text/html, application/xhtml+xml, text/plain' });
  return { url: result.url, body: result.body.toString('utf8') };
}

/** Downloads an untrusted external video through the same DNS-pinned, deadline-bound transport as Safe Fetch. */
export async function safeDownloadExternalMedia(value: string, maxBytes: number): Promise<Buffer> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error('External media limit must be a positive integer');
  return (await safeFetch(value, { acceptedTypes: VIDEO_TYPES, maxBytes, accept: 'video/mp4, video/quicktime, video/x-msvideo, video/webm' })).body;
}
