import { db } from '@/db/client';
import { localContextIds } from '@/lib/api/context';
import { handleApi, methodNotAllowed, readJson } from '@/lib/api/handler';
import { teamService } from '@/lib/team/service';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  return handleApi(() => {
    const { organizationId, userId } = localContextIds(request);
    return teamService(db, organizationId, userId).list();
  });
}

export async function POST(request: Request) {
  return handleApi(async () => {
    const { organizationId, userId } = localContextIds(request);
    return teamService(db, organizationId, userId).create(await readJson(request));
  }, 201);
}

export const PUT = methodNotAllowed;
export const DELETE = methodNotAllowed;
