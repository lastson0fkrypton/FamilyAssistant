import { v4 as uuidv4 } from 'uuid';
import type { SemanticMemoryEntry, SemanticQueryResult } from '@familyassistant/schemas';
import { getSemanticMemoryAdapter } from '../memory/semantic/index.js';
import { embedText } from '../memory/semantic/embed.js';

export interface SaveSemanticMemoryInput {
  content: string;
  kind: 'preference' | 'conversation_summary' | 'context_note';
  tags?: string[];
  userId?: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
}

export interface SearchSemanticMemoryInput {
  query: string;
  limit: number;
  userId?: string;
  sessionId?: string;
  kinds?: Array<'preference' | 'conversation_summary' | 'context_note'>;
  tags?: string[];
}

export async function saveSemanticMemory(input: SaveSemanticMemoryInput): Promise<SemanticMemoryEntry> {
  const adapter = getSemanticMemoryAdapter();
  const timestamp = new Date().toISOString();

  const entry: SemanticMemoryEntry = {
    id: uuidv4(),
    userId: input.userId,
    sessionId: input.sessionId,
    kind: input.kind,
    content: input.content,
    tags: input.tags ?? [],
    source: 'system_summary',
    timestamp,
    metadata: input.metadata ?? {},
  };

  await adapter.upsert({
    entry,
    embedding: embedText(input.content),
  });

  return entry;
}

export async function searchSemanticMemory(input: SearchSemanticMemoryInput): Promise<SemanticQueryResult[]> {
  const adapter = getSemanticMemoryAdapter();

  return adapter.query({
    queryEmbedding: embedText(input.query),
    limit: input.limit,
    userId: input.userId,
    sessionId: input.sessionId,
    kinds: input.kinds,
    tags: input.tags,
  });
}

export async function deleteSemanticMemoryById(id: string): Promise<boolean> {
  const adapter = getSemanticMemoryAdapter();
  return adapter.deleteById(id);
}

export async function deleteSemanticMemoryBySession(sessionId: string): Promise<number> {
  const adapter = getSemanticMemoryAdapter();
  return adapter.deleteBySession(sessionId);
}

export async function deleteSemanticMemoryByUser(userId: string): Promise<number> {
  const adapter = getSemanticMemoryAdapter();
  return adapter.deleteByUser(userId);
}
