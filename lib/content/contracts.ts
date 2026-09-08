import { z } from 'zod';
import {
  businessStatuses, contentGoals, contentPriorities, contentStatuses, contentStatusTriggers, contentTypes, hookTypes,
} from '@/db/constants';

const uuid = z.uuid();
const timestamp = z.iso.datetime({ offset: true });
const name = z.string().trim().min(1, '不能为空').max(160);
const shortText = z.string().trim().max(300);
const longText = z.string().trim().max(5000);
const list = z.array(z.string().trim().min(1).max(300)).max(100);
const businessStatus = z.enum(businessStatuses);
const contentStatus = z.enum(contentStatuses);
const percentage = z.number().int().min(0).max(100);

export const contentMixSchema = z.partialRecord(z.enum(contentTypes), percentage);
type MixCandidate = { plannedContentCount: number; contentMixJson: Partial<Record<(typeof contentTypes)[number], number>> };
function validateContentMix(value: MixCandidate, context: z.RefinementCtx) {
  const percentages = Object.values(value.contentMixJson);
  if (value.plannedContentCount === 0 && percentages.length === 0) return;
  if (percentages.reduce((sum, item) => sum + item, 0) !== 100)
    context.addIssue({ code: 'custom', path: ['contentMixJson'], message: '内容配比百分比之和必须等于 100' });
}

const monthlyPlanFields = z.object({
  accountId: uuid,
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
  primaryGoal: z.enum(contentGoals),
  plannedContentCount: z.number().int().min(0).max(2147483647),
  campaignNotes: longText,
  keyProductsJson: list,
  contentMixJson: contentMixSchema,
  status: businessStatus,
}).strict();
export const monthlyPlanDefaults = {
  plannedContentCount: 0, campaignNotes: '', keyProductsJson: [], contentMixJson: {}, status: 'active' as const,
};
export const createMonthlyPlanSchema = monthlyPlanFields.partial().required({
  accountId: true, year: true, month: true, primaryGoal: true,
}).transform(value => ({ ...monthlyPlanDefaults, ...value })).superRefine(validateContentMix);
export const updateMonthlyPlanSchema = monthlyPlanFields.partial()
  .refine(value => Object.keys(value).length > 0, '至少提供一个字段');

const metadata = {
  id: uuid, organizationId: uuid, isDemo: z.boolean(), createdAt: timestamp, updatedAt: timestamp,
};
const monthlyPlanRowFields = {
  ...monthlyPlanFields.shape,
  ...metadata,
  createdBy: uuid,
};
export const monthlyPlanSchema = z.object(monthlyPlanRowFields).superRefine(validateContentMix);

const contentEditableFields = z.object({
  accountId: uuid,
  monthlyPlanId: uuid.nullable(),
  title: name,
  contentType: z.enum(contentTypes),
  contentGoal: z.enum(contentGoals),
  topic: shortText,
  angle: longText,
  hookType: z.enum(hookTypes),
  hookText: longText,
  coreMessage: longText,
  productText: longText,
  ctaType: shortText,
  localElement: longText,
  peopleJson: list,
  priority: z.enum(contentPriorities),
  operatorId: uuid,
  plannedPublishDate: timestamp.nullable(),
  deadline: timestamp.nullable(),
}).strict();
export const contentDefaults = {
  monthlyPlanId: null, topic: '', angle: '', hookType: 'other' as const, hookText: '', coreMessage: '',
  productText: '', ctaType: '', localElement: '', peopleJson: [],
  priority: 'normal' as const, plannedPublishDate: null, deadline: null,
};
export const createContentSchema = contentEditableFields.partial().required({
  accountId: true, title: true, contentType: true, contentGoal: true, operatorId: true,
}).transform(value => ({ ...contentDefaults, ...value }));
export const updateContentSchema = contentEditableFields.partial()
  .refine(value => Object.keys(value).length > 0, '至少提供一个字段');
export const contentSchema = contentEditableFields.extend({
  ...metadata,
  status: contentStatus,
  clientId: uuid,
  brandId: uuid,
  storeId: uuid,
  publishedAt: timestamp.nullable(),
  externalId: z.string().max(300).nullable(),
  importDedupKey: z.string().max(100).nullable(),
  importBatchId: uuid.nullable(),
  currentScriptVersionId: uuid.nullable(),
  activeApprovedScriptVersionId: uuid.nullable(),
  currentEditVersionId: uuid.nullable(),
  activeApprovedEditVersionId: uuid.nullable(),
  aiReviewStatus: z.string().trim().max(80).nullable(),
  createdBy: uuid,
});

export const planQuerySchema = z.object({
  accountId: uuid.optional(), year: z.coerce.number().int().min(2000).max(2100).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(), status: businessStatus.optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
}).strict();
export const contentQuerySchema = z.object({
  search: z.string().trim().max(160).optional(), clientId: uuid.optional(), brandId: uuid.optional(),
  storeId: uuid.optional(), accountId: uuid.optional(), monthlyPlanId: uuid.optional(),
  contentType: z.enum(contentTypes).optional(), contentGoal: z.enum(contentGoals).optional(),
  priority: z.enum(contentPriorities).optional(), operatorId: uuid.optional(), status: contentStatus.optional(),
  plannedFrom: timestamp.optional(), plannedTo: timestamp.optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(12),
}).strict().refine(value => !value.plannedFrom || !value.plannedTo || value.plannedFrom <= value.plannedTo, {
  path: ['plannedTo'], message: '结束日期不得早于开始日期',
});

export const contentAccessSchema = z.object({ canWrite: z.boolean() });
export const accountOptionSchema = z.object({
  id: uuid, clientId: uuid, brandId: uuid, storeId: uuid,
  accountName: z.string(), clientName: z.string(), brandName: z.string(), storeName: z.string(),
  canWrite: z.boolean(),
});
export const operatorOptionSchema = z.object({ id: uuid, name: z.string(), clientIds: z.array(uuid) });
export const planOptionSchema = z.object({ id: uuid, accountId: uuid, year: z.number().int(), month: z.number().int(), status: businessStatus });
export const contentOptionsSchema = z.object({
  accounts: z.array(accountOptionSchema), operators: z.array(operatorOptionSchema), plans: z.array(planOptionSchema),
});
export const monthlyPlanListItemSchema = z.object({
  ...monthlyPlanRowFields,
  accountName: z.string(), clientId: uuid, clientName: z.string(), createdContentCount: z.number().int().nonnegative(),
}).superRefine(validateContentMix);
export const monthlyPlanListSchema = z.object({
  items: z.array(monthlyPlanListItemSchema), total: z.number().int().nonnegative(), page: z.number().int(), pageSize: z.number().int(),
  options: z.object({ accounts: z.array(accountOptionSchema) }), permissions: contentAccessSchema,
});
export const mixStatSchema = z.object({
  contentType: z.enum(contentTypes), percentage, targetCount: z.number().int().nonnegative(), actualCount: z.number().int().nonnegative(),
});
export const monthlyPlanDetailSchema = z.object({
  plan: monthlyPlanListItemSchema, account: accountOptionSchema, mixStats: z.array(mixStatSchema), permissions: contentAccessSchema,
});
export const contentListItemSchema = contentSchema.extend({
  accountName: z.string(), clientName: z.string(), brandName: z.string(), storeName: z.string(), operatorName: z.string(),
  planYear: z.number().int().nullable(), planMonth: z.number().int().nullable(),
  overdue: z.boolean(), dueSoon: z.boolean(),
});
export const contentListSchema = z.object({
  items: z.array(contentListItemSchema), total: z.number().int().nonnegative(), page: z.number().int(), pageSize: z.number().int(),
  options: contentOptionsSchema, permissions: contentAccessSchema,
});
export const contentDetailSchema = z.object({
  content: contentListItemSchema, options: contentOptionsSchema, permissions: contentAccessSchema,
});

export const transitionContentInputSchema = z.object({
  newStatus: contentStatus,
  reason: z.string().trim().min(1, '请填写状态变更原因').max(1000),
}).strict();
export const contentStatusLogSchema = z.object({
  id: uuid,
  organizationId: uuid,
  contentId: uuid,
  previousStatus: contentStatus,
  newStatus: contentStatus,
  triggerType: z.enum(contentStatusTriggers),
  triggerId: uuid.nullable(),
  operatorId: uuid,
  reason: z.string().max(1000),
  isDemo: z.boolean(),
  createdAt: timestamp,
});
export const contentStatusHistoryItemSchema = contentStatusLogSchema.extend({ operatorName: z.string() });
export const contentTransitionResultSchema = z.object({
  content: contentListItemSchema,
  log: contentStatusHistoryItemSchema,
});
export const contentHistorySchema = z.object({
  contentId: uuid,
  currentStatus: contentStatus,
  items: z.array(contentStatusHistoryItemSchema),
  permissions: contentAccessSchema,
});

export const contentTypeLabels: Record<(typeof contentTypes)[number], string> = {
  persona: '人设', product: '产品', local: '本地', trust: '信任', conversion: '转化',
  education: '科普', process: '过程', customer_case: '客户案例', other: '其他',
};
export const contentGoalLabels: Record<(typeof contentGoals)[number], string> = {
  exposure: '曝光', followers: '涨粉', trust: '信任', click: '点击', conversion: '转化', gmv: 'GMV',
};
export const hookTypeLabels: Record<(typeof hookTypes)[number], string> = {
  contrast: '反差', conflict: '冲突', price: '价格', question: '提问', identity: '身份', local: '本地',
  result: '结果', mistake: '误区', secret: '秘密', challenge: '挑战', other: '其他',
};
export const priorityLabels: Record<(typeof contentPriorities)[number], string> = {
  low: '低', normal: '普通', high: '高', urgent: '紧急',
};
export const contentStatusLabels: Record<(typeof contentStatuses)[number], string> = {
  IDEA: '选题构思', SCRIPTING: '脚本中', WAITING_APPROVAL: '待客户审核', APPROVED: '已通过',
  WAITING_SHOOT: '待拍摄', SHOT: '已拍摄', EDITING: '剪辑中', WAITING_REVIEW: '待剪辑审核',
  REVISION: '修改中', READY_TO_PUBLISH: '待发布', PUBLISHED: '已发布', REVIEWED: '已复盘',
};
export const contentStatusTriggerLabels: Record<(typeof contentStatusTriggers)[number], string> = {
  manual: '手动', shoot: '拍摄事务', publish: '发布事务', system: '系统',
};

export type MonthlyPlan = z.infer<typeof monthlyPlanSchema>;
export type MonthlyPlanList = z.infer<typeof monthlyPlanListSchema>;
export type MonthlyPlanDetail = z.infer<typeof monthlyPlanDetailSchema>;
export type Content = z.infer<typeof contentSchema>;
export type ContentList = z.infer<typeof contentListSchema>;
export type ContentDetail = z.infer<typeof contentDetailSchema>;
export type ContentOptions = z.infer<typeof contentOptionsSchema>;
export type ContentStatusLog = z.infer<typeof contentStatusLogSchema>;
export type ContentTransitionResult = z.infer<typeof contentTransitionResultSchema>;
export type ContentHistory = z.infer<typeof contentHistorySchema>;
