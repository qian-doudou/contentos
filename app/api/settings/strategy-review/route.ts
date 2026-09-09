import { currentStrategyReviews } from '@/lib/api/context';
import { handleApi, methodNotAllowed, readJson } from '@/lib/api/handler';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  return handleApi(() => currentStrategyReviews(request).getConfig());
}

export async function PUT(request: Request) {
  return handleApi(async () => currentStrategyReviews(request).updateConfig(await readJson(request)));
}

export const POST = methodNotAllowed;
export const DELETE = methodNotAllowed;
