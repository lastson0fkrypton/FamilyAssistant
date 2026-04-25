import { pool } from '../db.js';
import { audit } from '../db/audit.js';
import type {
  Schedule,
  CreateSchedule,
  UpdateSchedule,
} from '@familyassistant/schemas';
import { v4 as uuidv4 } from 'uuid';

function rowToSchedule(row: Record<string, unknown>): Schedule {
  return {
    id: row['id'] as string,
    title: row['title'] as string,
    description: row['description'] as string | undefined,
    startsAt: (row['starts_at'] as Date).toISOString(),
    recurrence: row['recurrence'] as Schedule['recurrence'] | undefined,
    assignedTo: row['assigned_to'] as string | undefined,
    createdBy: row['created_by'] as string,
    createdAt: (row['created_at'] as Date).toISOString(),
    updatedAt: (row['updated_at'] as Date).toISOString(),
  };
}

export async function listSchedules(): Promise<Schedule[]> {
  const { rows } = await pool.query(
    'SELECT * FROM schedules ORDER BY starts_at ASC',
  );
  return rows.map(rowToSchedule);
}

export async function getSchedule(id: string): Promise<Schedule | null> {
  const { rows } = await pool.query(
    'SELECT * FROM schedules WHERE id = $1',
    [id],
  );
  return rows.length > 0 ? rowToSchedule(rows[0]) : null;
}

export async function createSchedule(
  data: CreateSchedule,
  correlationId: string,
): Promise<Schedule> {
  const { rows } = await pool.query(
    `INSERT INTO schedules
       (id, title, description, starts_at, recurrence, assigned_to, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING *`,
    [
      uuidv4(),
      data.title,
      data.description ?? null,
      data.startsAt,
      data.recurrence ? JSON.stringify(data.recurrence) : null,
      data.assignedTo ?? null,
      data.createdBy,
    ],
  );
  const schedule = rowToSchedule(rows[0]);
  await audit({
    correlationId,
    actorId: data.createdBy,
    action: 'create',
    resourceType: 'schedule',
    resourceId: schedule.id,
    payload: data,
  });
  return schedule;
}

export async function updateSchedule(
  id: string,
  data: UpdateSchedule,
  correlationId: string,
  actorId?: string,
): Promise<Schedule | null> {
  const fields: string[] = [];
  const params: unknown[] = [];

  if (data.title !== undefined) {
    params.push(data.title);
    fields.push(`title = $${params.length}`);
  }
  if (data.description !== undefined) {
    params.push(data.description);
    fields.push(`description = $${params.length}`);
  }
  if (data.startsAt !== undefined) {
    params.push(data.startsAt);
    fields.push(`starts_at = $${params.length}`);
  }
  if (data.recurrence !== undefined) {
    params.push(JSON.stringify(data.recurrence));
    fields.push(`recurrence = $${params.length}`);
  }
  if (data.assignedTo !== undefined) {
    params.push(data.assignedTo);
    fields.push(`assigned_to = $${params.length}`);
  }

  if (fields.length === 0) return getSchedule(id);

  params.push(new Date().toISOString());
  fields.push(`updated_at = $${params.length}`);
  params.push(id);

  const { rows } = await pool.query(
    `UPDATE schedules SET ${fields.join(', ')} WHERE id = $${params.length} RETURNING *`,
    params,
  );
  if (rows.length === 0) return null;

  const schedule = rowToSchedule(rows[0]);
  await audit({
    correlationId,
    actorId,
    action: 'update',
    resourceType: 'schedule',
    resourceId: id,
    payload: data,
  });
  return schedule;
}

export async function deleteSchedule(
  id: string,
  correlationId: string,
  actorId?: string,
): Promise<boolean> {
  const { rowCount } = await pool.query(
    'DELETE FROM schedules WHERE id = $1',
    [id],
  );
  const deleted = (rowCount ?? 0) > 0;
  if (deleted) {
    await audit({
      correlationId,
      actorId,
      action: 'delete',
      resourceType: 'schedule',
      resourceId: id,
    });
  }
  return deleted;
}
