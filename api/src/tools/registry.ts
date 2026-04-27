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
  CreateScheduleSchema,
  UpdateScheduleSchema,
} from '@familyassistant/schemas';
import * as EventsService from '../services/events.js';
import * as SchedulesService from '../services/schedules.js';
import * as MemoryKvService from '../services/memory-kv.js';
import * as SemanticMemoryService from '../services/semantic-memory.js';
import { writeReplayEvent } from '../observability/replay.js';

interface ToolContext {
  correlationId: string;
}

interface RegisteredTool<TInput extends ZodTypeAny = ZodTypeAny> {
  name: string;
  description: string;
  /** Words and phrases that signal the user wants this tool invoked. */
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

const ScheduleUpdateArgsSchema = z.object({
  id: UuidSchema,
  patch: UpdateScheduleSchema,
});

const ScheduleDeleteArgsSchema = z.object({
  id: UuidSchema,
});

const MemoryNamespaceSchema = z.string().min(1).max(80).default('household');

const MemoryKvSaveArgsSchema = z.object({
  namespace: MemoryNamespaceSchema,
  key: z.string().min(1).max(160),
  value: z.string().min(1).max(12000),
  tags: z.array(z.string().min(1).max(64)).default([]),
});

const MemoryKvLoadArgsSchema = z.object({
  namespace: MemoryNamespaceSchema,
  key: z.string().min(1).max(160),
});

const MemoryKvDeleteArgsSchema = MemoryKvLoadArgsSchema;

const MemoryKvSearchArgsSchema = z.object({
  namespace: MemoryNamespaceSchema.optional(),
  query: z.string().max(400).default(''),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

const SemanticMemorySaveArgsSchema = z.object({
  content: z.string().min(1).max(12000),
  kind: z.enum(['preference', 'conversation_summary', 'context_note']).default('context_note'),
  tags: z.array(z.string().min(1).max(64)).default([]),
  userId: UuidSchema.optional(),
  sessionId: UuidSchema.optional(),
  metadata: z.record(z.unknown()).default({}),
});

const SemanticMemorySearchArgsSchema = z.object({
  query: z.string().min(1).max(400),
  limit: z.coerce.number().int().min(1).max(50).default(5),
  userId: UuidSchema.optional(),
  sessionId: UuidSchema.optional(),
  kinds: z.array(z.enum(['preference', 'conversation_summary', 'context_note'])).optional(),
  tags: z.array(z.string().min(1).max(64)).optional(),
});

const SemanticMemoryDeleteArgsSchema = z.union([
  z.object({ id: UuidSchema }),
  z.object({ sessionId: UuidSchema }),
  z.object({ userId: UuidSchema }),
]);

const TOOL_REGISTRY: RegisteredTool[] = [
  {
    name: 'events.list',
    description: 'List household events in time order with optional date filtering.',
    keywords: ['events', 'upcoming', 'what\'s on', 'plans', 'appointments', 'calendar', 'schedule', 'list events', 'show events', 'coming up'],
    inputSchema: EventListQuerySchema.partial().default({}),
    execute: async (args) => EventsService.listEvents(args),
  },
  {
    name: 'events.get',
    description: 'Fetch a specific event by id.',
    keywords: ['event details', 'get event', 'fetch event', 'event id'],
    inputSchema: z.object({ id: UuidSchema }),
    execute: async (args) => EventsService.getEvent(args.id),
  },
  {
    name: 'events.create',
    description: 'Create a new event and persist it in structured memory.',
    keywords: ['create event', 'add event', 'new event', 'schedule event', 'add to calendar', 'book event', 'plan event'],
    inputSchema: CreateEventSchema,
    execute: async (args, ctx) => EventsService.createEvent(args, ctx.correlationId),
  },
  {
    name: 'events.update',
    description: 'Update mutable fields of an existing event by id.',
    keywords: ['update event', 'change event', 'edit event', 'reschedule', 'move event', 'modify event'],
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
    name: 'schedules.list',
    description: 'List household schedules in time order.',
    keywords: ['schedules', 'recurring', 'routines', 'weekly', 'daily schedule', 'list schedules', 'show schedules'],
    inputSchema: z.object({}).default({}),
    execute: async () => SchedulesService.listSchedules(),
  },
  {
    name: 'schedules.get',
    description: 'Fetch a specific schedule by id.',
    keywords: ['schedule details', 'get schedule', 'fetch schedule'],
    inputSchema: z.object({ id: UuidSchema }),
    execute: async (args) => SchedulesService.getSchedule(args.id),
  },
  {
    name: 'schedules.create',
    description: 'Create a new schedule and persist recurrence metadata.',
    keywords: ['create schedule', 'new schedule', 'recurring event', 'set routine', 'add routine', 'weekly task', 'daily task'],
    inputSchema: CreateScheduleSchema,
    execute: async (args, ctx) => SchedulesService.createSchedule(args, ctx.correlationId),
  },
  {
    name: 'schedules.update',
    description: 'Update mutable fields of an existing schedule by id.',
    keywords: ['update schedule', 'change schedule', 'modify schedule', 'edit routine'],
    inputSchema: ScheduleUpdateArgsSchema,
    execute: async (args, ctx) => SchedulesService.updateSchedule(args.id, args.patch, ctx.correlationId),
  },
  {
    name: 'schedules.delete',
    description: 'Delete a schedule by id.',
    keywords: ['delete schedule', 'remove schedule', 'cancel schedule', 'stop routine'],
    inputSchema: ScheduleDeleteArgsSchema,
    execute: async (args, ctx) => SchedulesService.deleteSchedule(args.id, ctx.correlationId),
  },
  {
    name: 'memory.kv.save',
    description: 'Save or update a key-value memory item — facts, preferences, and attributes about household members.',
    keywords: ['remember', 'save', 'store', 'update', 'set', 'change', 'note', 'record', 'likes', 'favorite', 'preference', 'tell me', 'their'],
    inputSchema: MemoryKvSaveArgsSchema,
    execute: async (args) => MemoryKvService.saveMemoryKv(args),
  },
  {
    name: 'memory.kv.load',
    description: 'Load a key-value memory item by exact namespace and key.',
    keywords: ['what is', 'what\'s', 'tell me', 'lookup', 'fetch memory', 'find fact'],
    inputSchema: MemoryKvLoadArgsSchema,
    execute: async (args) => MemoryKvService.loadMemoryKv(args.namespace, args.key),
  },
  {
    name: 'memory.kv.delete',
    description: 'Delete a key-value memory item by namespace and key.',
    keywords: ['forget', 'delete memory', 'remove memory', 'clear fact'],
    inputSchema: MemoryKvDeleteArgsSchema,
    execute: async (args) => ({ deleted: await MemoryKvService.deleteMemoryKv(args.namespace, args.key) }),
  },
  {
    name: 'memory.kv.search',
    description: 'Search key-value memory items by keyword across keys, values, and tags.',
    keywords: ['search memory', 'find preference', 'look up', 'what do you know', 'household memory', 'people', 'members'],
    inputSchema: MemoryKvSearchArgsSchema,
    execute: async (args) => MemoryKvService.searchMemoryKv(args),
  },
  {
    name: 'memory.semantic.save',
    description: 'Store a semantic memory entry for later vector similarity retrieval.',
    keywords: ['save context', 'note this', 'remember this conversation', 'store note'],
    inputSchema: SemanticMemorySaveArgsSchema,
    execute: async (args) => SemanticMemoryService.saveSemanticMemory(args),
  },
  {
    name: 'memory.semantic.search',
    description: 'Search semantic memory using vector similarity over query text.',
    keywords: ['search notes', 'similar topics', 'related conversations', 'context search'],
    inputSchema: SemanticMemorySearchArgsSchema,
    execute: async (args) => SemanticMemoryService.searchSemanticMemory(args),
  },
  {
    name: 'memory.semantic.delete',
    description: 'Delete semantic memory by entry id, session id, or user id.',
    keywords: ['delete note', 'remove context', 'clear semantic memory'],
    inputSchema: SemanticMemoryDeleteArgsSchema,
    execute: async (args) => {
      if ('id' in args) {
        return { deleted: await SemanticMemoryService.deleteSemanticMemoryById(args.id) };
      }
      if ('sessionId' in args) {
        return { deletedCount: await SemanticMemoryService.deleteSemanticMemoryBySession(args.sessionId) };
      }
      return { deletedCount: await SemanticMemoryService.deleteSemanticMemoryByUser(args.userId) };
    },
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
