import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

let sqlite: Database.Database | undefined;

afterEach(() => sqlite?.close());

describe('SQLite migration', () => {
  it('creates every phase-four table with organization scope', () => {
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
      'accounts', 'app_settings', 'audit_logs', 'brands', 'client_members', 'clients', 'content_status_logs', 'contents', 'monthly_plans',
      'organizations', 'run_steps', 'runs', 'stores', 'users',
    ]);

    for (const table of [
      'accounts', 'app_settings', 'audit_logs', 'brands', 'client_members', 'clients', 'content_status_logs', 'contents', 'monthly_plans',
      'run_steps', 'runs', 'stores', 'users',
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
    expect(new Set(contentForeignKeys.map(key => key.id)).size).toBe(5);
    const statusLogForeignKeys = sqlite.prepare('pragma foreign_key_list(content_status_logs)').all() as Array<{ id: number }>;
    expect(new Set(statusLogForeignKeys.map(key => key.id)).size).toBe(3);

    const contentColumns = sqlite.prepare('pragma table_info(contents)').all() as Array<{ name: string }>;
    expect(contentColumns.some(column => column.name === 'script')).toBe(false);
    expect(contentColumns.some(column => column.name === 'current_script_version_id')).toBe(true);
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
