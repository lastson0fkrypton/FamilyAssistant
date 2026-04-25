import type {
  User,
  CreateUser,
  UpdateUser,
  Event,
  CreateEvent,
  UpdateEvent,
  EventListQuery,
  Schedule,
  CreateSchedule,
  UpdateSchedule,
} from '@familyassistant/schemas';

export interface StructuredMemoryAdapter {
  // ── Lifecycle ─────────────────────────────────────────────────────────────
  healthCheck(): Promise<void>;

  // ── Users ─────────────────────────────────────────────────────────────────
  createUser(input: CreateUser): Promise<User>;
  getUser(id: string): Promise<User | null>;
  updateUser(id: string, patch: UpdateUser): Promise<User | null>;
  deleteUser(id: string): Promise<boolean>;

  // ── Events ────────────────────────────────────────────────────────────────
  listEvents(query: EventListQuery): Promise<Event[]>;
  createEvent(input: CreateEvent, correlationId: string): Promise<Event>;
  getEvent(id: string): Promise<Event | null>;
  updateEvent(id: string, patch: UpdateEvent, correlationId: string, actorId?: string): Promise<Event | null>;
  deleteEvent(id: string, correlationId: string, actorId?: string): Promise<boolean>;

  // ── Schedules ─────────────────────────────────────────────────────────────
  listSchedules(): Promise<Schedule[]>;
  createSchedule(input: CreateSchedule, correlationId: string): Promise<Schedule>;
  getSchedule(id: string): Promise<Schedule | null>;
  updateSchedule(id: string, patch: UpdateSchedule, correlationId: string, actorId?: string): Promise<Schedule | null>;
  deleteSchedule(id: string, correlationId: string, actorId?: string): Promise<boolean>;
}
