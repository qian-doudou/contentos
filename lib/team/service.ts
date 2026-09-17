import { and, asc, eq, inArray } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { z } from 'zod';
import * as tables from '@/db/schema';
import { permissionCodes, userRoles } from '@/db/constants';
import { permissionService, permissionCatalog, rolePermissionDefaults } from '@/lib/auth/permissions';
import {
  teamDataSchema, teamMemberCreateSchema, teamMemberUpdateSchema,
  type TeamMemberCreate, type TeamMemberUpdate,
} from '@/lib/auth/contracts';
import { ApiError } from '@/lib/api/envelope';

type Database = BetterSQLite3Database<typeof tables>;

const forbidden = (message: string) => new ApiError(403, 'PERMISSION_DENIED', message);
const missing = () => new ApiError(404, 'TEAM_MEMBER_NOT_FOUND', '成员不存在或不属于当前组织');

export function teamService(db: Database, organizationId: string, userId: string) {
  const permissions = permissionService(db, organizationId, userId);
  const canManageTarget = (target: typeof tables.users.$inferSelect) => permissions.has('team.manage')
    && target.id !== permissions.actor.id
    && (permissions.actor.role === 'owner' || !['owner', 'admin'].includes(target.role));
  const validateAccessConfiguration = (value: TeamMemberCreate | TeamMemberUpdate) => {
    const clientIds = new Set(db.select({ id: tables.clients.id }).from(tables.clients)
      .where(eq(tables.clients.organizationId, organizationId)).all().map(item => item.id));
    if (value.clientAccess.some(item => !clientIds.has(item.clientId)))
      throw new ApiError(404, 'CLIENT_NOT_FOUND', '客户不存在或不属于当前组织');
    const catalogByCode = new Map(permissionCatalog.map(item => [item.code, item]));
    if (value.permissionOverrides.some(item => !catalogByCode.get(item.permissionCode)?.overridable))
      throw new ApiError(400, 'PERMISSION_NOT_OVERRIDABLE', '团队权限管理和高风险系统操作不允许用户级覆盖');
    if (value.permissionOverrides.some(item => item.expiresAt && Date.parse(item.expiresAt) <= Date.now()))
      throw new ApiError(400, 'PERMISSION_EXPIRY_INVALID', '权限有效期必须晚于当前时间');
  };
  const insertAccessConfiguration = (
    memberId: string,
    isDemo: boolean,
    value: TeamMemberCreate | TeamMemberUpdate,
    at: string,
  ) => {
    if (value.clientAccess.length) db.insert(tables.clientMembers).values(value.clientAccess.map(item => ({
      id: crypto.randomUUID(), organizationId, clientId: item.clientId, userId: memberId,
      roleOverride: item.roleOverride, isDemo, createdAt: at,
    }))).run();
    if (value.permissionOverrides.length) db.insert(tables.userPermissionOverrides).values(value.permissionOverrides.map(item => ({
      id: crypto.randomUUID(), organizationId, userId: memberId, permissionCode: item.permissionCode,
      effect: item.effect, reason: value.changeReason, expiresAt: item.expiresAt ? new Date(item.expiresAt).toISOString() : null,
      grantedBy: permissions.actor.id, isDemo, createdAt: at, updatedAt: at,
    }))).run();
  };

  function list() {
    permissions.require('team.read');
    return db.transaction(() => {
      const members = db.select().from(tables.users).where(eq(tables.users.organizationId, organizationId))
        .orderBy(asc(tables.users.name), asc(tables.users.id)).all();
      const memberIds = members.map(member => member.id);
      const assignments = memberIds.length ? db.select().from(tables.clientMembers).where(and(
        eq(tables.clientMembers.organizationId, organizationId),
        inArray(tables.clientMembers.userId, memberIds),
      )).all() : [];
      const clients = db.select().from(tables.clients).where(eq(tables.clients.organizationId, organizationId))
        .orderBy(asc(tables.clients.clientName), asc(tables.clients.id)).all();
      const overrideRows = memberIds.length ? db.select().from(tables.userPermissionOverrides).where(and(
        eq(tables.userPermissionOverrides.organizationId, organizationId),
        inArray(tables.userPermissionOverrides.userId, memberIds),
      )).orderBy(asc(tables.userPermissionOverrides.permissionCode)).all() : [];
      const shoots = db.select().from(tables.shoots).where(eq(tables.shoots.organizationId, organizationId)).all();
      const contents = db.select().from(tables.contents).where(eq(tables.contents.organizationId, organizationId)).all();
      const approvals = db.select().from(tables.approvals).where(eq(tables.approvals.organizationId, organizationId)).all();
      const clientById = new Map(clients.map(client => [client.id, client]));
      const memberById = new Map(members.map(member => [member.id, member]));
      const roleCounts = Object.fromEntries(userRoles.map(role => [role, members.filter(member => member.role === role).length]));
      const roleDefaults = Object.fromEntries(userRoles.map(role => [role, rolePermissionDefaults(role)]));
      const noWorkspaceAccess = {
        scripts: false, masterData: false, contents: false, shoots: false, edits: false, ai: false,
        analytics: false, ops: false, skills: false, evals: false, team: false, settings: false,
      };

      return teamDataSchema.parse({
        members: members.map(member => {
          const memberPermissions = member.status === 'active' ? permissionService(db, organizationId, member.id) : null;
          const memberAssignments = assignments.filter(item => item.userId === member.id);
          return {
            ...member,
            clientCount: ['owner', 'admin'].includes(member.role) ? clients.length : memberAssignments.length,
            clientAccess: memberAssignments.flatMap(item => {
              const client = clientById.get(item.clientId);
              return client ? [{ clientId: client.id, clientName: client.clientName, roleOverride: item.roleOverride }] : [];
            }),
            permissionOverrides: overrideRows.filter(item => item.userId === member.id).map(item => ({
              id: item.id,
              permissionCode: item.permissionCode,
              effect: item.effect,
              reason: item.reason,
              expiresAt: item.expiresAt,
              grantedBy: item.grantedBy,
              grantedByName: memberById.get(item.grantedBy)?.name ?? '已移除成员',
              createdAt: item.createdAt,
              updatedAt: item.updatedAt,
            })),
            effectivePermissions: Object.fromEntries(permissionCodes.map(code => [code, memberPermissions?.has(code) ?? false])),
            workspaceAccess: memberPermissions?.workspaceAccess() ?? noWorkspaceAccess,
            taskCounts: {
              shoots: shoots.filter(item => item.photographerId === member.id && !['cancelled', 'rescheduled'].includes(item.status)).length,
              edits: contents.filter(item => item.editorId === member.id && ['SHOT', 'EDITING', 'WAITING_REVIEW', 'REVISION'].includes(item.status)).length,
              approvals: approvals.filter(item => item.reviewerUserId === member.id && item.status === 'pending').length,
            },
            canManage: canManageTarget(member),
          };
        }),
        roleCounts,
        clients: clients.map(client => ({ id: client.id, name: client.clientName, status: client.status })),
        permissionCatalog,
        roleDefaults,
        permissions: { canManage: permissions.has('team.manage'), currentUserId: permissions.actor.id },
      });
    });
  }

  function create(input: unknown) {
    permissions.require('team.manage');
    const value = teamMemberCreateSchema.parse(input);
    if (permissions.actor.role !== 'owner' && ['owner', 'admin'].includes(value.role))
      throw forbidden('只有 Owner 可以创建 Owner 或 Admin 账号');
    validateAccessConfiguration(value);
    const id = crypto.randomUUID();
    const at = new Date().toISOString();
    db.transaction(() => {
      db.insert(tables.users).values({
        id, organizationId, name: value.name, role: value.role, status: value.status,
        isDemo: false, createdAt: at, updatedAt: at,
      }).run();
      insertAccessConfiguration(id, false, value, at);
      db.insert(tables.auditLogs).values({
        id: crypto.randomUUID(), organizationId, userId: permissions.actor.id,
        action: 'team.account.created', entityType: 'user', entityId: id,
        metadataJson: JSON.stringify({
          reason: value.changeReason, name: value.name, role: value.role, status: value.status,
          clientAccess: value.clientAccess, permissionOverrides: value.permissionOverrides,
        }),
        isDemo: false, createdAt: at,
      }).run();
    });
    return list();
  }

  function update(memberId: string, input: unknown) {
    permissions.require('team.manage');
    const id = z.uuid().parse(memberId);
    const value = teamMemberUpdateSchema.parse(input);
    const target = db.select().from(tables.users).where(and(
      eq(tables.users.organizationId, organizationId),
      eq(tables.users.id, id),
    )).get();
    if (!target) throw missing();
    if (target.id === permissions.actor.id)
      throw forbidden('不能在当前会话中修改自己的角色或权限');
    if (permissions.actor.role !== 'owner' && (['owner', 'admin'].includes(target.role) || ['owner', 'admin'].includes(value.role)))
      throw forbidden('只有 Owner 可以修改 Owner 或 Admin');
    const at = new Date().toISOString();
    const activeOwners = db.select().from(tables.users).where(and(
      eq(tables.users.organizationId, organizationId),
      eq(tables.users.role, 'owner'),
      eq(tables.users.status, 'active'),
    )).all();
    if (target.role === 'owner' && target.status === 'active' && (value.role !== 'owner' || value.status !== 'active') && activeOwners.length <= 1)
      throw new ApiError(409, 'LAST_OWNER_REQUIRED', '组织必须保留至少一名启用中的 Owner');
    validateAccessConfiguration(value);

    db.transaction(() => {
      db.update(tables.users).set({ role: value.role, status: value.status, updatedAt: at }).where(and(
        eq(tables.users.organizationId, organizationId), eq(tables.users.id, target.id),
      )).run();
      db.delete(tables.clientMembers).where(and(
        eq(tables.clientMembers.organizationId, organizationId), eq(tables.clientMembers.userId, target.id),
      )).run();
      db.delete(tables.userPermissionOverrides).where(and(
        eq(tables.userPermissionOverrides.organizationId, organizationId),
        eq(tables.userPermissionOverrides.userId, target.id),
      )).run();
      insertAccessConfiguration(target.id, target.isDemo, value, at);
      db.insert(tables.auditLogs).values({
        id: crypto.randomUUID(), organizationId, userId: permissions.actor.id,
        action: 'team.permissions.updated', entityType: 'user', entityId: target.id,
        metadataJson: JSON.stringify({
          reason: value.changeReason,
          previous: { role: target.role, status: target.status },
          next: { role: value.role, status: value.status },
          clientAccess: value.clientAccess,
          permissionOverrides: value.permissionOverrides,
        }),
        isDemo: target.isDemo, createdAt: at,
      }).run();
    });
    return list();
  }

  return { list, create, update };
}
