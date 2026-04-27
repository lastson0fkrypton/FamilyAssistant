import { z } from 'zod';
import { UuidSchema, IsoDateTimeSchema } from './common.js';

// ── Event ──────────────────────────────────────────────────────────────────

export const EventSchema = z.object({
  id: UuidSchema,
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  startsAt: IsoDateTimeSchema,
  endsAt: IsoDateTimeSchema.optional(),
  allDay: z.boolean().default(false),
  location: z.string().max(300).optional(),
  createdBy: UuidSchema.optional(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});

export const CreateEventSchema = EventSchema.pick({
  title: true,
  description: true,
  startsAt: true,
  endsAt: true,
  allDay: true,
  location: true,
});

export const UpdateEventSchema = CreateEventSchema.partial();

export const EventListQuerySchema = z.object({
  from: IsoDateTimeSchema.optional(),
  to: IsoDateTimeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type Event = z.infer<typeof EventSchema>;
export type CreateEvent = z.infer<typeof CreateEventSchema>;
export type UpdateEvent = z.infer<typeof UpdateEventSchema>;
export type EventListQuery = z.infer<typeof EventListQuerySchema>;
