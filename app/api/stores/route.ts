import { z } from 'zod';
import { currentMasterData } from '@/lib/api/context';
import { handleApi, readJson, methodNotAllowed } from '@/lib/api/handler';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  return handleApi(async () => currentMasterData(request).createStore(await readJson(request)), 201);
}
export async function PUT(request: Request) {
  return handleApi(async () => {
    const { id, ...input } = z.looseObject({ id: z.uuid() }).parse(await readJson(request));
    return currentMasterData(request).updateStore(id, input);
  });
}
export const DELETE = methodNotAllowed;
