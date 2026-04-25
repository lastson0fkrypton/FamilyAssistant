import { pool } from '../db.js';
import { logger } from '../logger.js';
import { v4 as uuidv4 } from 'uuid';

export interface AuditEntry {
  correlationId: string;
  actorId?: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  payload?: unknown;
}

/**
 * Writes a single audit entry to the audit_log table.
 * Fire-and-forget safe: logs on failure but never throws.
 */
export async function audit(entry: AuditEntry): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO audit_log
         (id, correlation_id, actor_id, action, resource_type, resource_id, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        uuidv4(),
        entry.correlationId,
        entry.actorId ?? null,
        entry.action,
        entry.resourceType,
        entry.resourceId ?? null,
        entry.payload ? JSON.stringify(entry.payload) : null,
      ],
    );
  } catch (err) {
    logger.error({ err, entry }, 'Failed to write audit log entry');
  }
}
