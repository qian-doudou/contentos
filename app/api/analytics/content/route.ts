import { currentPerformance } from '@/lib/api/context';
import { handleApi, methodNotAllowed } from '@/lib/api/handler';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const url = new URL(request.url);
  return handleApi(() => currentPerformance(request).listAnalytics(Object.fromEntries(url.searchParams)));
}

export const POST = methodNotAllowed;
export const PUT = methodNotAllowed;
export const DELETE = methodNotAllowed;
