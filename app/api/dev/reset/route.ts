import { seedDemoData } from '@/db/seed';
import { fail, ok, requestId, ApiError } from '@/lib/api/envelope';
import { devResetInputSchema } from '@/lib/contracts';
import { currentPermissions } from '@/lib/api/context';
import { DEMO_IDS } from '@/db/seed';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const id = requestId();
  try {
    if (process.env.NODE_ENV === 'production') {
      throw new ApiError(403, 'DEV_RESET_DISABLED', '生产环境不允许重置演示数据');
    }
    let input: unknown;
    try {
      input = await request.json();
    } catch {
      throw new ApiError(400, 'INVALID_JSON', '请求体必须是有效 JSON');
    }
    const body = devResetInputSchema.parse(input);
    if (body.confirm !== 'RESET_DEMO') {
      throw new ApiError(400, 'RESET_CONFIRMATION_REQUIRED', '需要明确的重置确认');
    }
    const permissions = currentPermissions(request);
    permissions.require('system.dangerous');
    const organization = permissions.organization;
    if (organization.id !== DEMO_IDS.organization || !organization.isDemo) {
      throw new ApiError(403, 'DEMO_ORGANIZATION_REQUIRED', '仅演示组织可恢复演示数据');
    }
    const origin = request.headers.get('origin');
    if (origin && origin !== new URL(request.url).origin) {
      throw new ApiError(403, 'ORIGIN_FORBIDDEN', '不允许跨站写入');
    }
    return ok(seedDemoData({ reset: true }), id);
  } catch (error) {
    return fail(error, id);
  }
}
