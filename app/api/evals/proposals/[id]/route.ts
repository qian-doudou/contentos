import { currentQuality } from '@/lib/api/context';
import { handleApi, methodNotAllowed } from '@/lib/api/handler';

export const runtime = 'nodejs';

export async function GET(request: Request, context: RouteContext<'/api/evals/proposals/[id]'>) {
  const { id } = await context.params;
  return handleApi(() => currentQuality(request).proposalDetail(id));
}

export const POST = methodNotAllowed;
export const PUT = methodNotAllowed;
export const DELETE = methodNotAllowed;
