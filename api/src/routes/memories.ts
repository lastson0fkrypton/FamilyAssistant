import { Router, type Request, type Response } from 'express';
import * as MemoryKvService from '../services/memory-kv.js';

export const memoriesRouter = Router();

memoriesRouter.get('/', async (req: Request, res: Response) => {
  const rawLimit = Array.isArray(req.query['limit']) ? req.query['limit'][0] : req.query['limit'];
  const limit = Number(rawLimit ?? 200);

  if (!Number.isFinite(limit) || limit < 1 || limit > 1000) {
    res.status(400).json({
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: 'limit must be a number between 1 and 1000' },
    });
    return;
  }

  const memories = await MemoryKvService.listMemories(limit);
  res.json({ ok: true, data: memories });
});