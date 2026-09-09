import { currentStrategyReviews } from '@/lib/api/context';
import { handleApi, methodNotAllowed, readJson } from '@/lib/api/handler';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const url = new URL(request.url);
  return handleApi(() => currentStrategyReviews(request).list(Object.fromEntries(url.searchParams)));
}

export async function POST(request: Request) {
  return handleApi(async () => currentStrategyReviews(request).generate(await readJson(request)), 201);
}

export const PUT = methodNotAllowed;
export const DELETE = methodNotAllowed;
