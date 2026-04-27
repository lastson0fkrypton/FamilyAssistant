import { Router, type Request, type Response } from 'express';
import { orchestrate } from '../orchestration/engine.js';
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


