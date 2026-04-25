import { z } from 'zod';

// Semantic memory entry written to vector stores (Qdrant/Chroma adapters).
export const SemanticMemoryEntrySchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid().optional(),
  sessionId: z.string().uuid().optional(),
  kind: z.enum(['preference', 'conversation_summary', 'context_note']),
  content: z.string().min(1).max(12000),
  tags: z.array(z.string().min(1).max(64)).default([]),
  source: z.enum(['user_message', 'assistant_message', 'system_summary']),
  timestamp: z.string().datetime({ offset: true }),
  metadata: z.record(z.unknown()).default({}),
});

// Upsert payload used by semantic adapters.
export const SemanticUpsertRequestSchema = z.object({
  entry: SemanticMemoryEntrySchema,
  embedding: z.array(z.number()).min(1),
});

// Query payload for retrieval-augmented context recall.
export const SemanticQueryRequestSchema = z.object({
  queryEmbedding: z.array(z.number()).min(1),
  limit: z.coerce.number().int().min(1).max(50).default(5),
  userId: z.string().uuid().optional(),
  sessionId: z.string().uuid().optional(),
  kinds: z.array(SemanticMemoryEntrySchema.shape.kind).optional(),
  tags: z.array(z.string().min(1).max(64)).optional(),
});

export const SemanticQueryResultSchema = z.object({
  entry: SemanticMemoryEntrySchema,
  score: z.number(),
});

// Contract used by orchestrators to write semantic memory consistently.
export const SemanticIngestionRequestSchema = z.object({
  sessionId: z.string().uuid(),
  userId: z.string().uuid().optional(),
  timestamp: z.string().datetime({ offset: true }),
  conversationSummary: z.string().min(1).max(12000),
  extractedPreferences: z.array(
    z.object({
      key: z.string().min(1).max(128),
      value: z.string().min(1).max(512),
      confidence: z.number().min(0).max(1).optional(),
    }),
  ).default([]),
  tags: z.array(z.string().min(1).max(64)).default([]),
  metadata: z.record(z.unknown()).default({}),
});

export const SemanticIngestionResultSchema = z.object({
  accepted: z.boolean(),
  storedEntries: z.number().int().nonnegative(),
  message: z.string(),
});

export type SemanticMemoryEntry = z.infer<typeof SemanticMemoryEntrySchema>;
export type SemanticUpsertRequest = z.infer<typeof SemanticUpsertRequestSchema>;
export type SemanticQueryRequest = z.infer<typeof SemanticQueryRequestSchema>;
export type SemanticQueryResult = z.infer<typeof SemanticQueryResultSchema>;
export type SemanticIngestionRequest = z.infer<typeof SemanticIngestionRequestSchema>;
export type SemanticIngestionResult = z.infer<typeof SemanticIngestionResultSchema>;
