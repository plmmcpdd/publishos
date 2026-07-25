import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma';
import { getSecurityConfig, newJwtId } from '../config/security';
import { authenticateToken, requireAdmin } from '../middleware/auth';

const router = Router();

function issueToken(payload: Record<string, string>, expiresIn: '8h' | '7d' | '24h') {
  const { jwtSecret, jwtOptions } = getSecurityConfig();
  return jwt.sign(payload, jwtSecret, { ...jwtOptions, expiresIn, jwtid: newJwtId() });
}

router.post('/admin/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ success: false, error: 'Email and password required' });
  const admin = await prisma.admin.findUnique({ where: { email } });
  if (!admin || !await bcrypt.compare(password, admin.password)) return res.status(401).json({ success: false, error: 'Invalid credentials' });
  const token = issueToken({ tokenType: 'admin', sub: admin.id, role: 'admin' }, '8h');
  res.json({ success: true, data: { token, admin: { id: admin.id, name: admin.name, email: admin.email } } });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ success: false, error: 'Email and password required' });
  const client = await prisma.client.findUnique({ where: { email } });
  if (!client || !client.active || !await bcrypt.compare(password, client.password)) {
    return res.status(401).json({ success: false, error: 'Invalid credentials' });
  }
  const token = issueToken({ tokenType: 'client', sub: client.id, clientId: client.id, role: 'client' }, '8h');
  res.json({ success: true, data: { token, client: { id: client.id, name: client.name, industry: client.industry } } });
});

router.post('/register', authenticateToken, requireAdmin, async (req, res) => {
  const { name, email, password, industry } = req.body;
  if (!name || !email || !password) return res.status(400).json({ success: false, error: 'Name, email, password required' });
  if (await prisma.client.findUnique({ where: { email } })) return res.status(409).json({ success: false, error: 'Email already registered' });
  const client = await prisma.client.create({ data: { name, email, password: await bcrypt.hash(password, 10), industry } });
  res.json({ success: true, data: { id: client.id, name: client.name, email: client.email } });
});

export { issueToken };
export default router;
