import { currentAiInfrastructure } from '@/lib/api/context';
import { handleApi, methodNotAllowed, readJson } from '@/lib/api/handler';

export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  return handleApi(async () =>
    currentAiInfrastructure(request).rollbackSkill(
      (await context.params).id,
      await readJson(request),
    ),
  );
}

export const GET = methodNotAllowed;
export const PUT = methodNotAllowed;
export const DELETE = methodNotAllowed;
