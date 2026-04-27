import { z } from 'zod';
import {
  OrchestrationRequestSchema,
  type OrchestrationRequest,
  type OrchestrationResponse,
} from '@familyassistant/schemas';
import { v4 as uuidv4 } from 'uuid';
import { getOllamaClient } from '../ollama-client.js';
import { executeToolCall, getOllamaToolDefinitions, getToolManifest } from '../tools/registry.js';
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

const ORCHESTRATION_SYSTEM_PROMPT = [
  'You are a friendly household AI assistant helping manage events and memories.',
  'Be concise, factual, and operational.',
  'Use memory.add to save durable household facts and preferences.',
  'Use memory.remove to forget saved facts when asked.',
  'Use event tools when the user asks about events or wants to manage them.',
].join(' ');

// ── Utility helpers ────────────────────────────────────────────────────────

function extractJsonObject(raw: string): string {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end < 0 || end <= start) {
    throw new Error('LLM did not return a JSON object');
  }
  return raw.slice(start, end + 1);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseDecisionFromValue(value: unknown): LlmDecision | null {
  const parsed = LlmDecisionSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }

  if (!isRecord(value)) {
    return null;
  }

  if (value['kind'] === 'response') {
    const reply = value['reply'];

    if (typeof reply === 'string' && reply.trim().length > 0) {
      return {
        kind: 'response',
        reply: reply.trim(),
        done: typeof value['done'] === 'boolean' ? value['done'] : true,
      };
    }

    const nestedReplyDecision = parseDecisionFromValue(reply);
    if (nestedReplyDecision) {
      return nestedReplyDecision;
    }
  }

  if (value['kind'] === 'tool_call' && typeof value['tool'] === 'string') {
    return {
      kind: 'tool_call',
      tool: value['tool'],
      args: isRecord(value['args']) ? value['args'] : {},
    };
  }

  if (Array.isArray(value['tool_calls'])) {
    for (const candidate of value['tool_calls']) {
      const nestedDecision = parseDecisionFromValue(candidate);
      if (nestedDecision?.kind === 'tool_call') {
        return nestedDecision;
      }
    }
  }

  if (typeof value['tool'] === 'string') {
    return {
      kind: 'tool_call',
      tool: value['tool'],
      args: isRecord(value['args']) ? value['args'] : {},
    };
  }

  return null;
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
      const parsedValue = JSON.parse(candidate);
      const decision = parseDecisionFromValue(parsedValue);
      if (decision) {
        return decision;
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

  if (cleaned.length === 0 || (/^\{[\s\S]*\}$/.test(cleaned) && cleaned.includes('"kind"'))) {
    return 'I had trouble formatting my previous step. Please try again and I will continue from the latest context.';
  }

  return cleaned;
}

function extractValidationFieldHints(errorMessage: string): string[] {
  const fields = new Set<string>();
  const regex = /"path"\s*:\s*\[\s*"([^"]+)"/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(errorMessage)) !== null) {
    if (match[1]) {
      fields.add(match[1]);
    }
  }

  return [...fields];
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


function buildPrompt(
  input: OrchestrationRequest,
  scratchpad: string,
  recalledMemory: string,
  repairToolName?: string,
): { system: string; user: string } {
  const history = input.history
    .slice(-8)
    .map((turn) => `${turn.role.toUpperCase()}: ${turn.content}`)
    .join('\n');

  const toolManifest = buildToolManifestText();

  const system = [
    ORCHESTRATION_SYSTEM_PROMPT,
    '',
    'Respond naturally to the user unless a tool call is needed.',
    'When a tool is needed, call it directly using the provided native tool interface.',
    'Do not fabricate tool output.',
    '',
    'DECISION RULES (apply in order):',
    '1. User wants to save/remember a fact or preference -> call memory.add',
    '2. User wants to forget/delete a fact -> call memory.remove',
    '3. User wants event info or to manage events -> call the appropriate events.* tool',
    '4. Otherwise -> provide a helpful concise response',
    '',
    'IMPORTANT: If the user asks to add an event and gives a local date/time, convert it to a full ISO datetime with timezone, e.g. 2026-04-29T17:00:00Z.',
    'IMPORTANT: If the scratchpad shows a validation error, call the same tool again with corrected fields.',
    'IMPORTANT: After a tool result appears in the scratchpad, synthesize a reply instead of re-calling the same tool.',
    'IMPORTANT: Never expose tool names or internal identifiers in reply text.',
    'IMPORTANT: If recalled memory already contains the fact the user is stating, do not call memory.add again.',
    'IMPORTANT: For recommendation questions, use recalled memory directly in the reply.',
    'IMPORTANT: Use the exact parameter names from the tool manifest. Do not invent aliases like start_date when the tool requires startsAt.',
    '',
    '=== AVAILABLE TOOLS ===',
    toolManifest,
  ].join('\n');

  const user = [
    '=== RECALLED MEMORY ===',
    recalledMemory,
    '',
    '=== CONVERSATION HISTORY ===',
    history || '(none)',
    '',
    '=== TOOL RESULTS FROM EARLIER STEPS THIS TURN ===',
    scratchpad || '(none)',
    '',
    repairToolName
      ? `=== REPAIR MODE ===\nYour last call to ${repairToolName} failed. Do not explain the error to the user. Return a corrected tool_call for ${repairToolName}.`
      : undefined,
    repairToolName
      ? 'Use the exact field names required by the manifest and infer obvious missing values from the user request when possible.'
      : undefined,
    '',
    `USER: ${input.input}`,
    'OUTPUT:',
  ].join('\n');

  return { system, user };
}

// ── Planner call ───────────────────────────────────────────────────────────

async function askOllama(
  input: OrchestrationRequest,
  scratchpad: string,
  memoryQuery: string,
  repairToolName?: string,
): Promise<LlmDecision> {
  const client = getOllamaClient();
  const recalledMemory = await recallMemory(memoryQuery, input.sessionId);
  const { system, user } = buildPrompt(input, scratchpad, recalledMemory, repairToolName);
  const toolDefinitions = getOllamaToolDefinitions();

  console.log('[SERVER-PLANNER] Generated prompt:', {
    userInput: input.input,
    systemLength: system.length,
    userLength: user.length,
    recalledMemoryLength: recalledMemory.length,
    scratchpadLength: scratchpad.length,
  });

  const modelOutput = await client.chatWithTools(system, user, toolDefinitions);
  const rawText = modelOutput.content;

  console.log('[SERVER-PLANNER] LLM raw response:', {
    responseLength: rawText.length,
    responsePreview: rawText.slice(0, 400),
    fullResponse: rawText,
    nativeToolCalls: modelOutput.toolCalls,
  });

  if (modelOutput.toolCalls.length > 0) {
    const firstCall = modelOutput.toolCalls[0];
    return {
      kind: 'tool_call',
      tool: firstCall.name,
      args: firstCall.args,
    };
  }

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
  let repairToolName: string | undefined;
  let repairResponseCount = 0;
  let lastFailedSignature = '';
  let repeatedFailureCount = 0;

  console.log('[SERVER-ORCHESTRATE] Starting orchestration:', {
    sessionId: parsed.sessionId,
    userInput: parsed.input,
    historyLength: parsed.history.length,
    timestamp: new Date().toISOString(),
  });

  // Use the full input as the initial memory query; subsequent steps enrich scratchpad instead.
  let memoryQuery = parsed.input;

  for (let step = 0; step < maxSteps; step += 1) {
    console.log(`[SERVER-ORCHESTRATE-STEP] Step ${step + 1}/${maxSteps}`);
    
    const decision = await askOllama(parsed, scratchpad, memoryQuery, repairToolName);

    console.log(`[SERVER-ORCHESTRATE-STEP] Step ${step + 1} decision:`, {
      kind: decision.kind,
      tool: decision.kind === 'tool_call' ? decision.tool : undefined,
    });

    if (decision.kind === 'response') {
      if (repairToolName) {
        repairResponseCount += 1;

        if (repairResponseCount >= 2) {
          console.log('[SERVER-ORCHESTRATE] Repair mode aborted after repeated non-tool responses', {
            repairToolName,
            repairResponseCount,
          });

          return {
            sessionId: parsed.sessionId,
            reply: 'I could not repair that tool call automatically. Please try again with explicit date/time details including timezone (for example: 2026-04-29T17:00:00Z).',
            toolsExecuted,
            done: false,
          };
        }

        scratchpad += `\n[repair] The previous model output was a user-facing response while ${repairToolName} still needed corrected arguments. Return a corrected ${repairToolName} tool_call instead.`;
        continue;
      }

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
      repairToolName = decision.tool;
      repairResponseCount = 0;

      const signature = `${decision.tool}:${JSON.stringify(decision.args)}:${toolResult.error.code}:${toolResult.error.message}`;
      if (signature === lastFailedSignature) {
        repeatedFailureCount += 1;
      } else {
        repeatedFailureCount = 1;
        lastFailedSignature = signature;
      }

      if (repeatedFailureCount >= 2) {
        const fieldHints = extractValidationFieldHints(toolResult.error.message);
        const hintText = fieldHints.length > 0
          ? ` Missing or invalid fields: ${fieldHints.join(', ')}.`
          : '';

        console.log('[SERVER-ORCHESTRATE] Repeated identical tool failure, aborting repair loop', {
          tool: decision.tool,
          repeatedFailureCount,
          fieldHints,
        });

        return {
          sessionId: parsed.sessionId,
          reply: `I could not complete that action because the tool arguments are still invalid.${hintText} Please restate the request with exact values and I will try again.`,
          toolsExecuted,
          done: false,
        };
      }

      console.log('[SERVER-ORCHESTRATE] Tool failed, continuing so the model can repair and retry:', {
        step: step + 1,
        tool: decision.tool,
        error: toolResult.error,
      });

      continue;
    }

    repairToolName = undefined;
    repairResponseCount = 0;
    lastFailedSignature = '';
    repeatedFailureCount = 0;
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

