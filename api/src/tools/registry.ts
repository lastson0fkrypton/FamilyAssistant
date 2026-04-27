import { z, ZodError, type ZodTypeAny } from 'zod';
import {
  ToolCallRequestSchema,
  type ToolCallRequest,
  type ToolCallResult,
  type ToolCallSuccess,
  type ToolCallError,
  EventListQuerySchema,
  CreateEventSchema,
  UpdateEventSchema,
} from '@familyassistant/schemas';
import * as EventsService from '../services/events.js';
import * as MemoryKvService from '../services/memory-kv.js';
import { writeReplayEvent } from '../observability/replay.js';

interface ToolContext {
  correlationId: string;
}

interface RegisteredTool<TInput extends ZodTypeAny = ZodTypeAny> {
  name: string;
  description: string;
  keywords: string[];
  inputSchema: TInput;
  execute: (args: z.infer<TInput>, context: ToolContext) => Promise<unknown>;
}

export interface ToolManifestEntry {
  name: string;
  description: string;
  keywords: string[];
  parameters: string;
}

function unwrapSchema(schema: ZodTypeAny): ZodTypeAny {
  let current = schema as ZodTypeAny & { _def?: { innerType?: ZodTypeAny } };
  while (current?._def?.innerType) {
    current = current._def.innerType as ZodTypeAny & { _def?: { innerType?: ZodTypeAny } };
  }
  return current;
}

function describeInputSchema(schema: ZodTypeAny): string {
  const unwrapped = unwrapSchema(schema) as ZodTypeAny & {
    shape?: Record<string, unknown>;
    _def?: { shape?: (() => Record<string, unknown>) | Record<string, unknown> };
  };

  let shape: Record<string, unknown> | undefined;
  if (typeof unwrapped._def?.shape === 'function') {
    shape = unwrapped._def.shape();
  } else if (unwrapped._def?.shape && typeof unwrapped._def.shape === 'object') {
    shape = unwrapped._def.shape;
  } else if (unwrapped.shape && typeof unwrapped.shape === 'object') {
    shape = unwrapped.shape;
  }

  if (shape && Object.keys(shape).length > 0) {
    return Object.keys(shape).join(', ');
  }

  return 'see schema';
}

const UuidSchema = z.string().uuid();

const EventUpdateArgsSchema = z.object({
  id: UuidSchema,
  patch: UpdateEventSchema,
});

const EventDeleteArgsSchema = z.object({
  id: UuidSchema,
});

const MemoryAddArgsSchema = z.object({
  memory: z.string().min(1).max(12000),
  tags: z.array(z.string().min(1).max(64)).default([]),
});

const MemoryRemoveArgsSchema = z.object({
  memory: z.string().min(1).max(12000),
});

const TOOL_REGISTRY: RegisteredTool[] = [
  {
    name: 'events.list',
    description: 'List household events in time order with optional date filtering.',
    keywords: ['events', 'list', 'upcoming', 'calendar', 'what events'],
    inputSchema: EventListQuerySchema.partial().default({}),
    execute: async (args) => EventsService.listEvents(args),
  },
  {
    name: 'events.get',
    description: 'Fetch a specific event by id.',
    keywords: ['event details', 'get event', 'fetch event'],
    inputSchema: z.object({ id: UuidSchema }),
    execute: async (args) => EventsService.getEvent(args.id),
  },
  {
    name: 'events.add',
    description: 'Create a new event and persist it in structured memory.',
    keywords: ['add event', 'create event', 'new event'],
    inputSchema: CreateEventSchema,
    execute: async (args, ctx) => EventsService.createEvent(args, ctx.correlationId),
  },
  {
    name: 'events.update',
    description: 'Update mutable fields of an existing event by id.',
    keywords: ['update event', 'change event', 'edit event'],
    inputSchema: EventUpdateArgsSchema,
    execute: async (args, ctx) => EventsService.updateEvent(args.id, args.patch, ctx.correlationId),
  },
  {
    name: 'events.delete',
    description: 'Delete an event by id.',
    keywords: ['delete event', 'remove event', 'cancel event'],
    inputSchema: EventDeleteArgsSchema,
    execute: async (args, ctx) => EventsService.deleteEvent(args.id, ctx.correlationId),
  },
  {
    name: 'memory.add',
    description: 'Add a memory note as plain text. Tags are optional and auto-derived from text.',
    keywords: ['remember', 'save memory', 'store fact', 'add note', 'preference'],
    inputSchema: MemoryAddArgsSchema,
    execute: async (args) => MemoryKvService.addMemory(args),
  },
  {
    name: 'memory.remove',
    description: 'Remove memory notes that exactly match the provided text.',
    keywords: ['forget', 'remove memory', 'delete memory', 'clear memory'],
    inputSchema: MemoryRemoveArgsSchema,
    execute: async (args) => MemoryKvService.removeMemory(args),
  },
];

const TOOLS_BY_NAME = new Map(TOOL_REGISTRY.map((tool) => [tool.name, tool]));

export function listRegisteredTools(): Array<{ name: string; description: string }> {
  return TOOL_REGISTRY.map(({ name, description }) => ({ name, description }));
}

export function getToolManifest(): ToolManifestEntry[] {
  return TOOL_REGISTRY.map(({ name, description, keywords, inputSchema }) => ({
    name,
    description,
    keywords,
    parameters: describeInputSchema(inputSchema),
  }));
}

function successResult(
  request: ToolCallRequest,
  result: unknown,
  startedAt: number,
): ToolCallSuccess {
  return {
    ok: true,
    correlationId: request.correlationId,
    tool: request.tool,
    result,
    durationMs: Date.now() - startedAt,
  };
}

function errorResult(
  request: ToolCallRequest,
  code: string,
  message: string,
  startedAt: number,
): ToolCallError {
  return {
    ok: false,
    correlationId: request.correlationId,
    tool: request.tool,
    error: { code, message },
    durationMs: Date.now() - startedAt,
  };
}

export async function executeToolCall(rawRequest: unknown): Promise<ToolCallResult> {
  const startedAt = Date.now();

  const parsedRequest = ToolCallRequestSchema.safeParse(rawRequest);
  if (!parsedRequest.success) {
    const result: ToolCallError = {
      ok: false,
      correlationId: '00000000-0000-0000-0000-000000000000',
      tool: 'unknown',
      error: {
        code: 'INVALID_TOOL_REQUEST',
        message: parsedRequest.error.flatten().formErrors.join('; ') || 'Invalid tool request envelope',
      },
      durationMs: Date.now() - startedAt,
    };
    await writeReplayEvent({
      correlationId: result.correlationId,
      category: 'tool',
      action: 'execute',
      status: 'error',
      request: rawRequest,
      response: result,
      error: result.error.message,
    });
    return result;
  }

  const request = parsedRequest.data;
  const tool = TOOLS_BY_NAME.get(request.tool);
  if (!tool) {
    const result = errorResult(request, 'TOOL_NOT_FOUND', `Unknown tool: ${request.tool}`, startedAt);
    await writeReplayEvent({
      correlationId: request.correlationId,
      category: 'tool',
      action: request.tool,
      status: 'error',
      request,
      response: result,
      error: result.error.message,
    });
    return result;
  }

  try {
    const args = tool.inputSchema.parse(request.args);
    const result = await tool.execute(args, { correlationId: request.correlationId });
    const success = successResult(request, result, startedAt);
    await writeReplayEvent({
      correlationId: request.correlationId,
      category: 'tool',
      action: request.tool,
      status: 'ok',
      request,
      response: success,
    });
    return success;
  } catch (err) {
    if (err instanceof ZodError) {
      const result = errorResult(
        request,
        'INVALID_TOOL_ARGS',
        err.flatten().formErrors.join('; ') || 'Invalid tool arguments',
        startedAt,
      );
      await writeReplayEvent({
        correlationId: request.correlationId,
        category: 'tool',
        action: request.tool,
        status: 'error',
        request,
        response: result,
        error: result.error.message,
      });
      return result;
    }
    const result = errorResult(request, 'TOOL_EXECUTION_FAILED', String(err), startedAt);
    await writeReplayEvent({
      correlationId: request.correlationId,
      category: 'tool',
      action: request.tool,
      status: 'error',
      request,
      response: result,
      error: result.error.message,
    });
    return result;
  }
}
