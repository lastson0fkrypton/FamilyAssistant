import { z } from 'zod';
import {
  OrchestrationRequestSchema,
  type OrchestrationRequest,
  type OrchestrationResponse,
} from '@familyassistant/schemas';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config.js';
import { getOllamaClient } from '../ollama-client.js';
import { executeToolCall } from '../tools/registry.js';
import { logger } from '../logger.js';

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

const canceledCorrelationIds = new Set<string>();

export function cancelCorrelationId(correlationId: string): void {
  canceledCorrelationIds.add(correlationId);
}

function extractJsonObject(raw: string): string {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end < 0 || end <= start) {
    throw new Error('LLM did not return a JSON object');
  }
  return raw.slice(start, end + 1);
}

function buildPrompt(input: OrchestrationRequest, scratchpad: string): string {
  const history = input.history
    .slice(-10)
    .map((turn) => `${turn.role.toUpperCase()}: ${turn.content}`)
    .join('\n');

  const interruptLine = input.isInterrupt
    ? 'USER INTERRUPTION: Discard unfinished plans and replan from latest user guidance.'
    : 'No interruption flag for this turn.';

  return [
    config.ORCHESTRATION_SYSTEM_PROMPT,
    'Return EXACTLY one JSON object and nothing else.',
    'Choose either:',
    '1) {"kind":"response","reply":"...","done":true|false}',
    '2) {"kind":"tool_call","tool":"<allowlisted name>","args":{...}}',
    'Use tool_call only when a deterministic backend action is needed.',
    'Never claim device control, live integrations, news, weather, cameras, thermostats, or automation unless a tool result in this turn confirms it.',
    'If the user greets you or asks a general question, answer naturally and briefly instead of inventing platform capabilities.',
    interruptLine,
    '',
    'Conversation history:',
    history || '(none)',
    '',
    `Latest user input: ${input.input}`,
    '',
    'Scratchpad from prior loop steps:',
    scratchpad || '(none)',
  ].join('\n');
}

async function askPlanner(input: OrchestrationRequest, scratchpad: string): Promise<LlmDecision> {
  const client = getOllamaClient();
  const response = await client.generate(buildPrompt(input, scratchpad));
  const rawText = response.response ?? '';
  const jsonText = extractJsonObject(rawText);
  const parsed = LlmDecisionSchema.safeParse(JSON.parse(jsonText));
  if (!parsed.success) {
    throw new Error(`Planner JSON failed schema validation: ${parsed.error.message}`);
  }
  return parsed.data;
}

export async function orchestrate(rawRequest: unknown): Promise<OrchestrationResponse> {
  const parsed = OrchestrationRequestSchema.parse(rawRequest);
  const maxSteps = 4;
  const toolsExecuted: string[] = [];
  let scratchpad = '';

  for (let step = 0; step < maxSteps; step += 1) {
    const decision = await askPlanner(parsed, scratchpad);

    if (decision.kind === 'response') {
      return {
        sessionId: parsed.sessionId,
        reply: decision.reply,
        toolsExecuted,
        done: decision.done ?? false,
      };
    }

    const correlationId = uuidv4();
    if (canceledCorrelationIds.has(correlationId)) {
      canceledCorrelationIds.delete(correlationId);
      return {
        sessionId: parsed.sessionId,
        reply: 'Processing was canceled. I can continue with updated guidance.',
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
    scratchpad += `\nStep ${step + 1} tool ${decision.tool} -> ${JSON.stringify(toolResult)}`;

    if (!toolResult.ok) {
      return {
        sessionId: parsed.sessionId,
        reply: `Tool call failed: ${toolResult.error.code} - ${toolResult.error.message}`,
        toolsExecuted,
        done: false,
      };
    }
  }

  logger.warn({ sessionId: parsed.sessionId }, 'Orchestration reached max steps');
  return {
    sessionId: parsed.sessionId,
    reply: 'I need another turn to continue safely.',
    toolsExecuted,
    done: false,
  };
}
