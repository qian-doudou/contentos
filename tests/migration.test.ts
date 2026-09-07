import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

let sqlite: Database.Database | undefined;

afterEach(() => sqlite?.close());

describe('SQLite migration', () => {
  it('creates every phase-one table with organization scope', () => {
    sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    const migration = readFileSync(resolve('drizzle/0000_aromatic_robbie_robertson.sql'), 'utf8')
      .replaceAll('--> statement-breakpoint', '');
    sqlite.exec(migration);

    const tables = sqlite.prepare("select name from sqlite_schema where type = 'table' order by name").all() as Array<{ name: string }>;
    expect(tables.map((row) => row.name)).toEqual([
      'app_settings', 'audit_logs', 'organizations', 'run_steps', 'runs', 'users',
    ]);

    for (const table of ['app_settings', 'audit_logs', 'run_steps', 'runs', 'users']) {
      const columns = sqlite.prepare(`pragma table_info(${table})`).all() as Array<{ name: string }>;
      expect(columns.some((column) => column.name === 'organization_id')).toBe(true);
    }
  });
});

