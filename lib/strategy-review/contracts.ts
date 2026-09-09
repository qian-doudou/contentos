import { z } from 'zod';
import {
  contentGoals,
  contentTypes,
  hookTypes,
  strategyReviewStatuses,
} from '@/db/constants';
import { monthlyPlanSchema } from '@/lib/content/contracts';

const uuid = z.uuid();
const timestamp = z.iso.datetime({ offset: true });
const optionalMetric = z.number().nonnegative().nullable();
const percentage = z.number().int().min(0).max(100);

export const strategyReviewPeriodSchema = z
  .object({
    accountId: uuid,
    periodStart: timestamp,
    periodEnd: timestamp,
  })
  .strict()
  .refine((value) => value.periodStart < value.periodEnd, {
    path: ['periodEnd'],
    message: '周期结束时间必须晚于开始时间',
  });

export const strategyMetricGroupSchema = z.object({
  value: z.string(),
  contentCount: z.number().int().nonnegative(),
  viewsSampleCount: z.number().int().nonnegative(),
  averageViews: optionalMetric,
  medianViews: optionalMetric,
  groupbuyCtr: optionalMetric,
  gmvPer1000Views: optionalMetric,
});

export const strategyRankedContentSchema = z.object({
  contentId: uuid,
  title: z.string(),
  contentType: z.enum(contentTypes),
  hookType: z.enum(hookTypes),
  contentGoal: z.enum(contentGoals),
  topic: z.string(),
  angle: z.string(),
  coreMessage: z.string(),
  publishedAt: timestamp,
  snapshotTime: timestamp,
  views: z.number().int().nonnegative(),
  groupbuyCtr: optionalMetric,
  gmvPer1000Views: optionalMetric,
});

export const strategyMetricsSnapshotSchema = z.object({
  account: z.object({
    id: uuid,
    name: z.string(),
    clientId: uuid,
  }),
  period: z.object({ start: timestamp, end: timestamp }),
  publishedContentCount: z.number().int().nonnegative(),
  sampledContentCount: z.number().int().nonnegative(),
  viewsSampleCount: z.number().int().nonnegative(),
  totalViews: z.number().int().nonnegative(),
  averageViews: optionalMetric,
  medianViews: optionalMetric,
  byContentType: z.array(strategyMetricGroupSchema),
  byHookType: z.array(strategyMetricGroupSchema),
  byContentGoal: z.array(strategyMetricGroupSchema),
  topContents: z.array(strategyRankedContentSchema).max(5),
  bottomContents: z.array(strategyRankedContentSchema).max(5),
  groupbuyCtr: optionalMetric,
  gmvPer1000Views: optionalMetric,
  publishFrequency: z.object({
    periodDays: z.number().positive(),
    publishesPerWeek: z.number().nonnegative(),
    averageIntervalDays: optionalMetric,
  }),
  currentMonthlyPlan: z
    .object({
      id: uuid,
      year: z.number().int(),
      month: z.number().int(),
      primaryGoal: z.enum(contentGoals),
      plannedContentCount: z.number().int().nonnegative(),
      contentMixJson: z.partialRecord(z.enum(contentTypes), percentage),
      campaignNotes: z.string(),
    })
    .nullable(),
  generatedAt: timestamp,
  snapshotSelection: z.literal('latest_per_publish_at_period_end'),
});

export const performanceAnalyzerOutputSchema = z
  .object({
    summary: z.string().trim().min(1).max(4000),
    effective_patterns: z.array(z.string().trim().min(1).max(1000)).max(20),
    weak_patterns: z.array(z.string().trim().min(1).max(1000)).max(20),
    observations: z.array(z.string().trim().min(1).max(1000)).max(30),
    sample_size_notes: z.string().trim().min(1).max(2000),
    confidence: z.number().min(0).max(1),
  })
  .strict();

export const recommendedContentMixSchema = z
  .partialRecord(z.enum(contentTypes), percentage)
  .superRefine((value, context) => {
    if (Object.values(value).reduce((sum, item) => sum + item, 0) !== 100)
      context.addIssue({ code: 'custom', message: '推荐内容配比之和必须等于 100' });
  });

export const strategyPlannerOutputSchema = z
  .object({
    next_period_goal: z.enum(contentGoals),
    recommended_content_mix: recommendedContentMixSchema,
    keep: z.array(z.string().trim().min(1).max(1000)).max(20),
    reduce: z.array(z.string().trim().min(1).max(1000)).max(20),
    test: z.array(z.string().trim().min(1).max(1000)).max(20),
    next_actions: z.array(z.string().trim().min(1).max(1000)).max(30),
  })
  .strict();

export const strategyReviewSchema = z.object({
  id: uuid,
  organizationId: uuid,
  accountId: uuid,
  periodStart: timestamp,
  periodEnd: timestamp,
  metricsSnapshotJson: strategyMetricsSnapshotSchema,
  previousStrategyMemoryIdsJson: z.array(uuid),
  aiAnalysisJson: performanceAnalyzerOutputSchema,
  aiStrategyJson: strategyPlannerOutputSchema,
  status: z.enum(strategyReviewStatuses),
  confirmedBy: uuid.nullable(),
  confirmedAt: timestamp.nullable(),
  isDemo: z.boolean(),
  createdAt: timestamp,
});

export const generateStrategyReviewSchema = strategyReviewPeriodSchema;
export const confirmStrategyReviewSchema = z
  .object({ savePerformancePattern: z.boolean().default(false) })
  .strict();
export const rejectStrategyReviewSchema = z
  .object({ reason: z.string().trim().min(1).max(1000) })
  .strict();
export const strategyReviewListQuerySchema = z
  .object({
    accountId: uuid.optional(),
    status: z.enum(strategyReviewStatuses).optional(),
    page: z.coerce.number().int().min(1).max(100_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(12),
  })
  .strict();

export const strategyReviewAccountOptionSchema = z.object({
  id: uuid,
  name: z.string(),
  clientId: uuid,
  clientName: z.string(),
  canWrite: z.boolean(),
});

export const strategyReviewConfigSchema = z.object({
  minimumSampleSize: z.number().int().min(1).max(10_000),
});
export const updateStrategyReviewConfigSchema = strategyReviewConfigSchema.strict();
export const strategyReviewConfigResultSchema = z.object({
  config: strategyReviewConfigSchema,
  permissions: z.object({ canWrite: z.boolean() }),
});
export const strategyMetricsResultSchema = z.object({
  metrics: strategyMetricsSnapshotSchema,
  sampleThreshold: z.number().int().positive(),
  sampleThresholdMet: z.boolean(),
  canGenerate: z.boolean(),
});

export const strategyReviewViewSchema = strategyReviewSchema.extend({
  accountName: z.string(),
  clientName: z.string(),
  permissions: z.object({
    canWrite: z.boolean(),
    canConfirm: z.boolean(),
    canCreateNextPlan: z.boolean(),
  }),
  sampleThreshold: z.number().int().positive(),
  sampleThresholdMet: z.boolean(),
});

export const strategyReviewListSchema = z.object({
  items: z.array(strategyReviewViewSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  options: z.object({ accounts: z.array(strategyReviewAccountOptionSchema) }),
  config: strategyReviewConfigSchema,
  permissions: z.object({ canConfigure: z.boolean() }),
});

export const strategyReviewGenerationResultSchema = z.object({
  review: strategyReviewViewSchema,
  runId: uuid,
  contextSnapshotId: uuid,
  billedPoints: z.number().int().nonnegative(),
});

export const strategyReviewConfirmationResultSchema = z.object({
  review: strategyReviewViewSchema,
  strategyMemoryId: uuid,
  performanceMemoryId: uuid.nullable(),
});

export const nextPeriodPlanResultSchema = z.object({
  plan: monthlyPlanSchema,
  sourceReviewId: uuid,
});

const looseObjectJsonSchema = {
  type: 'object' as const,
  properties: {},
  additionalProperties: true,
};
const textArrayJsonSchema = {
  type: 'array' as const,
  items: { type: 'string' as const, minLength: 1, maxLength: 1000 },
  maxItems: 30,
};

export const performanceAnalyzerInputJsonSchema = {
  type: 'object' as const,
  properties: {
    metrics_snapshot: looseObjectJsonSchema,
    top_contents: { type: 'array' as const, items: looseObjectJsonSchema, maxItems: 5 },
    bottom_contents: { type: 'array' as const, items: looseObjectJsonSchema, maxItems: 5 },
    current_monthly_plan: looseObjectJsonSchema,
    active_memories: { type: 'array' as const, items: looseObjectJsonSchema, maxItems: 20 },
    confirmed_strategy_memories: { type: 'array' as const, items: looseObjectJsonSchema, maxItems: 20 },
  },
  required: [
    'metrics_snapshot',
    'top_contents',
    'bottom_contents',
    'current_monthly_plan',
    'active_memories',
    'confirmed_strategy_memories',
  ],
  additionalProperties: false,
};

export const performanceAnalyzerOutputJsonSchema = {
  type: 'object' as const,
  properties: {
    summary: { type: 'string' as const, minLength: 1, maxLength: 4000 },
    effective_patterns: textArrayJsonSchema,
    weak_patterns: textArrayJsonSchema,
    observations: textArrayJsonSchema,
    sample_size_notes: { type: 'string' as const, minLength: 1, maxLength: 2000 },
    confidence: { type: 'number' as const, minimum: 0, maximum: 1 },
  },
  required: ['summary', 'effective_patterns', 'weak_patterns', 'observations', 'sample_size_notes', 'confidence'],
  additionalProperties: false,
};

export const strategyPlannerInputJsonSchema = {
  type: 'object' as const,
  properties: {
    metrics_snapshot: looseObjectJsonSchema,
    performance_analysis: looseObjectJsonSchema,
    current_monthly_plan: looseObjectJsonSchema,
    active_memories: { type: 'array' as const, items: looseObjectJsonSchema, maxItems: 20 },
    confirmed_strategy_memories: { type: 'array' as const, items: looseObjectJsonSchema, maxItems: 20 },
  },
  required: ['metrics_snapshot', 'performance_analysis', 'current_monthly_plan', 'active_memories', 'confirmed_strategy_memories'],
  additionalProperties: false,
};

export const strategyPlannerOutputJsonSchema = {
  type: 'object' as const,
  properties: {
    next_period_goal: { type: 'string' as const, enum: [...contentGoals] },
    recommended_content_mix: {
      type: 'object' as const,
      properties: Object.fromEntries(contentTypes.map((type) => [type, { type: 'integer' as const, minimum: 0, maximum: 100 }])),
      additionalProperties: false,
    },
    keep: textArrayJsonSchema,
    reduce: textArrayJsonSchema,
    test: textArrayJsonSchema,
    next_actions: textArrayJsonSchema,
  },
  required: ['next_period_goal', 'recommended_content_mix', 'keep', 'reduce', 'test', 'next_actions'],
  additionalProperties: false,
};

export type StrategyMetricsSnapshot = z.infer<typeof strategyMetricsSnapshotSchema>;
export type PerformanceAnalyzerOutput = z.infer<typeof performanceAnalyzerOutputSchema>;
export type StrategyPlannerOutput = z.infer<typeof strategyPlannerOutputSchema>;
export type StrategyReviewView = z.infer<typeof strategyReviewViewSchema>;
export type StrategyReviewList = z.infer<typeof strategyReviewListSchema>;
