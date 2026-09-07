import { check, foreignKey, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import {
  accountTypes, businessStatuses, contentGoals, contentPriorities, contentStatuses, contentStatusTriggers,
  contentTypes, cooperationStatuses, hookTypes,
} from './constants';
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

export const clientMembers = sqliteTable('client_members', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull(),
  clientId: text('client_id').notNull(),
  userId: text('user_id').notNull(),
  roleOverride: text('role_override', { enum: userRoles }),
  isDemo: integer('is_demo', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
}, (t) => [
  uniqueIndex('uq_client_members_org_client_user').on(t.organizationId, t.clientId, t.userId),
  index('idx_client_members_org_user').on(t.organizationId, t.userId),
  foreignKey({ columns: [t.organizationId, t.clientId], foreignColumns: [clients.organizationId, clients.id], name: 'client_members_client_fk' }),
  foreignKey({ columns: [t.organizationId, t.userId], foreignColumns: [users.organizationId, users.id], name: 'client_members_user_fk' }),
  check('client_members_role_valid', sql`${t.roleOverride} IS NULL OR ${t.roleOverride} IN ('owner', 'admin', 'operator', 'photographer', 'editor', 'viewer')`),
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
  uniqueIndex('uq_accounts_org_hierarchy_id').on(t.organizationId, t.clientId, t.brandId, t.storeId, t.id),
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

export const monthlyPlans = sqliteTable('monthly_plans', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id),
  accountId: text('account_id').notNull(),
  year: integer('year').notNull(),
  month: integer('month').notNull(),
  primaryGoal: text('primary_goal', { enum: contentGoals }).notNull(),
  plannedContentCount: integer('planned_content_count').notNull().default(0),
  campaignNotes: text('campaign_notes').notNull().default(''),
  keyProductsJson: listColumn('key_products_json'),
  contentMixJson: text('content_mix_json', { mode: 'json' }).$type<Partial<Record<(typeof contentTypes)[number], number>>>().notNull().default({}),
  status: text('status', { enum: businessStatuses }).notNull().default('active'),
  createdBy: text('created_by').notNull(),
  isDemo: integer('is_demo', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (t) => [
  uniqueIndex('uq_monthly_plans_org_account_period').on(t.organizationId, t.accountId, t.year, t.month),
  uniqueIndex('uq_monthly_plans_org_account_id').on(t.organizationId, t.accountId, t.id),
  index('idx_monthly_plans_org_period').on(t.organizationId, t.year, t.month),
  foreignKey({ columns: [t.organizationId, t.accountId], foreignColumns: [accounts.organizationId, accounts.id] }),
  foreignKey({ columns: [t.organizationId, t.createdBy], foreignColumns: [users.organizationId, users.id] }),
  check('monthly_plans_year_valid', sql`${t.year} BETWEEN 2000 AND 2100 AND typeof(${t.year}) = 'integer'`),
  check('monthly_plans_month_valid', sql`${t.month} BETWEEN 1 AND 12 AND typeof(${t.month}) = 'integer'`),
  check('monthly_plans_count_nonnegative', sql`${t.plannedContentCount} >= 0 AND typeof(${t.plannedContentCount}) = 'integer'`),
  check('monthly_plans_status_valid', sql`${t.status} IN ('active', 'inactive')`),
  check('monthly_plans_goal_valid', sql`${t.primaryGoal} IN ('exposure', 'followers', 'trust', 'click', 'conversion', 'gmv')`),
  check('monthly_plans_products_array', sql`json_type(${t.keyProductsJson}) = 'array'`),
  check('monthly_plans_mix_object', sql`json_type(${t.contentMixJson}) = 'object'`),
  check('monthly_plans_mix_total', sql`(
    ${t.plannedContentCount} = 0 AND ${t.contentMixJson} = '{}'
  ) OR (
    coalesce(json_extract(${t.contentMixJson}, '$.persona'), 0) +
    coalesce(json_extract(${t.contentMixJson}, '$.product'), 0) +
    coalesce(json_extract(${t.contentMixJson}, '$.local'), 0) +
    coalesce(json_extract(${t.contentMixJson}, '$.trust'), 0) +
    coalesce(json_extract(${t.contentMixJson}, '$.conversion'), 0) +
    coalesce(json_extract(${t.contentMixJson}, '$.education'), 0) +
    coalesce(json_extract(${t.contentMixJson}, '$.process'), 0) +
    coalesce(json_extract(${t.contentMixJson}, '$.customer_case'), 0) +
    coalesce(json_extract(${t.contentMixJson}, '$.other'), 0) = 100
  )`),
]);

export const contents = sqliteTable('contents', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id),
  clientId: text('client_id').notNull(),
  brandId: text('brand_id').notNull(),
  storeId: text('store_id').notNull(),
  accountId: text('account_id').notNull(),
  monthlyPlanId: text('monthly_plan_id'),
  title: text('title').notNull(),
  contentType: text('content_type', { enum: contentTypes }).notNull(),
  contentGoal: text('content_goal', { enum: contentGoals }).notNull(),
  topic: text('topic').notNull().default(''),
  angle: text('angle').notNull().default(''),
  hookType: text('hook_type', { enum: hookTypes }).notNull().default('other'),
  hookText: text('hook_text').notNull().default(''),
  coreMessage: text('core_message').notNull().default(''),
  productText: text('product_text').notNull().default(''),
  ctaType: text('cta_type').notNull().default(''),
  localElement: text('local_element').notNull().default(''),
  peopleJson: listColumn('people_json'),
  status: text('status', { enum: contentStatuses }).notNull().default('IDEA'),
  priority: text('priority', { enum: contentPriorities }).notNull().default('normal'),
  operatorId: text('operator_id').notNull(),
  plannedPublishDate: text('planned_publish_date'),
  deadline: text('deadline'),
  currentScriptVersionId: text('current_script_version_id'),
  activeApprovedScriptVersionId: text('active_approved_script_version_id'),
  currentEditVersionId: text('current_edit_version_id'),
  activeApprovedEditVersionId: text('active_approved_edit_version_id'),
  aiReviewStatus: text('ai_review_status'),
  createdBy: text('created_by').notNull(),
  isDemo: integer('is_demo', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (t) => [
  uniqueIndex('uq_contents_org_id').on(t.organizationId, t.id),
  index('idx_contents_org_account_status').on(t.organizationId, t.accountId, t.status),
  index('idx_contents_org_plan').on(t.organizationId, t.monthlyPlanId),
  index('idx_contents_org_publish_date').on(t.organizationId, t.plannedPublishDate),
  foreignKey({
    columns: [t.organizationId, t.clientId, t.brandId, t.storeId, t.accountId],
    foreignColumns: [accounts.organizationId, accounts.clientId, accounts.brandId, accounts.storeId, accounts.id],
  }),
  foreignKey({ columns: [t.organizationId, t.accountId, t.monthlyPlanId], foreignColumns: [monthlyPlans.organizationId, monthlyPlans.accountId, monthlyPlans.id] }),
  foreignKey({ columns: [t.organizationId, t.operatorId], foreignColumns: [users.organizationId, users.id] }),
  foreignKey({ columns: [t.organizationId, t.createdBy], foreignColumns: [users.organizationId, users.id] }),
  check('contents_type_valid', sql`${t.contentType} IN ('persona', 'product', 'local', 'trust', 'conversion', 'education', 'process', 'customer_case', 'other')`),
  check('contents_goal_valid', sql`${t.contentGoal} IN ('exposure', 'followers', 'trust', 'click', 'conversion', 'gmv')`),
  check('contents_hook_valid', sql`${t.hookType} IN ('contrast', 'conflict', 'price', 'question', 'identity', 'local', 'result', 'mistake', 'secret', 'challenge', 'other')`),
  check('contents_priority_valid', sql`${t.priority} IN ('low', 'normal', 'high', 'urgent')`),
  check('contents_status_valid', sql`${t.status} IN ('IDEA', 'SCRIPTING', 'WAITING_APPROVAL', 'APPROVED', 'WAITING_SHOOT', 'SHOT', 'EDITING', 'WAITING_REVIEW', 'REVISION', 'READY_TO_PUBLISH', 'PUBLISHED', 'REVIEWED')`),
  check('contents_people_array', sql`json_type(${t.peopleJson}) = 'array'`),
]);

export const contentStatusLogs = sqliteTable('content_status_logs', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id),
  contentId: text('content_id').notNull(),
  previousStatus: text('previous_status', { enum: contentStatuses }).notNull(),
  newStatus: text('new_status', { enum: contentStatuses }).notNull(),
  triggerType: text('trigger_type', { enum: contentStatusTriggers }).notNull(),
  triggerId: text('trigger_id'),
  operatorId: text('operator_id').notNull(),
  reason: text('reason').notNull(),
  isDemo: integer('is_demo', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
}, (t) => [
  index('idx_content_status_logs_org_content_created').on(t.organizationId, t.contentId, t.createdAt),
  foreignKey({ columns: [t.organizationId, t.contentId], foreignColumns: [contents.organizationId, contents.id] }),
  foreignKey({ columns: [t.organizationId, t.operatorId], foreignColumns: [users.organizationId, users.id] }),
  check('content_status_logs_previous_valid', sql`${t.previousStatus} IN ('IDEA', 'SCRIPTING', 'WAITING_APPROVAL', 'APPROVED', 'WAITING_SHOOT', 'SHOT', 'EDITING', 'WAITING_REVIEW', 'REVISION', 'READY_TO_PUBLISH', 'PUBLISHED', 'REVIEWED')`),
  check('content_status_logs_new_valid', sql`${t.newStatus} IN ('IDEA', 'SCRIPTING', 'WAITING_APPROVAL', 'APPROVED', 'WAITING_SHOOT', 'SHOT', 'EDITING', 'WAITING_REVIEW', 'REVISION', 'READY_TO_PUBLISH', 'PUBLISHED', 'REVIEWED')`),
  check('content_status_logs_trigger_valid', sql`${t.triggerType} IN ('manual', 'shoot', 'publish', 'system')`),
]);

export type ClientRow = typeof clients.$inferSelect;
export type ClientMemberRow = typeof clientMembers.$inferSelect;
export type BrandRow = typeof brands.$inferSelect;
export type StoreRow = typeof stores.$inferSelect;
export type AccountRow = typeof accounts.$inferSelect;
export type MonthlyPlanRow = typeof monthlyPlans.$inferSelect;
export type ContentRow = typeof contents.$inferSelect;
export type ContentStatusLogRow = typeof contentStatusLogs.$inferSelect;
