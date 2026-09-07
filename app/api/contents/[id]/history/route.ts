import { currentContentData } from '@/lib/api/context';
import { handleApi, methodNotAllowed } from '@/lib/api/handler';

export const runtime = 'nodejs';
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  return handleApi(async () => currentContentData(request).contentHistory((await context.params).id));
}

export const POST = methodNotAllowed;
export const PUT = methodNotAllowed;
export const DELETE = methodNotAllowed;
