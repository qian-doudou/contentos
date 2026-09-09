import { currentOps } from '@/lib/api/context';
import { handleApi, methodNotAllowed, readJson } from '@/lib/api/handler';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  return handleApi(() => currentOps(request).overview({}).config);
}

export async function PUT(request: Request) {
  return handleApi(async () => currentOps(request).updateConfig(await readJson(request)));
}

export const POST = methodNotAllowed;
export const DELETE = methodNotAllowed;
