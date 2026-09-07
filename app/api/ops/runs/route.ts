import { currentAiInfrastructure } from '@/lib/api/context';
import { handleApi, methodNotAllowed } from '@/lib/api/handler';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  return handleApi(() =>
    currentAiInfrastructure(request).listRuns(
      Object.fromEntries(new URL(request.url).searchParams),
    ),
  );
}

export const POST = methodNotAllowed;
export const PUT = methodNotAllowed;
export const DELETE = methodNotAllowed;
