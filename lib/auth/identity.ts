import { and, asc, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as tables from '@/db/schema';
import { devIdentityDataSchema } from '@/lib/auth/contracts';
import { permissionService } from '@/lib/auth/permissions';

type Database = BetterSQLite3Database<typeof tables>;

export function identityData(db: Database, organizationId: string, userId: string, switchingEnabled: boolean) {
  const permissions = permissionService(db, organizationId, userId);
  const users = switchingEnabled
    ? db.select().from(tables.users).where(and(
      eq(tables.users.organizationId, organizationId),
      eq(tables.users.status, 'active'),
    )).orderBy(asc(tables.users.createdAt), asc(tables.users.id)).all()
    : [permissions.actor];
  return devIdentityDataSchema.parse({
    organization: permissions.organization,
    currentUser: permissions.actor,
    users,
    switchingEnabled,
  });
}
