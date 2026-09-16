import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { fetchData } from '@/lib/api/client';

afterEach(() => vi.unstubAllGlobals());
describe('recoverable browser API errors', () => {
  it.each([
    [['items.0：非法枚举'], 'items.0：非法枚举'],
    [[{ path: ['items', 0], message: '非法枚举' }], 'items.0：非法枚举'],
    [{ arbitrary: true }, '输出校验失败'],
  ])('handles both validation and AI detail formats without undefined text', async (details, expected) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ success: false, error: { code: 'LLM_OUTPUT_INVALID', message: '输出校验失败', details }, request_id: 'trace-1' }, { status: 502 })));
    await expect(fetchData('/api/test', z.unknown())).rejects.toMatchObject({ message: expect.stringContaining(expected), code: 'LLM_OUTPUT_INVALID', requestId: 'trace-1' });
  });
  it('turns an HTML gateway failure into a recoverable error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>unavailable</html>', { status: 503 })));
    await expect(fetchData('/api/test', z.unknown())).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('returns validated API data and preserves network failures as retryable errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json({ success: true, data: { id: 'saved' }, error: null })).mockRejectedValueOnce(new TypeError('Failed to fetch')));
    await expect(fetchData('/api/test', z.object({ id: z.string() }))).resolves.toEqual({ id: 'saved' });
    await expect(fetchData('/api/test', z.unknown())).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });
});
