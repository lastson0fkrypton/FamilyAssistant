import { pool } from '../db.js';
import { audit } from '../db/audit.js';
import type {
  Event,
  CreateEvent,
  UpdateEvent,
  EventListQuery,
} from '@familyassistant/schemas';
import { v4 as uuidv4 } from 'uuid';

function rowToEvent(row: Record<string, unknown>): Event {
  return {
    id: row['id'] as string,
    title: row['title'] as string,
    description: row['description'] as string | undefined,
    startsAt: (row['starts_at'] as Date).toISOString(),
    endsAt: row['ends_at'] ? (row['ends_at'] as Date).toISOString() : undefined,
    allDay: row['all_day'] as boolean,
    location: row['location'] as string | undefined,
    createdBy: (row['created_by'] as string | null) ?? undefined,
    createdAt: (row['created_at'] as Date).toISOString(),
    updatedAt: (row['updated_at'] as Date).toISOString(),
  };
}

export async function listEvents(query: EventListQuery): Promise<Event[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (query.from) {
    params.push(query.from);
    conditions.push(`starts_at >= $${params.length}`);
  }
  if (query.to) {
    params.push(query.to);
    conditions.push(`starts_at <= $${params.length}`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(query.limit, query.offset);

  const { rows } = await pool.query(
    `SELECT * FROM events ${where}
     ORDER BY starts_at ASC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return rows.map(rowToEvent);
}

export async function getEvent(id: string): Promise<Event | null> {
  const { rows } = await pool.query('SELECT * FROM events WHERE id = $1', [id]);
  return rows.length > 0 ? rowToEvent(rows[0]) : null;
}

export async function createEvent(
  data: CreateEvent,
  correlationId: string,
): Promise<Event> {
  const { rows } = await pool.query(
    `INSERT INTO events (id, title, description, starts_at, ends_at, all_day, location, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING *`,
    [
      uuidv4(),
      data.title,
      data.description ?? null,
      data.startsAt,
      data.endsAt ?? null,
      data.allDay ?? false,
      data.location ?? null,
      null,
    ],
  );
  const event = rowToEvent(rows[0]);
  await audit({
    correlationId,
    actorId: undefined,
    action: 'create',
    resourceType: 'event',
    resourceId: event.id,
    payload: data,
  });
  return event;
}

export async function updateEvent(
  id: string,
  data: UpdateEvent,
  correlationId: string,
  actorId?: string,
): Promise<Event | null> {
  const fields: string[] = [];
  const params: unknown[] = [];

  const fieldMap: Partial<Record<keyof UpdateEvent, string>> = {
    title: 'title',
    description: 'description',
    startsAt: 'starts_at',
    endsAt: 'ends_at',
    allDay: 'all_day',
    location: 'location',
  };

  for (const [key, col] of Object.entries(fieldMap) as [keyof UpdateEvent, string][]) {
    if (key in data && data[key] !== undefined) {
      params.push(data[key]);
      fields.push(`${col} = $${params.length}`);
    }
  }

  if (fields.length === 0) {
    return getEvent(id);
  }

  params.push(new Date().toISOString());
  fields.push(`updated_at = $${params.length}`);
  params.push(id);

  const { rows } = await pool.query(
    `UPDATE events SET ${fields.join(', ')} WHERE id = $${params.length} RETURNING *`,
    params,
  );
  if (rows.length === 0) return null;

  const event = rowToEvent(rows[0]);
  await audit({
    correlationId,
    actorId,
    action: 'update',
    resourceType: 'event',
    resourceId: id,
    payload: data,
  });
  return event;
}

export async function deleteEvent(
  id: string,
  correlationId: string,
  actorId?: string,
): Promise<boolean> {
  const { rowCount } = await pool.query('DELETE FROM events WHERE id = $1', [id]);
  const deleted = (rowCount ?? 0) > 0;
  if (deleted) {
    await audit({
      correlationId,
      actorId,
      action: 'delete',
      resourceType: 'event',
      resourceId: id,
    });
  }
  return deleted;
}
