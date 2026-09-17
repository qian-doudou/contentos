import { and, asc, desc, eq, gt, gte, inArray, isNull, lt, lte, or } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { z } from 'zod';
import * as tables from '@/db/schema';
import { aiUsageLogSchema } from '@/lib/ai/contracts';
import { ApiError } from '@/lib/api/envelope';
import { permissionService } from '@/lib/auth/permissions';
import {
  approvalStatuses, closedContentStatuses, dueSoonWindowMs, scriptDraftStatuses, type ContentStatus,
} from '@/lib/content/workflow';
import {
  aiCostDataSchema,
  aiCostQuerySchema,
  deliveryPlanSchema,
  opsOverviewDataSchema,
  opsPeriodQuerySchema,
  personalWorkbenchSchema,
  runDetailDataSchema,
  teamFactSchema,
  updateOpsConfigInputSchema,
  type AiCostGroup,
  type DeliveryPlan,
  type OpsConfig,
} from './contracts';
import { DEFAULT_OPS_CONFIG, OPS_CONFIG_KEY, readOpsConfig } from './config';
import { parseTraceValue, sanitizeTrace, snapshotIdsFrom } from './trace-safety';

type Database = BetterSQLite3Database<typeof tables>;

const SHANGHAI_TIME_ZONE = 'Asia/Shanghai';
const CLOSED_CONTENT_STATUSES = new Set<ContentStatus>(closedContentStatuses);
const PENDING_EDIT_STATUSES = new Set(['SHOT', 'EDITING', 'REVISION']);
const APPROVAL_STATUSES = new Set<ContentStatus>(approvalStatuses);
const SCRIPT_DRAFT_STATUSES = new Set<ContentStatus>(scriptDraftStatuses);

function json(value: unknown) {
  return JSON.stringify(value);
}

function localParts(at: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SHANGHAI_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { year: value('year'), month: value('month'), day: value('day') };
}

function dateOnly(parts: { year: number; month: number; day: number }) {
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function monthIndex(year: number, month: number) {
  return year * 12 + month - 1;
}

function monthDateRange(year: number, month: number) {
  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  const to = `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth(year, month)).padStart(2, '0')}`;
  return { from, to };
}

function nextDate(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function shanghaiBoundary(value: string) {
  return new Date(`${value}T00:00:00+08:00`).toISOString();
}

export function calculateDeliveryRisk(
  input: {
    year: number;
    month: number;
    planStatus: 'active' | 'inactive';
    plannedCount: number;
    publishedCount: number;
  },
  config: OpsConfig['deliveryRisk'] = DEFAULT_OPS_CONFIG.deliveryRisk,
  at = new Date(),
) {
  const current = localParts(at);
  const targetIndex = monthIndex(input.year, input.month);
  const currentIndex = monthIndex(current.year, current.month);
  const remainingCount = Math.max(0, input.plannedCount - input.publishedCount);
  const completionRate = input.plannedCount > 0 ? input.publishedCount / input.plannedCount : 0;

  if (targetIndex < currentIndex) {
    if (remainingCount > 0) {
      return {
        remainingCount,
        completionRate,
        periodProgressRate: 1,
        riskLevel: 'high' as const,
        periodState: input.planStatus === 'inactive' ? 'closed_with_gap' as const : 'overdue' as const,
        riskReasons: [input.planStatus === 'inactive' ? '历史计划已关闭但仍有缺口' : '历史计划已过期且仍有缺口'],
      };
    }
    return {
      remainingCount,
      completionRate,
      periodProgressRate: 1,
      riskLevel: 'low' as const,
      periodState: 'closed' as const,
      riskReasons: [],
    };
  }

  if (input.planStatus === 'inactive') {
    return {
      remainingCount,
      completionRate,
      periodProgressRate: targetIndex === currentIndex ? current.day / daysInMonth(current.year, current.month) : 0,
      riskLevel: 'low' as const,
      periodState: 'draft' as const,
      riskReasons: [],
    };
  }

  if (targetIndex > currentIndex) {
    return {
      remainingCount,
      completionRate,
      periodProgressRate: 0,
      riskLevel: 'low' as const,
      periodState: 'future' as const,
      riskReasons: [],
    };
  }

  const totalDays = daysInMonth(current.year, current.month);
  const periodProgressRate = current.day / totalDays;
  if (remainingCount === 0 || input.plannedCount === 0) {
    return {
      remainingCount,
      completionRate,
      periodProgressRate,
      riskLevel: 'low' as const,
      periodState: 'current' as const,
      riskReasons: [],
    };
  }

  const daysRemaining = totalDays - current.day;
  if (daysRemaining <= config.nearMonthEndDays && remainingCount >= config.nearMonthEndRemainingCount) {
    return {
      remainingCount,
      completionRate,
      periodProgressRate,
      riskLevel: 'high' as const,
      periodState: 'current' as const,
      riskReasons: [`距月底仅 ${daysRemaining} 天，仍需发布 ${remainingCount} 条`],
    };
  }
  if (completionRate + config.toleranceRate + config.highGapRate < periodProgressRate) {
    return {
      remainingCount,
      completionRate,
      periodProgressRate,
      riskLevel: 'high' as const,
      periodState: 'current' as const,
      riskReasons: ['履约完成率显著落后于自然月进度'],
    };
  }
  if (completionRate + config.toleranceRate < periodProgressRate) {
    return {
      remainingCount,
      completionRate,
      periodProgressRate,
      riskLevel: 'medium' as const,
      periodState: 'current' as const,
      riskReasons: ['履约完成率轻度落后于自然月进度'],
    };
  }
  return {
    remainingCount,
    completionRate,
    periodProgressRate,
    riskLevel: 'low' as const,
    periodState: 'current' as const,
    riskReasons: [],
  };
}

function quotaAlert(row: typeof tables.organizationAiQuotas.$inferSelect | undefined, config: OpsConfig) {
  if (!row) return null;
  const usageRate = row.quotaPoints === 0 ? 1 : Math.min(1, row.usedPoints / row.quotaPoints);
  const alertLevel = usageRate >= 1
    ? 'blocked_100' as const
    : usageRate >= 0.9
      ? 'critical_90' as const
      : usageRate >= 0.7
        ? 'warning_70' as const
        : 'normal' as const;
  return {
    quotaId: row.id,
    quotaPoints: row.quotaPoints,
    usedPoints: row.usedPoints,
    remainingPoints: Math.max(0, row.quotaPoints - row.usedPoints),
    usageRate,
    alertLevel,
    billedProductionBlocked: usageRate >= 1,
    adminTestEvalAllowed: usageRate < 1 || config.allowAdminTestEvalAtQuotaLimit,
  };
}

function aggregateCost(
  rows: Array<z.infer<typeof aiUsageLogSchema>>,
  group: (row: z.infer<typeof aiUsageLogSchema>) => { key: string; label: string },
) {
  const values = new Map<string, AiCostGroup>();
  for (const row of rows) {
    const identity = group(row);
    const item = values.get(identity.key) ?? {
      ...identity,
      callCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      unknownTokenCalls: 0,
      billedPoints: 0,
      estimatedCost: 0,
      knownEstimatedCost: 0,
      unknownCostCalls: 0,
    };
    item.callCount += 1;
    item.inputTokens += row.inputTokens ?? 0;
    item.outputTokens += row.outputTokens ?? 0;
    if (row.inputTokens === null || row.outputTokens === null) item.unknownTokenCalls += 1;
    item.billedPoints += row.billedPoints;
    if (row.estimatedCost === null) {
      item.unknownCostCalls += 1;
      item.estimatedCost = null;
    } else {
      item.knownEstimatedCost += row.estimatedCost;
      if (item.estimatedCost !== null) item.estimatedCost += row.estimatedCost;
    }
    values.set(identity.key, item);
  }
  return [...values.values()].sort((a, b) => b.callCount - a.callCount || a.label.localeCompare(b.label, 'zh-CN'));
}

export function opsService(
  db: Database,
  organizationId: string,
  userId: string,
  runtime: { now?: () => Date } = {},
) {
  const permissions = permissionService(db, organizationId, userId);
  const now = runtime.now ?? (() => new Date());
  const timestamp = () => now().toISOString();
  const config = () => readOpsConfig(db, organizationId);

  function activeQuota() {
    const at = timestamp();
    return db.select().from(tables.organizationAiQuotas).where(and(
      eq(tables.organizationAiQuotas.organizationId, organizationId),
      lte(tables.organizationAiQuotas.periodStart, at),
      gt(tables.organizationAiQuotas.periodEnd, at),
    )).orderBy(desc(tables.organizationAiQuotas.periodStart)).get();
  }

  function buildDelivery(year: number, month: number, allowedClientIds: string[] | null = null): DeliveryPlan[] {
    const planRows = db.select().from(tables.monthlyPlans).where(and(
      eq(tables.monthlyPlans.organizationId, organizationId),
      eq(tables.monthlyPlans.year, year),
      eq(tables.monthlyPlans.month, month),
    )).orderBy(asc(tables.monthlyPlans.createdAt)).all();
    const accounts = db.select().from(tables.accounts).where(eq(tables.accounts.organizationId, organizationId)).all();
    const clients = db.select().from(tables.clients).where(eq(tables.clients.organizationId, organizationId)).all();
    const contentRows = db.select().from(tables.contents).where(eq(tables.contents.organizationId, organizationId)).all();
    const publishRows = db.select().from(tables.publishes).where(and(
      eq(tables.publishes.organizationId, organizationId),
      eq(tables.publishes.status, 'active'),
    )).all();
    const publishedContentIds = new Set(publishRows.map((row) => row.contentId));
    const accountMap = new Map(accounts.map((row) => [row.id, row]));
    const clientMap = new Map(clients.map((row) => [row.id, row]));
    const permitted = allowedClientIds === null ? null : new Set(allowedClientIds);
    return planRows.flatMap((plan) => {
      const account = accountMap.get(plan.accountId);
      if (!account || (permitted && !permitted.has(account.clientId))) return [];
      const client = clientMap.get(account.clientId);
      if (!client) return [];
      const publishedCount = new Set(contentRows.filter((content) =>
        content.monthlyPlanId === plan.id && publishedContentIds.has(content.id),
      ).map((content) => content.id)).size;
      const delivery = calculateDeliveryRisk({
        year: plan.year,
        month: plan.month,
        planStatus: plan.status,
        plannedCount: plan.plannedContentCount,
        publishedCount,
      }, config().deliveryRisk, now());
      return [deliveryPlanSchema.parse({
        planId: plan.id,
        clientId: client.id,
        clientName: client.clientName,
        accountId: account.id,
        accountName: account.accountName,
        year: plan.year,
        month: plan.month,
        planStatus: plan.status,
        plannedCount: plan.plannedContentCount,
        publishedCount,
        ...delivery,
      })];
    });
  }

  function visibleContentRows() {
    const rows = db.select().from(tables.contents).where(eq(tables.contents.organizationId, organizationId)).all();
    if (permissions.actor.role === 'owner' || permissions.actor.role === 'admin') return rows;
    if (permissions.actor.role === 'editor') return rows.filter((row) => row.editorId === userId);
    if (permissions.actor.role === 'photographer') return [];
    const ids = new Set(permissions.readableClientIds() ?? []);
    return rows.filter((row) => ids.has(row.clientId));
  }

  function visibleShootRows() {
    const rows = db.select().from(tables.shoots).where(eq(tables.shoots.organizationId, organizationId)).all();
    if (permissions.actor.role === 'owner' || permissions.actor.role === 'admin') return rows;
    if (permissions.actor.role === 'photographer') return rows.filter((row) => row.photographerId === userId);
    if (permissions.actor.role === 'operator' || permissions.actor.role === 'viewer') {
      const ids = new Set(permissions.readableClientIds() ?? []);
      return rows.filter((row) => ids.has(row.clientId));
    }
    return [];
  }

  function teamFacts(year: number, month: number) {
    const range = monthDateRange(year, month);
    const start = shanghaiBoundary(range.from);
    const end = shanghaiBoundary(nextDate(range.to));
    const members = db.select().from(tables.users).where(and(
      eq(tables.users.organizationId, organizationId),
      eq(tables.users.status, 'active'),
    )).orderBy(asc(tables.users.createdAt)).all();
    const memberships = db.select().from(tables.clientMembers).where(eq(tables.clientMembers.organizationId, organizationId)).all();
    const contentRows = db.select().from(tables.contents).where(eq(tables.contents.organizationId, organizationId)).all();
    const publishRows = db.select().from(tables.publishes).where(and(
      eq(tables.publishes.organizationId, organizationId),
      gte(tables.publishes.publishedAt, start),
      lt(tables.publishes.publishedAt, end),
      eq(tables.publishes.status, 'active'),
    )).all();
    const contentById = new Map(contentRows.map((row) => [row.id, row]));
    const shootRows = db.select().from(tables.shoots).where(and(
      eq(tables.shoots.organizationId, organizationId),
      gte(tables.shoots.shootDate, range.from),
      lte(tables.shoots.shootDate, range.to),
    )).all();
    const shootIds = new Set(shootRows.map((row) => row.id));
    const shootItems = db.select().from(tables.shootContents).where(eq(tables.shootContents.organizationId, organizationId)).all()
      .filter((row) => shootIds.has(row.shootId));
    const editRows = db.select().from(tables.editVersions).where(and(
      eq(tables.editVersions.organizationId, organizationId),
      gte(tables.editVersions.createdAt, start),
      lt(tables.editVersions.createdAt, end),
    )).all();
    const statusLogs = db.select().from(tables.contentStatusLogs)
      .where(eq(tables.contentStatusLogs.organizationId, organizationId)).orderBy(asc(tables.contentStatusLogs.createdAt)).all();
    const nowMs = now().getTime();

    return members.flatMap<z.infer<typeof teamFactSchema>>((member) => {
      const base = { id: member.id, name: member.name, role: member.role, status: member.status };
      if (member.role === 'operator') {
        const publishedIds = new Set(publishRows.filter((publish) => contentById.get(publish.contentId)?.operatorId === member.id).map((row) => row.contentId));
        return [{
          kind: 'operator' as const,
          member: { ...base, role: 'operator' as const },
          metrics: {
            clientCount: new Set(memberships.filter((row) => row.userId === member.id).map((row) => row.clientId)).size,
            contentsCreated: contentRows.filter((row) => row.createdBy === member.id && row.createdAt >= start && row.createdAt < end).length,
            publishedCount: publishedIds.size,
            overdueCount: contentRows.filter((row) => row.operatorId === member.id && row.deadline !== null
              && Date.parse(row.deadline) < nowMs && !CLOSED_CONTENT_STATUSES.has(row.status)).length,
          },
        }];
      }
      if (member.role === 'photographer') {
        const ownShoots = shootRows.filter((row) => row.photographerId === member.id);
        const ownShootIds = new Set(ownShoots.map((row) => row.id));
        const items = shootItems.filter((row) => ownShootIds.has(row.shootId));
        return [{
          kind: 'photographer' as const,
          member: { ...base, role: 'photographer' as const },
          metrics: {
            shootCount: ownShoots.length,
            plannedItemCount: items.filter((row) => row.shootItemStatus !== 'cancelled').length,
            completedItemCount: items.filter((row) => row.shootItemStatus === 'shot').length,
          },
        }];
      }
      if (member.role === 'editor') {
        const versions = editRows.filter((row) => row.createdBy === member.id);
        const durations = versions.flatMap((version) => {
          const started = statusLogs.filter((log) => log.contentId === version.contentId
            && (log.newStatus === 'EDITING' || log.newStatus === 'REVISION')
            && log.createdAt <= version.createdAt).at(-1);
          if (!started) return [];
          const value = Date.parse(version.createdAt) - Date.parse(started.createdAt);
          return Number.isFinite(value) && value >= 0 ? [value] : [];
        });
        return [{
          kind: 'editor' as const,
          member: { ...base, role: 'editor' as const },
          metrics: {
            pendingEditCount: contentRows.filter((row) => row.editorId === member.id && PENDING_EDIT_STATUSES.has(row.status)).length,
            submittedVersionCount: versions.length,
            averageHandlingMs: durations.length ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : null,
          },
        }];
      }
      return [];
    });
  }

  function businessResult(run: typeof tables.runs.$inferSelect) {
    if (run.subjectType === 'ai_content_planner' && run.subjectId) {
      const row = db.select().from(tables.plannerSessions).where(and(
        eq(tables.plannerSessions.organizationId, organizationId), eq(tables.plannerSessions.id, run.subjectId),
      )).get();
      return { type: run.subjectType, id: run.subjectId, label: 'AI Planner 候选会话', status: row?.status ?? null, href: row ? '/ai/planner' : null };
    }
    if (run.subjectType === 'script_generation' && run.subjectId) {
      const row = db.select().from(tables.contents).where(and(
        eq(tables.contents.organizationId, organizationId), eq(tables.contents.id, run.subjectId),
      )).get();
      return { type: run.subjectType, id: run.subjectId, label: row?.title ?? '脚本生成内容', status: row?.status ?? null, href: row ? `/contents/${row.id}` : null };
    }
    if (run.subjectType === 'strategy_review' && run.subjectId) {
      const row = db.select().from(tables.strategyReviews).where(and(
        eq(tables.strategyReviews.organizationId, organizationId), eq(tables.strategyReviews.id, run.subjectId),
      )).get();
      return { type: run.subjectType, id: run.subjectId, label: '策略复盘', status: row?.status ?? null, href: row ? '/ai/reviews' : null };
    }
    if (run.subjectType.startsWith('skill:') && run.subjectId) {
      const row = db.select().from(tables.skills).where(and(
        eq(tables.skills.id, run.subjectId),
        or(isNull(tables.skills.organizationId), eq(tables.skills.organizationId, organizationId)),
      )).get();
      return { type: run.subjectType, id: run.subjectId, label: row?.name ?? run.subjectType, status: row ? (row.enabled ? 'enabled' : 'disabled') : null, href: row ? `/skills/${row.id}` : null };
    }
    return { type: run.subjectType, id: run.subjectId, label: run.subjectType, status: null, href: null };
  }

  return {
    personalWorkbench() {
      const at = now();
      const nowMs = at.getTime();
      const today = dateOnly(localParts(at));
      const dueSoonLimit = nowMs + dueSoonWindowMs;
      const contentRows = visibleContentRows();
      const shootRows = visibleShootRows().filter((row) => row.shootDate === today
        && row.status !== 'cancelled' && row.status !== 'rescheduled');
      const clients = db.select().from(tables.clients).where(eq(tables.clients.organizationId, organizationId)).all();
      const clientMap = new Map(clients.map((row) => [row.id, row.clientName]));
      const parts = localParts(at);
      const deliveryClientIds = permissions.actor.role === 'owner' || permissions.actor.role === 'admin'
        ? null
        : permissions.actor.role === 'operator' || permissions.actor.role === 'viewer'
          ? permissions.readableClientIds() ?? []
          : [];
      const delivery = deliveryClientIds !== null && deliveryClientIds.length === 0
        ? []
        : buildDelivery(parts.year, parts.month, deliveryClientIds);
      const highRiskPlans = delivery.filter((row) => row.riskLevel === 'high' && row.periodState === 'current');
      const highRiskMap = new Map<string, { clientId: string; clientName: string; accountNames: Set<string>; remainingCount: number; reasons: Set<string> }>();
      for (const plan of highRiskPlans) {
        const current = highRiskMap.get(plan.clientId) ?? {
          clientId: plan.clientId, clientName: plan.clientName, accountNames: new Set<string>(), remainingCount: 0, reasons: new Set<string>(),
        };
        current.accountNames.add(plan.accountName);
        current.remainingCount += plan.remainingCount;
        for (const reason of plan.riskReasons) current.reasons.add(reason);
        highRiskMap.set(plan.clientId, current);
      }
      const highRiskClients = [...highRiskMap.values()].map((item) => ({
        clientId: item.clientId,
        clientName: item.clientName,
        accountNames: [...item.accountNames],
        remainingCount: item.remainingCount,
        href: `/clients/${item.clientId}`,
        reasons: [...item.reasons],
      }));
      const tasks = new Map<string, z.infer<typeof personalWorkbenchSchema>['tasks'][number]>();
      for (const content of contentRows) {
        const deadlineMs = content.deadline ? Date.parse(content.deadline) : null;
        const clientName = clientMap.get(content.clientId) ?? '客户';
        const base = {
          id: `content:${content.id}`,
          detail: `${clientName} · ${content.status}`,
          href: permissions.actor.role === 'editor' ? `/edits/${content.id}` : `/contents/${content.id}`,
          dueAt: content.deadline,
        };
        if (deadlineMs !== null && deadlineMs < nowMs && !CLOSED_CONTENT_STATUSES.has(content.status)) {
          tasks.set(base.id, { ...base, category: 'deadline', title: `已延期：${content.title}`, urgency: 'overdue' });
        } else if (deadlineMs !== null && deadlineMs <= dueSoonLimit && !CLOSED_CONTENT_STATUSES.has(content.status)) {
          tasks.set(base.id, { ...base, category: 'deadline', title: `即将延期：${content.title}`, urgency: 'due_soon' });
        } else if (SCRIPT_DRAFT_STATUSES.has(content.status)) {
          tasks.set(base.id, { ...base, category: 'script', title: `待写脚本：${content.title}`, urgency: 'normal' });
        } else if (APPROVAL_STATUSES.has(content.status) && permissions.actor.role !== 'editor') {
          tasks.set(base.id, { ...base, category: 'approval', title: `待审核：${content.title}`, urgency: 'normal' });
        } else if (PENDING_EDIT_STATUSES.has(content.status)) {
          tasks.set(base.id, { ...base, category: 'edit', title: `待剪辑：${content.title}`, urgency: 'normal' });
        } else if (content.status === 'READY_TO_PUBLISH') {
          tasks.set(base.id, { ...base, category: 'publish', title: `待发布：${content.title}`, urgency: 'normal' });
        }
      }
      for (const shoot of shootRows) {
        tasks.set(`shoot:${shoot.id}`, {
          id: `shoot:${shoot.id}`,
          category: 'shoot',
          title: `今日拍摄：${clientMap.get(shoot.clientId) ?? '客户'}`,
          detail: `${shoot.startTime}–${shoot.endTime} · ${shoot.location || '地点待补充'}`,
          href: `/shoots/${shoot.id}`,
          dueAt: new Date(`${shoot.shootDate}T${shoot.startTime}:00+08:00`).toISOString(),
          urgency: 'normal',
        });
      }
      for (const item of highRiskClients) {
        tasks.set(`client-risk:${item.clientId}`, {
          id: `client-risk:${item.clientId}`,
          category: 'client_risk',
          title: `高风险客户：${item.clientName}`,
          detail: `本月仍缺 ${item.remainingCount} 条 · ${item.reasons.join('；')}`,
          href: item.href,
          dueAt: null,
          urgency: 'high',
        });
      }
      const sortedTasks = [...tasks.values()].sort((a, b) => {
        const priority = { overdue: 0, high: 1, due_soon: 2, normal: 3 } as const;
        return priority[a.urgency] - priority[b.urgency]
          || (a.dueAt ?? '9999').localeCompare(b.dueAt ?? '9999');
      });
      const dueSoon = contentRows.filter((row) => row.deadline !== null
        && Date.parse(row.deadline) >= nowMs && Date.parse(row.deadline) <= dueSoonLimit
        && !CLOSED_CONTENT_STATUSES.has(row.status)).length;
      return personalWorkbenchSchema.parse({
        currentUser: {
          id: permissions.actor.id,
          name: permissions.actor.name,
          role: permissions.actor.role,
          status: permissions.actor.status,
        },
        counts: {
          todayTodo: sortedTasks.length,
          scriptsToWrite: contentRows.filter((row) => SCRIPT_DRAFT_STATUSES.has(row.status)).length,
          pendingApproval: contentRows.filter((row) => APPROVAL_STATUSES.has(row.status)).length,
          todayShoots: shootRows.length,
          pendingEdits: contentRows.filter((row) => PENDING_EDIT_STATUSES.has(row.status)).length,
          readyToPublish: contentRows.filter((row) => row.status === 'READY_TO_PUBLISH').length,
          dueSoon,
          highRiskClients: highRiskClients.length,
        },
        tasks: sortedTasks.slice(0, 20),
        highRiskClients,
        generatedAt: timestamp(),
      });
    },

    overview(input: unknown) {
      permissions.require('ops.read');
      const query = opsPeriodQuerySchema.parse(input);
      const current = localParts(now());
      const year = query.year ?? current.year;
      const month = query.month ?? current.month;
      const delivery = buildDelivery(year, month);
      const summary = delivery.reduce((value, row) => ({
        planCount: value.planCount + 1,
        plannedCount: value.plannedCount + row.plannedCount,
        publishedCount: value.publishedCount + row.publishedCount,
        remainingCount: value.remainingCount + row.remainingCount,
        highRiskPlanCount: value.highRiskPlanCount + (row.riskLevel === 'high' ? 1 : 0),
      }), { planCount: 0, plannedCount: 0, publishedCount: 0, remainingCount: 0, highRiskPlanCount: 0 });
      const currentConfig = config();
      return opsOverviewDataSchema.parse({
        period: { year, month, label: `${year} 年 ${month} 月` },
        summary,
        delivery,
        teamFacts: teamFacts(year, month),
        quota: quotaAlert(activeQuota(), currentConfig),
        config: currentConfig,
        permissions: { canConfigure: permissions.has('ai.settings') },
        generatedAt: timestamp(),
      });
    },

    updateConfig(input: unknown) {
      permissions.require('ai.settings');
      const value = updateOpsConfigInputSchema.parse(input);
      const at = timestamp();
      return db.transaction(() => {
        db.insert(tables.appSettings).values({
          id: crypto.randomUUID(), organizationId, key: OPS_CONFIG_KEY, valueJson: json(value),
          isSecret: false, isDemo: permissions.organization.isDemo, createdAt: at, updatedAt: at,
        }).onConflictDoUpdate({
          target: [tables.appSettings.organizationId, tables.appSettings.key],
          set: { valueJson: json(value), isSecret: false, updatedAt: at },
        }).run();
        db.insert(tables.auditLogs).values({
          id: crypto.randomUUID(), organizationId, userId, action: 'ops.config.updated', entityType: 'app_setting',
          entityId: null, metadataJson: json(value), isDemo: permissions.organization.isDemo, createdAt: at,
        }).run();
        return value;
      });
    },

    aiCost(input: unknown) {
      permissions.require('runs.read');
      const query = aiCostQuerySchema.parse(input);
      const current = localParts(now());
      const defaultRange = monthDateRange(current.year, current.month);
      const from = query.from ?? defaultRange.from;
      const to = query.to ?? defaultRange.to;
      const start = shanghaiBoundary(from);
      const end = shanghaiBoundary(nextDate(to));
      const rows = db.select().from(tables.aiUsageLogs).where(and(
        eq(tables.aiUsageLogs.organizationId, organizationId),
        gte(tables.aiUsageLogs.createdAt, start),
        lt(tables.aiUsageLogs.createdAt, end),
      )).orderBy(asc(tables.aiUsageLogs.createdAt)).all().map((row) => aiUsageLogSchema.parse(row));
      const clientMap = new Map(db.select().from(tables.clients).where(eq(tables.clients.organizationId, organizationId)).all().map((row) => [row.id, row.clientName]));
      const accountMap = new Map(db.select().from(tables.accounts).where(eq(tables.accounts.organizationId, organizationId)).all().map((row) => [row.id, row.accountName]));
      const userMap = new Map(db.select().from(tables.users).where(eq(tables.users.organizationId, organizationId)).all().map((row) => [row.id, row.name]));
      const skillMap = new Map(db.select().from(tables.skills).where(or(
        isNull(tables.skills.organizationId), eq(tables.skills.organizationId, organizationId),
      )).all().map((row) => [row.code, row.name]));
      const totalGroup = aggregateCost(rows, () => ({ key: 'total', label: '全部调用' }))[0] ?? {
        key: 'total', label: '全部调用', callCount: 0, inputTokens: 0, outputTokens: 0,
        unknownTokenCalls: 0, billedPoints: 0, estimatedCost: 0, knownEstimatedCost: 0, unknownCostCalls: 0,
      };
      const currentConfig = config();
      return aiCostDataSchema.parse({
        period: { from, to },
        totals: {
          callCount: totalGroup.callCount,
          inputTokens: totalGroup.inputTokens,
          outputTokens: totalGroup.outputTokens,
          unknownTokenCalls: totalGroup.unknownTokenCalls,
          billedPoints: totalGroup.billedPoints,
          estimatedCost: totalGroup.estimatedCost,
          knownEstimatedCost: totalGroup.knownEstimatedCost,
          unknownCostCalls: totalGroup.unknownCostCalls,
        },
        groups: {
          bySkill: aggregateCost(rows, (row) => ({ key: row.skillCode, label: skillMap.get(row.skillCode) ?? row.skillCode })),
          byModel: aggregateCost(rows, (row) => ({ key: row.model, label: row.model })),
          byClient: aggregateCost(rows, (row) => ({ key: row.clientId ?? 'unassigned', label: row.clientId ? clientMap.get(row.clientId) ?? '已删除客户' : '未关联客户' })),
          byAccount: aggregateCost(rows, (row) => ({ key: row.accountId ?? 'unassigned', label: row.accountId ? accountMap.get(row.accountId) ?? '已删除账号' : '未关联账号' })),
          byUser: aggregateCost(rows, (row) => ({ key: row.userId, label: userMap.get(row.userId) ?? '已停用成员' })),
        },
        quota: quotaAlert(activeQuota(), currentConfig),
        generatedAt: timestamp(),
      });
    },

    runDetail(id: string) {
      permissions.require('runs.read');
      const runId = z.uuid().parse(id);
      const run = db.select().from(tables.runs).where(and(
        eq(tables.runs.organizationId, organizationId), eq(tables.runs.id, runId),
      )).get();
      if (!run) throw new ApiError(404, 'RUN_NOT_FOUND', 'Run 不存在');
      const stepRows = db.select().from(tables.runSteps).where(and(
        eq(tables.runSteps.organizationId, organizationId), eq(tables.runSteps.runId, run.id),
      )).orderBy(asc(tables.runSteps.sequence)).all();
      const parsedSteps = stepRows.map((step) => ({
        rawInput: parseTraceValue(step.inputJson),
        rawOutput: parseTraceValue(step.outputJson),
        rawError: parseTraceValue(step.errorJson),
        row: step,
      }));
      const snapshotIds = new Set<string>();
      for (const step of parsedSteps) {
        snapshotIdsFrom(step.rawInput, snapshotIds);
        snapshotIdsFrom(step.rawOutput, snapshotIds);
      }
      const snapshots = snapshotIds.size ? db.select().from(tables.contextSnapshots).where(and(
        eq(tables.contextSnapshots.organizationId, organizationId),
        inArray(tables.contextSnapshots.id, [...snapshotIds]),
      )).orderBy(asc(tables.contextSnapshots.createdAt)).all() : [];
      const usage = db.select().from(tables.aiUsageLogs).where(and(
        eq(tables.aiUsageLogs.organizationId, organizationId), eq(tables.aiUsageLogs.runId, run.id),
      )).orderBy(asc(tables.aiUsageLogs.createdAt)).all().map((row) => aiUsageLogSchema.parse(row));
      const total = aggregateCost(usage, () => ({ key: 'total', label: '全部调用' }))[0] ?? {
        key: 'total', label: '全部调用', callCount: 0, inputTokens: 0, outputTokens: 0,
        unknownTokenCalls: 0, billedPoints: 0, estimatedCost: 0, knownEstimatedCost: 0, unknownCostCalls: 0,
      };
      const actor = run.createdBy ? db.select().from(tables.users).where(and(
        eq(tables.users.organizationId, organizationId), eq(tables.users.id, run.createdBy),
      )).get() : null;
      const steps = parsedSteps.map(({ row, rawInput, rawOutput, rawError }) => ({
        id: row.id,
        sequence: row.sequence,
        stepCode: row.stepCode,
        status: row.status,
        input: sanitizeTrace(rawInput),
        output: sanitizeTrace(rawOutput),
        error: sanitizeTrace(rawError),
        warningCodes: (() => {
          const parsed = parseTraceValue(row.warningCodesJson);
          return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
        })(),
        startedAt: row.startedAt,
        finishedAt: row.finishedAt,
        durationMs: row.durationMs,
      }));
      return runDetailDataSchema.parse({
        run,
        actor: actor ? { id: actor.id, name: actor.name, role: actor.role, status: actor.status } : null,
        steps,
        usage,
        totals: {
          inputTokens: total.inputTokens,
          outputTokens: total.outputTokens,
          unknownTokenCalls: total.unknownTokenCalls,
          estimatedCost: total.estimatedCost,
          knownEstimatedCost: total.knownEstimatedCost,
          unknownCostCalls: total.unknownCostCalls,
          billedPoints: total.billedPoints,
          retryCount: usage.reduce((sum, row) => sum + Math.max(0, row.attempts - 1), 0),
        },
        contextSnapshots: snapshots.map((row) => ({
          id: row.id, accountId: row.accountId, contentId: row.contentId,
          monthlyPlanId: row.monthlyPlanId, snapshot: sanitizeTrace(row.contextSnapshotJson), createdAt: row.createdAt,
        })),
        errors: steps.filter((step) => step.error !== null).map((step) => ({ stepCode: step.stepCode, detail: step.error })),
        businessResult: businessResult(run),
        generatedAt: timestamp(),
      });
    },
  };
}
