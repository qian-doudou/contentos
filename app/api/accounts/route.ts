import { currentMasterData } from '@/lib/api/context';
import { handleApi, readJson, methodNotAllowed } from '@/lib/api/handler';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  return handleApi(() => currentMasterData().listAccounts(Object.fromEntries(new URL(request.url).searchParams)));
}
export async function POST(request: Request) {
  return handleApi(async () => currentMasterData().createAccount(await readJson(request)), 201);
}
export const DELETE = methodNotAllowed;
