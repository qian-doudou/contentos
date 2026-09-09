import { z } from 'zod';
import {
  approvalReviewerTypes, approvalStatuses, contentStatuses, editAssetTypes,
} from '@/db/constants';

const uuid = z.uuid();
const timestamp = z.iso.datetime({ offset: true });
const text = (max: number) => z.string().trim().max(max);
const requiredText = (max: number) => text(max).min(1, '不能为空');

function validateAsset(value: { assetType: (typeof editAssetTypes)[number]; assetUrl: string }, context: z.RefinementCtx) {
  if (value.assetType === 'url') {
    try {
      const url = new URL(value.assetUrl);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('protocol');
    } catch {
      context.addIssue({ code: 'custom', path: ['assetUrl'], message: 'URL 素材必须使用有效的 http 或 https 地址' });
    }
    return;
  }
  if (/^(?:[/\\]|[A-Za-z]:[/\\]|file:)/i.test(value.assetUrl) || /(?:^|[/\\])\.\.(?:[/\\]|$)/.test(value.assetUrl))
    context.addIssue({ code: 'custom', path: ['assetUrl'], message: '本地引用必须是安全的相对素材标识，不能包含绝对路径或上级目录' });
}

function validateReviewer(value: {
  reviewerType: (typeof approvalReviewerTypes)[number];
  reviewerUserId?: string | null;
}, context: z.RefinementCtx) {
  if (value.reviewerType === 'internal_user' && !value.reviewerUserId)
    context.addIssue({ code: 'custom', path: ['reviewerUserId'], message: '内部审核必须选择审核成员' });
  if (value.reviewerType === 'external_client' && value.reviewerUserId)
    context.addIssue({ code: 'custom', path: ['reviewerUserId'], message: '外部客户审核不能绑定内部成员' });
}

export const assignEditorInputSchema = z.object({ editorId: uuid }).strict();
export const startEditingInputSchema = z.object({ reason: text(1000).optional() }).strict()
  .transform((value) => ({ reason: value.reason || '剪辑人员开始处理' }));

export const submitEditVersionSchema = z.object({
  assetUrl: requiredText(2000),
  assetType: z.enum(editAssetTypes),
  note: text(5000).default(''),
  reviewerType: z.enum(approvalReviewerTypes),
  reviewerUserId: uuid.nullable().optional(),
  expiresAt: timestamp.nullable().optional(),
}).strict().superRefine((value, context) => {
  validateAsset(value, context);
  validateReviewer(value, context);
});

export const resubmitEditApprovalSchema = z.object({
  versionId: uuid,
  reviewerType: z.enum(approvalReviewerTypes),
  reviewerUserId: uuid.nullable().optional(),
  expiresAt: timestamp.nullable().optional(),
}).strict().superRefine(validateReviewer);

export const editTaskQuerySchema = z.object({
  status: z.enum(['SHOT', 'EDITING', 'WAITING_REVIEW', 'REVISION', 'READY_TO_PUBLISH']).optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
}).strict();

export const editorOptionSchema = z.object({ id: uuid, name: z.string() });
export const editReviewerOptionSchema = editorOptionSchema.extend({ clientIds: z.array(uuid) });

export const editVersionSchema = z.object({
  id: uuid,
  organizationId: uuid,
  contentId: uuid,
  versionNo: z.number().int().positive(),
  assetUrl: z.string(),
  assetType: z.enum(editAssetTypes),
  note: z.string(),
  createdBy: uuid,
  creatorName: z.string(),
  isDemo: z.boolean(),
  createdAt: timestamp,
  isCurrent: z.boolean(),
  isActiveApproved: z.boolean(),
});

export const editApprovalViewSchema = z.object({
  id: uuid,
  contentId: uuid,
  approvalType: z.literal('final_video'),
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
  canDecide: z.boolean(),
});

export const editWorkspaceSchema = z.object({
  content: z.object({
    id: uuid,
    title: z.string(),
    status: z.enum(contentStatuses),
    clientId: uuid,
    clientName: z.string(),
    brandName: z.string(),
    accountName: z.string(),
    editorId: uuid.nullable(),
    editorName: z.string().nullable(),
    currentEditVersionId: uuid.nullable(),
    activeApprovedEditVersionId: uuid.nullable(),
  }),
  versions: z.array(editVersionSchema),
  approvals: z.array(editApprovalViewSchema),
  options: z.object({ editors: z.array(editorOptionSchema), reviewers: z.array(editReviewerOptionSchema) }),
  permissions: z.object({
    canAssign: z.boolean(),
    canStart: z.boolean(),
    canSubmit: z.boolean(),
    canResubmit: z.boolean(),
    canReview: z.boolean(),
  }),
});

export const editTaskListItemSchema = editWorkspaceSchema.shape.content.extend({
  currentVersionNo: z.number().int().positive().nullable(),
  activeApprovedVersionNo: z.number().int().positive().nullable(),
  updatedAt: timestamp,
  isDemo: z.boolean(),
});

export const editTaskListSchema = z.object({
  items: z.array(editTaskListItemSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});

export const submitEditVersionResultSchema = z.object({
  workspace: editWorkspaceSchema,
  reviewPath: z.string().nullable(),
});

export const publicEditReviewSchema = z.object({
  brand: z.object({ name: z.string(), city: z.string() }),
  content: z.object({ title: z.string() }),
  edit: z.object({
    versionNo: z.number().int().positive(),
    assetUrl: z.string(),
    assetType: z.enum(editAssetTypes),
    note: z.string(),
  }),
  approval: z.object({
    status: z.enum(approvalStatuses),
    expiresAt: timestamp,
    comment: z.string(),
    updatedAt: timestamp,
  }),
});

export const editAssetTypeLabels: Record<(typeof editAssetTypes)[number], string> = {
  url: '在线链接', local_reference: '本地素材引用',
};

export type EditWorkspace = z.infer<typeof editWorkspaceSchema>;
export type PublicEditReview = z.infer<typeof publicEditReviewSchema>;
