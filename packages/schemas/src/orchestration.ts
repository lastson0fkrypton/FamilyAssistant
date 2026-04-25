import { z } from 'zod';

// ── Conversation turn ──────────────────────────────────────────────────────

export const TurnRoleSchema = z.enum(['user', 'assistant', 'tool']);

export const ConversationTurnSchema = z.object({
  role: TurnRoleSchema,
  content: z.string(),
  /** ISO timestamp of when this turn was added. */
  at: z.string().datetime({ offset: true }),
  /** Only present on tool turns — links back to the tool call. */
  correlationId: z.string().uuid().optional(),
});

// ── Orchestration request ──────────────────────────────────────────────────
// Sent from the frontend to the API to process a user turn.

export const OrchestrationRequestSchema = z.object({
  sessionId: z.string().uuid(),
  /** Accumulated conversation history for this session. */
  history: z.array(ConversationTurnSchema),
  /** The new user turn to process. */
  input: z.string().min(1).max(8000),
  /** If true, signals the LLM should abort current work and replan. */
  isInterrupt: z.boolean().default(false),
});

// ── Orchestration response ─────────────────────────────────────────────────

export const OrchestrationResponseSchema = z.object({
  sessionId: z.string().uuid(),
  /** The assistant reply text (may be partial if streaming later). */
  reply: z.string(),
  /** Any tool calls that were executed during this turn. */
  toolsExecuted: z.array(z.string()).default([]),
  /** Whether the session has reached a natural end state. */
  done: z.boolean().default(false),
});

export type TurnRole = z.infer<typeof TurnRoleSchema>;
export type ConversationTurn = z.infer<typeof ConversationTurnSchema>;
export type OrchestrationRequest = z.infer<typeof OrchestrationRequestSchema>;
export type OrchestrationResponse = z.infer<typeof OrchestrationResponseSchema>;
