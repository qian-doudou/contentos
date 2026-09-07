import { and, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { users } from '@/db/schema';
import { devIdentityInputSchema } from '@/lib/auth/contracts';
import { identityData } from '@/lib/auth/identity';
import { DEV_USER_COOKIE, localContextIds } from '@/lib/api/context';
import { ApiError, fail, ok, requestId } from '@/lib/api/envelope';
import { handleApi, readJson } from '@/lib/api/handler';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  return handleApi(() => {
    const { organizationId, userId } = localContextIds(request);
    return identityData(db, organizationId, userId, process.env.NODE_ENV !== 'production');
  });
}

export async function POST(request: Request) {
  const id = requestId();
  try {
    if (process.env.NODE_ENV === 'production')
      throw new ApiError(403, 'DEV_IDENTITY_DISABLED', '生产环境不允许切换开发身份');
    const { userId } = devIdentityInputSchema.parse(await readJson(request));
    const { organizationId } = localContextIds(request);
    const target = db.select().from(users).where(and(
      eq(users.organizationId, organizationId),
      eq(users.id, userId),
      eq(users.status, 'active'),
    )).get();
    if (!target) throw new ApiError(404, 'USER_NOT_FOUND', '用户不存在、不属于当前组织或已停用');
    const response = ok(identityData(db, organizationId, target.id, true), id);
    response.headers.append('Set-Cookie', `${DEV_USER_COOKIE}=${encodeURIComponent(target.id)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`);
    return response;
  } catch (error) {
    return fail(error, id);
  }
}
