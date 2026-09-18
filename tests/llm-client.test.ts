import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  bailianDefaults,
  getLlmConfig,
  OpenAICompatibleClient,
  parseJsonOutput,
  structuredSystemPrompt,
} from '@/lib/llm/client';

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
    const first = await client.complete({
      messages: [{ role: 'user', content: '写一段脚本' }],
    });
    const second = await client.complete({
      messages: [{ role: 'user', content: '完全不同的输入' }],
    });
    expect(client.mode).toBe('mock');
    expect(first.text).toBe(second.text);
    expect(first.providerRequestId).toMatch(/^mock-/);
    expect(first.inputTokens).toBeNull();
    expect(config.models).toEqual(bailianDefaults.models);
  });

  it('validates mock structured output with Zod', async () => {
    const client = new OpenAICompatibleClient(
      getLlmConfig({ LLM_API_KEY: '' }),
    );
    const schema = z.object({ title: z.string(), hooks: z.array(z.string()) });
    await expect(
      client.generateObject({
        messages: [{ role: 'user', content: '生成脚本' }],
        schema,
        mockValue: { title: '确定性脚本', hooks: ['开场'] },
      }),
    ).resolves.toMatchObject({
      value: { title: '确定性脚本', hooks: ['开场'] },
      completion: { mode: 'mock' },
    });
  });

  it('defaults live traffic to Bailian Qwen through the compatible endpoint', async () => {
    const request = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json(
        {
          id: 'provider-body-id',
          model: 'qwen-actual',
          choices: [{ message: { content: '{"result":"千问响应"}' } }],
          usage: { prompt_tokens: 21, completion_tokens: 8 },
        },
        { headers: { 'x-request-id': 'provider-header-id' } },
      ),
    );
    const config = getLlmConfig({ LLM_API_KEY: 'test-bailian-key' });
    const client = new OpenAICompatibleClient(config);

    await expect(
      client.complete({
        tier: 'strong',
        messages: [{ role: 'user', content: '生成一条短视频脚本' }],
      }),
    ).resolves.toMatchObject({
      text: '{"result":"千问响应"}',
      providerRequestId: 'provider-header-id',
      model: 'qwen-actual',
      inputTokens: 21,
      outputTokens: 8,
      attempts: 1,
      mode: 'live',
    });

    expect(config).toMatchObject({
      mode: 'live',
      baseUrl: bailianDefaults.baseUrl,
      models: bailianDefaults.models,
    });
    expect(request).toHaveBeenCalledOnce();
    const [url, init] = request.mock.calls[0];
    expect(url).toBe(`${bailianDefaults.baseUrl}/chat/completions`);
    expect(init?.headers).toMatchObject({
      Authorization: 'Bearer test-bailian-key',
    });
    expect(typeof init?.body).toBe('string');
    const body: unknown =
      typeof init?.body === 'string' ? JSON.parse(init.body) : null;
    expect(body).toMatchObject({
      model: 'qwen3.8-max',
      temperature: 0,
      response_format: { type: 'json_object' },
      enable_thinking: false,
    });
  });

  it('retries one transient failure and never retries a permanent client error', async () => {
    const transient = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(
        Response.json({ choices: [{ message: { content: '{}' } }] }),
      );
    const client = new OpenAICompatibleClient(
      getLlmConfig({ LLM_API_KEY: 'test-key' }),
      { fetch: transient },
    );
    await expect(
      client.complete({ messages: [{ role: 'user', content: '测试' }] }),
    ).resolves.toMatchObject({ attempts: 2 });
    expect(transient).toHaveBeenCalledTimes(2);

    const permanent = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 400 }));
    const invalidClient = new OpenAICompatibleClient(
      getLlmConfig({ LLM_API_KEY: 'test-key' }),
      { fetch: permanent },
    );
    await expect(
      invalidClient.complete({ messages: [{ role: 'user', content: '测试' }] }),
    ).rejects.toThrow('HTTP 400');
    expect(permanent).toHaveBeenCalledOnce();
  });

  it('retries a network failure once and exposes the actual attempt count', async () => {
    const unavailable = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError('fetch failed'));
    const client = new OpenAICompatibleClient(
      getLlmConfig({ LLM_API_KEY: 'test-key' }),
      { fetch: unavailable },
    );
    await expect(
      client.complete({ messages: [{ role: 'user', content: '测试网络失败' }] }),
    ).rejects.toMatchObject({
      name: 'LlmRequestError',
      code: 'LLM_CONNECTION_FAILED',
      attempts: 2,
    });
    expect(unavailable).toHaveBeenCalledTimes(2);
  });

  it('never turns a failed live request into a chargeable mock success, and allows a later retry', async () => {
    const unavailable = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError('fetch failed'));
    const client = new OpenAICompatibleClient(
      getLlmConfig({ LLM_API_KEY: 'test-key' }),
      { fetch: unavailable },
    );
    await expect(client.complete({
      messages: [{ role: 'user', content: '生成可继续使用的选题' }],
      mockText: '{"items":[]}',
    })).rejects.toMatchObject({
      code: 'LLM_CONNECTION_FAILED',
      attempts: 2,
    });
    expect(unavailable).toHaveBeenCalledTimes(2);

    unavailable.mockResolvedValueOnce(Response.json({ choices: [{ message: { content: '{"status":"passed"}' } }] }));
    await expect(client.complete({
      messages: [{ role: 'user', content: '继续执行质量检查' }],
      mockText: '{"status":"passed"}',
    })).resolves.toMatchObject({
      text: '{"status":"passed"}',
      mode: 'live',
      attempts: 1,
    });
    expect(unavailable).toHaveBeenCalledTimes(3);
  });

  it('sends the saved output schema including enums as the protocol without changing the stored prompt', () => {
    const schema = { type: 'object', properties: { status: { type: 'string', enum: ['passed', 'blocked'] } }, required: ['status'] };
    expect(structuredSystemPrompt('质量检查', schema)).toContain(JSON.stringify(schema));
    expect(structuredSystemPrompt('质量检查', schema)).toMatch(/^质量检查/);
  });

  it('provides actionable auth errors without exposing provider echoes', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: { message: 'secret-key /private/config' } }, { status: 401 }));
    const client = new OpenAICompatibleClient(getLlmConfig({ LLM_API_KEY: 'secret-key' }), { fetch: request });
    const failure = await client.complete({ messages: [], mockText: '{}' }).catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: 'LLM_AUTH_FAILED', attempts: 1 });
    expect((failure as Error).message).not.toMatch(/secret-key|\/private/);
    expect(request).toHaveBeenCalledOnce();
  });

  it('does not retry an overall generation timeout, but retries a malformed provider response once', async () => {
    const timeout = vi.fn<typeof fetch>().mockRejectedValue(new DOMException('Aborted', 'AbortError'));
    const timedClient = new OpenAICompatibleClient(getLlmConfig({ LLM_API_KEY: 'test-key' }), { fetch: timeout });
    await expect(timedClient.complete({ messages: [] })).rejects.toMatchObject({ code: 'LLM_TIMEOUT', httpStatus: 504, attempts: 1 });
    const malformed = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ choices: [] }));
    const invalidClient = new OpenAICompatibleClient(getLlmConfig({ LLM_API_KEY: 'test-key' }), { fetch: malformed });
    await expect(invalidClient.complete({ messages: [] })).rejects.toMatchObject({ code: 'LLM_RESPONSE_INVALID', httpStatus: 502, attempts: 2 });
    expect(timeout).toHaveBeenCalledOnce();
    expect(malformed).toHaveBeenCalledTimes(2);
  });

  it('does not send Bailian-only options to another compatible provider', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ choices: [{ message: { content: '{}' } }] }));
    const client = new OpenAICompatibleClient(getLlmConfig({ LLM_API_KEY: 'test-key', LLM_BASE_URL: 'https://example.com/v1' }), { fetch: request });
    await client.complete({ messages: [] });
    expect(request.mock.calls[0][1]?.body).not.toContain('enable_thinking');
  });

  it('uses one JSON parser for plain and fenced model output', () => {
    expect(parseJsonOutput('{"ok":true}')).toEqual({ ok: true });
    expect(parseJsonOutput('```json\n{"ok":true}\n```')).toEqual({ ok: true });
    expect(() => parseJsonOutput('不是 JSON')).toThrow('不是有效 JSON');
  });

  it('accepts the official DASHSCOPE_API_KEY alias without exposing it', () => {
    const config = getLlmConfig({ DASHSCOPE_API_KEY: 'test-dashscope-key' });
    expect(config.mode).toBe('live');
    expect(config.apiKey).toBe('test-dashscope-key');
    expect(new OpenAICompatibleClient(config).publicConfig).not.toHaveProperty(
      'apiKey',
    );
    expect(new OpenAICompatibleClient(config).publicConfig).not.toHaveProperty(
      'baseUrl',
    );
  });
});
