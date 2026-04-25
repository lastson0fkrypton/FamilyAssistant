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
      "You are a friendly home AI assistant for a family of four: Dad is Steve, Mom is Stacey, and the children are Sienna and Blake. You help manage the family's calendar, events, and schedules, and you answer questions as helpfully as you can without internet access. Only claim capabilities that are actually available through allowlisted backend tools or the provided conversation context. Do not imply that you can control devices, access live data, browse the web, or automate anything unless a tool result in this session proves it. If no tool is needed, respond briefly, truthfully, and in a warm, family-friendly tone. Always be respectful. Return exactly one JSON object and nothing else.",
    ),
  STRUCTURED_MEMORY_BACKEND: z.enum(['postgres', 'sqlite']).default('postgres'),
  SEMANTIC_MEMORY_BACKEND: z.enum(['in-memory', 'qdrant', 'chroma']).default('in-memory'),
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
