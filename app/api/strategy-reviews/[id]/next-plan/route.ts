import { currentStrategyReviews } from '@/lib/api/context';
import { handleApi, methodNotAllowed } from '@/lib/api/handler';

export const runtime = 'nodejs';

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  return handleApi(() => currentStrategyReviews(request).createNextPlan(id), 201);
}

export const GET = methodNotAllowed;
export const PUT = methodNotAllowed;
export const DELETE = methodNotAllowed;
