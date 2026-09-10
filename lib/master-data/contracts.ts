import { z } from 'zod';
import { accountTypes, businessStatuses, cooperationStatuses } from '@/db/constants';
import { userSchema } from '@/db/validation';

const name = z.string().trim().min(1, '不能为空').max(120);
const shortText = z.string().trim().max(200);
const notes = z.string().trim().max(5000);
const list = z.array(z.string().trim().min(1).max(300)).max(100);
const status = z.enum(businessStatuses);
const timestamp = z.iso.datetime({ offset: true });
const metadata = {
  id: z.uuid(), organizationId: z.uuid(), isDemo: z.boolean(), createdAt: timestamp, updatedAt: timestamp,
};
const clientFields = z.object({
  clientName: name, industry: name, subIndustry: shortText, cooperationStatus: z.enum(cooperationStatuses),
  contractStart: timestamp.nullable(), contractEnd: timestamp.nullable(),
  monthlyContentTarget: z.number().int().min(0).max(2147483647), ownerUserId: z.uuid().nullable(),
  notes, status,
}).strict();
export const clientDefaults = {
  subIndustry: '', cooperationStatus: 'lead' as const, contractStart: null, contractEnd: null,
  monthlyContentTarget: 0, ownerUserId: null, notes: '', status: 'active' as const,
};
export const createClientSchema = clientFields.partial().required({ clientName: true, industry: true })
  .transform(value => ({ ...clientDefaults, ...value }));
export const updateClientSchema = clientFields.partial().refine(value => Object.keys(value).length > 0, '至少提供一个字段');
export const clientSchema = clientFields.extend(metadata).refine(
  value => !value.contractStart || !value.contractEnd || Date.parse(value.contractStart) <= Date.parse(value.contractEnd),
  { message: '合同结束时间不得早于开始时间', path: ['contractEnd'] },
);
const brandFields = z.object({
  clientId: z.uuid(), brandName: name, industry: shortText, subIndustry: shortText, city: shortText,
  brandPositioning: notes, targetAudienceJson: list, coreProductsJson: list, coreSellingPointsJson: list,
  brandToneJson: list, forbiddenTopicsJson: list, status,
}).strict();
export const brandDefaults = {
  industry: '', subIndustry: '', city: '', brandPositioning: '', targetAudienceJson: [], coreProductsJson: [],
  coreSellingPointsJson: [], brandToneJson: [], forbiddenTopicsJson: [], status: 'active' as const,
};
export const createBrandSchema = brandFields.partial().required({ clientId: true, brandName: true })
  .transform(value => ({ ...brandDefaults, ...value }));
export const updateBrandSchema = brandFields.partial().refine(value => Object.keys(value).length > 0, '至少提供一个字段');
export const brandSchema = brandFields.extend(metadata);
const storeFields = z.object({
  brandId: z.uuid(), storeName: name, city: shortText, district: shortText, address: notes, storeType: shortText, status,
}).strict();
export const storeDefaults = { city: '', district: '', address: '', storeType: '', status: 'active' as const };
export const createStoreSchema = storeFields.partial().required({ brandId: true, storeName: true })
  .transform(value => ({ ...storeDefaults, ...value }));
export const updateStoreSchema = storeFields.partial().refine(value => Object.keys(value).length > 0, '至少提供一个字段');
export const storeSchema = storeFields.extend(metadata);
const accountFields = z.object({
  clientId: z.uuid(), brandId: z.uuid(), storeId: z.uuid(), platform: z.literal('douyin'), accountName: name,
  accountType: z.enum(accountTypes), accountGoalJson: list, contentStyleJson: list, forbiddenStyleJson: list,
  followers: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable(), status,
}).strict();
export const accountDefaults = {
  platform: 'douyin' as const, accountType: 'other' as const, accountGoalJson: [], contentStyleJson: [],
  forbiddenStyleJson: [], followers: null, status: 'active' as const,
};
export const createAccountSchema = accountFields.partial().required({ clientId: true, brandId: true, storeId: true, accountName: true })
  .transform(value => ({ ...accountDefaults, ...value }));
export const updateAccountSchema = accountFields.partial().refine(value => Object.keys(value).length > 0, '至少提供一个字段');
export const accountSchema = accountFields.extend(metadata);
export const clientQuerySchema = z.object({
  search: z.string().trim().max(120).optional(), industry: shortText.optional(), ownerUserId: z.uuid().optional(),
  cooperationStatus: z.enum(cooperationStatuses).optional(), status: status.optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
}).strict();
export const accountQuerySchema = z.object({
  clientId: z.uuid().optional(), brandId: z.uuid().optional(), storeId: z.uuid().optional(), status: status.optional(),
}).strict();
export const masterDataPermissionsSchema = z.object({ canWrite: z.boolean() });
export const clientDetailSchema = z.object({
  client: clientSchema, owner: userSchema.nullable(), brands: z.array(brandSchema), stores: z.array(storeSchema),
  accounts: z.array(accountSchema), permissions: masterDataPermissionsSchema,
});
export const clientListSchema = z.object({
  items: z.array(clientSchema), total: z.number(), page: z.number(), pageSize: z.number(),
  filters: z.object({ industries: z.array(z.string()), owners: z.array(userSchema) }), permissions: masterDataPermissionsSchema,
});
export const hierarchySchema = z.object({
  clients: z.array(clientSchema), brands: z.array(brandSchema), stores: z.array(storeSchema), accounts: z.array(accountSchema),
  permissions: masterDataPermissionsSchema,
});
export const accountDetailSchema = z.object({
  account: accountSchema, client: clientSchema, brand: brandSchema, store: storeSchema,
  contentStats: z.object({
    total: z.number().int().nonnegative(),
    published: z.number().int().nonnegative(),
    implemented: z.literal(true),
  }),
  permissions: masterDataPermissionsSchema,
});
export type Client = z.infer<typeof clientSchema>;
export type Brand = z.infer<typeof brandSchema>;
export type Store = z.infer<typeof storeSchema>;
export type Account = z.infer<typeof accountSchema>;
export type ClientDetail = z.infer<typeof clientDetailSchema>;
export type ClientList = z.infer<typeof clientListSchema>;
export type Hierarchy = z.infer<typeof hierarchySchema>;
export type AccountDetail = z.infer<typeof accountDetailSchema>;
