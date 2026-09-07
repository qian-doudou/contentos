import { currentAiInfrastructure } from '@/lib/api/context';
import { handleApi, methodNotAllowed } from '@/lib/api/handler';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  return handleApi(() => currentAiInfrastructure(request).listSkills());
}

export const POST = methodNotAllowed;
export const PUT = methodNotAllowed;
export const DELETE = methodNotAllowed;
