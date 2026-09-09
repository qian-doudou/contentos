import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

let sqlite: Database.Database | undefined;

afterEach(() => sqlite?.close());

describe('SQLite migration', () => {
  it('applies through the transactional Drizzle migrator', () => {
    sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    expect(() => migrate(drizzle(sqlite!), { migrationsFolder: resolve('drizzle') })).not.toThrow();
    expect(sqlite.pragma('foreign_key_check')).toEqual([]);
    expect(sqlite.prepare("select count(*) as value from sqlite_schema where type = 'table' and name = 'skills'").get()).toEqual({ value: 1 });
  });

  it('creates every phase-thirteen table with organization scope', () => {
    sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    const migrations = readdirSync(resolve('drizzle'))
      .filter((file) => file.endsWith('.sql'))
      .sort();
    for (const file of migrations) {
      sqlite.exec(readFileSync(resolve('drizzle', file), 'utf8').replaceAll('--> statement-breakpoint', ''));
    }

    const tables = sqlite.prepare("select name from sqlite_schema where type = 'table' order by name").all() as Array<{ name: string }>;
    expect(tables.map((row) => row.name)).toEqual([
      'accounts', 'ai_point_ledger', 'ai_usage_logs', 'app_settings', 'approvals', 'audit_logs', 'brands', 'client_members', 'clients',
      'content_embeddings', 'content_import_batches', 'content_status_logs', 'contents', 'context_snapshots', 'edit_versions', 'history_retrieval_items', 'history_retrievals',
      'memories', 'model_price_configs', 'monthly_plans', 'organization_ai_quotas', 'organizations', 'performance_import_batches',
      'performance_snapshots', 'planner_candidates', 'planner_sessions', 'publishes', 'run_steps', 'runs', 'script_versions',
      'shoot_contents', 'shoots', 'skill_versions', 'skills', 'stores', 'users',
    ]);

    for (const table of [
      'accounts', 'ai_point_ledger', 'ai_usage_logs', 'app_settings', 'approvals', 'audit_logs', 'brands', 'client_members', 'clients',
      'content_embeddings', 'content_import_batches', 'content_status_logs', 'contents', 'context_snapshots', 'edit_versions', 'history_retrieval_items', 'history_retrievals',
      'memories', 'monthly_plans', 'organization_ai_quotas', 'performance_import_batches', 'performance_snapshots', 'planner_candidates',
      'planner_sessions', 'publishes', 'run_steps', 'runs', 'script_versions', 'skill_versions',
      'shoot_contents', 'shoots', 'skills', 'stores', 'users',
    ]) {
      const columns = sqlite.prepare(`pragma table_info(${table})`).all() as Array<{ name: string }>;
      expect(columns.some((column) => column.name === 'organization_id')).toBe(true);
    }

    const accountForeignKeys = sqlite.prepare('pragma foreign_key_list(accounts)').all() as Array<{ id: number }>;
    expect(new Set(accountForeignKeys.map((key) => key.id)).size).toBe(4);
    const membershipForeignKeys = sqlite.prepare('pragma foreign_key_list(client_members)').all() as Array<{ id: number }>;
    expect(new Set(membershipForeignKeys.map(key => key.id)).size).toBe(2);
    const planForeignKeys = sqlite.prepare('pragma foreign_key_list(monthly_plans)').all() as Array<{ id: number }>;
    expect(new Set(planForeignKeys.map(key => key.id)).size).toBe(3);
    const contentForeignKeys = sqlite.prepare('pragma foreign_key_list(contents)').all() as Array<{ id: number }>;
    expect(new Set(contentForeignKeys.map(key => key.id)).size).toBe(6);
    const statusLogForeignKeys = sqlite.prepare('pragma foreign_key_list(content_status_logs)').all() as Array<{ id: number }>;
    expect(new Set(statusLogForeignKeys.map(key => key.id)).size).toBe(3);
    const usageForeignKeys = sqlite.prepare('pragma foreign_key_list(ai_usage_logs)').all() as Array<{ id: number }>;
    expect(new Set(usageForeignKeys.map(key => key.id)).size).toBe(6);
    const memoryForeignKeys = sqlite.prepare('pragma foreign_key_list(memories)').all() as Array<{ id: number }>;
    expect(new Set(memoryForeignKeys.map(key => key.id)).size).toBe(3);
    const snapshotForeignKeys = sqlite.prepare('pragma foreign_key_list(context_snapshots)').all() as Array<{ id: number }>;
    expect(new Set(snapshotForeignKeys.map(key => key.id)).size).toBe(5);
    const embeddingForeignKeys = sqlite.prepare('pragma foreign_key_list(content_embeddings)').all() as Array<{ id: number }>;
    expect(new Set(embeddingForeignKeys.map(key => key.id)).size).toBe(2);
    const importForeignKeys = sqlite.prepare('pragma foreign_key_list(content_import_batches)').all() as Array<{ id: number }>;
    expect(new Set(importForeignKeys.map(key => key.id)).size).toBe(2);
    const retrievalForeignKeys = sqlite.prepare('pragma foreign_key_list(history_retrievals)').all() as Array<{ id: number }>;
    expect(new Set(retrievalForeignKeys.map(key => key.id)).size).toBe(4);
    const retrievalItemForeignKeys = sqlite.prepare('pragma foreign_key_list(history_retrieval_items)').all() as Array<{ id: number }>;
    expect(new Set(retrievalItemForeignKeys.map(key => key.id)).size).toBe(3);
    const plannerSessionForeignKeys = sqlite.prepare('pragma foreign_key_list(planner_sessions)').all() as Array<{ id: number }>;
    expect(new Set(plannerSessionForeignKeys.map(key => key.id)).size).toBe(6);
    const plannerCandidateForeignKeys = sqlite.prepare('pragma foreign_key_list(planner_candidates)').all() as Array<{ id: number }>;
    expect(new Set(plannerCandidateForeignKeys.map(key => key.id)).size).toBe(6);
    const scriptVersionForeignKeys = sqlite.prepare('pragma foreign_key_list(script_versions)').all() as Array<{ id: number }>;
    expect(new Set(scriptVersionForeignKeys.map(key => key.id)).size).toBe(3);
    const approvalForeignKeys = sqlite.prepare('pragma foreign_key_list(approvals)').all() as Array<{ id: number }>;
    expect(new Set(approvalForeignKeys.map(key => key.id)).size).toBe(3);
    const editVersionForeignKeys = sqlite.prepare('pragma foreign_key_list(edit_versions)').all() as Array<{ id: number }>;
    expect(new Set(editVersionForeignKeys.map(key => key.id)).size).toBe(3);
    const publishForeignKeys = sqlite.prepare('pragma foreign_key_list(publishes)').all() as Array<{ id: number }>;
    expect(new Set(publishForeignKeys.map(key => key.id)).size).toBe(3);
    const performanceSnapshotForeignKeys = sqlite.prepare('pragma foreign_key_list(performance_snapshots)').all() as Array<{ id: number }>;
    expect(new Set(performanceSnapshotForeignKeys.map(key => key.id)).size).toBe(2);
    const performanceImportForeignKeys = sqlite.prepare('pragma foreign_key_list(performance_import_batches)').all() as Array<{ id: number }>;
    expect(new Set(performanceImportForeignKeys.map(key => key.id)).size).toBe(2);
    const shootForeignKeys = sqlite.prepare('pragma foreign_key_list(shoots)').all() as Array<{ id: number }>;
    expect(new Set(shootForeignKeys.map(key => key.id)).size).toBe(5);
    const shootContentForeignKeys = sqlite.prepare('pragma foreign_key_list(shoot_contents)').all() as Array<{ id: number }>;
    expect(new Set(shootContentForeignKeys.map(key => key.id)).size).toBe(4);
    const integrityTriggers = sqlite.prepare("select name from sqlite_schema where type = 'trigger' and name like 'validate_%' order by name").all() as Array<{ name: string }>;
    expect(integrityTriggers.map(row => row.name)).toEqual([
      'validate_content_edit_pointers_update', 'validate_content_editor_insert', 'validate_content_editor_update',
      'validate_content_script_pointers_update', 'validate_final_video_approval_version_insert', 'validate_final_video_approval_version_update',
      'validate_publish_ready_insert',
      'validate_script_approval_version_insert', 'validate_script_approval_version_update',
      'validate_shoot_content_identity_update', 'validate_shoot_content_insert',
      'validate_shoot_hierarchy_insert', 'validate_shoot_hierarchy_update',
    ]);

    const contentColumns = sqlite.prepare('pragma table_info(contents)').all() as Array<{ name: string }>;
    expect(contentColumns.some(column => column.name === 'script')).toBe(false);
    expect(contentColumns.some(column => column.name === 'current_script_version_id')).toBe(true);
    expect(contentColumns.some(column => column.name === 'editor_id')).toBe(true);
    expect(contentColumns.some(column => column.name === 'current_edit_version_id')).toBe(true);
    expect(contentColumns.some(column => column.name === 'published_at')).toBe(true);
    expect(contentColumns.some(column => column.name === 'import_dedup_key')).toBe(true);
  });

  it('maps legacy Run statuses and preserves existing Run Steps', () => {
    sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    const migrations = readdirSync(resolve('drizzle')).filter(file => file.endsWith('.sql')).sort();
    for (const file of migrations.filter(file => file < '0006'))
      sqlite.exec(readFileSync(resolve('drizzle', file), 'utf8').replaceAll('--> statement-breakpoint', ''));
    const org = '0198f744-8e18-7ae2-a780-52a0e20c5a01';
    const user = '0198f744-8e18-7ae2-a780-52a0e20c5a02';
    const pendingRun = '0198f744-8e18-7ae2-a780-52a0e20c5a03';
    const succeededRun = '0198f744-8e18-7ae2-a780-52a0e20c5a04';
    const now = '2026-09-08T00:00:00.000Z';
    sqlite.prepare('insert into organizations values (?, ?, ?, ?, ?, ?)').run(org, '组织', 'active', 0, now, now);
    sqlite.prepare('insert into users values (?, ?, ?, ?, ?, ?, ?, ?)').run(user, org, '成员', 'owner', 'active', 0, now, now);
    const insertRun = sqlite.prepare('insert into runs values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    insertRun.run(pendingRun, org, 'test', 'skill:test', null, 'pending', null, null, user, 0, now);
    insertRun.run(succeededRun, org, 'production', 'skill:test', null, 'succeeded', now, now, user, 0, now);
    sqlite.prepare('insert into run_steps values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      '0198f744-8e18-7ae2-a780-52a0e20c5a05', org, pendingRun, 0, 'llm.invoke', 'pending',
      null, null, null, null, null, null, null, 0,
    );
    sqlite.exec(readFileSync(resolve('drizzle/0006_spooky_doorman.sql'), 'utf8').replaceAll('--> statement-breakpoint', ''));
    expect(sqlite.prepare('select id, status from runs order by id').all()).toEqual([
      { id: pendingRun, status: 'queued' }, { id: succeededRun, status: 'completed' },
    ]);
    expect(sqlite.prepare('select run_id, step_code from run_steps').get()).toEqual({ run_id: pendingRun, step_code: 'llm.invoke' });
    expect(sqlite.pragma('foreign_key_check')).toEqual([]);
  });

  it('maps phase-four lifecycle values to IDEA while preserving existing content rows', () => {
    sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = OFF');
    const migrations = readdirSync(resolve('drizzle')).filter(file => file.endsWith('.sql')).sort();
    for (const file of migrations.filter(file => file.startsWith('000') && file < '0005'))
      sqlite.exec(readFileSync(resolve('drizzle', file), 'utf8').replaceAll('--> statement-breakpoint', ''));
    sqlite.prepare(`insert into contents (
      id, organization_id, client_id, brand_id, store_id, account_id, title, content_type, content_goal,
      status, operator_id, created_by, created_at, updated_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      '0198f744-8e18-7ae2-a780-52a0e20c5931', '0198f744-8e18-7ae2-a780-52a0e20c5932',
      '0198f744-8e18-7ae2-a780-52a0e20c5933', '0198f744-8e18-7ae2-a780-52a0e20c5934',
      '0198f744-8e18-7ae2-a780-52a0e20c5935', '0198f744-8e18-7ae2-a780-52a0e20c5936',
      '旧内容', 'persona', 'exposure', 'active', '0198f744-8e18-7ae2-a780-52a0e20c5937',
      '0198f744-8e18-7ae2-a780-52a0e20c5937', '2026-09-07T01:00:00.000Z', '2026-09-07T01:00:00.000Z',
    );
    sqlite.exec(readFileSync(resolve('drizzle/0005_chunky_supreme_intelligence.sql'), 'utf8').replaceAll('--> statement-breakpoint', ''));
    expect(sqlite.prepare('select title, status from contents').get()).toEqual({ title: '旧内容', status: 'IDEA' });
  });
});
