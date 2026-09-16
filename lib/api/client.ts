import { z } from 'zod';

export class RequestError extends Error {
  constructor(message: string, public readonly code: string, public readonly requestId?: string) { super(message); }
}

function issueMessage(issue: unknown): string {
  if (typeof issue === 'string') return issue;
  if (!issue || typeof issue !== 'object' || !('message' in issue) || typeof issue.message !== 'string') return '';
  const path = 'path' in issue && Array.isArray(issue.path) ? issue.path.join('.') : '';
  return path ? `${path}：${issue.message}` : issue.message;
}

export async function fetchData<T>(url: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { cache: 'no-store', ...init });
  } catch (error) {
    if (init?.signal?.aborted) throw error;
    throw new RequestError('连接中断，请检查网络后重试。已保存的选题不会重复保存或扣费。', 'NETWORK_ERROR');
  }
  const requestId = response.headers.get('x-request-id') ?? undefined;
  let payload: unknown;
  try { payload = await response.json(); }
  catch { throw new RequestError('服务暂时没有返回有效数据，请稍后重试。', 'INVALID_RESPONSE', requestId); }
  const envelope = z.object({
    success: z.boolean(), data: z.unknown().optional(), request_id: z.string().optional(),
    error: z.object({ code: z.string().optional(), message: z.string().optional(), details: z.unknown().optional() }).nullish(),
  }).safeParse(payload);
  if (!envelope.success) throw new RequestError('服务返回格式异常，请刷新后重试。', 'INVALID_RESPONSE', requestId);
  const body = envelope.data;
  if (!response.ok || !body.success) {
    const details = Array.isArray(body.error?.details) ? body.error.details.map(issueMessage).filter(Boolean).join('；') : '';
    const message = body.error?.message || '请求失败，请稍后重试。';
    throw new RequestError(details ? `${message}：${details}` : message, body.error?.code || 'REQUEST_FAILED', body.request_id ?? requestId);
  }
  return schema.parse(body.data);
}
