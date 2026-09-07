import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { bailianDefaults, getLlmConfig, OpenAICompatibleClient } from '@/lib/llm/client';

afterEach(() => vi.restoreAllMocks());

describe('OpenAI-compatible LLM client', () => {
  it('enters deterministic mock mode without an API key', async () => {
    const config = getLlmConfig({
      LLM_BASE_URL: 'https://example.com/v1',
      LLM_API_KEY: '',
      LLM_MODEL_LIGHT: '',
      LLM_MODEL_STANDARD: '',
      LLM_MODEL_STRONG: '',
    });
    const client = new OpenAICompatibleClient(config);
    const first = await client.complete({ messages: [{ role: 'user', content: '写一段脚本' }] });
    const second = await client.complete({ messages: [{ role: 'user', content: '完全不同的输入' }] });
    expect(client.mode).toBe('mock');
    expect(first).toBe(second);
    expect(config.models).toEqual(bailianDefaults.models);
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

  it('defaults live traffic to Bailian Qwen through the compatible endpoint', async () => {
    const request = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({
      choices: [{ message: { content: '千问响应' } }],
    }));
    const config = getLlmConfig({ LLM_API_KEY: 'test-bailian-key' });
    const client = new OpenAICompatibleClient(config);

    await expect(client.complete({
      tier: 'strong',
      messages: [{ role: 'user', content: '生成一条短视频脚本' }],
    })).resolves.toBe('千问响应');

    expect(config).toMatchObject({
      mode: 'live',
      baseUrl: bailianDefaults.baseUrl,
      models: bailianDefaults.models,
    });
    expect(request).toHaveBeenCalledOnce();
    const [url, init] = request.mock.calls[0];
    expect(url).toBe(`${bailianDefaults.baseUrl}/chat/completions`);
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer test-bailian-key' });
    expect(typeof init?.body).toBe('string');
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
    expect(body).toMatchObject({ model: 'qwen3.8-max', temperature: 0 });
  });

  it('accepts the official DASHSCOPE_API_KEY alias without exposing it', () => {
    const config = getLlmConfig({ DASHSCOPE_API_KEY: 'test-dashscope-key' });
    expect(config.mode).toBe('live');
    expect(config.apiKey).toBe('test-dashscope-key');
  });
});
