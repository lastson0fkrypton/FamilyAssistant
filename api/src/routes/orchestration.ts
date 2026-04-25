import { Router, type Request, type Response } from 'express';
import { CancelToolCallSchema } from '@familyassistant/schemas';
import { orchestrate, cancelCorrelationId } from '../orchestration/engine.js';
import { writeReplayEvent } from '../observability/replay.js';

export const orchestrationRouter = Router();

orchestrationRouter.post('/orchestrate', async (req: Request, res: Response) => {
  try {
    const response = await orchestrate(req.body);
    await writeReplayEvent({
      correlationId: req.correlationId,
      category: 'orchestration',
      action: 'orchestrate',
      status: 'ok',
      sessionId: response.sessionId,
      request: req.body,
      response,
    });
    res.json({ ok: true, data: response });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown orchestration error';
    await writeReplayEvent({
      correlationId: req.correlationId,
      category: 'orchestration',
      action: 'orchestrate',
      status: 'error',
      request: req.body,
      error: message,
    });
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
    void writeReplayEvent({
      correlationId: req.correlationId,
      category: 'cancel',
      action: 'orchestrate.cancel',
      status: 'error',
      request: req.body,
      error: flat.formErrors.join('; ') || 'Invalid cancel request',
    });
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
  void writeReplayEvent({
    correlationId: req.correlationId,
    category: 'cancel',
    action: 'orchestrate.cancel',
    status: 'ok',
    request: req.body,
    response: { canceled: true, correlationId: parsed.data.correlationId },
  });
  res.json({ ok: true, data: { canceled: true, correlationId: parsed.data.correlationId } });
});
