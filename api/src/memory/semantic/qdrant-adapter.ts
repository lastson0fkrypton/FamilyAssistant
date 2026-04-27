import type {
  SemanticMemoryEntry,
  SemanticUpsertRequest,
  SemanticQueryRequest,
  SemanticQueryResult,
} from '@familyassistant/schemas';
import type { SemanticMemoryAdapter } from './adapter.js';
import { config } from '../../config.js';

interface QdrantPoint {
  id: string;
  payload?: Record<string, unknown>;
  score?: number;
}

interface QdrantSearchResponse {
  result?: QdrantPoint[];
}

interface QdrantRetrieveResponse {
  result?: QdrantPoint[];
}

function toPayload(entry: SemanticMemoryEntry): Record<string, unknown> {
  return {
    id: entry.id,
    userId: entry.userId,
    sessionId: entry.sessionId,
    kind: entry.kind,
    content: entry.content,
    tags: entry.tags,
    source: entry.source,
    timestamp: entry.timestamp,
    metadata: entry.metadata,
  };
}

function payloadToEntry(payload: Record<string, unknown> | undefined): SemanticMemoryEntry | null {
  if (!payload) return null;

  const id = payload['id'];
  const kind = payload['kind'];
  const content = payload['content'];
  const source = payload['source'];
  const timestamp = payload['timestamp'];

  if (
    typeof id !== 'string' ||
    typeof kind !== 'string' ||
    typeof content !== 'string' ||
    typeof source !== 'string' ||
    typeof timestamp !== 'string'
  ) {
    return null;
  }

  return {
    id,
    userId: typeof payload['userId'] === 'string' ? payload['userId'] : undefined,
    sessionId: typeof payload['sessionId'] === 'string' ? payload['sessionId'] : undefined,
    kind: kind as SemanticMemoryEntry['kind'],
    content,
    tags: Array.isArray(payload['tags']) ? payload['tags'].map(String) : [],
    source: source as SemanticMemoryEntry['source'],
    timestamp,
    metadata: (payload['metadata'] as Record<string, unknown>) ?? {},
  };
}


export class QdrantSemanticMemoryAdapter implements SemanticMemoryAdapter {
  private readonly baseUrl: string;
  private readonly collection: string;
  private readonly vectorSize: number;
  private collectionReady = false;

  constructor() {
    this.baseUrl = config.QDRANT_URL;
    this.collection = config.QDRANT_COLLECTION;
    this.vectorSize = config.QDRANT_VECTOR_SIZE;
  }

  async healthCheck(): Promise<void> {
    await this.request('/collections', { method: 'GET' });
    await this.ensureCollection();
  }

  async upsert(input: SemanticUpsertRequest): Promise<void> {
    await this.ensureCollection();

    await this.request(`/collections/${this.collection}/points?wait=true`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        points: [
          {
            id: input.entry.id,
            vector: input.embedding,
            payload: toPayload(input.entry),
          },
        ],
      }),
    });
  }

  async query(input: SemanticQueryRequest): Promise<SemanticQueryResult[]> {
    await this.ensureCollection();

    const must: Array<Record<string, unknown>> = [];
    if (input.userId) {
      must.push({ key: 'userId', match: { value: input.userId } });
    }
    if (input.sessionId) {
      must.push({ key: 'sessionId', match: { value: input.sessionId } });
    }

    const body: Record<string, unknown> = {
      vector: input.queryEmbedding,
      limit: input.limit,
      with_payload: true,
      with_vector: false,
    };

    if (must.length > 0) {
      body['filter'] = { must };
    }

    const response = await this.request<QdrantSearchResponse>(
      `/collections/${this.collection}/points/search`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
    );

    const rows: SemanticQueryResult[] = [];
    for (const row of response.result ?? []) {
      const entry = payloadToEntry(row.payload);
      if (!entry) continue;
      if (input.kinds && !input.kinds.includes(entry.kind)) continue;
      if (input.tags && input.tags.length > 0) {
        const hasTag = input.tags.some((tag) => entry.tags.includes(tag));
        if (!hasTag) continue;
      }

      rows.push({
        entry,
        score: typeof row.score === 'number' ? row.score : 0,
      });
    }

    return rows.slice(0, input.limit);
  }

  async deleteById(id: string): Promise<boolean> {
    await this.ensureCollection();

    const response = await this.request<QdrantRetrieveResponse>(
      `/collections/${this.collection}/points`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids: [id], with_payload: true, with_vector: false }),
      },
    );

    const existed = (response.result ?? []).length > 0;

    await this.request(`/collections/${this.collection}/points/delete?wait=true`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ points: [id] }),
    });

    return existed;
  }

  async deleteBySession(sessionId: string): Promise<number> {
    await this.ensureCollection();
    const count = await this.countByFilter({ must: [{ key: 'sessionId', match: { value: sessionId } }] });

    await this.request(`/collections/${this.collection}/points/delete?wait=true`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ filter: { must: [{ key: 'sessionId', match: { value: sessionId } }] } }),
    });

    return count;
  }

  async deleteByUser(userId: string): Promise<number> {
    await this.ensureCollection();
    const count = await this.countByFilter({ must: [{ key: 'userId', match: { value: userId } }] });

    await this.request(`/collections/${this.collection}/points/delete?wait=true`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ filter: { must: [{ key: 'userId', match: { value: userId } }] } }),
    });

    return count;
  }

  async getById(id: string): Promise<SemanticMemoryEntry | null> {
    await this.ensureCollection();

    const response = await this.request<QdrantRetrieveResponse>(
      `/collections/${this.collection}/points`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids: [id], with_payload: true, with_vector: false }),
      },
    );

    const first = response.result?.[0];
    if (!first) return null;

    return payloadToEntry(first.payload) ?? null;
  }

  private async ensureCollection(): Promise<void> {
    if (this.collectionReady) return;

    try {
      await this.request(`/collections/${this.collection}`, {
        method: 'GET',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes('(404)')) {
        throw err;
      }

      await this.request(`/collections/${this.collection}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          vectors: {
            size: this.vectorSize,
            distance: 'Cosine',
          },
        }),
      });
    }

    this.collectionReady = true;
  }

  private async countByFilter(filter: Record<string, unknown>): Promise<number> {
    const response = await this.request<{ result?: { count?: number } }>(
      `/collections/${this.collection}/points/count`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ filter, exact: true }),
      },
    );

    return response.result?.count ?? 0;
  }

  private async request<T = unknown>(path: string, init: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, init);
    if (!response.ok) {
      const body = await response.text().catch(() => '(no body)');
      throw new Error(`Qdrant request failed (${response.status}) ${path}: ${body}`);
    }

    if (response.status === 204) {
      return {} as T;
    }

    return (await response.json()) as T;
  }
}
