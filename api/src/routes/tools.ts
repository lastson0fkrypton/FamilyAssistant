import { Router, type Request, type Response } from 'express';
import { executeToolCall, getToolManifest, listRegisteredTools } from '../tools/registry.js';

export const toolsRouter = Router();

// Exposes allowlisted tools to the orchestration layer.
toolsRouter.get('/', (_req: Request, res: Response) => {
  res.json({ ok: true, data: listRegisteredTools() });
});

toolsRouter.get('/manifest', (_req: Request, res: Response) => {
  res.json({ ok: true, data: getToolManifest() });
});

// Deterministic tool execution entrypoint for LLM tool-calling.
toolsRouter.post('/execute', async (req: Request, res: Response) => {
  const raw = (typeof req.body === 'object' && req.body !== null)
    ? req.body as Record<string, unknown>
    : {};

  const result = await executeToolCall({
    ...raw,
    correlationId: raw['correlationId'] ?? req.correlationId,
  });

  if (!result.ok && result.error.code === 'INVALID_TOOL_REQUEST') {
    res.status(400).json(result);
    return;
  }

  res.json(result);
});
