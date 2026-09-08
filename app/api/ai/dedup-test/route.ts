import { currentHistoryRetrieval } from '@/lib/api/context';
import { handleApi, methodNotAllowed, readJson } from '@/lib/api/handler';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  return handleApi(async () =>
    currentHistoryRetrieval(request).dedupTest(await readJson(request)),
  );
}

export const GET = methodNotAllowed;
export const PUT = methodNotAllowed;
export const DELETE = methodNotAllowed;
