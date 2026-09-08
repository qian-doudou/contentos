import { z } from 'zod';
import {
  contentGoals,
  contentImportDedupStrategies,
  contentImportFormats,
  contentImportStatuses,
  contentTypes,
  duplicateLevels,
  historyRetrievalMethods,
} from '@/db/constants';

const uuid = z.uuid();
const timestamp = z.iso.datetime({ offset: true });
const nullableText = (maximum: number) =>
  z.string().trim().max(maximum).nullable().optional();

export const contentImportRowInputSchema = z
  .object({
    account_id: nullableText(100),
    account_identifier: nullableText(160),
    external_id: nullableText(300),
    title: z.string().trim().min(1).max(160),
    content_type: z.enum(contentTypes).nullable().optional(),
    content_goal: z.enum(contentGoals).nullable().optional(),
    topic: nullableText(300),
    angle: nullableText(5000),
    hook_text: nullableText(5000),
    core_message: nullableText(5000),
    published_at: timestamp.nullable().optional(),
  })
  .strict()
  .refine(
    (value) => Boolean(value.account_id || value.account_identifier),
    'account_id 或 account_identifier 至少填写一个',
  );

export const contentImportPreviewInputSchema = z
  .object({
    format: z.enum(contentImportFormats),
    dedupStrategy: z.enum(contentImportDedupStrategies),
    payload: z.string().min(1).max(1_000_000),
  })
  .strict();

export const contentImportPreviewItemSchema = z.object({
  rowNumber: z.number().int().positive(),
  status: z.enum(['valid', 'duplicate', 'invalid']),
  accountId: uuid.nullable(),
  accountName: z.string().nullable(),
  externalId: z.string().nullable(),
  title: z.string(),
  contentType: z.enum(contentTypes).nullable(),
  contentGoal: z.enum(contentGoals).nullable(),
  topic: z.string(),
  angle: z.string(),
  hookText: z.string(),
  coreMessage: z.string(),
  publishedAt: timestamp.nullable(),
  dedupKey: z.string().nullable(),
  existingContentId: uuid.nullable(),
  issues: z.array(z.string()),
});

export const contentImportBatchSchema = z.object({
  id: uuid,
  organizationId: uuid,
  format: z.enum(contentImportFormats),
  dedupStrategy: z.enum(contentImportDedupStrategies),
  sourceHash: z.string().length(64),
  previewJson: z.unknown(),
  status: z.enum(contentImportStatuses),
  totalRows: z.number().int().nonnegative(),
  validRows: z.number().int().nonnegative(),
  duplicateRows: z.number().int().nonnegative(),
  invalidRows: z.number().int().nonnegative(),
  committedRows: z.number().int().nonnegative(),
  createdBy: uuid,
  isDemo: z.boolean(),
  committedAt: timestamp.nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
});

export const contentImportPreviewSchema = z.object({
  batch: contentImportBatchSchema.omit({ previewJson: true }),
  items: z.array(contentImportPreviewItemSchema).max(200),
  canCommit: z.boolean(),
});

export const contentImportCommitInputSchema = z
  .object({ batchId: uuid })
  .strict();

export const contentImportCommitResultSchema = z.object({
  batch: contentImportBatchSchema.omit({ previewJson: true }),
  contentIds: z.array(uuid),
  embedding: z.object({
    indexed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    mode: z.enum(['live', 'fallback']),
    model: z.string(),
  }),
});

export const historyAccountOptionSchema = z.object({
  id: uuid,
  accountName: z.string(),
  clientId: uuid,
  clientName: z.string(),
  canWrite: z.boolean(),
});

export const contentImportPageDataSchema = z.object({
  accounts: z.array(historyAccountOptionSchema),
  batches: z.array(contentImportBatchSchema.omit({ previewJson: true })),
  permissions: z.object({ canImport: z.boolean(), canTest: z.boolean() }),
});

export const embeddingVectorSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('dense'),
    values: z.array(z.number()).min(1).max(8192),
  }),
  z.object({
    kind: z.literal('weighted_terms'),
    weights: z.record(z.string().min(1).max(40), z.number().positive()),
  }),
]);

export const contentEmbeddingSchema = z.object({
  id: uuid,
  organizationId: uuid,
  accountId: uuid,
  contentId: uuid,
  embeddingModel: z.string().min(1),
  sourceHash: z.string().length(64),
  vectorJson: embeddingVectorSchema,
  status: z.enum(['active', 'stale', 'failed']),
  isDemo: z.boolean(),
  createdAt: timestamp,
  updatedAt: timestamp,
});

export const historyCandidateSchema = z
  .object({
    accountId: uuid,
    title: z.string().trim().min(1).max(160),
    contentType: z.enum(contentTypes).nullable().optional(),
    contentGoal: z.enum(contentGoals).nullable().optional(),
    topic: nullableText(300),
    angle: nullableText(5000),
    hookText: nullableText(5000),
    coreMessage: nullableText(5000),
  })
  .strict()
  .transform((value) => ({
    ...value,
    contentType: value.contentType ?? null,
    contentGoal: value.contentGoal ?? null,
    topic: value.topic ?? '',
    angle: value.angle ?? '',
    hookText: value.hookText ?? '',
    coreMessage: value.coreMessage ?? '',
  }));

export const ruleScoreSchema = z.object({
  semantic: z.number().min(0).max(1),
  topic: z.number().min(0).max(1),
  angle: z.number().min(0).max(1),
  hook: z.number().min(0).max(1),
  coreMessage: z.number().min(0).max(1),
  combined: z.number().min(0).max(1),
});

export const historyRetrievalItemSchema = z.object({
  contentId: uuid,
  title: z.string(),
  contentType: z.enum(contentTypes),
  contentGoal: z.enum(contentGoals),
  topic: z.string(),
  angle: z.string(),
  hookText: z.string(),
  coreMessage: z.string(),
  publishedAt: timestamp.nullable(),
  similarity: z.number().min(0).max(1),
  retrievalMethod: z.enum(historyRetrievalMethods),
  sourceHash: z.string().length(64),
  rank: z.number().int().min(1).max(10),
  ruleScore: ruleScoreSchema,
  sentToJudge: z.boolean(),
});

export const duplicateJudgeOutputSchema = z
  .object({
    duplicate_level: z.enum(duplicateLevels),
    similar_content_ids: z.array(uuid).max(5),
    reason: z.string().trim().min(1).max(2000),
    recommended_action: z.string().trim().min(1).max(2000),
    alternative_angles: z.array(z.string().trim().min(1).max(500)).max(10),
  })
  .strict();

export const duplicateJudgeInputJsonSchema = {
  type: 'object',
  properties: {
    candidate: {
      type: 'object',
      properties: {
        title: { type: 'string', minLength: 1, maxLength: 160 },
        content_type: { type: 'string', maxLength: 40 },
        content_goal: { type: 'string', maxLength: 40 },
        topic: { type: 'string', maxLength: 300 },
        angle: { type: 'string', maxLength: 5000 },
        hook_text: { type: 'string', maxLength: 5000 },
        core_message: { type: 'string', maxLength: 5000 },
      },
      required: [
        'title',
        'content_type',
        'content_goal',
        'topic',
        'angle',
        'hook_text',
        'core_message',
      ],
      additionalProperties: false,
    },
    similar_contents: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          content_id: { type: 'string', minLength: 1, maxLength: 100 },
          title: { type: 'string', minLength: 1, maxLength: 160 },
          topic: { type: 'string', maxLength: 300 },
          angle: { type: 'string', maxLength: 5000 },
          hook_text: { type: 'string', maxLength: 5000 },
          core_message: { type: 'string', maxLength: 5000 },
          semantic_similarity: { type: 'number', minimum: 0, maximum: 1 },
          rule_score: { type: 'number', minimum: 0, maximum: 1 },
        },
        required: [
          'content_id',
          'title',
          'topic',
          'angle',
          'hook_text',
          'core_message',
          'semantic_similarity',
          'rule_score',
        ],
        additionalProperties: false,
      },
      maxItems: 5,
    },
  },
  required: ['candidate', 'similar_contents'],
  additionalProperties: false,
} as const;

export const duplicateJudgeOutputJsonSchema = {
  type: 'object',
  properties: {
    duplicate_level: {
      type: 'string',
      enum: ['new', 'mild', 'remixable', 'high'],
    },
    similar_content_ids: {
      type: 'array',
      items: { type: 'string', minLength: 1, maxLength: 100 },
      maxItems: 5,
    },
    reason: { type: 'string', minLength: 1, maxLength: 2000 },
    recommended_action: { type: 'string', minLength: 1, maxLength: 2000 },
    alternative_angles: {
      type: 'array',
      items: { type: 'string', minLength: 1, maxLength: 500 },
      maxItems: 10,
    },
  },
  required: [
    'duplicate_level',
    'similar_content_ids',
    'reason',
    'recommended_action',
    'alternative_angles',
  ],
  additionalProperties: false,
} as const;

export const dedupTestResultSchema = z.object({
  marker: z.literal('TEST_RUN'),
  retrievalId: uuid,
  candidate: historyCandidateSchema,
  top10: z.array(historyRetrievalItemSchema).max(10),
  judgeInputContentIds: z.array(uuid).max(5),
  judgment: duplicateJudgeOutputSchema,
  fallbackUsed: z.boolean(),
  fallbackReason: z.string().nullable(),
  embedding: z.object({
    provider: z.literal('Alibaba Cloud Model Studio (Bailian)'),
    mode: z.enum(['live', 'fallback']),
    model: z.string(),
    retryCount: z.literal(1),
  }),
  run: z
    .object({
      id: uuid,
      status: z.enum([
        'queued',
        'running',
        'completed',
        'completed_with_warnings',
        'manual_review_required',
        'failed',
        'cancelled',
      ]),
      billedPoints: z.number().int().nonnegative(),
      mode: z.enum(['mock', 'live']),
      schemaValid: z.boolean(),
    })
    .nullable(),
});

export type ContentImportPreviewItem = z.infer<
  typeof contentImportPreviewItemSchema
>;
export type ContentImportPreview = z.infer<typeof contentImportPreviewSchema>;
export type HistoryCandidate = z.infer<typeof historyCandidateSchema>;
export type EmbeddingVector = z.infer<typeof embeddingVectorSchema>;
export type DuplicateJudgeOutput = z.infer<typeof duplicateJudgeOutputSchema>;
export type DedupTestResult = z.infer<typeof dedupTestResultSchema>;
