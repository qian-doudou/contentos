import { z } from 'zod';

export const bailianDefaults = {
  baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  models: {
    light: 'qwen3.8-flash',
    standard: 'qwen3.7-plus',
    strong: 'qwen3.8-max',
  },
  timeoutMs: 30_000,
} as const;

const modelSetting = (fallback: string) =>
  z.preprocess(
    (value) =>
      typeof value === 'string' && value.trim() === '' ? undefined : value,
    z.string().trim().min(1).default(fallback),
  );

const timeoutSetting = z.preprocess(
  (value) =>
    typeof value === 'string' && value.trim() !== '' ? Number(value) : value,
  z.number().int().min(1_000).max(120_000).default(bailianDefaults.timeoutMs),
);

const envSchema = z.object({
  LLM_BASE_URL: z.url().default(bailianDefaults.baseUrl),
  LLM_API_KEY: z.string().trim().optional().default(''),
  DASHSCOPE_API_KEY: z.string().trim().optional().default(''),
  LLM_MODEL_LIGHT: modelSetting(bailianDefaults.models.light),
  LLM_MODEL_STANDARD: modelSetting(bailianDefaults.models.standard),
  LLM_MODEL_STRONG: modelSetting(bailianDefaults.models.strong),
  LLM_TIMEOUT_MS: timeoutSetting,
});

const completionResponseSchema = z.object({
  id: z.string().optional(),
  model: z.string().optional(),
  choices: z
    .array(z.object({ message: z.object({ content: z.string() }) }))
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number().int().nonnegative().optional(),
      completion_tokens: z.number().int().nonnegative().optional(),
    })
    .optional(),
});

export type LlmTier = 'light' | 'standard' | 'strong';
export type LlmMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type LlmConfig = {
  mode: 'mock' | 'live';
  baseUrl: string;
  apiKey: string;
  models: Record<LlmTier, string>;
  timeoutMs: number;
};

export type LlmCompletion = {
  text: string;
  providerRequestId: string | null;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  durationMs: number;
  attempts: number;
  mode: 'mock' | 'live';
};

export function getLlmConfig(
  env: Partial<NodeJS.ProcessEnv> = process.env,
): LlmConfig {
  const parsed = envSchema.parse(env);
  const apiKey = parsed.LLM_API_KEY || parsed.DASHSCOPE_API_KEY;
  return {
    mode: apiKey ? 'live' : 'mock',
    baseUrl: parsed.LLM_BASE_URL.replace(/\/$/, ''),
    apiKey,
    models: {
      light: parsed.LLM_MODEL_LIGHT,
      standard: parsed.LLM_MODEL_STANDARD,
      strong: parsed.LLM_MODEL_STRONG,
    },
    timeoutMs: parsed.LLM_TIMEOUT_MS,
  };
}

export function getPublicLlmConfig(config: LlmConfig = getLlmConfig()) {
  return {
    provider: 'Alibaba Cloud Model Studio (Bailian)' as const,
    mode: config.mode,
    models: config.models,
    timeoutMs: config.timeoutMs,
    retryCount: 1 as const,
  };
}

function stableMockId(input: unknown) {
  const text = JSON.stringify(input);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `mock-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function parseJsonOutput(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fenced?.[1] ?? trimmed;
  try {
    return JSON.parse(candidate) as unknown;
  } catch {
    throw new Error('LLM 输出不是有效 JSON');
  }
}

class NonRetryableLlmError extends Error {}

export class OpenAICompatibleClient {
  constructor(
    private readonly config: LlmConfig = getLlmConfig(),
    private readonly runtime: { fetch?: typeof fetch; now?: () => number } = {},
  ) {}

  get mode() {
    return this.config.mode;
  }

  get publicConfig() {
    return getPublicLlmConfig(this.config);
  }

  async complete(input: {
    messages: LlmMessage[];
    tier?: LlmTier;
    mockText?: string;
  }): Promise<LlmCompletion> {
    const tier = input.tier ?? 'standard';
    const model = this.config.models[tier];
    if (!model)
      throw new Error(`LLM model for tier "${tier}" is not configured`);
    const clock = this.runtime.now ?? Date.now;
    const startedAt = clock();

    if (this.config.mode === 'mock') {
      return {
        text: input.mockText ?? '[MOCK] ContentOS deterministic response',
        providerRequestId: stableMockId({
          model,
          messages: input.messages,
          text: input.mockText,
        }),
        model,
        inputTokens: null,
        outputTokens: null,
        durationMs: Math.max(0, clock() - startedAt),
        attempts: 1,
        mode: 'mock',
      };
    }

    const fetchImpl = this.runtime.fetch ?? fetch;
    let lastError: unknown;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
      try {
        const response = await fetchImpl(
          `${this.config.baseUrl}/chat/completions`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${this.config.apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model,
              messages: input.messages,
              temperature: 0,
              response_format: { type: 'json_object' },
            }),
            signal: controller.signal,
          },
        );
        if (!response.ok) {
          const error = new Error(
            `LLM request failed with HTTP ${response.status}`,
          );
          if (
            attempt < 2 &&
            (response.status === 429 || response.status >= 500)
          ) {
            lastError = error;
            continue;
          }
          throw new NonRetryableLlmError(error.message);
        }
        const payload = completionResponseSchema.parse(await response.json());
        return {
          text: payload.choices[0].message.content,
          providerRequestId:
            response.headers.get('x-request-id') ??
            response.headers.get('request-id') ??
            payload.id ??
            null,
          model: payload.model ?? model,
          inputTokens: payload.usage?.prompt_tokens ?? null,
          outputTokens: payload.usage?.completion_tokens ?? null,
          durationMs: Math.max(0, clock() - startedAt),
          attempts: attempt,
          mode: 'live',
        };
      } catch (error) {
        lastError = error;
        if (error instanceof NonRetryableLlmError) throw error;
        if (attempt >= 2) throw error;
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error('LLM request failed');
  }

  async generateObject<T>(input: {
    messages: LlmMessage[];
    schema: z.ZodType<T>;
    mockValue: T;
    tier?: LlmTier;
  }): Promise<{ value: T; completion: LlmCompletion }> {
    const completion = await this.complete({
      messages: input.messages,
      tier: input.tier,
      mockText:
        this.config.mode === 'mock'
          ? JSON.stringify(input.mockValue)
          : undefined,
    });
    return {
      value: input.schema.parse(parseJsonOutput(completion.text)),
      completion,
    };
  }
}
