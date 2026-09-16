import { z } from 'zod';
import { providerFetch } from '@/lib/llm/transport';
import type { EmbeddingVector } from './contracts';
import { weightedTermVector } from './similarity';

const defaults = {
  baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  model: 'text-embedding-v4',
  fallbackModel: 'fallback:zh-bigram-v1',
  timeoutMs: 30_000,
} as const;

const environmentSchema = z.object({
  EMBEDDING_BASE_URL: z.url().default(defaults.baseUrl),
  EMBEDDING_API_KEY: z.string().trim().optional().default(''),
  EMBEDDING_MODEL: z.string().trim().min(1).default(defaults.model),
  EMBEDDING_TIMEOUT_MS: z.preprocess(
    (value) =>
      typeof value === 'string' && value.trim() !== '' ? Number(value) : value,
    z.number().int().min(1_000).max(120_000).default(defaults.timeoutMs),
  ),
});

const responseSchema = z.object({
  model: z.string().optional(),
  data: z
    .array(
      z.object({
        index: z.number().int().nonnegative(),
        embedding: z.array(z.number()).min(1).max(8192),
      }),
    )
    .min(1),
});

export type EmbeddingConfig = {
  mode: 'live' | 'fallback';
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
};

export function getEmbeddingConfig(
  environment: Partial<NodeJS.ProcessEnv> = process.env,
): EmbeddingConfig {
  const value = environmentSchema.parse(environment);
  return {
    mode: value.EMBEDDING_API_KEY ? 'live' : 'fallback',
    baseUrl: value.EMBEDDING_BASE_URL.replace(/\/$/, ''),
    apiKey: value.EMBEDDING_API_KEY,
    model: value.EMBEDDING_API_KEY
      ? value.EMBEDDING_MODEL
      : defaults.fallbackModel,
    timeoutMs: value.EMBEDDING_TIMEOUT_MS,
  };
}

export type EmbeddingResult = {
  vectors: EmbeddingVector[];
  model: string;
  method: 'embedding' | 'fallback_bigram';
  attempts: number;
};

class NonRetryableEmbeddingError extends Error {}

export class OpenAICompatibleEmbeddingClient {
  private providerUnavailableUntil = 0;

  constructor(
    private readonly config: EmbeddingConfig = getEmbeddingConfig(),
    private readonly runtime: { fetch?: typeof fetch } = {},
  ) {}

  get mode() {
    return this.config.mode;
  }

  get publicConfig() {
    return {
      provider: 'Alibaba Cloud Model Studio (Bailian)' as const,
      mode: this.config.mode,
      model: this.config.model,
      retryCount: 1 as const,
    };
  }

  async embed(texts: string[]): Promise<EmbeddingResult> {
    const fallback = (attempts = 1): EmbeddingResult => ({
      ...deterministicFallbackEmbeddings(texts),
      attempts,
    });
    if (texts.length === 0)
      return {
        vectors: [],
        model: this.config.model,
        method: this.config.mode === 'live' ? 'embedding' : 'fallback_bigram',
        attempts: 1,
      };
    if (this.config.mode === 'fallback')
      return fallback();

    if (this.providerUnavailableUntil > Date.now()) return fallback();

    const fetchImplementation = this.runtime.fetch ?? providerFetch;
    let lastError: unknown;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
      try {
        const response = await fetchImplementation(
          `${this.config.baseUrl}/embeddings`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${this.config.apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ model: this.config.model, input: texts }),
            signal: controller.signal,
          },
        );
        if (!response.ok) {
          const error = new Error(
            `Embedding request failed with HTTP ${response.status}`,
          );
          const transient = response.status === 429 || response.status >= 500;
          if (attempt < 2 && transient) {
            lastError = error;
            continue;
          }
          if (transient) {
            this.providerUnavailableUntil = Date.now() + 60_000;
            return fallback(attempt);
          }
          throw new NonRetryableEmbeddingError(error.message);
        }
        const payload = responseSchema.parse(await response.json());
        const ordered = [...payload.data].sort((a, b) => a.index - b.index);
        if (ordered.length !== texts.length)
          throw new Error('Embedding response count does not match input');
        return {
          vectors: ordered.map((item) => ({
            kind: 'dense' as const,
            values: item.embedding,
          })),
          model: payload.model ?? this.config.model,
          method: 'embedding',
          attempts: attempt,
        };
      } catch (error) {
        lastError = error;
        if (error instanceof NonRetryableEmbeddingError) throw error;
        if (attempt >= 2) {
          this.providerUnavailableUntil = Date.now() + 60_000;
          return fallback(attempt);
        }
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error('Embedding request failed');
  }
}

export function deterministicFallbackEmbeddings(
  texts: string[],
): EmbeddingResult {
  return {
    vectors: texts.map(weightedTermVector),
    model: defaults.fallbackModel,
    method: 'fallback_bigram',
    attempts: 1,
  };
}
