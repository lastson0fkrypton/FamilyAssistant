import { pool } from '../db.js';
import { randomUUID } from 'node:crypto';

export interface MemoryRecord {
  id: string;
  memory: string;
  tags: string[];
  updatedAt: string;
}

export interface AddMemoryInput {
  memory: string;
  tags?: string[];
}

export interface RemoveMemoryInput {
  memory: string;
}

function rowToMemory(row: Record<string, unknown>): MemoryRecord {
  return {
    id: row['id'] as string,
    memory: row['memory'] as string,
    tags: ((row['tags'] as string[] | null) ?? []).map(String),
    updatedAt: (row['updated_at'] as Date).toISOString(),
  };
}

export function tokenizeText(input: string): string[] {
  const tokens = input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);

  return [...new Set(tokens)];
}

function normalizeMemoryText(input: string): string {
  return input.trim().replace(/\s+/g, ' ').toLowerCase();
}

export async function addMemory(input: AddMemoryInput): Promise<MemoryRecord> {
  const memory = input.memory.trim().replace(/\s+/g, ' ');
  const autoTags = tokenizeText(input.memory).slice(0, 24);
  const userTags = (input.tags ?? [])
    .map((tag) => tag.toLowerCase().trim())
    .filter((tag) => tag.length > 0);
  const tags = [...new Set([...userTags, ...autoTags])];

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const normalizedMemory = normalizeMemoryText(memory);
    const existing = await client.query(
      `SELECT *
       FROM memories
       WHERE lower(regexp_replace(trim(memory), '\\s+', ' ', 'g')) = $1
       ORDER BY updated_at DESC, created_at DESC`,
      [normalizedMemory],
    );

    if (existing.rows.length > 0) {
      const primaryRow = existing.rows[0] as Record<string, unknown>;
      const primaryId = String(primaryRow['id']);
      const existingTags = ((primaryRow['tags'] as string[] | null) ?? []).map(String);
      const mergedTags = [...new Set([...existingTags, ...tags])];

      const { rows } = await client.query(
        `UPDATE memories
         SET memory = $2,
             tags = $3::jsonb,
             updated_at = now()
         WHERE id = $1
         RETURNING *`,
        [primaryId, memory, JSON.stringify(mergedTags)],
      );

      if (existing.rows.length > 1) {
        const duplicateIds = existing.rows
          .slice(1)
          .map((row) => String((row as Record<string, unknown>)['id']));

        await client.query(
          `DELETE FROM memories
           WHERE id = ANY($1::uuid[])`,
          [duplicateIds],
        );
      }

      await client.query('COMMIT');
      return rowToMemory(rows[0]);
    }

    const { rows } = await client.query(
      `INSERT INTO memories (id, memory, tags)
       VALUES ($1, $2, $3::jsonb)
       RETURNING *`,
      [randomUUID(), memory, JSON.stringify(tags)],
    );

    await client.query('COMMIT');
    return rowToMemory(rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function listMemories(limit = 200): Promise<MemoryRecord[]> {
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (lower(regexp_replace(trim(memory), '\\s+', ' ', 'g')))
       *
     FROM memories
     ORDER BY lower(regexp_replace(trim(memory), '\\s+', ' ', 'g')), updated_at DESC, created_at DESC
     LIMIT $1`,
    [limit],
  );

  return rows
    .map((row) => rowToMemory(row as Record<string, unknown>))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function removeMemory(input: RemoveMemoryInput): Promise<{ deleted: boolean; deletedCount: number }> {
  const { rowCount } = await pool.query(
    `DELETE FROM memories
     WHERE memory = $1`,
    [input.memory],
  );

  return {
    deleted: (rowCount ?? 0) > 0,
    deletedCount: rowCount ?? 0,
  };
}

export async function findTopMemoriesByTagTokens(tokens: string[], limit: number): Promise<Array<MemoryRecord & { matchedTagCount: number }>> {
  if (tokens.length === 0) {
    return [];
  }

  const { rows } = await pool.query(
    `WITH ranked_memories AS (
       SELECT
         m.*,
         COUNT(*)::int AS matched_tag_count,
         ROW_NUMBER() OVER (
           PARTITION BY lower(regexp_replace(trim(m.memory), '\\s+', ' ', 'g'))
           ORDER BY m.updated_at DESC, m.created_at DESC
         ) AS duplicate_rank
       FROM memories m
       JOIN LATERAL jsonb_array_elements_text(m.tags) AS tag(value) ON true
       WHERE tag.value = ANY($1::text[])
       GROUP BY m.id
       HAVING COUNT(*) > 0
     )
     SELECT *
     FROM ranked_memories
     WHERE duplicate_rank = 1
     ORDER BY matched_tag_count DESC, updated_at DESC
     LIMIT $2`,
    [tokens, limit],
  );

  return rows.map((row) => ({
    ...rowToMemory(row as Record<string, unknown>),
    matchedTagCount: Number((row as Record<string, unknown>)['matched_tag_count'] ?? 0),
  }));
}
