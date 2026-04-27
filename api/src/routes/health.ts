import { Router, type Request, type Response } from 'express';
import { checkDb } from '../db.js';
import { checkOllama } from '../ollama-client.js';
import { getSemanticMemoryAdapter } from '../memory/semantic/index.js';
import { getMetricsSnapshot, getMetricsPrometheus } from '../observability/metrics.js';

export const healthRouter = Router();

healthRouter.get('/healthz', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

healthRouter.get('/readyz', async (_req: Request, res: Response) => {
  const checks: Record<string, string> = {};
  let statusCode = 200;

  try {
    await checkDb();
    checks['postgres'] = 'ok';
  } catch {
    checks['postgres'] = 'unavailable';
    statusCode = 503;
  }

  try {
    await checkOllama();
    checks['ollama'] = 'ok';
  } catch {
    checks['ollama'] = 'unavailable';
    statusCode = 503;
  }

  try {
    await getSemanticMemoryAdapter().healthCheck();
    checks['semanticMemory'] = 'ok';
  } catch {
    checks['semanticMemory'] = 'unavailable';
    statusCode = 503;
  }

  res.status(statusCode).json({ status: statusCode === 200 ? 'ready' : 'not ready', checks });
});

healthRouter.get('/metrics', (_req: Request, res: Response) => {
  res.json({ status: 'ok', data: getMetricsSnapshot() });
});

healthRouter.get('/metrics/prometheus', (_req: Request, res: Response) => {
  res.setHeader('content-type', 'text/plain; version=0.0.4; charset=utf-8');
  res.send(getMetricsPrometheus());
});
