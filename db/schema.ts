import { check, foreignKey, index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import {
  accountTypes, aiLedgerTypes, aiUsageStatuses, businessStatuses, contentGoals, contentPriorities,
  contentEmbeddingStatuses, contentImportDedupStrategies, contentImportFormats, contentImportStatuses,
  contentStatuses, contentStatusTriggers, contentTypes, cooperationStatuses, historyRetrievalMethods, hookTypes, modelProfiles,
  memoryScopeTypes, memorySourceTypes, memoryStatuses, memoryTypes, priceConfigStatuses,
  plannerCandidateStatuses, plannerQualityStatuses, plannerSessionStatuses,
  approvalReviewerTypes, approvalStatuses, approvalTypes, editAssetTypes, scriptSourceTypes,
  performanceImportStatuses, publishPlatforms, publishStatuses, strategyReviewStatuses,
  shootItemStatuses, shootStatuses,
  badCaseCategories, badCaseSeverities, badCaseStatuses, evalCaseSourceTypes,
  evalCaseStatuses, evalExperimentStatuses, evalVariants, evalVerdicts,
  improvementProposalStatuses, ratingIssueTags,
} from './constants';
import {
  organizationStatuses,
  permissionCodes,
  permissionEffects,
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
    index('idx_runs_organization_status').on(table.organizationId, table.status),
    uniqueIndex('uq_runs_organization_id').on(table.organizationId, table.id),
    check('runs_status_valid', sql`${table.status} IN ('queued', 'running', 'completed', 'completed_with_warnings', 'manual_review_required', 'failed', 'cancelled')`),
  ],
);

export const runSteps = sqliteTable(
  'run_steps',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    runId: text('run_id').notNull(),
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
    uniqueIndex('uq_run_steps_organization_id').on(table.organizationId, table.id),
    foreignKey({ columns: [table.organizationId, table.runId], foreignColumns: [runs.organizationId, runs.id] }).onDelete('cascade'),
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

export const userPermissionOverrides = sqliteTable('user_permission_overrides', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull(),
  userId: text('user_id').notNull(),
  permissionCode: text('permission_code', { enum: permissionCodes }).notNull(),
  effect: text('effect', { enum: permissionEffects }).notNull(),
  reason: text('reason').notNull(),
  expiresAt: text('expires_at'),
  grantedBy: text('granted_by').notNull(),
  isDemo: integer('is_demo', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (t) => [
  uniqueIndex('uq_user_permission_overrides_org_id').on(t.organizationId, t.id),
  uniqueIndex('uq_user_permission_overrides_user_permission').on(t.organizationId, t.userId, t.permissionCode),
  index('idx_user_permission_overrides_org_user_expiry').on(t.organizationId, t.userId, t.expiresAt),
  foreignKey({ columns: [t.organizationId, t.userId], foreignColumns: [users.organizationId, users.id] }),
  foreignKey({ columns: [t.organizationId, t.grantedBy], foreignColumns: [users.organizationId, users.id] }),
  check('user_permission_overrides_permission_valid', sql`${t.permissionCode} IN (
    'master_data.write', 'team.read', 'team.manage', 'skills.read', 'skills.write',
    'ai.test', 'ai.settings', 'runs.read', 'ops.read', 'eval.read', 'eval.rate',
    'eval.manage', 'memory.read', 'memory.write', 'context.build', 'system.dangerous'
  )`),
  check('user_permission_overrides_effect_valid', sql`${t.effect} IN ('allow', 'deny')`),
  check('user_permission_overrides_reason_valid', sql`length(trim(${t.reason})) > 0`),
]);

export type OrganizationRow = typeof organizations.$inferSelect;
export type UserRow = typeof users.$inferSelect;
export type AppSettingRow = typeof appSettings.$inferSelect;
export type RunRow = typeof runs.$inferSelect;
export type RunStepRow = typeof runSteps.$inferSelect;
export type AuditLogRow = typeof auditLogs.$inferSelect;
export type UserPermissionOverrideRow = typeof userPermissionOverrides.$inferSelect;

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

export const contentImportBatches = sqliteTable('content_import_batches', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id),
  format: text('format', { enum: contentImportFormats }).notNull(),
  dedupStrategy: text('dedup_strategy', { enum: contentImportDedupStrategies }).notNull(),
  sourceHash: text('source_hash').notNull(),
  previewJson: text('preview_json', { mode: 'json' }).$type<unknown>().notNull(),
  status: text('status', { enum: contentImportStatuses }).notNull().default('previewed'),
  totalRows: integer('total_rows').notNull(),
  validRows: integer('valid_rows').notNull(),
  duplicateRows: integer('duplicate_rows').notNull(),
  invalidRows: integer('invalid_rows').notNull(),
  committedRows: integer('committed_rows').notNull().default(0),
  createdBy: text('created_by').notNull(),
  isDemo: integer('is_demo', { mode: 'boolean' }).notNull().default(false),
  committedAt: text('committed_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (t) => [
  uniqueIndex('uq_content_import_batches_org_id').on(t.organizationId, t.id),
  index('idx_content_import_batches_org_created').on(t.organizationId, t.createdAt),
  foreignKey({ columns: [t.organizationId, t.createdBy], foreignColumns: [users.organizationId, users.id] }),
  check('content_import_batches_format_valid', sql`${t.format} IN ('csv', 'json')`),
  check('content_import_batches_dedup_valid', sql`${t.dedupStrategy} IN ('external_id', 'title_published_at', 'canonical')`),
  check('content_import_batches_status_valid', sql`${t.status} IN ('previewed', 'committed', 'failed')`),
  check('content_import_batches_counts_valid', sql`${t.totalRows} >= 0 AND ${t.validRows} >= 0 AND ${t.duplicateRows} >= 0 AND ${t.invalidRows} >= 0 AND ${t.committedRows} >= 0 AND ${t.validRows} + ${t.duplicateRows} + ${t.invalidRows} = ${t.totalRows}`),
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
  publishedAt: text('published_at'),
  deadline: text('deadline'),
  externalId: text('external_id'),
  importDedupKey: text('import_dedup_key'),
  importBatchId: text('import_batch_id'),
  currentScriptVersionId: text('current_script_version_id'),
  activeApprovedScriptVersionId: text('active_approved_script_version_id'),
  editorId: text('editor_id'),
  currentEditVersionId: text('current_edit_version_id'),
  activeApprovedEditVersionId: text('active_approved_edit_version_id'),
  aiReviewStatus: text('ai_review_status'),
  creativeBriefJson: text('creative_brief_json', { mode: 'json' }).$type<unknown>(),
  createdBy: text('created_by').notNull(),
  isDemo: integer('is_demo', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (t) => [
  uniqueIndex('uq_contents_org_id').on(t.organizationId, t.id),
  uniqueIndex('uq_contents_org_account_id').on(t.organizationId, t.accountId, t.id),
  uniqueIndex('uq_contents_import_dedup').on(t.organizationId, t.accountId, t.importDedupKey)
    .where(sql`${t.importDedupKey} IS NOT NULL`),
  index('idx_contents_org_account_status').on(t.organizationId, t.accountId, t.status),
  index('idx_contents_org_plan').on(t.organizationId, t.monthlyPlanId),
  index('idx_contents_org_publish_date').on(t.organizationId, t.plannedPublishDate),
  index('idx_contents_org_account_published').on(t.organizationId, t.accountId, t.publishedAt),
  index('idx_contents_org_created_by_created').on(t.organizationId, t.createdBy, t.createdAt),
  index('idx_contents_org_operator_deadline').on(t.organizationId, t.operatorId, t.deadline),
  foreignKey({
    columns: [t.organizationId, t.clientId, t.brandId, t.storeId, t.accountId],
    foreignColumns: [accounts.organizationId, accounts.clientId, accounts.brandId, accounts.storeId, accounts.id],
  }),
  foreignKey({ columns: [t.organizationId, t.accountId, t.monthlyPlanId], foreignColumns: [monthlyPlans.organizationId, monthlyPlans.accountId, monthlyPlans.id] }),
  foreignKey({ columns: [t.organizationId, t.operatorId], foreignColumns: [users.organizationId, users.id] }),
  foreignKey({ columns: [t.organizationId, t.createdBy], foreignColumns: [users.organizationId, users.id] }),
  foreignKey({ columns: [t.organizationId, t.importBatchId], foreignColumns: [contentImportBatches.organizationId, contentImportBatches.id] }),
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
  check('content_status_logs_trigger_valid', sql`${t.triggerType} IN ('manual', 'approval', 'shoot', 'edit', 'publish', 'system')`),
]);

export const scriptVersions = sqliteTable('script_versions', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id),
  contentId: text('content_id').notNull(),
  versionNo: integer('version_no').notNull(),
  scriptJson: text('script_json', { mode: 'json' }).$type<{
    title: string;
    hook: string;
    spoken_script: string;
    shots: Array<Record<string, unknown>>;
    product_integration: string;
    cta: string;
    hashtags: string[];
  }>().notNull(),
  sourceType: text('source_type', { enum: scriptSourceTypes }).notNull(),
  changeSummary: text('change_summary').notNull(),
  createdBy: text('created_by').notNull(),
  isDemo: integer('is_demo', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
}, (t) => [
  uniqueIndex('uq_script_versions_org_id').on(t.organizationId, t.id),
  uniqueIndex('uq_script_versions_org_content_version').on(t.organizationId, t.contentId, t.versionNo),
  uniqueIndex('uq_script_versions_org_content_id').on(t.organizationId, t.contentId, t.id),
  index('idx_script_versions_org_content_created').on(t.organizationId, t.contentId, t.createdAt),
  foreignKey({ columns: [t.organizationId, t.contentId], foreignColumns: [contents.organizationId, contents.id] }),
  foreignKey({ columns: [t.organizationId, t.createdBy], foreignColumns: [users.organizationId, users.id] }),
  check('script_versions_version_positive', sql`${t.versionNo} >= 1 AND typeof(${t.versionNo}) = 'integer'`),
  check('script_versions_source_valid', sql`${t.sourceType} IN ('ai', 'operator', 'client_revision', 'rewrite')`),
  check('script_versions_json_valid', sql`json_valid(${t.scriptJson}) AND json_type(${t.scriptJson}) = 'object'`),
]);

export const editVersions = sqliteTable('edit_versions', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id),
  contentId: text('content_id').notNull(),
  versionNo: integer('version_no').notNull(),
  assetUrl: text('asset_url').notNull(),
  assetType: text('asset_type', { enum: editAssetTypes }).notNull(),
  note: text('note').notNull().default(''),
  createdBy: text('created_by').notNull(),
  isDemo: integer('is_demo', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
}, (t) => [
  uniqueIndex('uq_edit_versions_org_id').on(t.organizationId, t.id),
  uniqueIndex('uq_edit_versions_org_content_version').on(t.organizationId, t.contentId, t.versionNo),
  uniqueIndex('uq_edit_versions_org_content_id').on(t.organizationId, t.contentId, t.id),
  index('idx_edit_versions_org_content_created').on(t.organizationId, t.contentId, t.createdAt),
  index('idx_edit_versions_org_creator_created').on(t.organizationId, t.createdBy, t.createdAt),
  foreignKey({ columns: [t.organizationId, t.contentId], foreignColumns: [contents.organizationId, contents.id] }),
  foreignKey({ columns: [t.organizationId, t.createdBy], foreignColumns: [users.organizationId, users.id] }),
  check('edit_versions_version_positive', sql`${t.versionNo} >= 1 AND typeof(${t.versionNo}) = 'integer'`),
  check('edit_versions_asset_type_valid', sql`${t.assetType} IN ('url', 'local_reference')`),
  check('edit_versions_asset_url_present', sql`length(trim(${t.assetUrl})) > 0`),
]);

export const publishes = sqliteTable('publishes', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id),
  contentId: text('content_id').notNull(),
  platform: text('platform', { enum: publishPlatforms }).notNull(),
  publishedAt: text('published_at').notNull(),
  postUrl: text('post_url').notNull(),
  platformPostId: text('platform_post_id'),
  status: text('status', { enum: publishStatuses }).notNull().default('active'),
  createdBy: text('created_by').notNull(),
  isDemo: integer('is_demo', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
}, (t) => [
  uniqueIndex('uq_publishes_org_id').on(t.organizationId, t.id),
  uniqueIndex('uq_publishes_active_content').on(t.organizationId, t.contentId)
    .where(sql`${t.status} = 'active'`),
  uniqueIndex('uq_publishes_platform_post').on(t.organizationId, t.platform, t.platformPostId)
    .where(sql`${t.platformPostId} IS NOT NULL`),
  index('idx_publishes_org_published').on(t.organizationId, t.publishedAt),
  foreignKey({ columns: [t.organizationId, t.contentId], foreignColumns: [contents.organizationId, contents.id] }),
  foreignKey({ columns: [t.organizationId, t.createdBy], foreignColumns: [users.organizationId, users.id] }),
  check('publishes_platform_valid', sql`${t.platform} IN ('douyin')`),
  check('publishes_status_valid', sql`${t.status} IN ('active', 'inactive')`),
  check('publishes_post_url_present', sql`length(trim(${t.postUrl})) > 0`),
]);

export const performanceSnapshots = sqliteTable('performance_snapshots', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id),
  publishId: text('publish_id').notNull(),
  snapshotTime: text('snapshot_time').notNull(),
  views: integer('views'),
  likes: integer('likes'),
  comments: integer('comments'),
  shares: integer('shares'),
  favorites: integer('favorites'),
  profileVisits: integer('profile_visits'),
  groupbuyClicks: integer('groupbuy_clicks'),
  orders: integer('orders'),
  gmv: real('gmv'),
  isDemo: integer('is_demo', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
}, (t) => [
  uniqueIndex('uq_performance_snapshots_org_id').on(t.organizationId, t.id),
  uniqueIndex('uq_performance_snapshots_publish_time').on(t.organizationId, t.publishId, t.snapshotTime),
  index('idx_performance_snapshots_org_time').on(t.organizationId, t.snapshotTime),
  foreignKey({ columns: [t.organizationId, t.publishId], foreignColumns: [publishes.organizationId, publishes.id] }),
  check('performance_snapshots_nonnegative', sql`
    (${t.views} IS NULL OR (${t.views} >= 0 AND typeof(${t.views}) = 'integer')) AND
    (${t.likes} IS NULL OR (${t.likes} >= 0 AND typeof(${t.likes}) = 'integer')) AND
    (${t.comments} IS NULL OR (${t.comments} >= 0 AND typeof(${t.comments}) = 'integer')) AND
    (${t.shares} IS NULL OR (${t.shares} >= 0 AND typeof(${t.shares}) = 'integer')) AND
    (${t.favorites} IS NULL OR (${t.favorites} >= 0 AND typeof(${t.favorites}) = 'integer')) AND
    (${t.profileVisits} IS NULL OR (${t.profileVisits} >= 0 AND typeof(${t.profileVisits}) = 'integer')) AND
    (${t.groupbuyClicks} IS NULL OR (${t.groupbuyClicks} >= 0 AND typeof(${t.groupbuyClicks}) = 'integer')) AND
    (${t.orders} IS NULL OR (${t.orders} >= 0 AND typeof(${t.orders}) = 'integer')) AND
    (${t.gmv} IS NULL OR ${t.gmv} >= 0)
  `),
]);

export const performanceImportBatches = sqliteTable('performance_import_batches', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id),
  sourceHash: text('source_hash').notNull(),
  mappingJson: text('mapping_json', { mode: 'json' }).$type<Record<string, string>>().notNull(),
  previewJson: text('preview_json', { mode: 'json' }).$type<unknown>().notNull(),
  status: text('status', { enum: performanceImportStatuses }).notNull().default('previewed'),
  totalRows: integer('total_rows').notNull(),
  validRows: integer('valid_rows').notNull(),
  duplicateRows: integer('duplicate_rows').notNull(),
  invalidRows: integer('invalid_rows').notNull(),
  committedRows: integer('committed_rows').notNull().default(0),
  createdBy: text('created_by').notNull(),
  isDemo: integer('is_demo', { mode: 'boolean' }).notNull().default(false),
  committedAt: text('committed_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (t) => [
  uniqueIndex('uq_performance_import_batches_org_id').on(t.organizationId, t.id),
  index('idx_performance_import_batches_org_created').on(t.organizationId, t.createdAt),
  foreignKey({ columns: [t.organizationId, t.createdBy], foreignColumns: [users.organizationId, users.id] }),
  check('performance_import_batches_status_valid', sql`${t.status} IN ('previewed', 'committed', 'failed')`),
  check('performance_import_batches_counts_valid', sql`
    ${t.totalRows} >= 0 AND ${t.validRows} >= 0 AND ${t.duplicateRows} >= 0 AND ${t.invalidRows} >= 0 AND
    ${t.committedRows} >= 0 AND ${t.validRows} + ${t.duplicateRows} + ${t.invalidRows} = ${t.totalRows}
  `),
]);

export const strategyReviews = sqliteTable('strategy_reviews', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id),
  accountId: text('account_id').notNull(),
  periodStart: text('period_start').notNull(),
  periodEnd: text('period_end').notNull(),
  metricsSnapshotJson: text('metrics_snapshot_json', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  previousStrategyMemoryIdsJson: text('previous_strategy_memory_ids_json', { mode: 'json' }).$type<string[]>().notNull().default([]),
  aiAnalysisJson: text('ai_analysis_json', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  aiStrategyJson: text('ai_strategy_json', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  status: text('status', { enum: strategyReviewStatuses }).notNull().default('draft'),
  confirmedBy: text('confirmed_by'),
  confirmedAt: text('confirmed_at'),
  isDemo: integer('is_demo', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
}, (t) => [
  uniqueIndex('uq_strategy_reviews_org_id').on(t.organizationId, t.id),
  index('idx_strategy_reviews_org_account_period').on(t.organizationId, t.accountId, t.periodStart, t.periodEnd),
  index('idx_strategy_reviews_org_status_created').on(t.organizationId, t.status, t.createdAt),
  foreignKey({ columns: [t.organizationId, t.accountId], foreignColumns: [accounts.organizationId, accounts.id] }),
  foreignKey({ columns: [t.organizationId, t.confirmedBy], foreignColumns: [users.organizationId, users.id] }),
  check('strategy_reviews_period_valid', sql`${t.periodStart} < ${t.periodEnd}`),
  check('strategy_reviews_status_valid', sql`${t.status} IN ('draft', 'confirmed', 'rejected')`),
  check('strategy_reviews_confirmed_fields', sql`(
    ${t.status} = 'confirmed' AND ${t.confirmedBy} IS NOT NULL AND ${t.confirmedAt} IS NOT NULL
  ) OR (
    ${t.status} <> 'confirmed' AND ${t.confirmedBy} IS NULL AND ${t.confirmedAt} IS NULL
  )`),
  check('strategy_reviews_memory_ids_array', sql`json_type(${t.previousStrategyMemoryIdsJson}) = 'array'`),
  check('strategy_reviews_metrics_object', sql`json_type(${t.metricsSnapshotJson}) = 'object'`),
  check('strategy_reviews_analysis_object', sql`json_type(${t.aiAnalysisJson}) = 'object'`),
  check('strategy_reviews_strategy_object', sql`json_type(${t.aiStrategyJson}) = 'object'`),
]);

export type StrategyReviewRow = typeof strategyReviews.$inferSelect;

export const approvals = sqliteTable('approvals', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id),
  contentId: text('content_id').notNull(),
  approvalType: text('approval_type', { enum: approvalTypes }).notNull(),
  versionId: text('version_id').notNull(),
  status: text('status', { enum: approvalStatuses }).notNull().default('pending'),
  reviewerType: text('reviewer_type', { enum: approvalReviewerTypes }).notNull(),
  reviewerUserId: text('reviewer_user_id'),
  reviewTokenHash: text('review_token_hash'),
  expiresAt: text('expires_at'),
  comment: text('comment').notNull().default(''),
  isDemo: integer('is_demo', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (t) => [
  uniqueIndex('uq_approvals_org_id').on(t.organizationId, t.id),
  uniqueIndex('uq_approvals_review_token_hash').on(t.reviewTokenHash).where(sql`${t.reviewTokenHash} IS NOT NULL`),
  index('idx_approvals_org_content_created').on(t.organizationId, t.contentId, t.createdAt),
  index('idx_approvals_org_status_expiry').on(t.organizationId, t.status, t.expiresAt),
  foreignKey({ columns: [t.organizationId, t.contentId], foreignColumns: [contents.organizationId, contents.id] }),
  foreignKey({ columns: [t.organizationId, t.reviewerUserId], foreignColumns: [users.organizationId, users.id] }),
  check('approvals_type_valid', sql`${t.approvalType} IN ('script', 'final_video')`),
  check('approvals_status_valid', sql`${t.status} IN ('pending', 'approved', 'changes_requested', 'rejected', 'expired')`),
  check('approvals_reviewer_type_valid', sql`${t.reviewerType} IN ('internal_user', 'external_client')`),
  check('approvals_token_hash_valid', sql`${t.reviewTokenHash} IS NULL OR length(${t.reviewTokenHash}) = 64`),
  check('approvals_reviewer_binding_valid', sql`(
    ${t.reviewerType} = 'internal_user' AND ${t.reviewerUserId} IS NOT NULL AND ${t.reviewTokenHash} IS NULL AND ${t.expiresAt} IS NULL
  ) OR (
    ${t.reviewerType} = 'external_client' AND ${t.reviewerUserId} IS NULL AND ${t.reviewTokenHash} IS NOT NULL AND ${t.expiresAt} IS NOT NULL
  )`),
]);

export const shoots = sqliteTable('shoots', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id),
  clientId: text('client_id').notNull(),
  storeId: text('store_id').notNull(),
  shootDate: text('shoot_date').notNull(),
  startTime: text('start_time').notNull(),
  endTime: text('end_time').notNull(),
  operatorId: text('operator_id').notNull(),
  photographerId: text('photographer_id').notNull(),
  location: text('location').notNull().default(''),
  notes: text('notes').notNull().default(''),
  status: text('status', { enum: shootStatuses }).notNull().default('planned'),
  isDemo: integer('is_demo', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (t) => [
  uniqueIndex('uq_shoots_org_id').on(t.organizationId, t.id),
  index('idx_shoots_org_date_status').on(t.organizationId, t.shootDate, t.status),
  index('idx_shoots_org_client_date').on(t.organizationId, t.clientId, t.shootDate),
  index('idx_shoots_org_photographer_date').on(t.organizationId, t.photographerId, t.shootDate),
  foreignKey({ columns: [t.organizationId, t.clientId], foreignColumns: [clients.organizationId, clients.id] }),
  foreignKey({ columns: [t.organizationId, t.storeId], foreignColumns: [stores.organizationId, stores.id] }),
  foreignKey({ columns: [t.organizationId, t.operatorId], foreignColumns: [users.organizationId, users.id] }),
  foreignKey({ columns: [t.organizationId, t.photographerId], foreignColumns: [users.organizationId, users.id] }),
  check('shoots_date_valid', sql`length(${t.shootDate}) = 10 AND date(${t.shootDate}) IS NOT NULL`),
  check('shoots_start_time_valid', sql`length(${t.startTime}) = 5 AND time(${t.startTime}) IS NOT NULL`),
  check('shoots_end_time_valid', sql`length(${t.endTime}) = 5 AND time(${t.endTime}) IS NOT NULL`),
  check('shoots_time_order', sql`${t.startTime} < ${t.endTime}`),
  check('shoots_status_valid', sql`${t.status} IN ('planned', 'in_progress', 'completed', 'partially_completed', 'cancelled', 'rescheduled')`),
]);

export const shootContents = sqliteTable('shoot_contents', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id),
  shootId: text('shoot_id').notNull(),
  contentId: text('content_id').notNull(),
  approvedScriptVersionId: text('approved_script_version_id').notNull(),
  shootItemStatus: text('shoot_item_status', { enum: shootItemStatuses }).notNull().default('planned'),
  missingShots: text('missing_shots').notNull().default(''),
  note: text('note').notNull().default(''),
  isDemo: integer('is_demo', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (t) => [
  uniqueIndex('uq_shoot_contents_org_id').on(t.organizationId, t.id),
  uniqueIndex('uq_shoot_contents_org_shoot_content').on(t.organizationId, t.shootId, t.contentId),
  uniqueIndex('uq_shoot_contents_active_content').on(t.organizationId, t.contentId)
    .where(sql`${t.shootItemStatus} IN ('planned', 'missing_shots')`),
  index('idx_shoot_contents_org_shoot_status').on(t.organizationId, t.shootId, t.shootItemStatus),
  index('idx_shoot_contents_org_content').on(t.organizationId, t.contentId, t.createdAt),
  foreignKey({ columns: [t.organizationId, t.shootId], foreignColumns: [shoots.organizationId, shoots.id] }),
  foreignKey({ columns: [t.organizationId, t.contentId], foreignColumns: [contents.organizationId, contents.id] }),
  foreignKey({
    columns: [t.organizationId, t.contentId, t.approvedScriptVersionId],
    foreignColumns: [scriptVersions.organizationId, scriptVersions.contentId, scriptVersions.id],
  }),
  check('shoot_contents_status_valid', sql`${t.shootItemStatus} IN ('planned', 'shot', 'missing_shots', 'rescheduled', 'cancelled')`),
  check('shoot_contents_missing_detail', sql`${t.shootItemStatus} <> 'missing_shots' OR length(trim(${t.missingShots})) > 0`),
]);

export const contentEmbeddings = sqliteTable('content_embeddings', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id),
  accountId: text('account_id').notNull(),
  contentId: text('content_id').notNull(),
  embeddingModel: text('embedding_model').notNull(),
  sourceHash: text('source_hash').notNull(),
  vectorJson: text('vector_json', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  status: text('status', { enum: contentEmbeddingStatuses }).notNull(),
  isDemo: integer('is_demo', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (t) => [
  uniqueIndex('uq_content_embeddings_org_id').on(t.organizationId, t.id),
  uniqueIndex('uq_content_embeddings_active_content').on(t.organizationId, t.accountId, t.contentId)
    .where(sql`${t.status} = 'active'`),
  index('idx_content_embeddings_lookup').on(t.organizationId, t.accountId, t.status, t.embeddingModel),
  foreignKey({ columns: [t.organizationId, t.accountId, t.contentId], foreignColumns: [contents.organizationId, contents.accountId, contents.id] }),
  check('content_embeddings_status_valid', sql`${t.status} IN ('active', 'stale', 'failed')`),
  check('content_embeddings_model_valid', sql`length(trim(${t.embeddingModel})) > 0`),
  check('content_embeddings_hash_valid', sql`length(${t.sourceHash}) = 64`),
  check('content_embeddings_vector_json_valid', sql`json_valid(${t.vectorJson})`),
]);

export const historyRetrievals = sqliteTable('history_retrievals', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id),
  accountId: text('account_id').notNull(),
  candidateJson: text('candidate_json', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  retrievalMethod: text('retrieval_method', { enum: historyRetrievalMethods }).notNull(),
  runId: text('run_id'),
  createdBy: text('created_by').notNull(),
  isDemo: integer('is_demo', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
}, (t) => [
  uniqueIndex('uq_history_retrievals_org_id').on(t.organizationId, t.id),
  index('idx_history_retrievals_org_account_created').on(t.organizationId, t.accountId, t.createdAt),
  foreignKey({ columns: [t.organizationId, t.accountId], foreignColumns: [accounts.organizationId, accounts.id] }),
  foreignKey({ columns: [t.organizationId, t.runId], foreignColumns: [runs.organizationId, runs.id] }),
  foreignKey({ columns: [t.organizationId, t.createdBy], foreignColumns: [users.organizationId, users.id] }),
  check('history_retrievals_method_valid', sql`${t.retrievalMethod} IN ('embedding', 'fallback_bigram')`),
]);

export const historyRetrievalItems = sqliteTable('history_retrieval_items', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id),
  accountId: text('account_id').notNull(),
  retrievalId: text('retrieval_id').notNull(),
  contentId: text('content_id').notNull(),
  similarity: real('similarity').notNull(),
  retrievalMethod: text('retrieval_method', { enum: historyRetrievalMethods }).notNull(),
  sourceHash: text('source_hash').notNull(),
  rank: integer('rank').notNull(),
  isDemo: integer('is_demo', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
}, (t) => [
  uniqueIndex('uq_history_retrieval_items_rank').on(t.organizationId, t.retrievalId, t.rank),
  uniqueIndex('uq_history_retrieval_items_content').on(t.organizationId, t.retrievalId, t.contentId),
  index('idx_history_retrieval_items_org_account').on(t.organizationId, t.accountId, t.createdAt),
  foreignKey({ columns: [t.organizationId, t.retrievalId], foreignColumns: [historyRetrievals.organizationId, historyRetrievals.id] }),
  foreignKey({ columns: [t.organizationId, t.accountId, t.contentId], foreignColumns: [contents.organizationId, contents.accountId, contents.id] }),
  check('history_retrieval_items_similarity_valid', sql`${t.similarity} BETWEEN 0 AND 1`),
  check('history_retrieval_items_method_valid', sql`${t.retrievalMethod} IN ('embedding', 'fallback_bigram')`),
  check('history_retrieval_items_hash_valid', sql`length(${t.sourceHash}) = 64`),
  check('history_retrieval_items_rank_valid', sql`${t.rank} BETWEEN 1 AND 10 AND typeof(${t.rank}) = 'integer'`),
]);

export type ClientRow = typeof clients.$inferSelect;
export type ClientMemberRow = typeof clientMembers.$inferSelect;
export type BrandRow = typeof brands.$inferSelect;
export type StoreRow = typeof stores.$inferSelect;
export type AccountRow = typeof accounts.$inferSelect;
export type MonthlyPlanRow = typeof monthlyPlans.$inferSelect;
export type ContentRow = typeof contents.$inferSelect;
export type ContentStatusLogRow = typeof contentStatusLogs.$inferSelect;
export type ScriptVersionRow = typeof scriptVersions.$inferSelect;
export type EditVersionRow = typeof editVersions.$inferSelect;
export type PublishRow = typeof publishes.$inferSelect;
export type PerformanceSnapshotRow = typeof performanceSnapshots.$inferSelect;
export type PerformanceImportBatchRow = typeof performanceImportBatches.$inferSelect;
export type ApprovalRow = typeof approvals.$inferSelect;
export type ShootRow = typeof shoots.$inferSelect;
export type ShootContentRow = typeof shootContents.$inferSelect;
export type ContentImportBatchRow = typeof contentImportBatches.$inferSelect;
export type ContentEmbeddingRow = typeof contentEmbeddings.$inferSelect;
export type HistoryRetrievalRow = typeof historyRetrievals.$inferSelect;
export type HistoryRetrievalItemRow = typeof historyRetrievalItems.$inferSelect;

export const memories = sqliteTable('memories', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id),
  scopeType: text('scope_type', { enum: memoryScopeTypes }).notNull(),
  scopeId: text('scope_id').notNull(),
  memoryKey: text('memory_key').notNull(),
  memoryType: text('memory_type', { enum: memoryTypes }).notNull(),
  valueJson: text('value_json', { mode: 'json' }).$type<unknown>().notNull(),
  summary: text('summary').notNull(),
  importance: integer('importance').notNull(),
  confidence: real('confidence').notNull(),
  sourceType: text('source_type', { enum: memorySourceTypes }).notNull(),
  sourceId: text('source_id'),
  effectiveAt: text('effective_at').notNull(),
  expiresAt: text('expires_at'),
  status: text('status', { enum: memoryStatuses }).notNull().default('active'),
  supersedesMemoryId: text('supersedes_memory_id'),
  createdBy: text('created_by').notNull(),
  isDemo: integer('is_demo', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
}, (t) => [
  uniqueIndex('uq_memories_org_id').on(t.organizationId, t.id),
  uniqueIndex('uq_memories_active_key').on(t.organizationId, t.scopeType, t.scopeId, t.memoryKey)
    .where(sql`${t.status} = 'active'`),
  index('idx_memories_context_lookup').on(t.organizationId, t.scopeType, t.scopeId, t.status, t.effectiveAt),
  index('idx_memories_expiration').on(t.organizationId, t.status, t.expiresAt),
  foreignKey({ columns: [t.organizationId, t.createdBy], foreignColumns: [users.organizationId, users.id] }),
  foreignKey({
    columns: [t.organizationId, t.supersedesMemoryId],
    foreignColumns: [t.organizationId, t.id],
  }),
  check('memories_scope_type_valid', sql`${t.scopeType} IN ('brand', 'account')`),
  check('memories_type_valid', sql`${t.memoryType} IN ('brand', 'preference', 'content_pattern', 'performance_pattern', 'strategy', 'temporary')`),
  check('memories_status_valid', sql`${t.status} IN ('active', 'inactive', 'superseded', 'expired')`),
  check('memories_source_type_valid', sql`${t.sourceType} IN ('brand_profile', 'confirmed_preference', 'confirmed_performance', 'confirmed_strategy', 'manual')`),
  check('memories_importance_valid', sql`${t.importance} BETWEEN 1 AND 5 AND typeof(${t.importance}) = 'integer'`),
  check('memories_confidence_valid', sql`${t.confidence} BETWEEN 0 AND 1`),
  check('memories_expiration_order', sql`${t.expiresAt} IS NULL OR ${t.effectiveAt} < ${t.expiresAt}`),
]);

export const contextSnapshots = sqliteTable('context_snapshots', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id),
  accountId: text('account_id').notNull(),
  contentId: text('content_id'),
  monthlyPlanId: text('monthly_plan_id'),
  contextSnapshotJson: text('context_snapshot_json', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  createdBy: text('created_by').notNull(),
  isDemo: integer('is_demo', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
}, (t) => [
  uniqueIndex('uq_context_snapshots_org_id').on(t.organizationId, t.id),
  index('idx_context_snapshots_org_account_created').on(t.organizationId, t.accountId, t.createdAt),
  foreignKey({ columns: [t.organizationId, t.accountId], foreignColumns: [accounts.organizationId, accounts.id] }),
  foreignKey({ columns: [t.organizationId, t.contentId], foreignColumns: [contents.organizationId, contents.id] }),
  foreignKey({
    columns: [t.organizationId, t.accountId, t.monthlyPlanId],
    foreignColumns: [monthlyPlans.organizationId, monthlyPlans.accountId, monthlyPlans.id],
  }),
  foreignKey({ columns: [t.organizationId, t.createdBy], foreignColumns: [users.organizationId, users.id] }),
]);

export type MemoryRow = typeof memories.$inferSelect;
export type ContextSnapshotRow = typeof contextSnapshots.$inferSelect;

export const plannerSessions = sqliteTable('planner_sessions', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id),
  runId: text('run_id').notNull(),
  accountId: text('account_id').notNull(),
  monthlyPlanId: text('monthly_plan_id'),
  contextSnapshotId: text('context_snapshot_id'),
  plannedCount: integer('planned_count').notNull(),
  shootDate: text('shoot_date'),
  primaryGoal: text('primary_goal', { enum: contentGoals }).notNull(),
  specialRequirements: text('special_requirements'),
  planningSummary: text('planning_summary').notNull().default(''),
  status: text('status', { enum: plannerSessionStatuses }).notNull().default('generating'),
  plannerSkillVersion: integer('planner_skill_version').notNull(),
  plannerPointCost: integer('planner_point_cost').notNull(),
  selectedCount: integer('selected_count').notNull().default(0),
  createdBy: text('created_by').notNull(),
  isDemo: integer('is_demo', { mode: 'boolean' }).notNull().default(false),
  completedAt: text('completed_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (t) => [
  uniqueIndex('uq_planner_sessions_org_id').on(t.organizationId, t.id),
  uniqueIndex('uq_planner_sessions_org_run').on(t.organizationId, t.runId),
  index('idx_planner_sessions_org_account_created').on(t.organizationId, t.accountId, t.createdAt),
  foreignKey({ columns: [t.organizationId, t.runId], foreignColumns: [runs.organizationId, runs.id] }),
  foreignKey({ columns: [t.organizationId, t.accountId], foreignColumns: [accounts.organizationId, accounts.id] }),
  foreignKey({ columns: [t.organizationId, t.accountId, t.monthlyPlanId], foreignColumns: [monthlyPlans.organizationId, monthlyPlans.accountId, monthlyPlans.id] }),
  foreignKey({ columns: [t.organizationId, t.contextSnapshotId], foreignColumns: [contextSnapshots.organizationId, contextSnapshots.id] }),
  foreignKey({ columns: [t.organizationId, t.createdBy], foreignColumns: [users.organizationId, users.id] }),
  check('planner_sessions_count_valid', sql`${t.plannedCount} BETWEEN 1 AND 20 AND typeof(${t.plannedCount}) = 'integer'`),
  check('planner_sessions_point_cost_valid', sql`${t.plannerPointCost} >= 0 AND typeof(${t.plannerPointCost}) = 'integer'`),
  check('planner_sessions_selected_count_valid', sql`${t.selectedCount} BETWEEN 0 AND ${t.plannedCount}`),
  check('planner_sessions_status_valid', sql`${t.status} IN ('generating', 'awaiting_selection', 'completed', 'failed')`),
  check('planner_sessions_goal_valid', sql`${t.primaryGoal} IN ('exposure', 'followers', 'trust', 'click', 'conversion', 'gmv')`),
]);

export const plannerCandidates = sqliteTable('planner_candidates', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id),
  plannerSessionId: text('planner_session_id').notNull(),
  accountId: text('account_id').notNull(),
  sourceRunId: text('source_run_id').notNull(),
  sequence: integer('sequence').notNull(),
  revision: integer('revision').notNull().default(1),
  replacesCandidateId: text('replaces_candidate_id'),
  title: text('title').notNull(),
  contentType: text('content_type', { enum: contentTypes }).notNull(),
  contentGoal: text('content_goal', { enum: contentGoals }).notNull(),
  topic: text('topic').notNull(),
  angle: text('angle').notNull(),
  hookType: text('hook_type', { enum: hookTypes }).notNull(),
  hookIdea: text('hook_idea').notNull(),
  coreMessage: text('core_message').notNull(),
  recommendedReason: text('recommended_reason').notNull(),
  creativeBriefJson: text('creative_brief_json', { mode: 'json' }).$type<unknown>(),
  duplicateLevel: text('duplicate_level', { enum: ['new', 'mild', 'remixable', 'high'] }).notNull(),
  similarContentsJson: text('similar_contents_json', { mode: 'json' }).$type<unknown[]>().notNull().default([]),
  duplicateReason: text('duplicate_reason').notNull(),
  alternativeAnglesJson: text('alternative_angles_json', { mode: 'json' }).$type<string[]>().notNull().default([]),
  qualityStatus: text('quality_status', { enum: plannerQualityStatuses }).notNull(),
  qualityIssuesJson: text('quality_issues_json', { mode: 'json' }).$type<unknown[]>().notNull().default([]),
  selectable: integer('selectable', { mode: 'boolean' }).notNull(),
  status: text('status', { enum: plannerCandidateStatuses }).notNull().default('active'),
  persistedContentId: text('persisted_content_id'),
  isDemo: integer('is_demo', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (t) => [
  uniqueIndex('uq_planner_candidates_org_id').on(t.organizationId, t.id),
  uniqueIndex('uq_planner_candidates_active_sequence').on(t.organizationId, t.plannerSessionId, t.sequence).where(sql`${t.status} = 'active'`),
  index('idx_planner_candidates_org_session').on(t.organizationId, t.plannerSessionId, t.sequence),
  foreignKey({ columns: [t.organizationId, t.plannerSessionId], foreignColumns: [plannerSessions.organizationId, plannerSessions.id] }),
  foreignKey({ columns: [t.organizationId, t.accountId], foreignColumns: [accounts.organizationId, accounts.id] }),
  foreignKey({ columns: [t.organizationId, t.sourceRunId], foreignColumns: [runs.organizationId, runs.id] }),
  foreignKey({ columns: [t.organizationId, t.replacesCandidateId], foreignColumns: [t.organizationId, t.id] }),
  foreignKey({ columns: [t.organizationId, t.persistedContentId], foreignColumns: [contents.organizationId, contents.id] }),
  check('planner_candidates_sequence_valid', sql`${t.sequence} >= 0 AND typeof(${t.sequence}) = 'integer'`),
  check('planner_candidates_revision_valid', sql`${t.revision} >= 1 AND typeof(${t.revision}) = 'integer'`),
  check('planner_candidates_status_valid', sql`${t.status} IN ('active', 'replaced', 'persisted', 'dismissed')`),
  check('planner_candidates_quality_valid', sql`${t.qualityStatus} IN ('passed', 'warning', 'blocked')`),
  check('planner_candidates_duplicate_valid', sql`${t.duplicateLevel} IN ('new', 'mild', 'remixable', 'high')`),
]);

export type PlannerSessionRow = typeof plannerSessions.$inferSelect;
export type PlannerCandidateRow = typeof plannerCandidates.$inferSelect;

export const skills = sqliteTable(
  'skills',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').references(() => organizations.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    systemPrompt: text('system_prompt').notNull(),
    userPromptTemplate: text('user_prompt_template').notNull(),
    inputSchemaJson: text('input_schema_json', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull(),
    outputSchemaJson: text('output_schema_json', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull(),
    modelProfile: text('model_profile', { enum: modelProfiles }).notNull(),
    pointCost: integer('point_cost').notNull().default(0),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    currentVersion: integer('current_version').notNull().default(1),
    isDemo: integer('is_demo', { mode: 'boolean' }).notNull().default(false),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('uq_skills_system_code')
      .on(t.code)
      .where(sql`${t.organizationId} IS NULL`),
    uniqueIndex('uq_skills_organization_code')
      .on(t.organizationId, t.code)
      .where(sql`${t.organizationId} IS NOT NULL`),
    index('idx_skills_organization_enabled').on(t.organizationId, t.enabled),
    check('skills_code_valid', sql`length(trim(${t.code})) > 0`),
    check(
      'skills_model_profile_valid',
      sql`${t.modelProfile} IN ('light', 'standard', 'strong')`,
    ),
    check(
      'skills_point_cost_nonnegative',
      sql`${t.pointCost} >= 0 AND typeof(${t.pointCost}) = 'integer'`,
    ),
    check(
      'skills_version_positive',
      sql`${t.currentVersion} >= 1 AND typeof(${t.currentVersion}) = 'integer'`,
    ),
  ],
);

export const skillVersions = sqliteTable(
  'skill_versions',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').references(() => organizations.id),
    skillId: text('skill_id')
      .notNull()
      .references(() => skills.id),
    version: integer('version').notNull(),
    systemPrompt: text('system_prompt').notNull(),
    userPromptTemplate: text('user_prompt_template').notNull(),
    inputSchemaJson: text('input_schema_json', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull(),
    outputSchemaJson: text('output_schema_json', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull(),
    modelProfile: text('model_profile', { enum: modelProfiles }).notNull(),
    pointCost: integer('point_cost').notNull(),
    changeReason: text('change_reason').notNull(),
    createdBy: text('created_by').references(() => users.id),
    isDemo: integer('is_demo', { mode: 'boolean' }).notNull().default(false),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('uq_skill_versions_skill_version').on(t.skillId, t.version),
    index('idx_skill_versions_organization_skill').on(
      t.organizationId,
      t.skillId,
    ),
    check(
      'skill_versions_version_positive',
      sql`${t.version} >= 1 AND typeof(${t.version}) = 'integer'`,
    ),
    check(
      'skill_versions_model_profile_valid',
      sql`${t.modelProfile} IN ('light', 'standard', 'strong')`,
    ),
    check(
      'skill_versions_point_cost_nonnegative',
      sql`${t.pointCost} >= 0 AND typeof(${t.pointCost}) = 'integer'`,
    ),
  ],
);

export const modelPriceConfigs = sqliteTable(
  'model_price_configs',
  {
    id: text('id').primaryKey(),
    model: text('model').notNull(),
    inputPricePerMillion: real('input_price_per_million'),
    outputPricePerMillion: real('output_price_per_million'),
    effectiveAt: text('effective_at').notNull(),
    status: text('status', { enum: priceConfigStatuses }).notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('uq_model_price_configs_model_effective').on(
      t.model,
      t.effectiveAt,
    ),
    index('idx_model_price_configs_lookup').on(
      t.model,
      t.status,
      t.effectiveAt,
    ),
    check(
      'model_price_configs_status_valid',
      sql`${t.status} IN ('active', 'inactive')`,
    ),
    check(
      'model_price_configs_input_nonnegative',
      sql`${t.inputPricePerMillion} IS NULL OR ${t.inputPricePerMillion} >= 0`,
    ),
    check(
      'model_price_configs_output_nonnegative',
      sql`${t.outputPricePerMillion} IS NULL OR ${t.outputPricePerMillion} >= 0`,
    ),
  ],
);

export const organizationAiQuotas = sqliteTable(
  'organization_ai_quotas',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    periodStart: text('period_start').notNull(),
    periodEnd: text('period_end').notNull(),
    quotaPoints: integer('quota_points').notNull(),
    usedPoints: integer('used_points').notNull().default(0),
    isDemo: integer('is_demo', { mode: 'boolean' }).notNull().default(false),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('uq_organization_ai_quotas_period').on(
      t.organizationId,
      t.periodStart,
      t.periodEnd,
    ),
    index('idx_organization_ai_quotas_active').on(
      t.organizationId,
      t.periodStart,
      t.periodEnd,
    ),
    check(
      'organization_ai_quotas_period_valid',
      sql`${t.periodStart} < ${t.periodEnd}`,
    ),
    check(
      'organization_ai_quotas_points_valid',
      sql`${t.quotaPoints} >= 0 AND ${t.usedPoints} >= 0 AND ${t.usedPoints} <= ${t.quotaPoints}`,
    ),
  ],
);

export const aiPointLedger = sqliteTable(
  'ai_point_ledger',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    runId: text('run_id'),
    skillCode: text('skill_code').notNull(),
    points: integer('points').notNull(),
    ledgerType: text('ledger_type', { enum: aiLedgerTypes }).notNull(),
    reason: text('reason').notNull(),
    isDemo: integer('is_demo', { mode: 'boolean' }).notNull().default(false),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    index('idx_ai_point_ledger_organization_created').on(
      t.organizationId,
      t.createdAt,
    ),
    uniqueIndex('uq_ai_point_ledger_run_consume')
      .on(t.organizationId, t.runId)
      .where(sql`${t.ledgerType} = 'consume' AND ${t.runId} IS NOT NULL`),
    foreignKey({
      columns: [t.organizationId, t.runId],
      foreignColumns: [runs.organizationId, runs.id],
    }),
    check(
      'ai_point_ledger_type_valid',
      sql`${t.ledgerType} IN ('consume', 'grant', 'refund', 'adjustment')`,
    ),
    check(
      'ai_point_ledger_points_positive',
      sql`${t.points} > 0 AND typeof(${t.points}) = 'integer'`,
    ),
  ],
);

export const aiUsageLogs = sqliteTable(
  'ai_usage_logs',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    runId: text('run_id').notNull(),
    runStepId: text('run_step_id').notNull(),
    runType: text('run_type', { enum: runTypes }).notNull(),
    userId: text('user_id').notNull(),
    clientId: text('client_id'),
    accountId: text('account_id'),
    skillCode: text('skill_code').notNull(),
    skillVersion: integer('skill_version').notNull(),
    providerRequestId: text('provider_request_id'),
    model: text('model').notNull(),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    estimatedCost: real('estimated_cost'),
    billedPoints: integer('billed_points').notNull().default(0),
    attempts: integer('attempts').notNull().default(1),
    durationMs: integer('duration_ms').notNull(),
    status: text('status', { enum: aiUsageStatuses }).notNull(),
    isDemo: integer('is_demo', { mode: 'boolean' }).notNull().default(false),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    index('idx_ai_usage_logs_organization_created').on(
      t.organizationId,
      t.createdAt,
    ),
    index('idx_ai_usage_logs_run').on(t.organizationId, t.runId),
    foreignKey({
      columns: [t.organizationId, t.runId],
      foreignColumns: [runs.organizationId, runs.id],
    }),
    foreignKey({
      columns: [t.organizationId, t.runStepId],
      foreignColumns: [runSteps.organizationId, runSteps.id],
    }),
    foreignKey({
      columns: [t.organizationId, t.userId],
      foreignColumns: [users.organizationId, users.id],
    }),
    foreignKey({
      columns: [t.organizationId, t.clientId],
      foreignColumns: [clients.organizationId, clients.id],
    }),
    foreignKey({
      columns: [t.organizationId, t.accountId],
      foreignColumns: [accounts.organizationId, accounts.id],
    }),
    check(
      'ai_usage_logs_status_valid',
      sql`${t.status} IN ('completed', 'failed')`,
    ),
    check(
      'ai_usage_logs_tokens_valid',
      sql`(${t.inputTokens} IS NULL OR ${t.inputTokens} >= 0) AND (${t.outputTokens} IS NULL OR ${t.outputTokens} >= 0)`,
    ),
    check(
      'ai_usage_logs_values_valid',
      sql`${t.skillVersion} >= 1 AND ${t.billedPoints} >= 0 AND ${t.attempts} BETWEEN 1 AND 2 AND ${t.durationMs} >= 0 AND (${t.estimatedCost} IS NULL OR ${t.estimatedCost} >= 0)`,
    ),
  ],
);

export type SkillRow = typeof skills.$inferSelect;
export type SkillVersionRow = typeof skillVersions.$inferSelect;
export type ModelPriceConfigRow = typeof modelPriceConfigs.$inferSelect;
export type OrganizationAiQuotaRow = typeof organizationAiQuotas.$inferSelect;
export type AiPointLedgerRow = typeof aiPointLedger.$inferSelect;
export type AiUsageLogRow = typeof aiUsageLogs.$inferSelect;

export const ratings = sqliteTable('ratings', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id),
  runId: text('run_id').notNull(),
  overallScore: integer('overall_score').notNull(),
  brandConsistency: integer('brand_consistency').notNull(),
  usability: integer('usability').notNull(),
  novelty: integer('novelty').notNull(),
  comment: text('comment').notNull().default(''),
  issueTagsJson: text('issue_tags_json', { mode: 'json' }).$type<(typeof ratingIssueTags)[number][]>().notNull().default([]),
  markedBadCase: integer('marked_bad_case', { mode: 'boolean' }).notNull().default(false),
  ratedBy: text('rated_by').notNull(),
  ratedAt: text('rated_at').notNull(),
  currentVersion: integer('current_version').notNull().default(1),
  isDemo: integer('is_demo', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (t) => [
  uniqueIndex('uq_ratings_org_run_rater').on(t.organizationId, t.runId, t.ratedBy),
  uniqueIndex('uq_ratings_org_id').on(t.organizationId, t.id),
  index('idx_ratings_org_run').on(t.organizationId, t.runId, t.ratedAt),
  foreignKey({ columns: [t.organizationId, t.runId], foreignColumns: [runs.organizationId, runs.id] }),
  foreignKey({ columns: [t.organizationId, t.ratedBy], foreignColumns: [users.organizationId, users.id] }),
  check('ratings_scores_valid', sql`
    ${t.overallScore} BETWEEN 1 AND 5 AND ${t.brandConsistency} BETWEEN 1 AND 5 AND
    ${t.usability} BETWEEN 1 AND 5 AND ${t.novelty} BETWEEN 1 AND 5
  `),
  check('ratings_version_valid', sql`${t.currentVersion} >= 1 AND typeof(${t.currentVersion}) = 'integer'`),
  check('ratings_issue_tags_array', sql`json_type(${t.issueTagsJson}) = 'array'`),
]);

export const ratingVersions = sqliteTable('rating_versions', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id),
  ratingId: text('rating_id').notNull(),
  versionNo: integer('version_no').notNull(),
  overallScore: integer('overall_score').notNull(),
  brandConsistency: integer('brand_consistency').notNull(),
  usability: integer('usability').notNull(),
  novelty: integer('novelty').notNull(),
  comment: text('comment').notNull().default(''),
  issueTagsJson: text('issue_tags_json', { mode: 'json' }).$type<(typeof ratingIssueTags)[number][]>().notNull().default([]),
  markedBadCase: integer('marked_bad_case', { mode: 'boolean' }).notNull().default(false),
  ratedBy: text('rated_by').notNull(),
  ratedAt: text('rated_at').notNull(),
  createdAt: text('created_at').notNull(),
}, (t) => [
  uniqueIndex('uq_rating_versions_org_id').on(t.organizationId, t.id),
  uniqueIndex('uq_rating_versions_rating_version').on(t.organizationId, t.ratingId, t.versionNo),
  index('idx_rating_versions_org_rating').on(t.organizationId, t.ratingId, t.versionNo),
  foreignKey({ columns: [t.organizationId, t.ratingId], foreignColumns: [ratings.organizationId, ratings.id] }),
  foreignKey({ columns: [t.organizationId, t.ratedBy], foreignColumns: [users.organizationId, users.id] }),
  check('rating_versions_scores_valid', sql`
    ${t.overallScore} BETWEEN 1 AND 5 AND ${t.brandConsistency} BETWEEN 1 AND 5 AND
    ${t.usability} BETWEEN 1 AND 5 AND ${t.novelty} BETWEEN 1 AND 5
  `),
  check('rating_versions_version_valid', sql`${t.versionNo} >= 1 AND typeof(${t.versionNo}) = 'integer'`),
  check('rating_versions_issue_tags_array', sql`json_type(${t.issueTagsJson}) = 'array'`),
]);

export const badCases = sqliteTable('bad_cases', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id),
  category: text('category', { enum: badCaseCategories }).notNull(),
  severity: text('severity', { enum: badCaseSeverities }).notNull(),
  runId: text('run_id').notNull(),
  stepCode: text('step_code').notNull(),
  skillCode: text('skill_code').notNull(),
  skillVersion: integer('skill_version').notNull(),
  inputSnapshotJson: text('input_snapshot_json', { mode: 'json' }).$type<unknown>().notNull(),
  contextSnapshotJson: text('context_snapshot_json', { mode: 'json' }).$type<unknown>().notNull(),
  outputJson: text('output_json', { mode: 'json' }).$type<unknown>().notNull(),
  expectedBehavior: text('expected_behavior').notNull().default(''),
  status: text('status', { enum: badCaseStatuses }).notNull().default('open'),
  ruleGenerated: integer('rule_generated', { mode: 'boolean' }).notNull(),
  sourceRatingId: text('source_rating_id'),
  fingerprint: text('fingerprint').notNull(),
  createdBy: text('created_by').notNull(),
  isDemo: integer('is_demo', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (t) => [
  uniqueIndex('uq_bad_cases_org_id').on(t.organizationId, t.id),
  uniqueIndex('uq_bad_cases_org_fingerprint').on(t.organizationId, t.fingerprint),
  index('idx_bad_cases_org_status_created').on(t.organizationId, t.status, t.createdAt),
  index('idx_bad_cases_org_skill_version').on(t.organizationId, t.skillCode, t.skillVersion),
  foreignKey({ columns: [t.organizationId, t.runId], foreignColumns: [runs.organizationId, runs.id] }),
  foreignKey({ columns: [t.organizationId, t.sourceRatingId], foreignColumns: [ratings.organizationId, ratings.id] }),
  foreignKey({ columns: [t.organizationId, t.createdBy], foreignColumns: [users.organizationId, users.id] }),
  check('bad_cases_category_valid', sql`${t.category} IN (
    'brand_fact_error', 'expired_information', 'duplicate_content', 'wrong_style',
    'unusable_script', 'wrong_content_goal', 'poor_strategy', 'invalid_json',
    'context_missing', 'other', 'low_rating', 'memory_status_violation',
    'high_duplicate_default', 'schema_repeated_failure', 'manual_flag'
  )`),
  check('bad_cases_severity_valid', sql`${t.severity} IN ('low', 'medium', 'high', 'critical')`),
  check('bad_cases_status_valid', sql`${t.status} IN ('open', 'investigating', 'resolved', 'dismissed')`),
  check('bad_cases_skill_version_valid', sql`${t.skillVersion} >= 1 AND typeof(${t.skillVersion}) = 'integer'`),
]);

export const improvementProposals = sqliteTable('improvement_proposals', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id),
  skillId: text('skill_id').notNull(),
  baseSkillVersion: integer('base_skill_version').notNull(),
  proposalRunId: text('proposal_run_id').notNull(),
  rootCause: text('root_cause').notNull(),
  changeReason: text('change_reason').notNull(),
  newSystemPrompt: text('new_system_prompt').notNull(),
  newUserPromptTemplate: text('new_user_prompt_template').notNull(),
  risksJson: text('risks_json', { mode: 'json' }).$type<string[]>().notNull().default([]),
  affectedCasesJson: text('affected_cases_json', { mode: 'json' }).$type<string[]>().notNull().default([]),
  status: text('status', { enum: improvementProposalStatuses }).notNull().default('draft'),
  appliedSkillVersion: integer('applied_skill_version'),
  appliedBy: text('applied_by'),
  appliedAt: text('applied_at'),
  createdBy: text('created_by').notNull(),
  isDemo: integer('is_demo', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (t) => [
  uniqueIndex('uq_improvement_proposals_org_id').on(t.organizationId, t.id),
  index('idx_improvement_proposals_org_status_created').on(t.organizationId, t.status, t.createdAt),
  foreignKey({ columns: [t.organizationId, t.proposalRunId], foreignColumns: [runs.organizationId, runs.id] }),
  foreignKey({ columns: [t.skillId], foreignColumns: [skills.id] }),
  foreignKey({ columns: [t.organizationId, t.appliedBy], foreignColumns: [users.organizationId, users.id] }),
  foreignKey({ columns: [t.organizationId, t.createdBy], foreignColumns: [users.organizationId, users.id] }),
  check('improvement_proposals_status_valid', sql`${t.status} IN ('draft', 'evaluated', 'applied', 'rejected')`),
  check('improvement_proposals_version_valid', sql`${t.baseSkillVersion} >= 1 AND (${t.appliedSkillVersion} IS NULL OR ${t.appliedSkillVersion} > ${t.baseSkillVersion})`),
  check('improvement_proposals_cases_array', sql`json_type(${t.affectedCasesJson}) = 'array' AND json_type(${t.risksJson}) = 'array'`),
]);

export const evalCases = sqliteTable('eval_cases', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id),
  sourceType: text('source_type', { enum: evalCaseSourceTypes }).notNull(),
  sourceId: text('source_id'),
  name: text('name').notNull(),
  skillCode: text('skill_code').notNull(),
  skillVersion: integer('skill_version').notNull(),
  inputSnapshotJson: text('input_snapshot_json', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  contextSnapshotJson: text('context_snapshot_json', { mode: 'json' }).$type<unknown>().notNull(),
  expectedBehavior: text('expected_behavior').notNull(),
  expectedDuplicateLevel: text('expected_duplicate_level', { enum: ['new', 'mild', 'remixable', 'high'] }),
  assertionsJson: text('assertions_json', { mode: 'json' }).$type<Record<string, unknown>>().notNull().default({}),
  status: text('status', { enum: evalCaseStatuses }).notNull().default('active'),
  createdBy: text('created_by').notNull(),
  isDemo: integer('is_demo', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (t) => [
  uniqueIndex('uq_eval_cases_org_id').on(t.organizationId, t.id),
  uniqueIndex('uq_eval_cases_org_source').on(t.organizationId, t.sourceType, t.sourceId).where(sql`${t.sourceId} IS NOT NULL`),
  index('idx_eval_cases_org_skill_status').on(t.organizationId, t.skillCode, t.status, t.createdAt),
  foreignKey({ columns: [t.organizationId, t.createdBy], foreignColumns: [users.organizationId, users.id] }),
  check('eval_cases_source_valid', sql`${t.sourceType} IN ('bad_case', 'high_rating_production', 'manual')`),
  check('eval_cases_status_valid', sql`${t.status} IN ('active', 'inactive')`),
  check('eval_cases_version_valid', sql`${t.skillVersion} >= 1 AND typeof(${t.skillVersion}) = 'integer'`),
  check('eval_cases_duplicate_level_valid', sql`${t.expectedDuplicateLevel} IS NULL OR ${t.expectedDuplicateLevel} IN ('new', 'mild', 'remixable', 'high')`),
]);

export const evalExperiments = sqliteTable('eval_experiments', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id),
  proposalId: text('proposal_id').notNull(),
  baselineSkillVersion: integer('baseline_skill_version').notNull(),
  modelProfile: text('model_profile', { enum: modelProfiles }).notNull(),
  caseIdsJson: text('case_ids_json', { mode: 'json' }).$type<string[]>().notNull(),
  runIdsAJson: text('run_ids_a_json', { mode: 'json' }).$type<string[]>().notNull().default([]),
  runIdsBJson: text('run_ids_b_json', { mode: 'json' }).$type<string[]>().notNull().default([]),
  status: text('status', { enum: evalExperimentStatuses }).notNull().default('running'),
  verdict: text('verdict', { enum: evalVerdicts }).notNull().default('data_insufficient'),
  metricsAJson: text('metrics_a_json', { mode: 'json' }).$type<Record<string, unknown>>().notNull().default({}),
  metricsBJson: text('metrics_b_json', { mode: 'json' }).$type<Record<string, unknown>>().notNull().default({}),
  comparisonJson: text('comparison_json', { mode: 'json' }).$type<Record<string, unknown>>().notNull().default({}),
  createdBy: text('created_by').notNull(),
  isDemo: integer('is_demo', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
  completedAt: text('completed_at'),
}, (t) => [
  uniqueIndex('uq_eval_experiments_org_id').on(t.organizationId, t.id),
  index('idx_eval_experiments_org_proposal_created').on(t.organizationId, t.proposalId, t.createdAt),
  foreignKey({ columns: [t.organizationId, t.proposalId], foreignColumns: [improvementProposals.organizationId, improvementProposals.id] }),
  foreignKey({ columns: [t.organizationId, t.createdBy], foreignColumns: [users.organizationId, users.id] }),
  check('eval_experiments_status_valid', sql`${t.status} IN ('running', 'completed', 'failed')`),
  check('eval_experiments_verdict_valid', sql`${t.verdict} IN ('data_insufficient', 'passed', 'regressed')`),
  check('eval_experiments_arrays_valid', sql`json_type(${t.caseIdsJson}) = 'array' AND json_type(${t.runIdsAJson}) = 'array' AND json_type(${t.runIdsBJson}) = 'array'`),
]);

export const evalCaseResults = sqliteTable('eval_case_results', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id),
  experimentId: text('experiment_id').notNull(),
  evalCaseId: text('eval_case_id').notNull(),
  variant: text('variant', { enum: evalVariants }).notNull(),
  runId: text('run_id').notNull(),
  outputJson: text('output_json', { mode: 'json' }).$type<unknown>().notNull(),
  metricsJson: text('metrics_json', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  schemaValid: integer('schema_valid', { mode: 'boolean' }).notNull(),
  durationMs: integer('duration_ms').notNull(),
  estimatedCost: real('estimated_cost'),
  model: text('model').notNull(),
  createdAt: text('created_at').notNull(),
}, (t) => [
  uniqueIndex('uq_eval_case_results_org_id').on(t.organizationId, t.id),
  uniqueIndex('uq_eval_case_results_experiment_case_variant').on(t.organizationId, t.experimentId, t.evalCaseId, t.variant),
  index('idx_eval_case_results_org_experiment').on(t.organizationId, t.experimentId, t.variant),
  foreignKey({ columns: [t.organizationId, t.experimentId], foreignColumns: [evalExperiments.organizationId, evalExperiments.id] }),
  foreignKey({ columns: [t.organizationId, t.evalCaseId], foreignColumns: [evalCases.organizationId, evalCases.id] }),
  foreignKey({ columns: [t.organizationId, t.runId], foreignColumns: [runs.organizationId, runs.id] }),
  check('eval_case_results_variant_valid', sql`${t.variant} IN ('a', 'b')`),
  check('eval_case_results_values_valid', sql`${t.durationMs} >= 0 AND (${t.estimatedCost} IS NULL OR ${t.estimatedCost} >= 0)`),
]);

export type RatingRow = typeof ratings.$inferSelect;
export type RatingVersionRow = typeof ratingVersions.$inferSelect;
export type BadCaseRow = typeof badCases.$inferSelect;
export type ImprovementProposalRow = typeof improvementProposals.$inferSelect;
export type EvalCaseRow = typeof evalCases.$inferSelect;
export type EvalExperimentRow = typeof evalExperiments.$inferSelect;
export type EvalCaseResultRow = typeof evalCaseResults.$inferSelect;
