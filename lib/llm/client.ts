import { z } from 'zod';

export const bailianDefaults = {
  baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  models: {
    light: 'qwen3.8-flash',
    standard: 'qwen3.7-plus',
    strong: 'qwen3.8-max',
  },
} as const;

const modelSetting = (fallback: string) => z.preprocess(
  value => typeof value === 'string' && value.trim() === '' ? undefined : value,
  z.string().trim().min(1).default(fallback),
);

const envSchema = z.object({
  LLM_BASE_URL: z.url().default(bailianDefaults.baseUrl),
  LLM_API_KEY: z.string().trim().optional().default(''),
  DASHSCOPE_API_KEY: z.string().trim().optional().default(''),
  LLM_MODEL_LIGHT: modelSetting(bailianDefaults.models.light),
  LLM_MODEL_STANDARD: modelSetting(bailianDefaults.models.standard),
  LLM_MODEL_STRONG: modelSetting(bailianDefaults.models.strong),
});

const completionResponseSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1),
});

export type LlmTier = 'light' | 'standard' | 'strong';
export type LlmMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export type LlmConfig = {
  mode: 'mock' | 'live';
  baseUrl: string;
  apiKey: string;
  models: Record<LlmTier, string>;
};

export function getLlmConfig(env: Partial<NodeJS.ProcessEnv> = process.env): LlmConfig {
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
  };
}

export class OpenAICompatibleClient {
  constructor(private readonly config: LlmConfig = getLlmConfig()) {}

  get mode() {
    return this.config.mode;
  }

  async complete(input: { messages: LlmMessage[]; tier?: LlmTier; mockText?: string }) {
    if (this.config.mode === 'mock') {
      return input.mockText ?? '[MOCK] ContentOS deterministic response';
    }

    const tier = input.tier ?? 'standard';
    const model = this.config.models[tier];
    if (!model) throw new Error(`LLM model for tier "${tier}" is not configured`);

    const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model, messages: input.messages, temperature: 0 }),
    });

    if (!response.ok) throw new Error(`LLM request failed with HTTP ${response.status}`);
    return completionResponseSchema.parse(await response.json()).choices[0].message.content;
  }

  async generateObject<T>(input: {
    messages: LlmMessage[];
    schema: z.ZodType<T>;
    mockValue: T;
    tier?: LlmTier;
  }): Promise<T> {
    if (this.config.mode === 'mock') return input.schema.parse(input.mockValue);
    const text = await this.complete({ messages: input.messages, tier: input.tier });
    return input.schema.parse(JSON.parse(text));
  }
}
