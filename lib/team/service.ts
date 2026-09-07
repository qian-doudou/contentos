import { and, asc, eq, inArray } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as tables from '@/db/schema';
import { userRoles } from '@/db/constants';
import { permissionService } from '@/lib/auth/permissions';
import { teamDataSchema } from '@/lib/auth/contracts';

type Database = BetterSQLite3Database<typeof tables>;

export function teamService(db: Database, organizationId: string, userId: string) {
  const permissions = permissionService(db, organizationId, userId);
  return {
    list() {
      permissions.require('team.read');
      return db.transaction(() => {
        const members = db.select().from(tables.users).where(eq(tables.users.organizationId, organizationId))
          .orderBy(asc(tables.users.name), asc(tables.users.id)).all();
        const memberIds = members.map(member => member.id);
        const assignments = memberIds.length ? db.select().from(tables.clientMembers).where(and(
          eq(tables.clientMembers.organizationId, organizationId),
          inArray(tables.clientMembers.userId, memberIds),
        )).all() : [];
        const ownedClients = memberIds.length ? db.select({ id: tables.clients.id, userId: tables.clients.ownerUserId })
          .from(tables.clients).where(and(
            eq(tables.clients.organizationId, organizationId),
            inArray(tables.clients.ownerUserId, memberIds),
          )).all() : [];
        const clientIdsByUser = new Map<string, Set<string>>();
        for (const member of members) clientIdsByUser.set(member.id, new Set());
        for (const assignment of assignments) clientIdsByUser.get(assignment.userId)?.add(assignment.clientId);
        for (const owned of ownedClients) if (owned.userId) clientIdsByUser.get(owned.userId)?.add(owned.id);
        const roleCounts = Object.fromEntries(userRoles.map(role => [role, members.filter(member => member.role === role).length]));
        return teamDataSchema.parse({
          members: members.map(member => ({ ...member, clientCount: clientIdsByUser.get(member.id)?.size ?? 0 })),
          roleCounts,
        });
      });
    },
  };
}
