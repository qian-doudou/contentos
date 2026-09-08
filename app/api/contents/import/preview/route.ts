import { currentHistoryRetrieval } from '@/lib/api/context';
import { handleApi, methodNotAllowed, readJson } from '@/lib/api/handler';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  return handleApi(
    async () =>
      currentHistoryRetrieval(request).previewImport(
        await readJson(request, { maxBytes: 1_100_000 }),
      ),
    201,
  );
}

export const GET = methodNotAllowed;
export const PUT = methodNotAllowed;
export const DELETE = methodNotAllowed;
