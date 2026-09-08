import { currentHistoryRetrieval } from '@/lib/api/context';
import { handleApi, methodNotAllowed } from '@/lib/api/handler';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  return handleApi(() => currentHistoryRetrieval(request).importPageData());
}

export const POST = methodNotAllowed;
export const PUT = methodNotAllowed;
export const DELETE = methodNotAllowed;
