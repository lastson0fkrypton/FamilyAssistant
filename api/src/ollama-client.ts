import { config } from './config.js';
import { logger } from './logger.js';

export async function checkOllama(): Promise<void> {
  const url = `${config.OLLAMA_BASE_URL}/api/version`;
  const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
  if (!res.ok) {
    throw new Error(`Ollama health check failed: HTTP ${res.status}`);
  }
  const body = await res.json() as { version?: string };
  logger.debug({ version: body.version }, 'Ollama reachable');
}
