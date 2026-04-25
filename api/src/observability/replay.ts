import { mkdir, appendFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { logger } from '../logger.js';

type ReplayStatus = 'ok' | 'error';
type ReplayCategory = 'tool' | 'orchestration' | 'cancel';

export interface ReplayEvent {
  correlationId: string;
  category: ReplayCategory;
  action: string;
  status: ReplayStatus;
  sessionId?: string;
  request?: unknown;
  response?: unknown;
  error?: string;
}

let replayPathCache: string | null = null;

function getReplayPath(): string {
  if (replayPathCache) return replayPathCache;

  if (isAbsolute(config.REPLAY_LOG_PATH)) {
    replayPathCache = config.REPLAY_LOG_PATH;
    return replayPathCache;
  }

  // Resolve from repository root relative to api/src/observability.
  const thisDir = dirname(fileURLToPath(import.meta.url));
  replayPathCache = resolve(thisDir, '../../../', config.REPLAY_LOG_PATH);
  return replayPathCache;
}

export async function writeReplayEvent(event: ReplayEvent): Promise<void> {
  if (!config.REPLAY_LOG_ENABLED) return;

  const path = getReplayPath();
  const record = {
    timestamp: new Date().toISOString(),
    correlationId: event.correlationId,
    category: event.category,
    action: event.action,
    status: event.status,
    sessionId: event.sessionId,
    request: event.request,
    response: event.response,
    error: event.error,
  };

  try {
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, `${JSON.stringify(record)}\n`, 'utf8');
  } catch (err) {
    logger.error({ err, path }, 'Failed to write replay event');
  }
}
