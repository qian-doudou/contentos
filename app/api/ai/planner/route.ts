import { currentAiPlanner } from '@/lib/api/context';
import { handleApi, methodNotAllowed, readJson } from '@/lib/api/handler';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  return handleApi(() => currentAiPlanner(request).pageData());
}

export async function POST(request: Request) {
  return handleApi(async () => currentAiPlanner(request).generate(await readJson(request)), 201);
}

export const PUT = methodNotAllowed;
export const DELETE = methodNotAllowed;
