import { currentMasterData } from '@/lib/api/context';
import { handleApi, readJson, methodNotAllowed } from '@/lib/api/handler';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  return handleApi(() => currentMasterData(request).listAccounts(Object.fromEntries(new URL(request.url).searchParams)));
}
export async function POST(request: Request) {
  return handleApi(async () => currentMasterData(request).createAccount(await readJson(request)), 201);
}
export const DELETE = methodNotAllowed;
