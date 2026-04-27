import { config } from './config.js';
import { logger } from './logger.js';

interface OllamaVersionResponse {
  version?: string;
}

interface OllamaTagsResponse {
  models?: Array<{ name?: string }>;
}

interface OllamaChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OllamaToolCall {
  function?: {
    name?: string;
    arguments?: unknown;
  };
}

interface OllamaToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required?: string[];
      additionalProperties?: boolean;
    };
  };
}

interface OllamaChatRequest {
  model: string;
  messages: OllamaChatMessage[];
  tools?: OllamaToolDefinition[];
  stream?: boolean;
  format?: 'json';
}

interface OllamaChatResponse {
  message?: { role?: string; content?: string; tool_calls?: OllamaToolCall[] };
  done?: boolean;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

export interface OllamaToolCallResult {
  name: string;
  args: Record<string, unknown>;
}

export interface OllamaChatWithToolsResult {
  content: string;
  toolCalls: OllamaToolCallResult[];
}

/** @deprecated use chatJson */
interface OllamaGenerateResponse {
  response?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nanosToMs(value?: number): number | undefined {
  if (typeof value !== 'number') {
    return undefined;
  }

  return Math.round(value / 1_000_000);
}

export class OllamaClient {
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly generateTimeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;

  constructor() {
    this.baseUrl = config.OLLAMA_BASE_URL;
    this.model = config.OLLAMA_MODEL;
    this.timeoutMs = config.OLLAMA_TIMEOUT_MS;
    this.generateTimeoutMs = config.OLLAMA_GENERATE_TIMEOUT_MS;
    this.maxRetries = config.OLLAMA_MAX_RETRIES;
    this.retryDelayMs = config.OLLAMA_RETRY_DELAY_MS;
  }

  selectedModel(): string {
    return this.model;
  }

  async version(): Promise<OllamaVersionResponse> {
    return this.request<OllamaVersionResponse>('/api/version');
  }

  async tags(): Promise<OllamaTagsResponse> {
    return this.request<OllamaTagsResponse>('/api/tags');
  }

  async ensureSelectedModelAvailable(): Promise<void> {
    const tags = await this.tags();
    const names = (tags.models ?? [])
      .map((m) => m.name)
      .filter((name): name is string => Boolean(name));

    if (!names.includes(this.model)) {
      throw new Error(
        `Selected model not found locally: ${this.model}. Available models: ${names.join(', ') || 'none'}`,
      );
    }
  }

  async checkHealth(): Promise<void> {
    const body = await this.version();
    if (!body.version) {
      throw new Error('Ollama version endpoint returned no version field');
    }
    const tags = await this.tags();
    const names = (tags.models ?? [])
      .map((m) => m.name)
      .filter((name): name is string => Boolean(name));

    if (!names.includes(this.model)) {
      logger.warn(
        { selectedModel: this.model, availableModels: names },
        'Ollama reachable but selected model is not available locally yet',
      );
    }

    logger.debug({ version: body.version, model: this.model }, 'Ollama reachable');
  }

  async chatJson(systemPrompt: string, userMessage: string): Promise<string> {
    await this.ensureSelectedModelAvailable();
    const response = await this.requestWithBody<OllamaChatResponse, OllamaChatRequest>('/api/chat', {
      model: this.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      stream: false,
      format: 'json',
    }, this.generateTimeoutMs);

    const outputTokens = response.eval_count ?? 0;
    const outputDurationMs = nanosToMs(response.eval_duration);
    const tokensPerSecond = outputTokens > 0 && outputDurationMs && outputDurationMs > 0
      ? Number(((outputTokens * 1000) / outputDurationMs).toFixed(2))
      : undefined;

    logger.info(
      {
        model: this.model,
        totalDurationMs: nanosToMs(response.total_duration),
        loadDurationMs: nanosToMs(response.load_duration),
        promptEvalCount: response.prompt_eval_count,
        promptEvalDurationMs: nanosToMs(response.prompt_eval_duration),
        evalCount: response.eval_count,
        evalDurationMs: outputDurationMs,
        tokensPerSecond,
      },
      'Ollama chat completed',
    );

    return response.message?.content ?? '';
  }

  async chatWithTools(
    systemPrompt: string,
    userMessage: string,
    tools: OllamaToolDefinition[],
  ): Promise<OllamaChatWithToolsResult> {
    await this.ensureSelectedModelAvailable();
    const response = await this.requestWithBody<OllamaChatResponse, OllamaChatRequest>('/api/chat', {
      model: this.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      tools,
      stream: false,
    }, this.generateTimeoutMs);

    const outputTokens = response.eval_count ?? 0;
    const outputDurationMs = nanosToMs(response.eval_duration);
    const tokensPerSecond = outputTokens > 0 && outputDurationMs && outputDurationMs > 0
      ? Number(((outputTokens * 1000) / outputDurationMs).toFixed(2))
      : undefined;

    logger.info(
      {
        model: this.model,
        totalDurationMs: nanosToMs(response.total_duration),
        loadDurationMs: nanosToMs(response.load_duration),
        promptEvalCount: response.prompt_eval_count,
        promptEvalDurationMs: nanosToMs(response.prompt_eval_duration),
        evalCount: response.eval_count,
        evalDurationMs: outputDurationMs,
        tokensPerSecond,
      },
      'Ollama chat with tools completed',
    );

    const toolCalls = (response.message?.tool_calls ?? [])
      .map((toolCall): OllamaToolCallResult | null => {
        const name = toolCall.function?.name;
        const rawArgs = toolCall.function?.arguments;

        if (!name || typeof name !== 'string') {
          return null;
        }

        if (rawArgs === undefined || rawArgs === null) {
          return { name, args: {} };
        }

        if (typeof rawArgs === 'string') {
          try {
            const parsed = JSON.parse(rawArgs) as unknown;
            return { name, args: (typeof parsed === 'object' && parsed !== null) ? parsed as Record<string, unknown> : {} };
          } catch {
            return { name, args: {} };
          }
        }

        if (typeof rawArgs === 'object') {
          return { name, args: rawArgs as Record<string, unknown> };
        }

        return { name, args: {} };
      })
      .filter((tool): tool is OllamaToolCallResult => tool !== null);

    return {
      content: response.message?.content ?? '',
      toolCalls,
    };
  }

  private async request<T>(path: string): Promise<T> {
    let attempt = 0;
    let lastErr: unknown;

    while (attempt <= this.maxRetries) {
      try {
        const res = await fetch(`${this.baseUrl}${path}`, {
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status} from ${path}`);
        }
        return (await res.json()) as T;
      } catch (err) {
        lastErr = err;
        if (attempt >= this.maxRetries) break;
        const nextAttempt = attempt + 1;
        logger.warn(
          { err, path, attempt: nextAttempt, maxRetries: this.maxRetries },
          'Ollama request failed, retrying',
        );
        await sleep(this.retryDelayMs);
      }
      attempt += 1;
    }

    throw new Error(`Ollama request failed after ${this.maxRetries + 1} attempts: ${String(lastErr)}`);
  }

  private async requestWithBody<T, TBody>(path: string, body: TBody, timeoutMs = this.timeoutMs): Promise<T> {
    let attempt = 0;
    let lastErr: unknown;

    while (attempt <= this.maxRetries) {
      try {
        const res = await fetch(`${this.baseUrl}${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status} from ${path}`);
        }
        return (await res.json()) as T;
      } catch (err) {
        lastErr = err;
        if (attempt >= this.maxRetries) break;
        const nextAttempt = attempt + 1;
        logger.warn(
          { err, path, attempt: nextAttempt, maxRetries: this.maxRetries },
          'Ollama request failed, retrying',
        );
        await sleep(this.retryDelayMs);
      }
      attempt += 1;
    }

    throw new Error(`Ollama request failed after ${this.maxRetries + 1} attempts: ${String(lastErr)}`);
  }
}

const ollamaClient = new OllamaClient();

export function getOllamaClient(): OllamaClient {
  return ollamaClient;
}

export async function checkOllama(): Promise<void> {
  await ollamaClient.checkHealth();
}
