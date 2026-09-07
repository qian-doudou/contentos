import { and, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { z } from 'zod';
import * as tables from '@/db/schema';
import type { User } from '@/db/validation';
import { organizationSchema, userSchema } from '@/db/validation';
import { ApiError } from '@/lib/api/envelope';

type Database = BetterSQLite3Database<typeof tables>;
export type OrganizationPermission = 'master_data.write' | 'team.read' | 'system.dangerous';

const organizationRoleMatrix: Record<OrganizationPermission, readonly User['role'][]> = {
  'master_data.write': ['owner', 'admin'],
  'team.read': ['owner', 'admin'],
  'system.dangerous': ['owner'],
};
const masterDataReaderRoles = new Set<User['role']>(['owner', 'admin', 'operator', 'viewer']);
const contentWriterRoles = new Set<User['role']>(['owner', 'admin', 'operator']);

const forbidden = (message = '当前身份无权执行此操作') =>
  new ApiError(403, 'PERMISSION_DENIED', message);

/**
 * The sole role and client-scope authorization boundary for organization APIs.
 * Callers must provide server-resolved identity values, never request body IDs.
 */
export function permissionService(db: Database, organizationId: string, userId: string) {
  const validOrganizationId = z.uuid().parse(organizationId);
  const validUserId = z.uuid().parse(userId);
  const organizationRow = db.select().from(tables.organizations).where(and(
    eq(tables.organizations.id, validOrganizationId),
    eq(tables.organizations.status, 'active'),
  )).get();
  const actorRow = db.select().from(tables.users).where(and(
    eq(tables.users.organizationId, validOrganizationId),
    eq(tables.users.id, validUserId),
    eq(tables.users.status, 'active'),
  )).get();
  if (!organizationRow || !actorRow)
    throw new ApiError(403, 'ORGANIZATION_ACCESS_DENIED', '当前本地组织或成员不可用，请检查服务端配置与 seed');

  const organization = organizationSchema.parse(organizationRow);
  const actor = userSchema.parse(actorRow);
  const has = (permission: OrganizationPermission) => organizationRoleMatrix[permission].includes(actor.role);
  const requirePermission = (permission: OrganizationPermission) => {
    if (!has(permission)) throw forbidden();
  };
  const membershipsFor = (memberId: string) => db.select().from(tables.clientMembers).where(and(
    eq(tables.clientMembers.organizationId, validOrganizationId),
    eq(tables.clientMembers.userId, memberId),
  )).all();
  const memberships = () => membershipsFor(validUserId);
  const isGlobalMasterDataReader = actor.role === 'owner' || actor.role === 'admin';

  const readableClientIds = (): string[] | null => {
    if (isGlobalMasterDataReader) return null;
    const rows = memberships();
    const ids = rows.filter(row => masterDataReaderRoles.has(row.roleOverride ?? actor.role)).map(row => row.clientId);
    if (!masterDataReaderRoles.has(actor.role) && ids.length === 0)
      throw forbidden('当前角色无权访问客户主数据');
    return [...new Set(ids)];
  };
  const requireClientRead = (clientId: string) => {
    const validClientId = z.uuid().parse(clientId);
    if (isGlobalMasterDataReader) return;
    const membership = memberships().find(row => row.clientId === validClientId);
    if (!membership || !masterDataReaderRoles.has(membership.roleOverride ?? actor.role))
      throw forbidden('当前身份未被授权访问该客户');
  };
  const canUserWriteClient = (memberId: string, clientId: string) => {
    const validMemberId = z.uuid().parse(memberId);
    const validClientId = z.uuid().parse(clientId);
    const member = db.select().from(tables.users).where(and(
      eq(tables.users.organizationId, validOrganizationId),
      eq(tables.users.id, validMemberId),
      eq(tables.users.status, 'active'),
    )).get();
    if (!member) return false;
    if (member.role === 'owner' || member.role === 'admin') return true;
    const membership = membershipsFor(validMemberId).find(row => row.clientId === validClientId);
    return !!membership && contentWriterRoles.has(membership.roleOverride ?? member.role);
  };
  const canWriteClient = (clientId: string) => canUserWriteClient(validUserId, clientId);
  const requireClientWrite = (clientId: string) => {
    if (!canWriteClient(clientId)) throw forbidden('当前身份无权管理该客户的内容与计划');
  };
  const writableClientIds = (): string[] | null => {
    if (actor.role === 'owner' || actor.role === 'admin') return null;
    return [...new Set(memberships().filter(row => contentWriterRoles.has(row.roleOverride ?? actor.role)).map(row => row.clientId))];
  };

  return {
    organization,
    actor,
    has,
    require: requirePermission,
    get canWriteMasterData() { return has('master_data.write'); },
    readableClientIds,
    requireClientRead,
    canUserWriteClient,
    canWriteClient,
    requireClientWrite,
    writableClientIds,
  };
}
