import { localContextIds } from '@/lib/api/context';
import { handleApi, readJson } from '@/lib/api/handler';
import { db } from '@/db/client';
import { teamService } from '@/lib/team/service';

type Context = { params: Promise<{ id: string }> };

export async function PUT(request: Request, context: Context) {
  return handleApi(async () => {
    const { organizationId, userId } = localContextIds(request);
    return teamService(db, organizationId, userId).update((await context.params).id, await readJson(request));
  });
}
