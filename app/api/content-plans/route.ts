import { currentContentData } from '@/lib/api/context';
import { handleApi, methodNotAllowed, readJson } from '@/lib/api/handler';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  return handleApi(() => currentContentData(request).listPlans(Object.fromEntries(new URL(request.url).searchParams)));
}

export async function POST(request: Request) {
  return handleApi(async () => currentContentData(request).createPlan(await readJson(request)), 201);
}

export const DELETE = methodNotAllowed;
