import { currentMemory } from '@/lib/api/context';
import { handleApi, methodNotAllowed, readJson } from '@/lib/api/handler';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  return handleApi(() =>
    currentMemory(request).list(
      Object.fromEntries(new URL(request.url).searchParams),
    ),
  );
}

export async function POST(request: Request) {
  return handleApi(
    async () =>
      currentMemory(request).createOrReplaceManual(await readJson(request)),
    201,
  );
}

export const PUT = methodNotAllowed;
export const DELETE = methodNotAllowed;
