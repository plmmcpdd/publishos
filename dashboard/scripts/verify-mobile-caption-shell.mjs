import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const shell = path.join(root, 'dist', 'h', 'index.html');
const script = path.join(root, 'dist', 'h', 'app.js');

if (!(await stat(shell)).isFile() || !(await stat(script)).isFile()) throw new Error('Mobile caption shell build output is missing');
const html = await readFile(shell, 'utf8');
const js = await readFile(script, 'utf8');
if (!html.includes("default-src 'none'")) throw new Error('Mobile caption shell CSP is missing');
if (!html.includes('no-store')) throw new Error('Mobile caption shell no-store policy is missing');
if (!js.includes("window.location.hash")) throw new Error('Mobile caption shell does not read the URL fragment');
if (!js.includes("history.replaceState")) throw new Error('Mobile caption shell does not clear the URL fragment');
if (js.includes('localStorage') || js.includes('sessionStorage')) throw new Error('Mobile caption shell must not persist the token');
if (js.includes('tiktok.com') || js.includes('open.tiktokapis.com')) throw new Error('Mobile caption shell must not call or navigate to TikTok');
console.log('Mobile caption shell production guard passed.');
