import { config } from '../../config.js';
import type { StructuredMemoryAdapter } from './adapter.js';
import { PostgresStructuredMemoryAdapter } from './postgres-adapter.js';
import { SqliteStructuredMemoryAdapter } from './sqlite-adapter.js';

let cachedAdapter: StructuredMemoryAdapter | null = null;

export function getStructuredMemoryAdapter(): StructuredMemoryAdapter {
  if (cachedAdapter) return cachedAdapter;

  cachedAdapter = config.STRUCTURED_MEMORY_BACKEND === 'sqlite'
    ? new SqliteStructuredMemoryAdapter()
    : new PostgresStructuredMemoryAdapter();

  return cachedAdapter;
}

export type { StructuredMemoryAdapter } from './adapter.js';
