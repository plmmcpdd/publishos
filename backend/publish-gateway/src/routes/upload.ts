import { Router } from 'express';
import type { Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { authenticateToken, requireAdmin } from '../middleware/auth';
import { sendInternalError } from '../middleware/errors';

const router = Router();

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const dir = path.resolve(__dirname, '../../uploads/videos');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 11)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowedTypes = ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'image/jpeg', 'image/png'];
    if (allowedTypes.includes(file.mimetype)) cb(null, true);
    else cb(new Error('File type not allowed'));
  },
});

router.post('/upload/video', authenticateToken, requireAdmin, upload.single('video'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ success: false, error: 'No file uploaded' });
      return;
    }

    const url = `/uploads/videos/${req.file.filename}`;
    res.json({ success: true, data: { url, filename: req.file.filename, size: req.file.size } });
  } catch (error) {
    sendInternalError(req, res);
  }
});

router.post('/upload/thumbnail', authenticateToken, requireAdmin, upload.single('thumbnail'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ success: false, error: 'No file uploaded' });
      return;
    }

    const url = `/uploads/videos/${req.file.filename}`;
    res.json({ success: true, data: { url, filename: req.file.filename, size: req.file.size } });
  } catch (error) {
    sendInternalError(req, res);
  }
});

export default router;
