import { z } from 'zod';
import { runTypes, userRoles, userStatuses } from '@/db/constants';
import { aiUsageLogSchema } from '@/lib/ai/contracts';
import { runSchema } from '@/db/validation';

const uuid = z.uuid();
const timestamp = z.iso.datetime({ offset: true });
const rate = z.number().nonnegative();

export const opsConfigSchema = z.object({
  deliveryRisk: z.object({
    toleranceRate: z.number().min(0).max(1),
    highGapRate: z.number().min(0).max(1),
    nearMonthEndDays: z.number().int().min(0).max(15),
    nearMonthEndRemainingCount: z.number().int().min(1).max(1000),
  }),
  allowAdminTestEvalAtQuotaLimit: z.boolean(),
}).strict();

export const updateOpsConfigInputSchema = opsConfigSchema;

export const opsPeriodQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
}).strict().refine(
  (value) => (value.year === undefined) === (value.month === undefined),
  { message: 'year 和 month 必须同时提供' },
);

export const deliveryRiskLevels = ['low', 'medium', 'high'] as const;
export const deliveryPeriodStates = [
  'current', 'future', 'closed', 'overdue', 'closed_with_gap', 'draft',
] as const;

export const deliveryPlanSchema = z.object({
  planId: uuid,
  clientId: uuid,
  clientName: z.string(),
  accountId: uuid,
  accountName: z.string(),
  year: z.number().int(),
  month: z.number().int(),
  planStatus: z.enum(['active', 'inactive']),
  plannedCount: z.number().int().nonnegative(),
  publishedCount: z.number().int().nonnegative(),
  remainingCount: z.number().int().nonnegative(),
  completionRate: rate,
  periodProgressRate: z.number().min(0).max(1),
  riskLevel: z.enum(deliveryRiskLevels),
  periodState: z.enum(deliveryPeriodStates),
  riskReasons: z.array(z.string()),
});

const memberSchema = z.object({
  id: uuid,
  name: z.string(),
  role: z.enum(userRoles),
  status: z.enum(userStatuses),
});

export const teamFactSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('operator'),
    member: memberSchema.extend({ role: z.literal('operator') }),
    metrics: z.object({
      clientCount: z.number().int().nonnegative(),
      contentsCreated: z.number().int().nonnegative(),
      publishedCount: z.number().int().nonnegative(),
      overdueCount: z.number().int().nonnegative(),
    }),
  }),
  z.object({
    kind: z.literal('photographer'),
    member: memberSchema.extend({ role: z.literal('photographer') }),
    metrics: z.object({
      shootCount: z.number().int().nonnegative(),
      plannedItemCount: z.number().int().nonnegative(),
      completedItemCount: z.number().int().nonnegative(),
    }),
  }),
  z.object({
    kind: z.literal('editor'),
    member: memberSchema.extend({ role: z.literal('editor') }),
    metrics: z.object({
      pendingEditCount: z.number().int().nonnegative(),
      submittedVersionCount: z.number().int().nonnegative(),
      averageHandlingMs: z.number().int().nonnegative().nullable(),
    }),
  }),
]);

export const quotaAlertSchema = z.object({
  quotaId: uuid,
  quotaPoints: z.number().int().nonnegative(),
  usedPoints: z.number().int().nonnegative(),
  remainingPoints: z.number().int().nonnegative(),
  usageRate: z.number().min(0).max(1),
  alertLevel: z.enum(['normal', 'warning_70', 'critical_90', 'blocked_100']),
  billedProductionBlocked: z.boolean(),
  adminTestEvalAllowed: z.boolean(),
}).nullable();

export const opsOverviewDataSchema = z.object({
  period: z.object({
    year: z.number().int(),
    month: z.number().int(),
    label: z.string(),
  }),
  summary: z.object({
    planCount: z.number().int().nonnegative(),
    plannedCount: z.number().int().nonnegative(),
    publishedCount: z.number().int().nonnegative(),
    remainingCount: z.number().int().nonnegative(),
    highRiskPlanCount: z.number().int().nonnegative(),
  }),
  delivery: z.array(deliveryPlanSchema),
  teamFacts: z.array(teamFactSchema),
  quota: quotaAlertSchema,
  config: opsConfigSchema,
  permissions: z.object({ canConfigure: z.boolean() }),
  generatedAt: timestamp,
});

export const actionTaskSchema = z.object({
  id: z.string().min(1),
  category: z.enum(['script', 'approval', 'shoot', 'edit', 'publish', 'deadline', 'client_risk']),
  title: z.string(),
  detail: z.string(),
  href: z.string().startsWith('/'),
  dueAt: timestamp.nullable(),
  urgency: z.enum(['normal', 'due_soon', 'overdue', 'high']),
});

export const personalWorkbenchSchema = z.object({
  currentUser: memberSchema,
  counts: z.object({
    todayTodo: z.number().int().nonnegative(),
    scriptsToWrite: z.number().int().nonnegative(),
    pendingApproval: z.number().int().nonnegative(),
    todayShoots: z.number().int().nonnegative(),
    pendingEdits: z.number().int().nonnegative(),
    readyToPublish: z.number().int().nonnegative(),
    dueSoon: z.number().int().nonnegative(),
    highRiskClients: z.number().int().nonnegative(),
  }),
  tasks: z.array(actionTaskSchema),
  highRiskClients: z.array(z.object({
    clientId: uuid,
    clientName: z.string(),
    accountNames: z.array(z.string()),
    remainingCount: z.number().int().nonnegative(),
    href: z.string().startsWith('/'),
    reasons: z.array(z.string()),
  })),
  generatedAt: timestamp,
});

export const aiCostQuerySchema = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
}).strict().refine(
  (value) => (value.from === undefined) === (value.to === undefined),
  { message: 'from 和 to 必须同时提供' },
).refine(
  (value) => !value.from || !value.to || value.from <= value.to,
  { message: 'from 不能晚于 to' },
);

export const aiCostGroupSchema = z.object({
  key: z.string(),
  label: z.string(),
  callCount: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  unknownTokenCalls: z.number().int().nonnegative(),
  billedPoints: z.number().int().nonnegative(),
  estimatedCost: z.number().nonnegative().nullable(),
  knownEstimatedCost: z.number().nonnegative(),
  unknownCostCalls: z.number().int().nonnegative(),
});

export const aiCostDataSchema = z.object({
  period: z.object({ from: z.iso.date(), to: z.iso.date() }),
  totals: aiCostGroupSchema.omit({ key: true, label: true }),
  groups: z.object({
    bySkill: z.array(aiCostGroupSchema),
    byModel: z.array(aiCostGroupSchema),
    byClient: z.array(aiCostGroupSchema),
    byAccount: z.array(aiCostGroupSchema),
    byUser: z.array(aiCostGroupSchema),
  }),
  quota: quotaAlertSchema,
  generatedAt: timestamp,
});

export const safeRunStepSchema = z.object({
  id: uuid,
  sequence: z.number().int().nonnegative(),
  stepCode: z.string(),
  status: z.enum(['pending', 'running', 'succeeded', 'failed', 'skipped']),
  input: z.unknown().nullable(),
  output: z.unknown().nullable(),
  error: z.unknown().nullable(),
  warningCodes: z.array(z.string()),
  startedAt: timestamp.nullable(),
  finishedAt: timestamp.nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
});

export const runDetailDataSchema = z.object({
  run: runSchema,
  actor: memberSchema.nullable(),
  steps: z.array(safeRunStepSchema),
  usage: z.array(aiUsageLogSchema),
  totals: z.object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    unknownTokenCalls: z.number().int().nonnegative(),
    estimatedCost: z.number().nonnegative().nullable(),
    knownEstimatedCost: z.number().nonnegative(),
    unknownCostCalls: z.number().int().nonnegative(),
    billedPoints: z.number().int().nonnegative(),
    retryCount: z.number().int().nonnegative(),
  }),
  contextSnapshots: z.array(z.object({
    id: uuid,
    accountId: uuid,
    contentId: uuid.nullable(),
    monthlyPlanId: uuid.nullable(),
    snapshot: z.unknown(),
    createdAt: timestamp,
  })),
  errors: z.array(z.object({ stepCode: z.string(), detail: z.unknown() })),
  businessResult: z.object({
    type: z.string(),
    id: z.string().nullable(),
    label: z.string(),
    status: z.string().nullable(),
    href: z.string().startsWith('/').nullable(),
  }),
  generatedAt: timestamp,
});

export type OpsConfig = z.infer<typeof opsConfigSchema>;
export type DeliveryPlan = z.infer<typeof deliveryPlanSchema>;
export type OpsOverviewData = z.infer<typeof opsOverviewDataSchema>;
export type PersonalWorkbench = z.infer<typeof personalWorkbenchSchema>;
export type AiCostData = z.infer<typeof aiCostDataSchema>;
export type AiCostGroup = z.infer<typeof aiCostGroupSchema>;
export type RunDetailData = z.infer<typeof runDetailDataSchema>;
export type RunType = (typeof runTypes)[number];
