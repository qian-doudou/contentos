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
      'accounts', 'app_settings', 'audit_logs', 'brands', 'client_members', 'clients', 'contents', 'monthly_plans',
      'organizations', 'run_steps', 'runs', 'stores', 'users',
    ]);

    for (const table of [
      'accounts', 'app_settings', 'audit_logs', 'brands', 'client_members', 'clients', 'contents', 'monthly_plans',
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

    const contentColumns = sqlite.prepare('pragma table_info(contents)').all() as Array<{ name: string }>;
    expect(contentColumns.some(column => column.name === 'script')).toBe(false);
    expect(contentColumns.some(column => column.name === 'current_script_version_id')).toBe(true);
  });
});
