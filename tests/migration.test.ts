import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

let sqlite: Database.Database | undefined;

afterEach(() => sqlite?.close());

describe('SQLite migration', () => {
  it('creates every phase-two table with organization scope', () => {
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
      'accounts', 'app_settings', 'audit_logs', 'brands', 'clients', 'organizations', 'run_steps', 'runs', 'stores', 'users',
    ]);

    for (const table of ['accounts', 'app_settings', 'audit_logs', 'brands', 'clients', 'run_steps', 'runs', 'stores', 'users']) {
      const columns = sqlite.prepare(`pragma table_info(${table})`).all() as Array<{ name: string }>;
      expect(columns.some((column) => column.name === 'organization_id')).toBe(true);
    }

    const accountForeignKeys = sqlite.prepare('pragma foreign_key_list(accounts)').all() as Array<{ id: number }>;
    expect(new Set(accountForeignKeys.map((key) => key.id)).size).toBe(4);
  });
});
