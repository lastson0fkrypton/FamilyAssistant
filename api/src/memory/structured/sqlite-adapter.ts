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
import type { StructuredMemoryAdapter } from './adapter.js';

function notImplemented(method: string): never {
  throw new Error(`SQLite structured memory adapter is not implemented yet (${method})`);
}

export class SqliteStructuredMemoryAdapter implements StructuredMemoryAdapter {
  async healthCheck(): Promise<void> { notImplemented('healthCheck'); }

  async createUser(_input: CreateUser): Promise<User> { return notImplemented('createUser'); }
  async getUser(_id: string): Promise<User | null> { return notImplemented('getUser'); }
  async updateUser(_id: string, _patch: UpdateUser): Promise<User | null> { return notImplemented('updateUser'); }
  async deleteUser(_id: string): Promise<boolean> { return notImplemented('deleteUser'); }

  async listEvents(_query: EventListQuery): Promise<Event[]> { return notImplemented('listEvents'); }
  async createEvent(_input: CreateEvent, _correlationId: string): Promise<Event> { return notImplemented('createEvent'); }
  async getEvent(_id: string): Promise<Event | null> { return notImplemented('getEvent'); }
  async updateEvent(_id: string, _patch: UpdateEvent, _correlationId: string, _actorId?: string): Promise<Event | null> {
    return notImplemented('updateEvent');
  }
  async deleteEvent(_id: string, _correlationId: string, _actorId?: string): Promise<boolean> {
    return notImplemented('deleteEvent');
  }

  async listSchedules(): Promise<Schedule[]> { return notImplemented('listSchedules'); }
  async createSchedule(_input: CreateSchedule, _correlationId: string): Promise<Schedule> {
    return notImplemented('createSchedule');
  }
  async getSchedule(_id: string): Promise<Schedule | null> { return notImplemented('getSchedule'); }
  async updateSchedule(_id: string, _patch: UpdateSchedule, _correlationId: string, _actorId?: string): Promise<Schedule | null> {
    return notImplemented('updateSchedule');
  }
  async deleteSchedule(_id: string, _correlationId: string, _actorId?: string): Promise<boolean> {
    return notImplemented('deleteSchedule');
  }
}
