import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { loadMediaConfig } from '../config/security';
import { AppError } from '../middleware/errors';

export type MediaKind = 'video' | 'image';
export interface DetectedMedia { kind: MediaKind; mimeType: string; extension: string; }

export function detectMedia(buffer: Buffer): DetectedMedia | undefined {
  if (buffer.length >= 8 && buffer.subarray(0, 2).equals(Buffer.from([0xff, 0xd8]))) return { kind: 'image', mimeType: 'image/jpeg', extension: 'jpg' };
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { kind: 'image', mimeType: 'image/png', extension: 'png' };
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp') return { kind: 'video', mimeType: 'video/mp4', extension: 'mp4' };
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'AVI ') return { kind: 'video', mimeType: 'video/x-msvideo', extension: 'avi' };
  return undefined;
}

export function normalizeLocalStorageKey(value: string): string | undefined {
  let decoded: string;
  try { decoded = decodeURIComponent(value); } catch { return undefined; }
  const converted = decoded.startsWith('/uploads/') ? `local:${decoded.slice('/uploads/'.length)}` : decoded;
  if (!converted.startsWith('local:')) return undefined;
  const key = converted.slice('local:'.length);
  if (!key || key.includes('\\') || key.startsWith('/') || key.split('/').some((part) => !part || part === '.' || part === '..')) return undefined;
  return `local:${key}`;
}

export function localPathForStorageKey(value: string): string {
  const key = normalizeLocalStorageKey(value);
  if (!key) throw new AppError(400, 'media_not_found', 'Media was not found');
  const root = loadMediaConfig().root;
  const candidate = path.resolve(root, key.slice(6));
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) throw new AppError(400, 'media_not_found', 'Media was not found');
  return candidate;
}

export function mediaMimeFromKey(key: string): string {
  const extension = path.extname(key).toLowerCase();
  return ({ '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.avi': 'video/x-msvideo', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png' } as Record<string, string>)[extension] || 'application/octet-stream';
}

export function finalizeUploadedFile(tempPath: string, detected: DetectedMedia): { storageKey: string; filename: string; path: string } {
  const config = loadMediaConfig();
  const folder = detected.kind === 'video' ? 'videos' : 'thumbnails';
  const filename = `${crypto.randomUUID()}.${detected.extension}`;
  const destinationDir = path.join(config.root, folder);
  fs.mkdirSync(destinationDir, { recursive: true, mode: 0o750 });
  const destination = path.join(destinationDir, filename);
  fs.renameSync(tempPath, destination);
  fs.chmodSync(destination, 0o640);
  return { storageKey: `local:${folder}/${filename}`, filename, path: destination };
}
