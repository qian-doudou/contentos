import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { ApiError, fail, ok, requestId } from '@/lib/api/envelope';
import { getLlmConfig } from '@/lib/llm/client';

export const runtime = 'nodejs';

export async function GET() {
  const id = requestId();
  try {
    db.run(sql`select 1`);
    return ok(
      {
        service: 'contentos',
        status: 'ok',
        database: 'connected',
        llm_mode: getLlmConfig().mode,
        checked_at: new Date().toISOString(),
      },
      id,
    );
  } catch (error) {
    console.error(`[${id}] Health check failed`, error);
    return fail(new ApiError(503, 'DATABASE_UNAVAILABLE', '数据库健康检查失败'), id);
  }
}
