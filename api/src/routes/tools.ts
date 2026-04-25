import { Router, type Request, type Response } from 'express';
import { executeToolCall, listRegisteredTools } from '../tools/registry.js';

export const toolsRouter = Router();

// Exposes allowlisted tools to the orchestration layer.
toolsRouter.get('/', (_req: Request, res: Response) => {
  res.json({ ok: true, data: listRegisteredTools() });
});

// Deterministic tool execution entrypoint for LLM tool-calling.
toolsRouter.post('/execute', async (req: Request, res: Response) => {
  const result = await executeToolCall(req.body);

  if (!result.ok && result.error.code === 'INVALID_TOOL_REQUEST') {
    res.status(400).json(result);
    return;
  }

  res.json(result);
});
