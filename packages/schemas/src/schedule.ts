import { z } from 'zod';
import { UuidSchema, IsoDateTimeSchema } from './common.js';

// ── Recurrence rule (RRULE-inspired subset) ────────────────────────────────

export const RecurrenceFrequencySchema = z.enum([
  'daily',
  'weekly',
  'monthly',
  'yearly',
]);

export const RecurrenceRuleSchema = z.object({
  frequency: RecurrenceFrequencySchema,
  interval: z.number().int().min(1).default(1),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).optional(), // 0=Sun
  endsAt: IsoDateTimeSchema.optional(),
  occurrences: z.number().int().min(1).optional(),
});

// ── Schedule ───────────────────────────────────────────────────────────────

export const ScheduleSchema = z.object({
  id: UuidSchema,
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  startsAt: IsoDateTimeSchema,
  recurrence: RecurrenceRuleSchema.optional(),
  assignedTo: UuidSchema.optional(),
  createdBy: UuidSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});

export const CreateScheduleSchema = ScheduleSchema.pick({
  title: true,
  description: true,
  startsAt: true,
  recurrence: true,
  assignedTo: true,
  createdBy: true,
});

export const UpdateScheduleSchema = CreateScheduleSchema
  .omit({ createdBy: true })
  .partial();

export type RecurrenceFrequency = z.infer<typeof RecurrenceFrequencySchema>;
export type RecurrenceRule = z.infer<typeof RecurrenceRuleSchema>;
export type Schedule = z.infer<typeof ScheduleSchema>;
export type CreateSchedule = z.infer<typeof CreateScheduleSchema>;
export type UpdateSchedule = z.infer<typeof UpdateScheduleSchema>;
