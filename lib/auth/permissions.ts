import { and, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { z } from 'zod';
import * as tables from '@/db/schema';
import type { User } from '@/db/validation';
import { organizationSchema, userSchema } from '@/db/validation';
import { ApiError } from '@/lib/api/envelope';

type Database = BetterSQLite3Database<typeof tables>;
export type OrganizationPermission =
  | 'master_data.write'
  | 'team.read'
  | 'skills.read'
  | 'skills.write'
  | 'ai.test'
  | 'ai.settings'
  | 'runs.read'
  | 'ops.read'
  | 'eval.read'
  | 'eval.rate'
  | 'eval.manage'
  | 'memory.read'
  | 'memory.write'
  | 'context.build'
  | 'system.dangerous';

const organizationRoleMatrix: Record<OrganizationPermission, readonly User['role'][]> = {
  'master_data.write': ['owner', 'admin'],
  'team.read': ['owner', 'admin'],
  'skills.read': ['owner', 'admin', 'operator'],
  'skills.write': ['owner', 'admin'],
  'ai.test': ['owner', 'admin', 'operator'],
  'ai.settings': ['owner', 'admin'],
  'runs.read': ['owner', 'admin'],
  'ops.read': ['owner', 'admin'],
  'eval.read': ['owner', 'admin', 'operator'],
  'eval.rate': ['owner', 'admin', 'operator'],
  'eval.manage': ['owner', 'admin'],
  'memory.read': ['owner', 'admin', 'operator', 'viewer'],
  'memory.write': ['owner', 'admin', 'operator'],
  'context.build': ['owner', 'admin', 'operator'],
  'system.dangerous': ['owner'],
};
const masterDataReaderRoles = new Set<User['role']>(['owner', 'admin', 'operator', 'viewer']);
const contentWriterRoles = new Set<User['role']>(['owner', 'admin', 'operator']);
export type ShootAccessScope =
  | { kind: 'organization' }
  | { kind: 'clients'; clientIds: string[] }
  | { kind: 'photographer'; photographerId: string };
export type EditAccessScope =
  | { kind: 'organization' }
  | { kind: 'clients'; clientIds: string[] }
  | { kind: 'editor'; editorId: string };

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
  const shootAccessScope = (): ShootAccessScope => {
    if (actor.role === 'owner' || actor.role === 'admin') return { kind: 'organization' };
    if (actor.role === 'photographer') return { kind: 'photographer', photographerId: actor.id };
    if (actor.role === 'operator' || actor.role === 'viewer') return { kind: 'clients', clientIds: readableClientIds() ?? [] };
    throw forbidden('当前角色无权访问拍摄任务');
  };
  const requireShootRead = (clientId: string, photographerId: string) => {
    const scope = shootAccessScope();
    if (scope.kind === 'organization') return;
    if (scope.kind === 'photographer') {
      if (scope.photographerId !== photographerId) throw forbidden('摄影人员只能查看本人的拍摄任务');
      return;
    }
    if (!scope.clientIds.includes(z.uuid().parse(clientId))) throw forbidden('当前身份未被授权访问该客户的拍摄任务');
  };
  const canScheduleShoot = (clientId: string) => canWriteClient(clientId);
  const requireShootWrite = (clientId: string) => {
    if (!canScheduleShoot(clientId)) throw forbidden('当前身份无权管理该客户的拍摄排期');
  };
  const canExecuteShoot = (clientId: string, photographerId: string) => {
    if (actor.role === 'photographer') {
      return actor.id === photographerId;
    }
    return canScheduleShoot(clientId);
  };
  const requireShootExecution = (clientId: string, photographerId: string) => {
    if (!canExecuteShoot(clientId, photographerId))
      throw forbidden('当前身份无权更新该拍摄任务的执行状态');
  };
  const editAccessScope = (): EditAccessScope => {
    if (actor.role === 'owner' || actor.role === 'admin') return { kind: 'organization' };
    if (actor.role === 'editor') return { kind: 'editor', editorId: actor.id };
    if (actor.role === 'operator' || actor.role === 'viewer') return { kind: 'clients', clientIds: readableClientIds() ?? [] };
    throw forbidden('当前角色无权访问剪辑任务');
  };
  const requireEditRead = (clientId: string, editorId: string | null) => {
    const scope = editAccessScope();
    if (scope.kind === 'organization') return;
    if (scope.kind === 'editor') {
      if (scope.editorId !== editorId) throw forbidden('剪辑人员只能查看分配给本人的任务');
      return;
    }
    if (!scope.clientIds.includes(z.uuid().parse(clientId))) throw forbidden('当前身份未被授权访问该客户的剪辑任务');
  };
  const canAssignEdit = (clientId: string) => canWriteClient(clientId);
  const requireEditAssignment = (clientId: string) => {
    if (!canAssignEdit(clientId)) throw forbidden('当前身份无权分配该客户的剪辑任务');
  };
  const canWorkOnEdit = (clientId: string, editorId: string | null) => {
    if (actor.role === 'owner' || actor.role === 'admin') return true;
    return actor.role === 'editor' && actor.id === editorId;
  };
  const requireEditWork = (clientId: string, editorId: string | null) => {
    if (!canWorkOnEdit(clientId, editorId)) throw forbidden('当前身份无权提交该剪辑任务的成片版本');
  };
  const canReviewEdit = (clientId: string) => {
    if (actor.role === 'owner' || actor.role === 'admin') return true;
    return actor.role === 'operator' && canWriteClient(clientId);
  };
  const requireEditReview = (clientId: string) => {
    if (!canReviewEdit(clientId)) throw forbidden('当前身份无权审核该客户的成片版本');
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
    shootAccessScope,
    requireShootRead,
    canScheduleShoot,
    requireShootWrite,
    canExecuteShoot,
    requireShootExecution,
    editAccessScope,
    requireEditRead,
    canAssignEdit,
    requireEditAssignment,
    canWorkOnEdit,
    requireEditWork,
    canReviewEdit,
    requireEditReview,
  };
}
