import { config } from '../../config.js';
import type { SemanticMemoryAdapter } from './adapter.js';
import { InMemorySemanticMemoryAdapter } from './in-memory-adapter.js';
import { ChromaSemanticMemoryAdapter } from './chroma-adapter.js';
import { QdrantSemanticMemoryAdapter } from './qdrant-adapter.js';

let cachedAdapter: SemanticMemoryAdapter | null = null;

export function getSemanticMemoryAdapter(): SemanticMemoryAdapter {
  if (cachedAdapter) return cachedAdapter;

  if (config.SEMANTIC_MEMORY_BACKEND === 'qdrant') {
    cachedAdapter = new QdrantSemanticMemoryAdapter();
    return cachedAdapter;
  }

  if (config.SEMANTIC_MEMORY_BACKEND === 'chroma') {
    cachedAdapter = new ChromaSemanticMemoryAdapter();
    return cachedAdapter;
  }

  cachedAdapter = new InMemorySemanticMemoryAdapter();
  return cachedAdapter;
}

export type { SemanticMemoryAdapter } from './adapter.js';
