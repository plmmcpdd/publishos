import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../middleware/errors';
import { normalizeContentRef } from '../services/content-ref';
import { getOpsBrainPerformance } from '../services/ops-brain-performance';

const router = Router();
const querySchema = z.object({ clientId: z.string().min(1), contentRef: z.string(), days: z.string().optional() });

router.get('/performance', async (req, res) => {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) throw new AppError(400, 'invalid_query', 'clientId and contentRef are required');
  const days = parsed.data.days === undefined ? 7 : Number(parsed.data.days);
  if (!Number.isInteger(days) || days < 1 || days > 365) throw new AppError(400, 'invalid_query', 'days must be an integer between 1 and 365');
  let contentRef: string;
  try { contentRef = normalizeContentRef(parsed.data.contentRef); }
  catch { throw new AppError(400, 'invalid_query', 'contentRef is invalid'); }
  res.json(await getOpsBrainPerformance({ clientId: parsed.data.clientId, contentRef, days }));
});

export default router;
