import { Router, type Request, type Response } from 'express';
import { CancelToolCallSchema } from '@familyassistant/schemas';
import { orchestrate, cancelCorrelationId } from '../orchestration/engine.js';

export const orchestrationRouter = Router();

orchestrationRouter.post('/orchestrate', async (req: Request, res: Response) => {
  try {
    const response = await orchestrate(req.body);
    res.json({ ok: true, data: response });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown orchestration error';
    res.status(400).json({
      ok: false,
      error: { code: 'ORCHESTRATION_ERROR', message },
    });
  }
});

orchestrationRouter.post('/orchestrate/cancel', (req: Request, res: Response) => {
  const parsed = CancelToolCallSchema.safeParse(req.body);
  if (!parsed.success) {
    const flat = parsed.error.flatten();
    res.status(400).json({
      ok: false,
      error: {
        code: 'INVALID_CANCEL_REQUEST',
        message: flat.formErrors.join('; ') || 'Invalid cancel request',
      },
    });
    return;
  }

  cancelCorrelationId(parsed.data.correlationId);
  res.json({ ok: true, data: { canceled: true, correlationId: parsed.data.correlationId } });
});
