import dns from 'dns';
import http from 'http';
import https from 'https';
import net from 'net';
import { AppError } from '../middleware/errors';

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;
function ipv4Number(ip: string): number | undefined { const parts = ip.split('.'); if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part) || Number(part) > 255)) return undefined; return parts.reduce((total, part) => total * 256 + Number(part), 0); }
function inV4(ip: string, base: string, mask: number): boolean { const a = ipv4Number(ip); const b = ipv4Number(base); return a !== undefined && b !== undefined && (a >>> (32 - mask)) === (b >>> (32 - mask)); }
function expandIPv6(addr: string): string {
  if (!addr.includes('::')) return addr.split(':').map((g) => g.padStart(4, '0')).join(':');
  const [left, right] = addr.split('::');
  const lg = left ? left.split(':') : [];
  const rg = right ? right.split(':') : [];
  return [...lg, ...Array(Math.max(0, 8 - lg.length - rg.length)).fill('0000'), ...rg].map((g) => g.padStart(4, '0')).join(':');
}
const UNSAFE_V4 = ['0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16', '172.16.0.0/12', '192.0.0.0/24', '192.0.2.0/24', '192.168.0.0/16', '198.18.0.0/15', '198.51.100.0/24', '203.0.113.0/24', '224.0.0.0/4', '240.0.0.0/4'];
function isUnsafeV4(ip: string): boolean { return UNSAFE_V4.some((cidr) => { const [base, bits] = cidr.split('/'); return inV4(ip, base, Number(bits)); }); }
export function isUnsafeAddress(address: string): boolean {
  const lower = address.toLowerCase().replace(/^::ffff:/, '');
  if (net.isIP(lower) === 4) return isUnsafeV4(lower);
  if (net.isIP(address) !== 6) return true;
  const full = expandIPv6(address.toLowerCase().split('%')[0]);
  const hexMapped = full.match(/^0{0,4}:0{0,4}:0{0,4}:0{0,4}:0{0,4}:ffff:([0-9a-f]{4}):([0-9a-f]{4})$/);
  if (hexMapped) { const a = parseInt(hexMapped[1], 16); const b = parseInt(hexMapped[2], 16); return isUnsafeV4(`${a >> 8}.${a & 0xff}.${b >> 8}.${b & 0xff}`); }
  if (full === '0000:0000:0000:0000:0000:0000:0000:0000') return true;
  if (full === '0000:0000:0000:0000:0000:0000:0000:0001') return true;
  if (/^f[cd]/.test(full)) return true;
  if (/^fe[89ab]/.test(full)) return true;
  if (/^ff/.test(full)) return true;
  if (/^2001:0db8/.test(full)) return true;
  return false;
}
async function resolvePublic(hostname: string): Promise<string[]> {
  if (net.isIP(hostname)) return isUnsafeAddress(hostname) ? [] : [hostname];
  let records: dns.LookupAddress[];
  try { records = await dns.promises.lookup(hostname, { all: true, verbatim: true }); } catch { return []; }
  if (!records.length || records.some((record) => isUnsafeAddress(record.address))) return [];
  return records.map((record) => record.address);
}
function validate(url: URL): void {
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !url.hostname) throw new AppError(400, 'unsafe_url', 'Website could not be safely fetched');
  const port = url.port || (url.protocol === 'https:' ? '443' : '80'); if ((url.protocol === 'https:' && port !== '443') || (url.protocol === 'http:' && port !== '80')) throw new AppError(400, 'unsafe_url', 'Website could not be safely fetched');
}
function requestPinned(url: URL, addresses: string[]): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http; let index = 0;
    const req = transport.request(url, { method: 'GET', headers: { Accept: 'text/html, application/xhtml+xml, text/plain', 'Accept-Encoding': 'identity', Host: url.host }, timeout: 10_000, servername: url.hostname, lookup: (_host, _options, callback) => callback(null, addresses[index++ % addresses.length], net.isIP(addresses[0]) === 6 ? 6 : 4) }, (res) => {
      const type = String(res.headers['content-type'] || '').split(';')[0].toLowerCase();
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400) { res.resume(); return resolve({ status: res.statusCode, headers: res.headers, body: '' }); }
      if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300 || !['text/html', 'application/xhtml+xml', 'text/plain'].includes(type)) { res.resume(); return reject(new AppError(400, 'unsafe_url', 'Website could not be safely fetched')); }
      const declared = Number(res.headers['content-length']); if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) { req.destroy(); return reject(new AppError(413, 'response_too_large', 'Website response is too large')); }
      const chunks: Buffer[] = []; let size = 0;
      res.on('data', (chunk: Buffer) => { size += chunk.length; if (size > MAX_BODY_BYTES) { req.destroy(new AppError(413, 'response_too_large', 'Website response is too large')); } else chunks.push(chunk); });
      res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('timeout', () => req.destroy(new AppError(504, 'unsafe_url', 'Website could not be safely fetched'))); req.on('error', reject); req.end();
  });
}
export async function safeFetchWebsite(value: string): Promise<{ url: string; body: string }> {
  let current: URL; try { current = new URL(value); } catch { throw new AppError(400, 'unsafe_url', 'Website could not be safely fetched'); }
  for (let count = 0; count <= MAX_REDIRECTS; count += 1) {
    validate(current); const addresses = await resolvePublic(current.hostname); if (!addresses.length) throw new AppError(400, 'unsafe_url', 'Website could not be safely fetched');
    const result = await requestPinned(current, addresses);
    if (result.status >= 300 && result.status < 400) { const location = result.headers.location; if (!location || count === MAX_REDIRECTS) throw new AppError(400, 'unsafe_redirect', 'Website could not be safely fetched'); try { current = new URL(location, current); } catch { throw new AppError(400, 'unsafe_redirect', 'Website could not be safely fetched'); } continue; }
    return { url: current.toString(), body: result.body };
  }
  throw new AppError(400, 'unsafe_redirect', 'Website could not be safely fetched');
}
