import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { dirname, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import * as schema from './schema';

const databasePath = process.env.DATABASE_PATH || './data/contentos.db';
const resolvedPath = databasePath === ':memory:' ? databasePath : resolve(process.cwd(), databasePath);

if (resolvedPath !== ':memory:') {
  mkdirSync(dirname(resolvedPath), { recursive: true });
}

const globalForDatabase = globalThis as unknown as {
  contentOsSqlite?: Database.Database;
};

export const sqlite = globalForDatabase.contentOsSqlite ?? new Database(resolvedPath);
sqlite.pragma('foreign_keys = ON');
sqlite.pragma('busy_timeout = 5000');
if (resolvedPath !== ':memory:') sqlite.pragma('journal_mode = WAL');

if (process.env.NODE_ENV !== 'production') globalForDatabase.contentOsSqlite = sqlite;

export const db = drizzle(sqlite, { schema });
