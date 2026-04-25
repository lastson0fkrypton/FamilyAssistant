import { Router, type Request, type Response } from 'express';
import {
  CreateEventSchema,
  UpdateEventSchema,
  EventListQuerySchema,
} from '@familyassistant/schemas';
import * as EventsService from '../services/events.js';

export const eventsRouter = Router();

function notFound(res: Response): void {
  res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Event not found' } });
}

// ── GET /events ─────────────────────────────────────────────────────────────

eventsRouter.get('/', async (req: Request, res: Response) => {
  const parsed = EventListQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid query parameters', details: parsed.error.flatten() } });
    return;
  }
  const events = await EventsService.listEvents(parsed.data);
  res.json({ ok: true, data: events });
});

// ── GET /events/:id ──────────────────────────────────────────────────────────

eventsRouter.get('/:id', async (req: Request, res: Response) => {
  const event = await EventsService.getEvent(String(req.params['id']));
  if (!event) { notFound(res); return; }
  res.json({ ok: true, data: event });
});

// ── POST /events ─────────────────────────────────────────────────────────────

eventsRouter.post('/', async (req: Request, res: Response) => {
  const parsed = CreateEventSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid event data', details: parsed.error.flatten() } });
    return;
  }
  const event = await EventsService.createEvent(parsed.data, req.correlationId);
  res.status(201).json({ ok: true, data: event });
});

// ── PATCH /events/:id ────────────────────────────────────────────────────────

eventsRouter.patch('/:id', async (req: Request, res: Response) => {
  const parsed = UpdateEventSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid update data', details: parsed.error.flatten() } });
    return;
  }
  const event = await EventsService.updateEvent(String(req.params['id']), parsed.data, req.correlationId);
  if (!event) { notFound(res); return; }
  res.json({ ok: true, data: event });
});

// ── DELETE /events/:id ───────────────────────────────────────────────────────

eventsRouter.delete('/:id', async (req: Request, res: Response) => {
  const deleted = await EventsService.deleteEvent(String(req.params['id']), req.correlationId);
  if (!deleted) { notFound(res); return; }
  res.status(204).send();
});
