import { currentAiInfrastructure } from '@/lib/api/context';
import { handleApi, methodNotAllowed, readJson } from '@/lib/api/handler';

export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  return handleApi(async () =>
    currentAiInfrastructure(request).skillDetail((await context.params).id),
  );
}

export async function PUT(request: Request, context: Context) {
  return handleApi(async () =>
    currentAiInfrastructure(request).updateSkill(
      (await context.params).id,
      await readJson(request),
    ),
  );
}

export const POST = methodNotAllowed;
export const DELETE = methodNotAllowed;
