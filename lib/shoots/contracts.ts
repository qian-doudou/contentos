import { z } from 'zod';
import { shootItemStatuses, shootStatuses } from '@/db/constants';
import { scriptJsonSchema } from '@/lib/scripts/contracts';

const uuid = z.uuid();
const timestamp = z.iso.datetime({ offset: true });
const date = z.iso.date();
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, '请使用 HH:mm 时间格式');
const text = (max: number) => z.string().trim().max(max);

const shootFields = z.object({
  clientId: uuid,
  storeId: uuid,
  shootDate: date,
  startTime: time,
  endTime: time,
  operatorId: uuid,
  photographerId: uuid,
  location: text(500),
  notes: text(5000),
}).strict();

function validateTimeOrder(value: { startTime?: string; endTime?: string }, context: z.RefinementCtx) {
  if (value.startTime && value.endTime && value.startTime >= value.endTime)
    context.addIssue({ code: 'custom', path: ['endTime'], message: '结束时间必须晚于开始时间' });
}

export const createShootSchema = shootFields.partial().required({
  clientId: true,
  storeId: true,
  shootDate: true,
  startTime: true,
  endTime: true,
  operatorId: true,
  photographerId: true,
}).transform((value) => ({ location: '', notes: '', ...value })).superRefine(validateTimeOrder);

export const updateShootSchema = shootFields.partial()
  .refine((value) => Object.keys(value).length > 0, '至少提供一个字段')
  .superRefine(validateTimeOrder);

export const shootQuerySchema = z.object({
  clientId: uuid.optional(),
  photographerId: uuid.optional(),
  status: z.enum(shootStatuses).optional(),
  dateFrom: date.optional(),
  dateTo: date.optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
}).strict().refine((value) => !value.dateFrom || !value.dateTo || value.dateFrom <= value.dateTo, {
  path: ['dateTo'], message: '结束日期不得早于开始日期',
});

export const addShootContentSchema = z.object({ contentId: uuid }).strict();

export const shootItemActionSchema = z.object({
  action: z.enum(['shot', 'missing_shots', 'rescheduled', 'cancelled', 'remove']),
  missingShots: text(3000).default(''),
  note: text(3000).default(''),
  newShootId: uuid.nullable().default(null),
}).strict().superRefine((value, context) => {
  if (value.action === 'missing_shots' && !value.missingShots)
    context.addIssue({ code: 'custom', path: ['missingShots'], message: '请记录缺失镜头' });
  if (['rescheduled', 'cancelled'].includes(value.action) && !value.note)
    context.addIssue({ code: 'custom', path: ['note'], message: '请记录原因' });
  if (value.action !== 'rescheduled' && value.newShootId)
    context.addIssue({ code: 'custom', path: ['newShootId'], message: '只有改期可以关联新拍摄' });
});

export const shootRowSchema = shootFields.extend({
  id: uuid,
  organizationId: uuid,
  status: z.enum(shootStatuses),
  isDemo: z.boolean(),
  createdAt: timestamp,
  updatedAt: timestamp,
});

export const shootOptionSchema = z.object({ id: uuid, name: z.string() });
export const shootStoreOptionSchema = z.object({ id: uuid, clientId: uuid, name: z.string(), location: z.string() });
export const shootOperatorOptionSchema = shootOptionSchema.extend({ clientIds: z.array(uuid) });

export const shootListItemSchema = shootRowSchema.extend({
  clientName: z.string(),
  storeName: z.string(),
  operatorName: z.string(),
  photographerName: z.string(),
  itemCount: z.number().int().nonnegative(),
  shotCount: z.number().int().nonnegative(),
  issueCount: z.number().int().nonnegative(),
});

export const shootOptionsSchema = z.object({
  clients: z.array(shootOptionSchema),
  stores: z.array(shootStoreOptionSchema),
  operators: z.array(shootOperatorOptionSchema),
  photographers: z.array(shootOptionSchema),
});

export const shootPermissionsSchema = z.object({
  canCreate: z.boolean(),
  canEdit: z.boolean(),
  canSchedule: z.boolean(),
  canExecute: z.boolean(),
});

export const shootListSchema = z.object({
  items: z.array(shootListItemSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  options: shootOptionsSchema,
  permissions: shootPermissionsSchema.pick({ canCreate: true }),
});

export const shootContentSchema = z.object({
  id: uuid,
  organizationId: uuid,
  shootId: uuid,
  contentId: uuid,
  approvedScriptVersionId: uuid,
  shootItemStatus: z.enum(shootItemStatuses),
  missingShots: z.string(),
  note: z.string(),
  isDemo: z.boolean(),
  createdAt: timestamp,
  updatedAt: timestamp,
  title: z.string(),
  hookText: z.string(),
  peopleJson: z.array(z.string()),
  productText: z.string(),
  contentStatus: z.string(),
  scriptVersionNo: z.number().int().positive(),
  approvedScript: scriptJsonSchema,
});

export const eligibleShootContentSchema = z.object({
  id: uuid,
  title: z.string(),
  hookText: z.string(),
  peopleJson: z.array(z.string()),
  productText: z.string(),
  status: z.string(),
  activeApprovedScriptVersionId: uuid,
  pendingReschedule: z.boolean(),
});

export const shootDetailSchema = z.object({
  shoot: shootListItemSchema,
  items: z.array(shootContentSchema),
  eligibleContents: z.array(eligibleShootContentSchema),
  rescheduleTargets: z.array(shootOptionSchema),
  options: shootOptionsSchema,
  permissions: shootPermissionsSchema,
});

export const shootMutationResultSchema = z.object({ detail: shootDetailSchema });

export const shootStatusLabels: Record<(typeof shootStatuses)[number], string> = {
  planned: '已排期', in_progress: '拍摄中', completed: '已完成', partially_completed: '部分完成',
  cancelled: '已取消', rescheduled: '已改期',
};
export const shootItemStatusLabels: Record<(typeof shootItemStatuses)[number], string> = {
  planned: '待拍', shot: '已拍', missing_shots: '缺镜头', rescheduled: '已改期', cancelled: '已取消',
};

export type CreateShootInput = z.infer<typeof createShootSchema>;
export type UpdateShootInput = z.infer<typeof updateShootSchema>;
export type ShootItemActionInput = z.infer<typeof shootItemActionSchema>;
