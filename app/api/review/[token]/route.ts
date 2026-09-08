import { publicScriptReview } from '@/lib/api/context';
import { handleApi, methodNotAllowed, readJson } from '@/lib/api/handler';

export const runtime = 'nodejs';
type Context = { params: Promise<{ token: string }> };

export async function GET(_request: Request, context: Context) {
  return handleApi(async () => publicScriptReview().view((await context.params).token));
}

export async function POST(request: Request, context: Context) {
  return handleApi(async () => publicScriptReview().decide((await context.params).token, await readJson(request)));
}

export const PUT = methodNotAllowed;
export const DELETE = methodNotAllowed;
