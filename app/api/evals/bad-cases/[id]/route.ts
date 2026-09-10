import { currentQuality } from '@/lib/api/context';
import { handleApi, methodNotAllowed, readJson } from '@/lib/api/handler';

export const runtime = 'nodejs';

export async function PUT(request: Request, context: RouteContext<'/api/evals/bad-cases/[id]'>) {
  const { id } = await context.params;
  return handleApi(async () => currentQuality(request).updateBadCase(id, await readJson(request)));
}

export const GET = methodNotAllowed;
export const POST = methodNotAllowed;
export const DELETE = methodNotAllowed;
