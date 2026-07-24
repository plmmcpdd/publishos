import fs from 'fs';
import { Router } from 'express';
import { AppError } from '../middleware/errors';
import { localPathForStorageKey, mediaMimeFromKey } from '../services/media-storage';
import { verifyMediaSignature } from '../services/media-signing';
import { loadMediaConfig } from '../config/security';

const router = Router();
router.get('/media', (req, res, next) => {
  try {
    const key = verifyMediaSignature(req.query);
    const filePath = localPathForStorageKey(key);
    const realRoot = fs.realpathSync.native(loadMediaConfig().root);
    let realFile: string;
    try { realFile = fs.realpathSync.native(filePath); } catch { throw new AppError(404, 'media_not_found', 'Media was not found'); }
    if (!realFile.startsWith(`${realRoot}/`) || !fs.statSync(realFile).isFile()) throw new AppError(404, 'media_not_found', 'Media was not found');
    const size = fs.statSync(realFile).size;
    const contentType = mediaMimeFromKey(key);
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Accept-Ranges', 'bytes'); res.setHeader('Content-Type', contentType);
    const range = req.headers.range;
    if (!range) { res.setHeader('Content-Length', String(size)); fs.createReadStream(realFile).pipe(res); return; }
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) { res.status(416).setHeader('Content-Range', `bytes */${size}`).end(); return; }
    let start: number; let end: number;
    if (match[1]) {
      // bytes=N- or bytes=N-M
      start = Number(match[1]);
      end = match[2] ? Number(match[2]) : size - 1;
    } else if (match[2]) {
      // bytes=-N (suffix range: last N bytes)
      start = Math.max(0, size - Number(match[2]));
      end = size - 1;
    } else {
      // bytes=-
      start = 0;
      end = size - 1;
    }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) { res.status(416).setHeader('Content-Range', `bytes */${size}`).end(); return; }
    const boundedEnd = Math.min(end, size - 1);
    res.status(206).setHeader('Content-Range', `bytes ${start}-${boundedEnd}/${size}`).setHeader('Content-Length', String(boundedEnd - start + 1));
    fs.createReadStream(realFile, { start, end: boundedEnd }).pipe(res);
  } catch (error) { next(error); }
});
export default router;
