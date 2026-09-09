import { z } from 'zod';
import {
  contentGoals,
  contentStatuses,
  contentTypes,
  hookTypes,
  performanceImportStatuses,
  publishPlatforms,
  publishStatuses,
} from '@/db/constants';

const uuid = z.uuid();
const timestamp = z.iso.datetime({ offset: true });
const nullableMetric = z.number().nonnegative().nullable().optional();
const nullableIntegerMetric = z.number().int().nonnegative().nullable().optional();

export const createPublishSchema = z.object({
  platform: z.enum(publishPlatforms).default('douyin'),
  publishedAt: timestamp,
  postUrl: z.url().max(2000).refine(value => /^https?:\/\//i.test(value), '发布链接必须使用 http 或 https'),
  platformPostId: z.string().trim().min(1).max(300).nullable().optional().default(null),
}).strict();

export const publishSchema = z.object({
  id: uuid,
  organizationId: uuid,
  contentId: uuid,
  platform: z.enum(publishPlatforms),
  publishedAt: timestamp,
  postUrl: z.string().min(1).max(2000),
  platformPostId: z.string().max(300).nullable(),
  status: z.enum(publishStatuses),
  createdBy: uuid,
  isDemo: z.boolean(),
  createdAt: timestamp,
});

export const snapshotMetricFields = [
  'views', 'likes', 'comments', 'shares', 'favorites', 'profileVisits',
  'groupbuyClicks', 'orders', 'gmv',
] as const;

export const createPerformanceSnapshotSchema = z.object({
  snapshotTime: timestamp,
  views: nullableIntegerMetric.default(null),
  likes: nullableIntegerMetric.default(null),
  comments: nullableIntegerMetric.default(null),
  shares: nullableIntegerMetric.default(null),
  favorites: nullableIntegerMetric.default(null),
  profileVisits: nullableIntegerMetric.default(null),
  groupbuyClicks: nullableIntegerMetric.default(null),
  orders: nullableIntegerMetric.default(null),
  gmv: nullableMetric.default(null),
}).strict();

export const performanceSnapshotSchema = createPerformanceSnapshotSchema.extend({
  id: uuid,
  organizationId: uuid,
  publishId: uuid,
  isDemo: z.boolean(),
  createdAt: timestamp,
});

export const derivedPerformanceMetricsSchema = z.object({
  engagementRate: z.number().nonnegative().nullable(),
  groupbuyCtr: z.number().nonnegative().nullable(),
  orderConversionRate: z.number().nonnegative().nullable(),
  gmvPer1000Views: z.number().nonnegative().nullable(),
});

export const performanceSnapshotViewSchema = performanceSnapshotSchema.extend({
  derived: derivedPerformanceMetricsSchema,
});

export const contentPerformanceSchema = z.object({
  content: z.object({ id: uuid, title: z.string(), status: z.enum(contentStatuses) }),
  publish: publishSchema.nullable(),
  snapshots: z.array(performanceSnapshotViewSchema),
  permissions: z.object({ canPublish: z.boolean(), canWritePerformance: z.boolean() }),
});

export const publishResultSchema = z.object({
  publish: publishSchema,
  content: z.object({ id: uuid, status: z.literal('PUBLISHED'), publishedAt: timestamp }),
});

export const analyticsQuerySchema = z.object({
  accountId: uuid.optional(),
  from: timestamp.optional(),
  to: timestamp.optional(),
  contentType: z.enum(contentTypes).optional(),
  hookType: z.enum(hookTypes).optional(),
  contentGoal: z.enum(contentGoals).optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
}).strict().refine(value => !value.from || !value.to || value.from <= value.to, {
  path: ['to'], message: '结束时间不得早于开始时间',
});

export const analyticsAccountOptionSchema = z.object({
  id: uuid,
  accountName: z.string(),
  clientName: z.string(),
});

export const analyticsRowSchema = z.object({
  snapshot: performanceSnapshotViewSchema,
  publish: publishSchema,
  content: z.object({
    id: uuid,
    title: z.string(),
    contentType: z.enum(contentTypes),
    contentGoal: z.enum(contentGoals),
    hookType: z.enum(hookTypes),
  }),
  account: analyticsAccountOptionSchema,
});

export const analyticsContentResultSchema = z.object({
  items: z.array(analyticsRowSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  options: z.object({ accounts: z.array(analyticsAccountOptionSchema) }),
  permissions: z.object({ canImport: z.boolean() }),
});

const mappingHeader = z.string().trim().min(1).max(200);
export const performanceImportMappingSchema = z.object({
  publishId: mappingHeader.optional(),
  platformPostId: mappingHeader.optional(),
  snapshotTime: mappingHeader,
  views: mappingHeader.optional(),
  likes: mappingHeader.optional(),
  comments: mappingHeader.optional(),
  shares: mappingHeader.optional(),
  favorites: mappingHeader.optional(),
  profileVisits: mappingHeader.optional(),
  groupbuyClicks: mappingHeader.optional(),
  orders: mappingHeader.optional(),
  gmv: mappingHeader.optional(),
}).strict().refine(value => Boolean(value.publishId || value.platformPostId), {
  message: 'publishId 与 platformPostId 至少映射一个',
  path: ['publishId'],
});

export const performanceImportPreviewInputSchema = z.object({
  payload: z.string().min(1).max(1_000_000),
  mapping: performanceImportMappingSchema,
}).strict();

export const performanceImportPreviewItemSchema = z.object({
  rowNumber: z.number().int().positive(),
  status: z.enum(['valid', 'duplicate', 'invalid']),
  publishId: uuid.nullable(),
  platformPostId: z.string().nullable(),
  contentId: uuid.nullable(),
  contentTitle: z.string().nullable(),
  accountName: z.string().nullable(),
  snapshot: createPerformanceSnapshotSchema.nullable(),
  issues: z.array(z.string()),
});

export const performanceImportBatchSchema = z.object({
  id: uuid,
  organizationId: uuid,
  sourceHash: z.string().length(64),
  mappingJson: performanceImportMappingSchema,
  previewJson: z.unknown(),
  status: z.enum(performanceImportStatuses),
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

export const performanceImportPreviewSchema = z.object({
  batch: performanceImportBatchSchema.omit({ previewJson: true }),
  items: z.array(performanceImportPreviewItemSchema).max(500),
  headers: z.array(z.string()),
  canCommit: z.boolean(),
});

export const performanceImportCommitInputSchema = z.object({ batchId: uuid }).strict();
export const performanceImportCommitResultSchema = z.object({
  batch: performanceImportBatchSchema.omit({ previewJson: true }),
  snapshotIds: z.array(uuid),
});

export type CreatePerformanceSnapshot = z.infer<typeof createPerformanceSnapshotSchema>;
export type PerformanceSnapshotView = z.infer<typeof performanceSnapshotViewSchema>;
export type PerformanceImportPreviewItem = z.infer<typeof performanceImportPreviewItemSchema>;
