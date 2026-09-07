import { ApiError, fail, ok, requestId } from './envelope';

export async function handleApi(action: () => unknown, status = 200) {
  const id = requestId();
  try { return ok(await action(), id, status); } catch (error) { return fail(error, id); }
}
export async function readJson(request: Request): Promise<unknown> {
  if (!request.headers.get('content-type')?.toLowerCase().includes('application/json'))
    throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', '请使用 application/json');
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin)
    throw new ApiError(403, 'ORIGIN_FORBIDDEN', '不允许跨站写入');
  const text = await request.text();
  if (text.length > 100_000) throw new ApiError(413, 'BODY_TOO_LARGE', '请求体过大');
  try { return JSON.parse(text) as unknown; } catch { throw new ApiError(400, 'INVALID_JSON', '请求体必须是有效 JSON'); }
}
export function methodNotAllowed() {
  return fail(new ApiError(405, 'METHOD_NOT_ALLOWED', '不支持此方法；请使用 status=inactive 停用记录'));
}
