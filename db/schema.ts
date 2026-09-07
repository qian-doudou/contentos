import { check, foreignKey, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { accountTypes, businessStatuses, cooperationStatuses } from './constants';
import {
  organizationStatuses,
  runStatuses,
  runStepStatuses,
  runTypes,
  userRoles,
  userStatuses,
} from './constants';

export const organizations = sqliteTable(
  'organizations',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    status: text('status', { enum: organizationStatuses }).notNull(),
    isDemo: integer('is_demo', { mode: 'boolean' }).notNull().default(false),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [index('idx_organizations_status').on(table.status)],
);

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    role: text('role', { enum: userRoles }).notNull(),
    status: text('status', { enum: userStatuses }).notNull(),
    isDemo: integer('is_demo', { mode: 'boolean' }).notNull().default(false),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_users_organization_id').on(table.organizationId),
    uniqueIndex('uq_users_organization_id_id').on(table.organizationId, table.id),
  ],
);

export const appSettings = sqliteTable(
  'app_settings',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    valueJson: text('value_json').notNull(),
    isSecret: integer('is_secret', { mode: 'boolean' }).notNull().default(false),
    isDemo: integer('is_demo', { mode: 'boolean' }).notNull().default(false),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_app_settings_organization_key').on(table.organizationId, table.key),
  ],
);

export const runs = sqliteTable(
  'runs',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    runType: text('run_type', { enum: runTypes }).notNull(),
    subjectType: text('subject_type').notNull(),
    subjectId: text('subject_id'),
    status: text('status', { enum: runStatuses }).notNull(),
    startedAt: text('started_at'),
    finishedAt: text('finished_at'),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    isDemo: integer('is_demo', { mode: 'boolean' }).notNull().default(false),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('idx_runs_organization_created_at').on(table.organizationId, table.createdAt),
    index('idx_runs_status').on(table.status),
  ],
);

export const runSteps = sqliteTable(
  'run_steps',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    runId: text('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    sequence: integer('sequence').notNull(),
    stepCode: text('step_code').notNull(),
    status: text('status', { enum: runStepStatuses }).notNull(),
    inputJson: text('input_json'),
    outputJson: text('output_json'),
    errorJson: text('error_json'),
    startedAt: text('started_at'),
    finishedAt: text('finished_at'),
    durationMs: integer('duration_ms'),
    warningCodesJson: text('warning_codes_json'),
    isDemo: integer('is_demo', { mode: 'boolean' }).notNull().default(false),
  },
  (table) => [
    uniqueIndex('idx_run_steps_run_sequence').on(table.runId, table.sequence),
    index('idx_run_steps_organization_id').on(table.organizationId),
  ],
);

export const auditLogs = sqliteTable(
  'audit_logs',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    metadataJson: text('metadata_json'),
    isDemo: integer('is_demo', { mode: 'boolean' }).notNull().default(false),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('idx_audit_logs_organization_created_at').on(table.organizationId, table.createdAt)],
);

export type OrganizationRow = typeof organizations.$inferSelect;
export type UserRow = typeof users.$inferSelect;
export type AppSettingRow = typeof appSettings.$inferSelect;
export type RunRow = typeof runs.$inferSelect;
export type RunStepRow = typeof runSteps.$inferSelect;
export type AuditLogRow = typeof auditLogs.$inferSelect;

const businessMetadata = () => ({
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id),
  status: text('status', { enum: businessStatuses }).notNull().default('active'),
  isDemo: integer('is_demo', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});
const listColumn = (name: string) => text(name, { mode: 'json' }).$type<string[]>().notNull().default([]);

export const clients = sqliteTable('clients', {
  ...businessMetadata(),
  clientName: text('client_name').notNull(),
  industry: text('industry').notNull(),
  subIndustry: text('sub_industry').notNull().default(''),
  cooperationStatus: text('cooperation_status', { enum: cooperationStatuses }).notNull().default('lead'),
  contractStart: text('contract_start'),
  contractEnd: text('contract_end'),
  monthlyContentTarget: integer('monthly_content_target').notNull().default(0),
  ownerUserId: text('owner_user_id'),
  notes: text('notes').notNull().default(''),
}, (t) => [
  uniqueIndex('uq_clients_org_id').on(t.organizationId, t.id),
  index('idx_clients_org_created').on(t.organizationId, t.createdAt),
  index('idx_clients_org_filters').on(t.organizationId, t.cooperationStatus, t.industry),
  foreignKey({ columns: [t.organizationId, t.ownerUserId], foreignColumns: [users.organizationId, users.id] }),
  check('clients_target_nonnegative', sql`${t.monthlyContentTarget} >= 0 AND typeof(${t.monthlyContentTarget}) = 'integer'`),
  check('clients_status_valid', sql`${t.status} IN ('active', 'inactive')`),
  check('clients_cooperation_valid', sql`${t.cooperationStatus} IN ('lead', 'active', 'paused', 'ended')`),
  check('clients_contract_order', sql`${t.contractStart} IS NULL OR ${t.contractEnd} IS NULL OR ${t.contractStart} <= ${t.contractEnd}`),
]);

export const brands = sqliteTable('brands', {
  ...businessMetadata(),
  clientId: text('client_id').notNull(),
  brandName: text('brand_name').notNull(),
  industry: text('industry').notNull().default(''),
  subIndustry: text('sub_industry').notNull().default(''),
  city: text('city').notNull().default(''),
  brandPositioning: text('brand_positioning').notNull().default(''),
  targetAudienceJson: listColumn('target_audience_json'),
  coreProductsJson: listColumn('core_products_json'),
  coreSellingPointsJson: listColumn('core_selling_points_json'),
  brandToneJson: listColumn('brand_tone_json'),
  forbiddenTopicsJson: listColumn('forbidden_topics_json'),
}, (t) => [
  uniqueIndex('uq_brands_org_id').on(t.organizationId, t.id),
  uniqueIndex('uq_brands_org_client_id').on(t.organizationId, t.clientId, t.id),
  index('idx_brands_org_client').on(t.organizationId, t.clientId),
  foreignKey({ columns: [t.organizationId, t.clientId], foreignColumns: [clients.organizationId, clients.id] }),
  check('brands_status_valid', sql`${t.status} IN ('active', 'inactive')`),
  check('brands_json_arrays', sql`json_type(${t.targetAudienceJson}) = 'array' AND json_type(${t.coreProductsJson}) = 'array' AND json_type(${t.coreSellingPointsJson}) = 'array' AND json_type(${t.brandToneJson}) = 'array' AND json_type(${t.forbiddenTopicsJson}) = 'array'`),
]);

export const stores = sqliteTable('stores', {
  ...businessMetadata(),
  brandId: text('brand_id').notNull(),
  storeName: text('store_name').notNull(),
  city: text('city').notNull().default(''),
  district: text('district').notNull().default(''),
  address: text('address').notNull().default(''),
  storeType: text('store_type').notNull().default(''),
}, (t) => [
  uniqueIndex('uq_stores_org_id').on(t.organizationId, t.id),
  uniqueIndex('uq_stores_org_brand_id').on(t.organizationId, t.brandId, t.id),
  index('idx_stores_org_brand').on(t.organizationId, t.brandId),
  foreignKey({ columns: [t.organizationId, t.brandId], foreignColumns: [brands.organizationId, brands.id] }),
  check('stores_status_valid', sql`${t.status} IN ('active', 'inactive')`),
]);

export const accounts = sqliteTable('accounts', {
  ...businessMetadata(),
  clientId: text('client_id').notNull(),
  brandId: text('brand_id').notNull(),
  storeId: text('store_id').notNull(),
  platform: text('platform', { enum: ['douyin'] }).notNull().default('douyin'),
  accountName: text('account_name').notNull(),
  accountType: text('account_type', { enum: accountTypes }).notNull().default('other'),
  accountGoalJson: listColumn('account_goal_json'),
  contentStyleJson: listColumn('content_style_json'),
  forbiddenStyleJson: listColumn('forbidden_style_json'),
  followers: integer('followers'),
}, (t) => [
  uniqueIndex('uq_accounts_org_id').on(t.organizationId, t.id),
  index('idx_accounts_org_hierarchy').on(t.organizationId, t.clientId, t.brandId, t.storeId),
  foreignKey({ columns: [t.organizationId, t.clientId], foreignColumns: [clients.organizationId, clients.id] }),
  foreignKey({ columns: [t.organizationId, t.clientId, t.brandId], foreignColumns: [brands.organizationId, brands.clientId, brands.id] }),
  foreignKey({ columns: [t.organizationId, t.brandId, t.storeId], foreignColumns: [stores.organizationId, stores.brandId, stores.id] }),
  check('accounts_status_valid', sql`${t.status} IN ('active', 'inactive')`),
  check('accounts_platform_valid', sql`${t.platform} = 'douyin'`),
  check('accounts_type_valid', sql`${t.accountType} IN ('official', 'owner_ip', 'employee_ip', 'store', 'other')`),
  check('accounts_followers_nonnegative', sql`${t.followers} IS NULL OR (${t.followers} >= 0 AND typeof(${t.followers}) = 'integer')`),
  check('accounts_json_arrays', sql`json_type(${t.accountGoalJson}) = 'array' AND json_type(${t.contentStyleJson}) = 'array' AND json_type(${t.forbiddenStyleJson}) = 'array'`),
]);

export type ClientRow = typeof clients.$inferSelect;
export type BrandRow = typeof brands.$inferSelect;
export type StoreRow = typeof stores.$inferSelect;
export type AccountRow = typeof accounts.$inferSelect;
