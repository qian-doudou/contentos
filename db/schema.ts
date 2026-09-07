import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
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
  (table) => [index('idx_users_organization_id').on(table.organizationId)],
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

