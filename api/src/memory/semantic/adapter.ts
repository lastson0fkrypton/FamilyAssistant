import type {
  SemanticMemoryEntry,
  SemanticUpsertRequest,
  SemanticQueryRequest,
  SemanticQueryResult,
} from '@familyassistant/schemas';

export interface SemanticMemoryAdapter {
  healthCheck(): Promise<void>;

  upsert(input: SemanticUpsertRequest): Promise<void>;
  query(input: SemanticQueryRequest): Promise<SemanticQueryResult[]>;

  deleteById(id: string): Promise<boolean>;
  deleteBySession(sessionId: string): Promise<number>;
  deleteByUser(userId: string): Promise<number>;

  // Optional inspection utility for debugging local-first behavior.
  getById(id: string): Promise<SemanticMemoryEntry | null>;
}
