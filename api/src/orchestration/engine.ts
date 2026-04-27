import { z } from 'zod';
import {
  OrchestrationRequestSchema,
  type OrchestrationRequest,
  type OrchestrationResponse,
} from '@familyassistant/schemas';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config.js';
import { getOllamaClient } from '../ollama-client.js';
import { executeToolCall, getToolManifest } from '../tools/registry.js';
import { logger } from '../logger.js';
import * as MemoryKvService from '../services/memory-kv.js';
import * as SemanticMemoryService from '../services/semantic-memory.js';

// ── LLM planner decision schema ────────────────────────────────────────────

const LlmDecisionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('response'),
    reply: z.string().min(1),
    done: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal('tool_call'),
    tool: z.string().min(1),
    args: z.record(z.unknown()).default({}),
  }),
]);

type LlmDecision = z.infer<typeof LlmDecisionSchema>;

// ── Cancellation ───────────────────────────────────────────────────────────

const canceledCorrelationIds = new Set<string>();

export function cancelCorrelationId(correlationId: string): void {
  canceledCorrelationIds.add(correlationId);
}

// ── Utility helpers ────────────────────────────────────────────────────────

function extractJsonObject(raw: string): string {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end < 0 || end <= start) {
    throw new Error('LLM did not return a JSON object');
  }
  return raw.slice(start, end + 1);
}

function parsePlannerDecisionFromRaw(rawText: string): LlmDecision | null {
  const candidates: string[] = [];
  const trimmed = rawText.trim();

  if (trimmed.length > 0) {
    candidates.push(trimmed);
  }

  // Common model behavior: wraps JSON in markdown code fences.
  const fencedMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch && fencedMatch[1]) {
    candidates.push(fencedMatch[1].trim());
  }

  try {
    candidates.push(extractJsonObject(rawText));
  } catch {
    // Keep trying other candidates.
  }

  for (const candidate of candidates) {
    try {
      const parsed = LlmDecisionSchema.safeParse(JSON.parse(candidate));
      if (parsed.success) {
        return parsed.data;
      }
    } catch {
      // Try next candidate.
    }
  }

  return null;
}

function sanitizeAssistantReply(reply: string): string {
  return reply
    .trim()
    .replace(/`?(?:memory|events|schedules)\.[a-z.]+`?/gi, 'household records')
    .replace(/\s{2,}/g, ' ');
}

function buildReplyFallbackFromRaw(rawText: string): string {
  const cleaned = sanitizeAssistantReply(
    rawText
      .replace(/```(?:json)?/gi, '')
      .replace(/```/g, '')
      .trim(),
  );

  if (cleaned.length === 0) {
    return 'I had trouble formatting my previous step. Please try again and I will continue from the latest context.';
  }

  return cleaned;
}

// ── Memory recall ──────────────────────────────────────────────────────────

async function recallMemory(query: string, sessionId: string): Promise<string> {
  if (query.trim().length <= 5) return '(none)';

  try {
    const [kv, semantic] = await Promise.all([
      MemoryKvService.searchMemoryKv({ namespace: 'household', query, limit: 8 }),
      SemanticMemoryService.searchSemanticMemory({
        query,
        limit: 5,
        sessionId,
        kinds: ['preference', 'context_note', 'conversation_summary'],
      }),
    ]);

    const lines: string[] = [];

    if (kv.length > 0) {
      lines.push('Household facts (key-value memory):');
      for (const item of kv) {
        lines.push(`  ${item.key}: ${item.value}`);
      }
    }

    if (semantic.length > 0) {
      lines.push('Related conversation notes:');
      for (const row of semantic) {
        lines.push(`  (${row.entry.kind}) ${row.entry.content}`);
      }
    }

    return lines.length > 0 ? lines.join('\n') : '(none)';
  } catch (err) {
    logger.warn({ err }, 'Memory recall failed; continuing without memory context');
    return '(none)';
  }
}

// ── Tool manifest text for the planner prompt ──────────────────────────────

function buildToolManifestText(): string {
  return getToolManifest()
    .map((t) => `• ${t.name}: ${t.description}\n  Invoke when: ${t.keywords.join(', ')}`)
    .join('\n');
}

// ── Planner prompt ─────────────────────────────────────────────────────────

function buildPlannerPrompt(
  input: OrchestrationRequest,
  scratchpad: string,
  recalledMemory: string,
): string {
  const history = input.history
    .slice(-10)
    .map((turn) => `${turn.role.toUpperCase()}: ${turn.content}`)
    .join('\n');

  const interruptNote = input.isInterrupt
    ? 'USER INTERRUPTED: Discard any prior plan. Replan based on the updated input below.'
    : '';

  const toolManifest = buildToolManifestText();

  return [
    config.ORCHESTRATION_SYSTEM_PROMPT,
    '',
    '=== INSTRUCTIONS ===',
    'You are a household AI assistant. On every turn, do the following:',
    '1. Identify the subjects (people, topics) and action the user wants.',
    '2. Check whether the action maps to an available tool below.',
    '3. If an action requires a tool: return {"kind":"tool_call","tool":"<name>","args":{...}}',
    '4. If this is a question or conversational response: return {"kind":"response","reply":"...","done":true}',
    '',
    'Rules:',
    '- Return EXACTLY one JSON object, nothing else.',
    '- Do NOT output markdown code fences.',
    '- When the user states a fact or preference about someone, ALWAYS use memory.kv.save first.',
    '- When asked about events/schedules/tasks, ALWAYS call the list/search tool — never guess.',
    '- Use recalled memory as context to enrich your response, but do not invent facts that are not there.',
    '- Never expose tool names, technical identifiers, or internal details in user-facing replies.',
    '- If you do not have the answer and no tool can provide it, say you do not know and ask.',
    '',
    '=== AVAILABLE TOOLS ===',
    toolManifest,
    '',
    '=== RECALLED MEMORY (use as context, do not invent beyond this) ===',
    recalledMemory,
    '',
    '=== CONVERSATION HISTORY ===',
    history || '(none)',
    '',
    interruptNote,
    `USER: ${input.input}`,
    '',
    '=== SCRATCHPAD (tool results from earlier steps this turn) ===',
    scratchpad || '(none)',
  ]
    .filter((line) => line !== undefined)
    .join('\n');
}

// ── Planner call ───────────────────────────────────────────────────────────

async function askPlanner(
  input: OrchestrationRequest,
  scratchpad: string,
  memoryQuery: string,
): Promise<LlmDecision> {
  const client = getOllamaClient();
  const recalledMemory = await recallMemory(memoryQuery, input.sessionId);
  const prompt = buildPlannerPrompt(input, scratchpad, recalledMemory);
  const response = await client.generateJson(prompt);
  const rawText = response.response ?? '';

  const decision = parsePlannerDecisionFromRaw(rawText);
  if (decision) {
    return decision;
  }

  logger.warn(
    {
      sessionId: input.sessionId,
      rawPreview: rawText.slice(0, 400),
    },
    'Planner returned non-JSON output; treating it as a conversational reply',
  );

  return {
    kind: 'response',
    reply: buildReplyFallbackFromRaw(rawText),
    done: false,
  };
}

// ── Orchestration entry point ──────────────────────────────────────────────

export async function orchestrate(rawRequest: unknown): Promise<OrchestrationResponse> {
  const parsed = OrchestrationRequestSchema.parse(rawRequest);
  const maxSteps = 6;
  const toolsExecuted: string[] = [];
  let scratchpad = '';

  // Use the full input as the initial memory query; subsequent steps enrich scratchpad instead.
  let memoryQuery = parsed.input;

  for (let step = 0; step < maxSteps; step += 1) {
    const decision = await askPlanner(parsed, scratchpad, memoryQuery);

    if (decision.kind === 'response') {
      return {
        sessionId: parsed.sessionId,
        reply: sanitizeAssistantReply(decision.reply),
        toolsExecuted,
        done: decision.done ?? true,
      };
    }

    // tool_call branch
    const correlationId = uuidv4();

    if (canceledCorrelationIds.has(correlationId)) {
      canceledCorrelationIds.delete(correlationId);
      return {
        sessionId: parsed.sessionId,
        reply: 'Processing was canceled. Please go ahead with your updated request.',
        toolsExecuted,
        done: false,
      };
    }

    const toolResult = await executeToolCall({
      correlationId,
      tool: decision.tool,
      args: decision.args,
    });

    toolsExecuted.push(decision.tool);

    const resultSummary = toolResult.ok
      ? JSON.stringify(toolResult.result)
      : `ERROR ${toolResult.error.code}: ${toolResult.error.message}`;

    scratchpad += `\n[step ${step + 1}] ${decision.tool}(${JSON.stringify(decision.args)}) → ${resultSummary}`;

    // After a tool result, refine the memory query to anything relevant in the result.
    memoryQuery = `${parsed.input} ${resultSummary}`.slice(0, 400);

    if (!toolResult.ok) {
      return {
        sessionId: parsed.sessionId,
        reply: 'I could not complete that action right now. I can still help if you want a direct answer or want to try the action again with a bit more detail.',
        toolsExecuted,
        done: false,
      };
    }
  }

  logger.warn({ sessionId: parsed.sessionId }, 'Orchestration reached max steps without completing');
  return {
    sessionId: parsed.sessionId,
    reply: 'I ran out of steps to complete this request. Please rephrase or break it into smaller asks.',
    toolsExecuted,
    done: false,
  };
}

