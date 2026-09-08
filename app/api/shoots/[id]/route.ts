import { currentShoots } from '@/lib/api/context';
import { handleApi, methodNotAllowed, readJson } from '@/lib/api/handler';

export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  return handleApi(async () => currentShoots(request).detail((await context.params).id));
}

export async function PUT(request: Request, context: Context) {
  return handleApi(async () => currentShoots(request).update((await context.params).id, await readJson(request)));
}

export const POST = methodNotAllowed;
export const DELETE = methodNotAllowed;
