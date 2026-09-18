import { z } from 'zod';
import { providerFetch } from './transport';

export const bailianDefaults = {
  baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  models: {
    light: 'qwen3.8-flash',
    standard: 'qwen3.7-plus',
    strong: 'qwen3.8-max',
  },
  timeoutMs: 60_000,
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

export function structuredSystemPrompt(prompt: string, outputSchema: unknown) {
  return `${prompt}\n\n输出协议：只返回一个 JSON 对象，字段名、类型、必填字段和枚举必须严格遵守以下 JSON Schema。不得添加 Markdown 代码块。\n${JSON.stringify(outputSchema)}`;
}

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

export class LlmRequestError extends Error {
  constructor(
    message: string,
    readonly attempts: number,
    options?: ErrorOptions,
    readonly code = 'LLM_CALL_FAILED',
    readonly httpStatus = 502,
  ) {
    super(message, options);
    this.name = 'LlmRequestError';
  }
}

function failureMessage(error: unknown) {
  if (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name))
    return 'AI 生成超时，请稍后重试；本次未生成成功，不扣积分。';
  return '无法连接 AI 服务，请检查启动服务时的网络或 HTTPS_PROXY 设置后重试；本次不扣积分。';
}

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

    const fetchImpl = this.runtime.fetch ?? providerFetch;
    const hostname = new URL(this.config.baseUrl).hostname;
    const bailianQwen = (hostname === 'dashscope.aliyuncs.com' || hostname.endsWith('.aliyuncs.com'))
      && /^qwen(?:3[.\d-]|-plus|-flash)/.test(model) && !model.includes('thinking');
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
              ...(bailianQwen ? { enable_thinking: false } : {}),
            }),
            signal: controller.signal,
          },
        );
        if (!response.ok) {
          // Never forward a provider response body: it can echo input or credentials.
          await response.body?.cancel();
          const message = response.status === 401 || response.status === 403
            ? 'AI 服务鉴权失败，请检查 API Key、地域和模型访问权限。'
            : response.status === 429 ? 'AI 服务限流或服务商额度不足，请稍后重试或检查百炼余额。'
              : response.status === 404 ? 'AI 模型或接口不存在，请检查模型名称与服务地址。'
                : response.status >= 500 ? 'AI 服务暂时不可用，请稍后重试。'
                  : `AI 服务拒绝请求（HTTP ${response.status}），请检查模型配置。`;
          const code = response.status === 401 || response.status === 403 ? 'LLM_AUTH_FAILED'
            : response.status === 429 ? 'LLM_RATE_LIMITED' : response.status === 404 ? 'LLM_MODEL_NOT_FOUND'
              : 'LLM_PROVIDER_ERROR';
          const error = new LlmRequestError(message, attempt, undefined, code);
          const transient = response.status === 429 || response.status >= 500;
          if (attempt < 2 && transient) {
            lastError = error;
            continue;
          }
          throw error;
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
        if (error instanceof LlmRequestError) throw error;
        const timeout = error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name);
        if (timeout) {
          throw new LlmRequestError(failureMessage(error), attempt, { cause: error }, 'LLM_TIMEOUT', 504);
        }
        if (attempt >= 2) {
          const invalid = error instanceof z.ZodError || error instanceof SyntaxError;
          throw new LlmRequestError(invalid ? 'AI 服务返回格式异常，请重试；本次不扣积分。' : failureMessage(error), attempt,
            { cause: error }, invalid ? 'LLM_RESPONSE_INVALID' : 'LLM_CONNECTION_FAILED', 502);
        }
      } finally {
        clearTimeout(timer);
      }
    }
    throw new LlmRequestError(failureMessage(lastError), 2, {
      cause: lastError,
    });
  }

  async generateObject<T>(input: {
    messages: LlmMessage[];
    schema: z.ZodType<T>;
    mockValue: T;
    tier?: LlmTier;
  }): Promise<{ value: T; completion: LlmCompletion }> {
    const completion = await this.complete({
      messages: [{ role: 'system', content: structuredSystemPrompt('', z.toJSONSchema(input.schema)) }, ...input.messages],
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
