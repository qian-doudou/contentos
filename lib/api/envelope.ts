import { ZodError } from 'zod';

export type ApiErrorBody = {
  code: string;
  message: string;
  details?: unknown;
};

export type ApiEnvelope<T> = {
  success: boolean;
  data: T | null;
  error: ApiErrorBody | null;
  request_id: string;
};

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function requestId() {
  return crypto.randomUUID();
}

export function ok<T>(data: T, id = requestId(), status = 200) {
  return Response.json(
    { success: true, data, error: null, request_id: id } satisfies ApiEnvelope<T>,
    { status },
  );
}

export function fail(error: unknown, id = requestId()) {
  if (error instanceof ApiError) {
    return Response.json(
      {
        success: false,
        data: null,
        error: { code: error.code, message: error.message, details: error.details },
        request_id: id,
      } satisfies ApiEnvelope<never>,
      { status: error.status },
    );
  }

  if (error instanceof ZodError) {
    return Response.json(
      {
        success: false,
        data: null,
        error: { code: 'VALIDATION_ERROR', message: '请求参数校验失败', details: error.issues },
        request_id: id,
      } satisfies ApiEnvelope<never>,
      { status: 400 },
    );
  }

  console.error(`[${id}] Unhandled API error`, error);
  return Response.json(
    {
      success: false,
      data: null,
      error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' },
      request_id: id,
    } satisfies ApiEnvelope<never>,
    { status: 500 },
  );
}

