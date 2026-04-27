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

export async function addMemory(input: AddMemoryInput): Promise<MemoryRecord> {
  const autoTags = tokenizeText(input.memory).slice(0, 24);
  const userTags = (input.tags ?? [])
    .map((tag) => tag.toLowerCase().trim())
    .filter((tag) => tag.length > 0);
  const tags = [...new Set([...userTags, ...autoTags])];

  const { rows } = await pool.query(
    `INSERT INTO memories (id, memory, tags)
     VALUES ($1, $2, $3::jsonb)
     RETURNING *`,
    [randomUUID(), input.memory, JSON.stringify(tags)],
  );

  return rowToMemory(rows[0]);
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
    `SELECT
       m.*,
       COUNT(*)::int AS matched_tag_count
     FROM memories m
     JOIN LATERAL jsonb_array_elements_text(m.tags) AS tag(value) ON true
     WHERE tag.value = ANY($1::text[])
     GROUP BY m.id
     HAVING COUNT(*) > 0
     ORDER BY matched_tag_count DESC, m.updated_at DESC
     LIMIT $2`,
    [tokens, limit],
  );

  return rows.map((row) => ({
    ...rowToMemory(row as Record<string, unknown>),
    matchedTagCount: Number((row as Record<string, unknown>)['matched_tag_count'] ?? 0),
  }));
}
