import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'publishos-dev-secret-change-in-production';

router.post('/admin/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      res.status(400).json({ success: false, error: 'Email and password required' });
      return;
    }

    const admin = await prisma.admin.findUnique({ where: { email } });
    if (!admin) {
      res.status(401).json({ success: false, error: 'Invalid credentials' });
      return;
    }

    const valid = await bcrypt.compare(password, admin.password);
    if (!valid) {
      res.status(401).json({ success: false, error: 'Invalid credentials' });
      return;
    }

    const token = jwt.sign(
      { adminId: admin.id, email: admin.email, role: 'admin' },
      JWT_SECRET,
      { expiresIn: '30d' },
    );

    res.json({
      success: true,
      data: {
        token,
        admin: { id: admin.id, name: admin.name, email: admin.email },
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      res.status(400).json({ success: false, error: 'Email and password required' });
      return;
    }

    const client = await prisma.client.findUnique({ where: { email } });
    if (!client) {
      res.status(401).json({ success: false, error: 'Invalid credentials' });
      return;
    }

    const valid = await bcrypt.compare(password, client.password);
    if (!valid) {
      res.status(401).json({ success: false, error: 'Invalid credentials' });
      return;
    }

    const token = jwt.sign(
      { clientId: client.id, clientName: client.name, email: client.email },
      JWT_SECRET,
      { expiresIn: '30d' },
    );

    res.json({
      success: true,
      data: {
        token,
        client: { id: client.id, name: client.name, industry: client.industry },
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

router.post('/register', async (req, res) => {
  try {
    const { name, email, password, industry } = req.body;
    if (!name || !email || !password) {
      res.status(400).json({ success: false, error: 'Name, email, password required' });
      return;
    }

    const existing = await prisma.client.findUnique({ where: { email } });
    if (existing) {
      res.status(409).json({ success: false, error: 'Email already registered' });
      return;
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const client = await prisma.client.create({
      data: { name, email, password: hashedPassword, industry },
    });

    res.json({
      success: true,
      data: { id: client.id, name: client.name, email: client.email },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

export default router;
