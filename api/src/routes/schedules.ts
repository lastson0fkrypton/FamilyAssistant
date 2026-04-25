import { Router, type Request, type Response } from 'express';
import {
  CreateScheduleSchema,
  UpdateScheduleSchema,
} from '@familyassistant/schemas';
import * as SchedulesService from '../services/schedules.js';

export const schedulesRouter = Router();

function notFound(res: Response): void {
  res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Schedule not found' } });
}

// ── GET /schedules ────────────────────────────────────────────────────────────

schedulesRouter.get('/', async (_req: Request, res: Response) => {
  const schedules = await SchedulesService.listSchedules();
  res.json({ ok: true, data: schedules });
});

// ── GET /schedules/:id ────────────────────────────────────────────────────────

schedulesRouter.get('/:id', async (req: Request, res: Response) => {
  const schedule = await SchedulesService.getSchedule(String(req.params['id']));
  if (!schedule) { notFound(res); return; }
  res.json({ ok: true, data: schedule });
});

// ── POST /schedules ───────────────────────────────────────────────────────────

schedulesRouter.post('/', async (req: Request, res: Response) => {
  const parsed = CreateScheduleSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid schedule data', details: parsed.error.flatten() } });
    return;
  }
  const schedule = await SchedulesService.createSchedule(parsed.data, req.correlationId);
  res.status(201).json({ ok: true, data: schedule });
});

// ── PATCH /schedules/:id ──────────────────────────────────────────────────────

schedulesRouter.patch('/:id', async (req: Request, res: Response) => {
  const parsed = UpdateScheduleSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid update data', details: parsed.error.flatten() } });
    return;
  }
  const schedule = await SchedulesService.updateSchedule(String(req.params['id']), parsed.data, req.correlationId);
  if (!schedule) { notFound(res); return; }
  res.json({ ok: true, data: schedule });
});

// ── DELETE /schedules/:id ─────────────────────────────────────────────────────

schedulesRouter.delete('/:id', async (req: Request, res: Response) => {
  const deleted = await SchedulesService.deleteSchedule(String(req.params['id']), req.correlationId);
  if (!deleted) { notFound(res); return; }
  res.status(204).send();
});
