import { currentShoots } from '@/lib/api/context';
import { handleApi, methodNotAllowed, readJson } from '@/lib/api/handler';

export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string; itemId: string }> };

export async function POST(request: Request, context: Context) {
  const { id, itemId } = await context.params;
  return handleApi(async () => currentShoots(request).actOnItem(id, itemId, await readJson(request)));
}

export const GET = methodNotAllowed;
export const PUT = methodNotAllowed;
export const DELETE = methodNotAllowed;
