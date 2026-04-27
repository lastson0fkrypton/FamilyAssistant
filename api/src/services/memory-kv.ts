import { pool } from '../db.js';

export interface MemoryKvRecord {
  namespace: string;
  key: string;
  value: string;
  tags: string[];
  updatedAt: string;
}

export interface SaveMemoryKvInput {
  namespace: string;
  key: string;
  value: string;
  tags?: string[];
}

export interface SearchMemoryKvInput {
  namespace?: string;
  query: string;
  limit: number;
}

function rowToMemoryKv(row: Record<string, unknown>): MemoryKvRecord {
  return {
    namespace: row['namespace'] as string,
    key: row['key'] as string,
    value: row['value'] as string,
    tags: ((row['tags'] as string[] | null) ?? []).map(String),
    updatedAt: (row['updated_at'] as Date).toISOString(),
  };
}

export async function saveMemoryKv(input: SaveMemoryKvInput): Promise<MemoryKvRecord> {
  const { rows } = await pool.query(
    `INSERT INTO memory_kv (namespace, key, value, tags)
     VALUES ($1, $2, $3, $4::jsonb)
     ON CONFLICT (namespace, key)
     DO UPDATE SET value = EXCLUDED.value,
                   tags = EXCLUDED.tags,
                   updated_at = now()
     RETURNING *`,
    [input.namespace, input.key, input.value, JSON.stringify(input.tags ?? [])],
  );

  return rowToMemoryKv(rows[0]);
}

export async function loadMemoryKv(namespace: string, key: string): Promise<MemoryKvRecord | null> {
  const { rows } = await pool.query(
    `SELECT * FROM memory_kv
     WHERE namespace = $1 AND key = $2`,
    [namespace, key],
  );

  return rows.length > 0 ? rowToMemoryKv(rows[0]) : null;
}

export async function searchMemoryKv(input: SearchMemoryKvInput): Promise<MemoryKvRecord[]> {
  const whereParts: string[] = [];
  const params: unknown[] = [];

  if (input.namespace) {
    params.push(input.namespace);
    whereParts.push(`namespace = $${params.length}`);
  }

  if (input.query.trim().length > 0) {
    const rawQuery = input.query.trim();
    const fuzzyQuery = rawQuery.replace(/\s+/g, '%');

    params.push(`%${rawQuery}%`);
    const rawSearchParam = `$${params.length}`;

    params.push(`%${fuzzyQuery}%`);
    const fuzzySearchParam = `$${params.length}`;

    whereParts.push(`(
      key ILIKE ${rawSearchParam}
      OR REPLACE(key, '_', ' ') ILIKE ${fuzzySearchParam}
      OR value ILIKE ${rawSearchParam}
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(tags) AS t(tag)
        WHERE t.tag ILIKE ${rawSearchParam}
      )
    )`);
  }

  params.push(input.limit);
  const sql = `
    SELECT *
    FROM memory_kv
    WHERE ${whereParts.join(' AND ')}
    ORDER BY updated_at DESC
    LIMIT $${params.length}
  `;

  const { rows } = await pool.query(sql, params);
  return rows.map(rowToMemoryKv);
}

export async function deleteMemoryKv(namespace: string, key: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `DELETE FROM memory_kv
     WHERE namespace = $1 AND key = $2`,
    [namespace, key],
  );

  return (rowCount ?? 0) > 0;
}
