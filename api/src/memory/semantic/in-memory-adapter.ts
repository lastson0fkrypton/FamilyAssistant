import type {
  SemanticMemoryEntry,
  SemanticUpsertRequest,
  SemanticQueryRequest,
  SemanticQueryResult,
} from '@familyassistant/schemas';
import type { SemanticMemoryAdapter } from './adapter.js';

interface StoredEntry {
  entry: SemanticMemoryEntry;
  embedding: number[];
}

function cosineSimilarity(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < length; i += 1) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }

  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export class InMemorySemanticMemoryAdapter implements SemanticMemoryAdapter {
  private readonly store = new Map<string, StoredEntry>();

  async healthCheck(): Promise<void> {
    // In-memory adapter is always available in-process.
  }

  async upsert(input: SemanticUpsertRequest): Promise<void> {
    this.store.set(input.entry.id, {
      entry: input.entry,
      embedding: input.embedding,
    });
  }

  async query(input: SemanticQueryRequest): Promise<SemanticQueryResult[]> {
    const rows: SemanticQueryResult[] = [];

    for (const value of this.store.values()) {
      const entry = value.entry;

      if (input.userId && entry.userId !== input.userId) continue;
      if (input.sessionId && entry.sessionId !== input.sessionId) continue;
      if (input.kinds && !input.kinds.includes(entry.kind)) continue;
      if (input.tags && input.tags.length > 0) {
        const hasTag = input.tags.some((t) => entry.tags.includes(t));
        if (!hasTag) continue;
      }

      rows.push({
        entry,
        score: cosineSimilarity(input.queryEmbedding, value.embedding),
      });
    }

    rows.sort((a, b) => b.score - a.score);
    return rows.slice(0, input.limit);
  }

  async deleteById(id: string): Promise<boolean> {
    return this.store.delete(id);
  }

  async deleteBySession(sessionId: string): Promise<number> {
    let count = 0;
    for (const [id, value] of this.store.entries()) {
      if (value.entry.sessionId === sessionId) {
        this.store.delete(id);
        count += 1;
      }
    }
    return count;
  }

  async deleteByUser(userId: string): Promise<number> {
    let count = 0;
    for (const [id, value] of this.store.entries()) {
      if (value.entry.userId === userId) {
        this.store.delete(id);
        count += 1;
      }
    }
    return count;
  }

  async getById(id: string): Promise<SemanticMemoryEntry | null> {
    return this.store.get(id)?.entry ?? null;
  }
}
