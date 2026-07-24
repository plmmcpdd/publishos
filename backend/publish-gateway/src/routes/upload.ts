import { Router } from 'express';
import type { Request } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { authenticateToken, requireAdmin } from '../middleware/auth';
import { AppError } from '../middleware/errors';
import { loadMediaConfig } from '../config/security';
import { detectMedia, finalizeUploadedFile } from '../services/media-storage';
import { signedMediaUrl } from '../services/media-signing';
import { rateLimit } from '../middleware/http-security';

const router = Router();

function temporaryDirectory(): string {
  const directory = path.join(loadMediaConfig().root, '.tmp');
  fs.mkdirSync(directory, { recursive: true, mode: 0o750 });
  return directory;
}

function uploadForLimit(fileSize: number) {
  return multer({
    storage: multer.diskStorage({ destination: (_req, _file, cb) => cb(null, temporaryDirectory()), filename: (_req, _file, cb) => cb(null, `${crypto.randomUUID()}.upload`) }),
    // Busboy emits its limit event at the configured byte, so reserve one byte
    // for an inclusive application-level maximum; the next middleware rejects it
    // and removes the temporary file. Larger streams are still cut off by Multer.
    limits: { fileSize: fileSize + 1 },
  });
}

function removeTemporary(file?: Express.Multer.File): void { if (file?.path) fs.rmSync(file.path, { force: true }); }

function handleUpload(expected: 'video' | 'image', field: string) {
  return [
    (req: Request, res: any, next: any) => {
      const config = loadMediaConfig();
      const limit = expected === 'video' ? config.videoMaxBytes : config.imageMaxBytes;
      uploadForLimit(limit).single(field)(req, res, (error: unknown) => {
      if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') { removeTemporary(req.file); return next(new AppError(413, 'upload_too_large', 'Upload exceeds the permitted size')); }
      if (error) return next(new AppError(400, 'validation_error', 'Upload could not be processed'));
      next();
      });
    },
    (req: Request, res: any, next: any) => {
      try {
        if (!req.file) throw new AppError(400, 'validation_error', 'No file uploaded');
        const config = loadMediaConfig();
        const limit = expected === 'video' ? config.videoMaxBytes : config.imageMaxBytes;
        if (req.file.size > limit) throw new AppError(413, 'upload_too_large', 'Upload exceeds the permitted size');
        const descriptor = fs.openSync(req.file.path, 'r');
        const head = Buffer.alloc(32); const bytes = fs.readSync(descriptor, head, 0, head.length, 0); fs.closeSync(descriptor);
        const detected = detectMedia(head.subarray(0, bytes));
        if (!detected || detected.kind !== expected) throw new AppError(415, 'media_type_not_allowed', 'Uploaded file type is not allowed');
        const saved = finalizeUploadedFile(req.file.path, detected);
        const signed = signedMediaUrl(saved.storageKey);
        res.status(201).json({ success: true, data: { storage_key: saved.storageKey, url: signed.url, preview_url: signed.url, expires_at: signed.expiresAt.toISOString(), filename: saved.filename, size: req.file.size, mime_type: detected.mimeType } });
      } catch (error) { removeTemporary(req.file); next(error); }
    },
  ];
}

router.post('/upload/video', authenticateToken, requireAdmin, rateLimit('upload', 30, 60 * 60_000), ...handleUpload('video', 'video'));
router.post('/upload/thumbnail', authenticateToken, requireAdmin, rateLimit('upload', 30, 60 * 60_000), ...handleUpload('image', 'thumbnail'));
export default router;
