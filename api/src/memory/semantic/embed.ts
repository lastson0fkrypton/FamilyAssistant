// Lightweight deterministic local embedding for semantic memory tools.
// This avoids network dependencies while still enabling vector similarity.

const DIMENSIONS = 96;

export function embedText(text: string): number[] {
  const vector = new Array<number>(DIMENSIONS).fill(0);
  const tokens = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

  for (const token of tokens) {
    const index = hashToken(token) % DIMENSIONS;
    vector[index] += 1;
  }

  return normalize(vector);
}

function hashToken(token: string): number {
  let hash = 2166136261;
  for (let i = 0; i < token.length; i += 1) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}

function normalize(values: number[]): number[] {
  let norm = 0;
  for (const value of values) {
    norm += value * value;
  }

  if (norm === 0) {
    return values;
  }

  const magnitude = Math.sqrt(norm);
  return values.map((v) => v / magnitude);
}
