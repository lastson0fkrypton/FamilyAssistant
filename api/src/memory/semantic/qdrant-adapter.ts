import type {
  SemanticMemoryEntry,
  SemanticUpsertRequest,
  SemanticQueryRequest,
  SemanticQueryResult,
} from '@familyassistant/schemas';
import type { SemanticMemoryAdapter } from './adapter.js';

function notImplemented(method: string): never {
  throw new Error(`Qdrant semantic adapter is not implemented yet (${method})`);
}

export class QdrantSemanticMemoryAdapter implements SemanticMemoryAdapter {
  async healthCheck(): Promise<void> { notImplemented('healthCheck'); }

  async upsert(_input: SemanticUpsertRequest): Promise<void> { notImplemented('upsert'); }

  async query(_input: SemanticQueryRequest): Promise<SemanticQueryResult[]> {
    return notImplemented('query');
  }

  async deleteById(_id: string): Promise<boolean> { return notImplemented('deleteById'); }
  async deleteBySession(_sessionId: string): Promise<number> { return notImplemented('deleteBySession'); }
  async deleteByUser(_userId: string): Promise<number> { return notImplemented('deleteByUser'); }

  async getById(_id: string): Promise<SemanticMemoryEntry | null> { return notImplemented('getById'); }
}
