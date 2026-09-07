import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ApiError } from '@/lib/api/envelope';
import { handleApi } from '@/lib/api/handler';

describe('unified API error envelope', () => {
  it.each([
    [403, 'PERMISSION_DENIED'],
    [404, 'NOT_FOUND'],
  ])('preserves HTTP %i and the public error code', async (status, code) => {
    const response = await handleApi(() => { throw new ApiError(status, code, '测试错误'); });
    const body = await response.json();
    expect(response.status).toBe(status);
    expect(body).toMatchObject({ success: false, data: null, error: { code, message: '测试错误' } });
    expect(body.request_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('returns success for empty data and 400 for invalid parameters', async () => {
    const empty = await handleApi(() => []);
    expect(await empty.json()).toMatchObject({ success: true, data: [], error: null });
    const invalid = await handleApi(() => z.object({ page: z.number().min(1) }).parse({ page: 0 }));
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ success: false, error: { code: 'VALIDATION_ERROR' } });
  });

  it('redacts unexpected failures behind a 500 response', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const response = await handleApi(() => { throw new Error('database /private/secret.db'); });
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toMatchObject({ success: false, data: null, error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } });
    expect(JSON.stringify(body)).not.toContain('/private/secret.db');
    log.mockRestore();
  });
});
