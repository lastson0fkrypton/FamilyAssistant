import { z } from 'zod';

// ── Tool call request ──────────────────────────────────────────────────────
// Sent by the orchestration layer when the LLM selects a tool.

export const ToolCallRequestSchema = z.object({
  /** Correlation ID linking this call to the originating conversation turn. */
  correlationId: z.string().uuid(),
  /** Registered tool name from the tool registry allowlist. */
  tool: z.string().min(1).max(100),
  /** Tool-specific arguments, validated per-tool before execution. */
  args: z.record(z.unknown()),
});

// ── Tool call result ───────────────────────────────────────────────────────

export const ToolCallSuccessSchema = z.object({
  ok: z.literal(true),
  correlationId: z.string().uuid(),
  tool: z.string(),
  /** Machine-readable result returned to the LLM context. */
  result: z.unknown(),
  /** Optional plain-English summary for logging and UI display. */
  summary: z.string().optional(),
  durationMs: z.number().int().nonnegative(),
});

export const ToolCallErrorSchema = z.object({
  ok: z.literal(false),
  correlationId: z.string().uuid(),
  tool: z.string(),
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
  durationMs: z.number().int().nonnegative(),
});

export const ToolCallResultSchema = z.discriminatedUnion('ok', [
  ToolCallSuccessSchema,
  ToolCallErrorSchema,
]);

export type ToolCallRequest = z.infer<typeof ToolCallRequestSchema>;
export type ToolCallSuccess = z.infer<typeof ToolCallSuccessSchema>;
export type ToolCallError = z.infer<typeof ToolCallErrorSchema>;
export type ToolCallResult = z.infer<typeof ToolCallResultSchema>;
