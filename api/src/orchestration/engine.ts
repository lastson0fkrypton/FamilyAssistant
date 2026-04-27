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
    .replace(/`?(?:memory|events)\.[a-z.]+`?/gi, 'household records')
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
  if (query.trim().length <= 1) return '(none)';

  try {
    const tokens = MemoryKvService.tokenizeText(query);
    const kv = await MemoryKvService.findTopMemoriesByTagTokens(tokens, 5);

    const lines: string[] = [];
    lines.push(`Input tokens: ${tokens.length > 0 ? tokens.join(', ') : '(none)'}`);

    if (kv.length > 0) {
      lines.push('Top matching memories by matched tags:');
      for (const item of kv) {
        lines.push(`  (${item.matchedTagCount} tags) ${item.memory}`);
      }
    }

    return lines.length > 0 ? lines.join('\n') : '(none)';
  } catch (err) {
    logger.warn({ err, sessionId }, 'Memory recall failed; continuing without memory context');
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
    '- Decide between tool_call vs response from user intent and available tools; do not stall in planning language.',
    '- Use memory context provided in this prompt before deciding to call a tool.',
    '- When the user states a fact or preference, use memory.add to save it.',
    '- When the user asks to forget or remove a memory, use memory.remove.',
    '- When asked about events, call events.list or events.get as needed.',
    '- Do not ask for confirmation to list events when the user already requested it.',
    '- If the previous assistant turn offered to check events and the user replies with "yes/please/go ahead", your next output MUST be a tool_call to the relevant event tool.',
    '- Never output planning text like "Let me check" unless a tool_call has already been emitted in this turn.',
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
    `USER: ${input.input}`,
    '',
    '=== SCRATCHPAD (tool results from earlier steps this turn) ===',
    scratchpad || '(none)',
  ]
    .filter((line) => line !== undefined)
    .join('\n');
}

function buildDirectPrompt(input: OrchestrationRequest, scratchpad: string, recalledMemory: string): string {
  const history = input.history
    .slice(-8)
    .map((turn) => `${turn.role.toUpperCase()}: ${turn.content}`)
    .join('\n');

  const toolManifest = buildToolManifestText();

  return [
    config.ORCHESTRATION_SYSTEM_PROMPT,
    '',
    'Return EXACTLY one JSON object and nothing else.',
    'Allowed outputs:',
    '{"kind":"tool_call","tool":"<name>","args":{...}}',
    '{"kind":"response","reply":"...","done":true}',
    '',
    'Guidance:',
    '- Memory context below is preloaded from tokenized user input; use it before deciding on tools.',
    '- Use tool_call for event and memory actions that require writes or event retrieval.',
    '- Use memory.add for saving facts/preferences and memory.remove for deletion requests.',
    '- After retrieving tool results (see scratchpad), synthesize a helpful response instead of re-calling the same tool.',
    '- If responding conversationally, keep it concise and helpful.',
    '- Do not expose internal tool identifiers in user-facing reply text.',
    '- Do not fabricate facts not present in provided memory context or tool results.',
    '',
    'Available tools:',
    toolManifest,
    '',
    'Relevant memory:',
    recalledMemory,
    '',
    'Conversation history:',
    history || '(none)',
    '',
    'Tool execution results from earlier steps this turn:',
    scratchpad || '(none)',
    '',
    `USER: ${input.input}`,
  ].join('\n');
}

// ── Planner call ───────────────────────────────────────────────────────────

async function askPlanner(
  input: OrchestrationRequest,
  scratchpad: string,
  memoryQuery: string,
): Promise<LlmDecision> {
  const client = getOllamaClient();
  const recalledMemory = await recallMemory(memoryQuery, input.sessionId);
  const prompt = input.usePlanner
    ? buildPlannerPrompt(input, scratchpad, recalledMemory)
    : buildDirectPrompt(input, scratchpad, recalledMemory);
  
  console.log('[SERVER-PLANNER] Generated prompt:', {
    mode: input.usePlanner ? 'PLANNER' : 'DIRECT',
    userInput: input.input,
    promptLength: prompt.length,
    promptPreview: prompt.slice(0, 300) + '...',
    recalledMemoryLength: recalledMemory.length,
    scratchpadLength: scratchpad.length,
  });
  
  const response = await client.generateJson(prompt);
  const rawText = response.response ?? '';

  console.log('[SERVER-PLANNER] LLM raw response:', {
    responseLength: rawText.length,
    responsePreview: rawText.slice(0, 400),
    fullResponse: rawText,
  });

  const decision = parsePlannerDecisionFromRaw(rawText);
  
  console.log('[SERVER-PLANNER] Parsed decision:', {
    kind: decision?.kind,
    tool: decision?.kind === 'tool_call' ? decision.tool : undefined,
    reply: decision?.kind === 'response' ? decision.reply : undefined,
    parseSuccess: !!decision,
  });
  
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

  console.log('[SERVER-ORCHESTRATE] Starting orchestration:', {
    sessionId: parsed.sessionId,
    userInput: parsed.input,
    usePlanner: parsed.usePlanner,
    historyLength: parsed.history.length,
    timestamp: new Date().toISOString(),
  });

  // Use the full input as the initial memory query; subsequent steps enrich scratchpad instead.
  let memoryQuery = parsed.input;

  for (let step = 0; step < maxSteps; step += 1) {
    console.log(`[SERVER-ORCHESTRATE-STEP] Step ${step + 1}/${maxSteps}`);
    
    const decision = await askPlanner(parsed, scratchpad, memoryQuery);

    console.log(`[SERVER-ORCHESTRATE-STEP] Step ${step + 1} decision:`, {
      kind: decision.kind,
      tool: decision.kind === 'tool_call' ? decision.tool : undefined,
    });

    if (decision.kind === 'response') {
      console.log('[SERVER-ORCHESTRATE] Orchestration complete with response:', {
        reply: decision.reply.slice(0, 100),
        toolsExecuted,
        done: decision.done ?? true,
      });
      return {
        sessionId: parsed.sessionId,
        reply: sanitizeAssistantReply(decision.reply),
        toolsExecuted,
        done: decision.done ?? true,
      };
    }

    // tool_call branch
    const correlationId = uuidv4();

    console.log(`[SERVER-ORCHESTRATE-STEP] Executing tool:`, {
      step: step + 1,
      tool: decision.tool,
      args: decision.args,
      correlationId,
    });

    const toolResult = await executeToolCall({
      correlationId,
      tool: decision.tool,
      args: decision.args,
    });

    toolsExecuted.push(decision.tool);

    const resultSummary = toolResult.ok
      ? JSON.stringify(toolResult.result)
      : `ERROR ${toolResult.error.code}: ${toolResult.error.message}`;

    console.log(`[SERVER-ORCHESTRATE-STEP] Tool result:`, {
      step: step + 1,
      tool: decision.tool,
      success: toolResult.ok,
      resultPreview: resultSummary.slice(0, 200),
    });

    scratchpad += `\n[step ${step + 1}] ${decision.tool}(${JSON.stringify(decision.args)}) → ${resultSummary}`;

    // After a tool result, refine the memory query to anything relevant in the result.
    memoryQuery = `${parsed.input} ${resultSummary}`.slice(0, 400);

    if (!toolResult.ok) {
      console.log('[SERVER-ORCHESTRATE] Tool failed, returning error response');
      return {
        sessionId: parsed.sessionId,
        reply: 'I could not complete that action right now. I can still help if you want a direct answer or want to try the action again with a bit more detail.',
        toolsExecuted,
        done: false,
      };
    }
  }

  console.log('[SERVER-ORCHESTRATE] Max steps reached without completing');
  logger.warn({ sessionId: parsed.sessionId }, 'Orchestration reached max steps without completing');
  return {
    sessionId: parsed.sessionId,
    reply: 'I ran out of steps to complete this request. Please rephrase or break it into smaller asks.',
    toolsExecuted,
    done: false,
  };
}

