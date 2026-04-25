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

interface ToolContext {
  correlationId: string;
}

interface RegisteredTool<TInput extends ZodTypeAny = ZodTypeAny> {
  name: string;
  description: string;
  inputSchema: TInput;
  execute: (args: z.infer<TInput>, context: ToolContext) => Promise<unknown>;
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

const TOOL_REGISTRY: RegisteredTool[] = [
  {
    name: 'events.list',
    description: 'List household events in time order with optional date filtering.',
    inputSchema: EventListQuerySchema.partial().default({}),
    execute: async (args) => EventsService.listEvents(args),
  },
  {
    name: 'events.get',
    description: 'Fetch a specific event by id.',
    inputSchema: z.object({ id: UuidSchema }),
    execute: async (args) => EventsService.getEvent(args.id),
  },
  {
    name: 'events.create',
    description: 'Create a new event and persist it in structured memory.',
    inputSchema: CreateEventSchema,
    execute: async (args, ctx) => EventsService.createEvent(args, ctx.correlationId),
  },
  {
    name: 'events.update',
    description: 'Update mutable fields of an existing event by id.',
    inputSchema: EventUpdateArgsSchema,
    execute: async (args, ctx) => EventsService.updateEvent(args.id, args.patch, ctx.correlationId),
  },
  {
    name: 'events.delete',
    description: 'Delete an event by id.',
    inputSchema: EventDeleteArgsSchema,
    execute: async (args, ctx) => EventsService.deleteEvent(args.id, ctx.correlationId),
  },
  {
    name: 'schedules.list',
    description: 'List household schedules in time order.',
    inputSchema: z.object({}).default({}),
    execute: async () => SchedulesService.listSchedules(),
  },
  {
    name: 'schedules.get',
    description: 'Fetch a specific schedule by id.',
    inputSchema: z.object({ id: UuidSchema }),
    execute: async (args) => SchedulesService.getSchedule(args.id),
  },
  {
    name: 'schedules.create',
    description: 'Create a new schedule and persist recurrence metadata.',
    inputSchema: CreateScheduleSchema,
    execute: async (args, ctx) => SchedulesService.createSchedule(args, ctx.correlationId),
  },
  {
    name: 'schedules.update',
    description: 'Update mutable fields of an existing schedule by id.',
    inputSchema: ScheduleUpdateArgsSchema,
    execute: async (args, ctx) => SchedulesService.updateSchedule(args.id, args.patch, ctx.correlationId),
  },
  {
    name: 'schedules.delete',
    description: 'Delete a schedule by id.',
    inputSchema: ScheduleDeleteArgsSchema,
    execute: async (args, ctx) => SchedulesService.deleteSchedule(args.id, ctx.correlationId),
  },
];

const TOOLS_BY_NAME = new Map(TOOL_REGISTRY.map((tool) => [tool.name, tool]));

export function listRegisteredTools(): Array<{ name: string; description: string }> {
  return TOOL_REGISTRY.map(({ name, description }) => ({ name, description }));
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
    return {
      ok: false,
      correlationId: '00000000-0000-0000-0000-000000000000',
      tool: 'unknown',
      error: {
        code: 'INVALID_TOOL_REQUEST',
        message: parsedRequest.error.flatten().formErrors.join('; ') || 'Invalid tool request envelope',
      },
      durationMs: Date.now() - startedAt,
    };
  }

  const request = parsedRequest.data;
  const tool = TOOLS_BY_NAME.get(request.tool);
  if (!tool) {
    return errorResult(request, 'TOOL_NOT_FOUND', `Unknown tool: ${request.tool}`, startedAt);
  }

  try {
    const args = tool.inputSchema.parse(request.args);
    const result = await tool.execute(args, { correlationId: request.correlationId });
    return successResult(request, result, startedAt);
  } catch (err) {
    if (err instanceof ZodError) {
      return errorResult(
        request,
        'INVALID_TOOL_ARGS',
        err.flatten().formErrors.join('; ') || 'Invalid tool arguments',
        startedAt,
      );
    }
    return errorResult(request, 'TOOL_EXECUTION_FAILED', String(err), startedAt);
  }
}
