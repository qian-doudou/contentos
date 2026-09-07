import { z } from 'zod';

const envSchema = z.object({
  LLM_BASE_URL: z.url().default('https://api.openai.com/v1'),
  LLM_API_KEY: z.string().optional().default(''),
  LLM_MODEL_LIGHT: z.string().optional().default(''),
  LLM_MODEL_STANDARD: z.string().optional().default(''),
  LLM_MODEL_STRONG: z.string().optional().default(''),
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
  return {
    mode: parsed.LLM_API_KEY ? 'live' : 'mock',
    baseUrl: parsed.LLM_BASE_URL.replace(/\/$/, ''),
    apiKey: parsed.LLM_API_KEY,
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
