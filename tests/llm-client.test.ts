import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { getLlmConfig, OpenAICompatibleClient } from '@/lib/llm/client';

describe('OpenAI-compatible LLM client', () => {
  it('enters deterministic mock mode without an API key', async () => {
    const config = getLlmConfig({ LLM_BASE_URL: 'https://example.com/v1', LLM_API_KEY: '' });
    const client = new OpenAICompatibleClient(config);
    const first = await client.complete({ messages: [{ role: 'user', content: '写一段脚本' }] });
    const second = await client.complete({ messages: [{ role: 'user', content: '完全不同的输入' }] });
    expect(client.mode).toBe('mock');
    expect(first).toBe(second);
  });

  it('validates mock structured output with Zod', async () => {
    const client = new OpenAICompatibleClient(getLlmConfig({ LLM_API_KEY: '' }));
    const schema = z.object({ title: z.string(), hooks: z.array(z.string()) });
    await expect(client.generateObject({
      messages: [{ role: 'user', content: '生成脚本' }],
      schema,
      mockValue: { title: '确定性脚本', hooks: ['开场'] },
    })).resolves.toEqual({ title: '确定性脚本', hooks: ['开场'] });
  });
});

