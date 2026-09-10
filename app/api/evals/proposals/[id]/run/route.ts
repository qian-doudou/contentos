import { currentQuality } from '@/lib/api/context';
import { handleApi, methodNotAllowed, readJson } from '@/lib/api/handler';

export const runtime = 'nodejs';

export async function POST(request: Request, context: RouteContext<'/api/evals/proposals/[id]/run'>) {
  const { id } = await context.params;
  return handleApi(async () => currentQuality(request).runExperiment(id, await readJson(request)), 201);
}

export const GET = methodNotAllowed;
export const PUT = methodNotAllowed;
export const DELETE = methodNotAllowed;
