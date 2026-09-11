import { z } from 'zod';
import {
  approvalReviewerTypes,
  approvalStatuses,
  approvalTypes,
  contentStatuses,
  scriptSourceTypes,
} from '@/db/constants';

const uuid = z.uuid();
const timestamp = z.iso.datetime({ offset: true });
const text = (max: number) => z.string().trim().max(max);
const requiredText = (max: number) => text(max).min(1, '不能为空');

export const scriptShotSchema = z.record(z.string().trim().min(1).max(100), z.unknown());
export const scriptJsonSchema = z.object({
  title: requiredText(160),
  hook: requiredText(2000),
  spoken_script: requiredText(20_000),
  shots: z.array(scriptShotSchema).max(100),
  product_integration: text(5000),
  cta: text(2000),
  hashtags: z.array(requiredText(100)).max(50),
}).strict();

export const scriptGeneratorInputJsonSchema = {
  type: 'object',
  properties: {
    content: { type: 'object', properties: {}, additionalProperties: true },
    context: { type: 'object', properties: {}, additionalProperties: true },
    requirements: { type: 'object', properties: {}, additionalProperties: true },
  },
  required: ['content', 'context', 'requirements'],
  additionalProperties: false,
} as const;

export const scriptJsonOutputJsonSchema = {
  type: 'object',
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 160 },
    hook: { type: 'string', minLength: 1, maxLength: 2000 },
    spoken_script: { type: 'string', minLength: 1, maxLength: 20000 },
    shots: {
      type: 'array',
      maxItems: 100,
      items: { type: 'object', properties: {}, additionalProperties: true },
    },
    product_integration: { type: 'string', maxLength: 5000 },
    cta: { type: 'string', maxLength: 2000 },
    hashtags: {
      type: 'array',
      maxItems: 50,
      items: { type: 'string', minLength: 1, maxLength: 100 },
    },
  },
  required: ['title', 'hook', 'spoken_script', 'shots', 'product_integration', 'cta', 'hashtags'],
  additionalProperties: false,
} as const;

export const generateScriptInputSchema = z.object({
  changeSummary: text(1000).optional(),
}).strict().transform((value) => ({
  changeSummary: value.changeSummary || 'AI 根据当前 Content 与有效 Context 生成脚本',
}));

export const createManualScriptSchema = z.object({
  scriptJson: scriptJsonSchema,
  sourceType: z.enum(['operator', 'client_revision', 'rewrite']).default('operator'),
  changeSummary: requiredText(1000),
}).strict();

export const submitScriptApprovalSchema = z.object({
  versionId: uuid,
  reviewerType: z.enum(approvalReviewerTypes),
  reviewerUserId: uuid.nullable().optional(),
  expiresAt: timestamp.nullable().optional(),
}).strict().superRefine((value, context) => {
  if (value.reviewerType === 'internal_user' && !value.reviewerUserId)
    context.addIssue({ code: 'custom', path: ['reviewerUserId'], message: '内部审核必须选择审核成员' });
  if (value.reviewerType === 'external_client' && value.reviewerUserId)
    context.addIssue({ code: 'custom', path: ['reviewerUserId'], message: '外部客户审核不能绑定内部成员' });
});

export const approvalDecisionInputSchema = z.object({
  status: z.enum(['approved', 'changes_requested', 'rejected']),
  comment: text(3000).default(''),
}).strict();

export const scriptVersionSchema = z.object({
  id: uuid,
  organizationId: uuid,
  contentId: uuid,
  versionNo: z.number().int().positive(),
  scriptJson: scriptJsonSchema,
  sourceType: z.enum(scriptSourceTypes),
  changeSummary: z.string(),
  createdBy: uuid,
  creatorName: z.string(),
  isDemo: z.boolean(),
  createdAt: timestamp,
  isCurrent: z.boolean(),
  isActiveApproved: z.boolean(),
});

export const approvalViewSchema = z.object({
  id: uuid,
  contentId: uuid,
  approvalType: z.enum(approvalTypes),
  versionId: uuid,
  versionNo: z.number().int().positive(),
  status: z.enum(approvalStatuses),
  reviewerType: z.enum(approvalReviewerTypes),
  reviewerUserId: uuid.nullable(),
  reviewerName: z.string().nullable(),
  expiresAt: timestamp.nullable(),
  comment: z.string(),
  isDemo: z.boolean(),
  createdAt: timestamp,
  updatedAt: timestamp,
});

export const scriptWorkspaceSchema = z.object({
  content: z.object({
    id: uuid,
    title: z.string(),
    status: z.enum(contentStatuses),
    accountId: uuid,
    accountName: z.string(),
    brandName: z.string(),
    currentScriptVersionId: uuid.nullable(),
    activeApprovedScriptVersionId: uuid.nullable(),
  }),
  versions: z.array(scriptVersionSchema),
  approvals: z.array(approvalViewSchema),
  remainingPoints: z.number().int().nonnegative(),
  generatorPointCost: z.number().int().nonnegative().nullable(),
  mode: z.enum(['mock', 'live']),
  permissions: z.object({ canWrite: z.boolean(), canReview: z.boolean() }),
});

export const generateScriptResultSchema = z.object({
  workspace: scriptWorkspaceSchema,
  runId: uuid,
  contextSnapshotId: uuid,
  billedPoints: z.number().int().nonnegative(),
  fallbackUsed: z.boolean(),
  qualityStatus: z.enum(['passed', 'warning']),
  qualityIssues: z.array(z.object({
    code: z.string(), message: z.string(), field: z.string().nullable(), blocking: z.boolean(),
  })),
});

export const submitApprovalResultSchema = z.object({
  workspace: scriptWorkspaceSchema,
  reviewPath: z.string().nullable(),
});

export const publicScriptReviewSchema = z.object({
  brand: z.object({ name: z.string(), city: z.string() }),
  content: z.object({ title: z.string() }),
  script: z.object({ versionNo: z.number().int().positive(), scriptJson: scriptJsonSchema }),
  approval: z.object({
    status: z.enum(approvalStatuses),
    expiresAt: timestamp,
    comment: z.string(),
    updatedAt: timestamp,
  }),
});

export const scriptSourceTypeLabels: Record<(typeof scriptSourceTypes)[number], string> = {
  ai: 'AI 生成', operator: '运营修改', client_revision: '客户修改', rewrite: '改写',
};
export const approvalStatusLabels: Record<(typeof approvalStatuses)[number], string> = {
  pending: '待审核', approved: '已批准', changes_requested: '要求修改', rejected: '已拒绝', expired: '已过期',
};
export const approvalReviewerTypeLabels: Record<(typeof approvalReviewerTypes)[number], string> = {
  internal_user: '内部成员', external_client: '外部客户',
};

export type ScriptJson = z.infer<typeof scriptJsonSchema>;
export type ScriptWorkspace = z.infer<typeof scriptWorkspaceSchema>;
export type PublicScriptReview = z.infer<typeof publicScriptReviewSchema>;
