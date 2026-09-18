import { afterEach, describe, expect, it, vi } from 'vitest';

const dispatchers = vi.hoisted(() => ({
  DirectAgent: vi.fn(function DirectAgent() {}),
  ProxyAgent: vi.fn(function ProxyAgent() {}),
}));
vi.mock('undici', () => ({ Agent: dispatchers.DirectAgent, EnvHttpProxyAgent: dispatchers.ProxyAgent }));
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks(); vi.resetModules(); });

describe('provider-only environment proxy', () => {
  it('honors proxy configuration via EnvHttpProxyAgent without changing global fetch defaults', async () => {
    vi.stubEnv('HTTPS_PROXY', 'http://127.0.0.1:9999');
    const request = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', request);
    const { providerFetch } = await import('@/lib/llm/transport');
    const controller = new AbortController();
    await providerFetch('https://example.com/v1/chat/completions', { method: 'POST', body: '{}', signal: controller.signal });
    await providerFetch('https://example.com/v1/embeddings');
    expect(dispatchers.ProxyAgent).toHaveBeenCalledOnce();
    expect(dispatchers.ProxyAgent).toHaveBeenCalledWith({ connectTimeout: 5_000 });
    expect(dispatchers.DirectAgent).not.toHaveBeenCalled();
    expect(request.mock.calls[0][1]).toMatchObject({ method: 'POST', body: '{}', signal: controller.signal, dispatcher: expect.any(dispatchers.ProxyAgent) });
    expect(request.mock.calls[1][1].dispatcher).toBe(request.mock.calls[0][1].dispatcher);
  });

  it('bounds direct provider connection time when no proxy is configured', async () => {
    for (const name of ['https_proxy', 'HTTPS_PROXY', 'http_proxy', 'HTTP_PROXY']) vi.stubEnv(name, '');
    vi.stubEnv('LLM_CONNECT_TIMEOUT_MS', '7000');
    const request = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', request);
    const { providerFetch } = await import('@/lib/llm/transport');
    await providerFetch('https://example.com/v1', { method: 'GET' });
    expect(dispatchers.ProxyAgent).not.toHaveBeenCalled();
    expect(dispatchers.DirectAgent).toHaveBeenCalledWith({ connectTimeout: 7_000 });
    expect(request.mock.calls[0][1]).toMatchObject({ method: 'GET', dispatcher: expect.any(dispatchers.DirectAgent) });
  });
});
