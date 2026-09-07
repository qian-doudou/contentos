import { currentMasterData } from '@/lib/api/context';
import { handleApi, readJson, methodNotAllowed } from '@/lib/api/handler';
export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: Context) {
  return handleApi(async () => currentMasterData().clientDetail((await context.params).id));
}
export async function PUT(request: Request, context: Context) {
  return handleApi(async () => currentMasterData().updateClient((await context.params).id, await readJson(request)));
}
export const DELETE = methodNotAllowed;
