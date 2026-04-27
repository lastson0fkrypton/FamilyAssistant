import pg from 'pg';
import { pool } from '../db.js';
import { logger } from '../logger.js';

/**
 * Runs all pending migrations in order.
 * Uses a simple migrations table as the state tracker — no external tool needed.
 */
export async function runMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id        SERIAL PRIMARY KEY,
        name      TEXT NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    for (const migration of MIGRATIONS) {
      const { rows } = await client.query(
        'SELECT id FROM schema_migrations WHERE name = $1',
        [migration.name],
      );
      if (rows.length > 0) continue;

      logger.info({ migration: migration.name }, 'Applying migration');
      await client.query(migration.sql);
      await client.query(
        'INSERT INTO schema_migrations (name) VALUES ($1)',
        [migration.name],
      );
    }

    await client.query('COMMIT');
    logger.info('Migrations complete');
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error({ err }, 'Migration failed — rolled back');
    throw err;
  } finally {
    client.release();
  }
}

// ── Migration definitions (append-only, never edit existing entries) ─────────

const MIGRATIONS: Array<{ name: string; sql: string }> = [
  {
    name: '001_create_users',
    sql: `
      CREATE TABLE IF NOT EXISTS users (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name        TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `,
  },
  {
    name: '002_create_events',
    sql: `
      CREATE TABLE IF NOT EXISTS events (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        title       TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
        description TEXT CHECK (char_length(description) <= 2000),
        starts_at   TIMESTAMPTZ NOT NULL,
        ends_at     TIMESTAMPTZ,
        all_day     BOOLEAN NOT NULL DEFAULT false,
        location    TEXT CHECK (char_length(location) <= 300),
        created_by  UUID NOT NULL REFERENCES users(id),
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS events_starts_at_idx ON events(starts_at);
      CREATE INDEX IF NOT EXISTS events_created_by_idx ON events(created_by);
    `,
  },
  {
    name: '003_create_schedules',
    sql: `
      CREATE TABLE IF NOT EXISTS schedules (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        title         TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
        description   TEXT CHECK (char_length(description) <= 2000),
        starts_at     TIMESTAMPTZ NOT NULL,
        recurrence    JSONB,
        assigned_to   UUID REFERENCES users(id),
        created_by    UUID NOT NULL REFERENCES users(id),
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS schedules_starts_at_idx ON schedules(starts_at);
      CREATE INDEX IF NOT EXISTS schedules_assigned_to_idx ON schedules(assigned_to);
    `,
  },
  {
    name: '004_create_audit_log',
    sql: `
      CREATE TABLE IF NOT EXISTS audit_log (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        correlation_id  UUID NOT NULL,
        actor_id        UUID,
        action          TEXT NOT NULL,
        resource_type   TEXT NOT NULL,
        resource_id     UUID,
        payload         JSONB,
        occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS audit_log_occurred_at_idx ON audit_log(occurred_at);
      CREATE INDEX IF NOT EXISTS audit_log_resource_idx ON audit_log(resource_type, resource_id);
    `,
  },
  {
    name: '005_create_memory_kv',
    sql: `
      CREATE TABLE IF NOT EXISTS memory_kv (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        namespace   TEXT NOT NULL CHECK (char_length(namespace) BETWEEN 1 AND 80),
        key         TEXT NOT NULL CHECK (char_length(key) BETWEEN 1 AND 160),
        value       TEXT NOT NULL CHECK (char_length(value) <= 12000),
        tags        JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE(namespace, key)
      );

      CREATE INDEX IF NOT EXISTS memory_kv_namespace_idx ON memory_kv(namespace);
      CREATE INDEX IF NOT EXISTS memory_kv_updated_at_idx ON memory_kv(updated_at DESC);
    `,
  },
];
