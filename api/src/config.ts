import { z } from 'zod';
import { config as dotenvConfig } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Load .env from repo root (two levels up from api/src/).
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: resolve(__dirname, '../../.env') });

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().url(),
  OLLAMA_BASE_URL: z.string().url().default('http://localhost:11434'),
  OLLAMA_MODEL: z.string().default('llama3:8b-instruct-q4_K_M'),
  OLLAMA_TIMEOUT_MS: z.coerce.number().int().min(100).max(120000).default(8000),
  OLLAMA_GENERATE_TIMEOUT_MS: z.coerce.number().int().min(100).max(300000).default(60000),
  OLLAMA_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  OLLAMA_RETRY_DELAY_MS: z.coerce.number().int().min(0).max(10000).default(500),
  ORCHESTRATION_SYSTEM_PROMPT: z
    .string()
    .default(
      'You are a friendly home AI assistant helping a household manage events, schedules, tasks, and family memories. MEMORY IS CRITICAL - you MUST actively save household facts and preferences using memory.kv.save whenever users mention them. IMPORTANT FACTS TO ALWAYS SAVE: family member names, ages, schools, jobs, favorite foods/games/activities, sleep schedules, routines, rules, allergies, preferences, chores, pets. Example: If user says "Blake loves Minecraft", immediately call memory.kv.save with key="blake_favorite_game", value="Minecraft". ALSO recall relevant memories at the START of processing using memory.kv.search. You have access to a complete household memory system - USE IT ACTIVELY. Never mention internal tool names or implementation details to the user. NEVER make up memories or facts. If information is unknown or not found in memory/tool results, say you do not know yet and ask the user for the missing detail. Be friendly, family-safe, and respectful. Only claim capabilities from allowlisted tools. Return exactly one JSON object: {"kind":"response","reply":"...","done":true/false} or {"kind":"tool_call","tool":"<name>","args":{...}}',
    ),
  ORCHESTRATION_MEMORY_CONTEXT: z.string().default(''),
  STRUCTURED_MEMORY_BACKEND: z.enum(['postgres', 'sqlite']).default('postgres'),
  SEMANTIC_MEMORY_BACKEND: z.enum(['in-memory', 'qdrant', 'chroma']).default('qdrant'),
  QDRANT_URL: z.string().url().default('http://localhost:6333'),
  QDRANT_COLLECTION: z.string().min(1).max(120).default('familyassistant-memory'),
  QDRANT_VECTOR_SIZE: z.coerce.number().int().min(8).max(4096).default(96),
  REPLAY_LOG_ENABLED: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  REPLAY_LOG_PATH: z.string().default('var/replay-log.ndjson'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
});

function loadConfig() {
  const result = EnvSchema.safeParse(process.env);
  if (!result.success) {
    console.error('Invalid environment configuration:');
    for (const issue of result.error.issues) {
      console.error(`  ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(1);
  }
  return result.data;
}

export const config = loadConfig();
export type Config = typeof config;
