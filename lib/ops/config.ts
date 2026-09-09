import { and, desc, eq, gt, lte } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as tables from '@/db/schema';
import type { User } from '@/db/validation';
import { ApiError } from '@/lib/api/envelope';
import { opsConfigSchema, type OpsConfig, type RunType } from './contracts';

type Database = BetterSQLite3Database<typeof tables>;

export const OPS_CONFIG_KEY = 'ops.config';
export const DEFAULT_OPS_CONFIG: OpsConfig = {
  deliveryRisk: {
    toleranceRate: 0.08,
    highGapRate: 0.15,
    nearMonthEndDays: 5,
    nearMonthEndRemainingCount: 3,
  },
  allowAdminTestEvalAtQuotaLimit: true,
};

export function readOpsConfig(db: Database, organizationId: string): OpsConfig {
  const row = db.select({ valueJson: tables.appSettings.valueJson })
    .from(tables.appSettings)
    .where(and(
      eq(tables.appSettings.organizationId, organizationId),
      eq(tables.appSettings.key, OPS_CONFIG_KEY),
      eq(tables.appSettings.isSecret, false),
    ))
    .get();
  if (!row) return DEFAULT_OPS_CONFIG;
  try {
    return opsConfigSchema.parse(JSON.parse(row.valueJson));
  } catch {
    throw new ApiError(500, 'OPS_CONFIG_INVALID', '运营中心配置无效，请由管理员修复');
  }
}

export function assertNonProductionAiAllowed(
  db: Database,
  organizationId: string,
  role: User['role'],
  runType: RunType,
  at: string,
) {
  if (runType === 'production') return;
  const quota = db.select().from(tables.organizationAiQuotas).where(and(
    eq(tables.organizationAiQuotas.organizationId, organizationId),
    lte(tables.organizationAiQuotas.periodStart, at),
    gt(tables.organizationAiQuotas.periodEnd, at),
  )).orderBy(desc(tables.organizationAiQuotas.periodStart)).get();
  if (!quota || quota.usedPoints < quota.quotaPoints) return;
  const config = readOpsConfig(db, organizationId);
  if (config.allowAdminTestEvalAtQuotaLimit && (role === 'owner' || role === 'admin')) return;
  throw new ApiError(
    402,
    'AI_NON_PRODUCTION_QUOTA_POLICY_BLOCKED',
    'AI 额度已用尽，当前系统设置不允许该身份继续运行 Test/Eval',
  );
}
