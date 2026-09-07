import { z } from 'zod';
import {
  contentGoals,
  contentPriorities,
  contentStatuses,
  contentTypes,
  hookTypes,
  memoryScopeTypes,
  memorySourceTypes,
  memoryStatuses,
  memoryTypes,
} from '@/db/constants';

const uuid = z.uuid();
const timestamp = z.iso.datetime({ offset: true });
const jsonValue = z.unknown().refine((value) => {
  try {
    return JSON.stringify(value) !== undefined;
  } catch {
    return false;
  }
}, '必须是可序列化的 JSON 值');

export const memorySchema = z
  .object({
    id: uuid,
    organizationId: uuid,
    scopeType: z.enum(memoryScopeTypes),
    scopeId: uuid,
    memoryKey: z.string().trim().min(1).max(160),
    memoryType: z.enum(memoryTypes),
    valueJson: jsonValue,
    summary: z.string().trim().min(1).max(1000),
    importance: z.number().int().min(1).max(5),
    confidence: z.number().min(0).max(1),
    sourceType: z.enum(memorySourceTypes),
    sourceId: uuid.nullable(),
    effectiveAt: timestamp,
    expiresAt: timestamp.nullable(),
    status: z.enum(memoryStatuses),
    supersedesMemoryId: uuid.nullable(),
    createdBy: uuid,
    isDemo: z.boolean(),
    createdAt: timestamp,
  })
  .refine((value) => !value.expiresAt || value.effectiveAt < value.expiresAt, {
    path: ['expiresAt'],
    message: '失效时间必须晚于生效时间',
  });

export const memoryAccountQuerySchema = z
  .object({
    accountId: uuid,
    status: z.enum(memoryStatuses).optional(),
    page: z.coerce.number().int().min(1).max(100000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

export const createManualMemorySchema = z
  .object({
    accountId: uuid,
    scopeType: z.enum(memoryScopeTypes),
    memoryKey: z
      .string()
      .trim()
      .min(1)
      .max(160)
      .regex(/^[a-z0-9][a-z0-9._-]*$/i, '请使用稳定的英文 key'),
    memoryType: z.enum(memoryTypes),
    valueJson: jsonValue,
    summary: z.string().trim().min(1).max(1000),
    importance: z.number().int().min(1).max(5).default(3),
    confidence: z.number().min(0).max(1).default(1),
    effectiveAt: timestamp.optional(),
    expiresAt: timestamp.nullable().default(null),
  })
  .strict()
  .refine(
    (value) =>
      !value.expiresAt ||
      !value.effectiveAt ||
      value.effectiveAt < value.expiresAt,
    {
      path: ['expiresAt'],
      message: '失效时间必须晚于生效时间',
    },
  );

export const initializeMemoriesSchema = z.object({ accountId: uuid }).strict();
export const deactivateMemorySchema = z
  .object({ reason: z.string().trim().min(1).max(500) })
  .strict();

export const memoryListSchema = z.object({
  account: z.object({
    id: uuid,
    name: z.string(),
    brandId: uuid,
    brandName: z.string(),
    clientId: uuid,
  }),
  items: z.array(memorySchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  permissions: z.object({
    canWrite: z.boolean(),
    canBuildContext: z.boolean(),
  }),
});

export const memoryMutationSchema = z.object({
  memory: memorySchema,
  replacedMemoryId: uuid.nullable(),
});

export const memoryInitializationResultSchema = z.object({
  created: z.array(memorySchema),
  skippedKeys: z.array(z.string()),
});

export const contextBuildInputSchema = z
  .object({
    accountId: uuid,
    contentId: uuid.optional(),
    monthlyPlanId: uuid.optional(),
    focus: z.string().trim().max(1000).default(''),
  })
  .strict();

export const stableContextItemSchema = z.object({
  key: z.string(),
  scopeType: z.enum(memoryScopeTypes),
  value: jsonValue,
  memoryId: uuid.nullable(),
});
export const contextMemoryItemSchema = z.object({
  id: uuid,
  scopeType: z.enum(memoryScopeTypes),
  memoryKey: z.string(),
  memoryType: z.enum(memoryTypes),
  summary: z.string(),
  value: jsonValue,
  importance: z.number().int(),
  confidence: z.number(),
  sourceType: z.enum(memorySourceTypes),
  sourceId: uuid.nullable(),
  relevance: z.number().int().nonnegative(),
});
export const historicalContentSummarySchema = z.object({
  id: uuid,
  title: z.string(),
  contentType: z.enum(contentTypes),
  contentGoal: z.enum(contentGoals),
  topic: z.string(),
  angle: z.string(),
  hookType: z.enum(hookTypes),
  hookText: z.string(),
  coreMessage: z.string(),
  productText: z.string(),
  ctaType: z.string(),
  localElement: z.string(),
  status: z.enum(contentStatuses),
  priority: z.enum(contentPriorities),
  plannedPublishDate: timestamp.nullable(),
  relevance: z.number().int().nonnegative(),
});
const contextPlanSchema = z.object({
  id: uuid,
  year: z.number().int(),
  month: z.number().int(),
  primaryGoal: z.enum(contentGoals),
  plannedContentCount: z.number().int().nonnegative(),
  campaignNotes: z.string(),
  keyProductsJson: z.array(z.string()),
  contentMixJson: z.record(z.string(), z.number()),
});
const contextTaskSchema = historicalContentSummarySchema.omit({
  relevance: true,
});
export const contextLayersSchema = z.object({
  l0SystemRules: z.array(z.string()),
  l1StableContext: z.array(stableContextItemSchema),
  l2Current: z.object({
    plan: contextPlanSchema.nullable(),
    task: contextTaskSchema.nullable(),
  }),
  l3Memories: z.array(contextMemoryItemSchema),
  l4HistoricalContentSummaries: z.array(historicalContentSummarySchema),
});
export const contextTruncationSchema = z.object({
  layer: z.enum(['L1', 'L2', 'L3', 'L4']),
  reason: z.enum(['item_limit', 'character_budget']),
  omitted: z.number().int().positive(),
});
export const contextSnapshotSchema = z.object({
  memoryIds: z.array(uuid),
  contentIds: z.array(uuid),
  planIds: z.array(uuid),
  truncations: z.array(contextTruncationSchema),
  estimatedCharacters: z.number().int().nonnegative(),
  estimatedTokens: z.number().int().nonnegative(),
  builtAt: timestamp,
  budgets: z.object({
    stableItems: z.number().int(),
    activeMemories: z.number().int(),
    historicalContents: z.number().int(),
    characters: z.number().int(),
  }),
});
export const contextBuildResultSchema = z.object({
  snapshotId: uuid,
  account: z.object({
    id: uuid,
    name: z.string(),
    brandId: uuid,
    brandName: z.string(),
    clientId: uuid,
  }),
  layers: contextLayersSchema,
  snapshot: contextSnapshotSchema,
});

export type Memory = z.infer<typeof memorySchema>;
export type ContextLayers = z.infer<typeof contextLayersSchema>;
export type ContextSnapshot = z.infer<typeof contextSnapshotSchema>;
export type ContextBuildResult = z.infer<typeof contextBuildResultSchema>;
