import { z } from 'zod';
import { UuidSchema, IsoDateTimeSchema } from './common.js';

// ── User ───────────────────────────────────────────────────────────────────

export const UserSchema = z.object({
  id: UuidSchema,
  name: z.string().min(1).max(100),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});

export const CreateUserSchema = UserSchema.pick({ name: true });

export const UpdateUserSchema = CreateUserSchema.partial();

export type User = z.infer<typeof UserSchema>;
export type CreateUser = z.infer<typeof CreateUserSchema>;
export type UpdateUser = z.infer<typeof UpdateUserSchema>;
