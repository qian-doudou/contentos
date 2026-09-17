import { and, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { z } from 'zod';
import * as tables from '@/db/schema';
import { permissionCodes } from '@/db/constants';
import type { User } from '@/db/validation';
import { organizationSchema, userSchema } from '@/db/validation';
import { ApiError } from '@/lib/api/envelope';

type Database = BetterSQLite3Database<typeof tables>;
export type OrganizationPermission = (typeof permissionCodes)[number];

export const permissionCatalog: ReadonlyArray<{
  code: OrganizationPermission;
  group: '业务管理' | 'AI 与质量' | '组织与系统';
  label: string;
  description: string;
  overridable: boolean;
}> = [
  { code: 'master_data.write', group: '业务管理', label: '管理客户主数据', description: '新建和修改客户、品牌、门店与账号。', overridable: true },
  { code: 'team.read', group: '组织与系统', label: '查看团队与权限', description: '查看成员、客户范围和有效权限。', overridable: true },
  { code: 'team.manage', group: '组织与系统', label: '管理团队权限', description: '修改角色、客户范围和用户权限特例。', overridable: false },
  { code: 'skills.read', group: 'AI 与质量', label: '查看 AI Skill', description: '查看 Skill 与版本。', overridable: true },
  { code: 'skills.write', group: 'AI 与质量', label: '管理 AI Skill', description: '新建版本、回滚或上线 Skill。', overridable: true },
  { code: 'ai.test', group: 'AI 与质量', label: '使用 AI 生成与测试', description: '运行内容策划、脚本生成和 Skill 测试。', overridable: true },
  { code: 'ai.settings', group: '组织与系统', label: '管理 AI 设置', description: '修改模型、价格和 AI 运行配置。', overridable: true },
  { code: 'runs.read', group: 'AI 与质量', label: '查看 Run 记录', description: '查看 AI 执行记录和步骤详情。', overridable: true },
  { code: 'ops.read', group: '组织与系统', label: '查看运营中心', description: '查看履约、成本和团队执行概览。', overridable: true },
  { code: 'eval.read', group: 'AI 与质量', label: '查看评测', description: '查看评测集、Bad Case 和改进提案。', overridable: true },
  { code: 'eval.rate', group: 'AI 与质量', label: '提交评分', description: '对 Production Run 提交人工评分。', overridable: true },
  { code: 'eval.manage', group: 'AI 与质量', label: '管理评测', description: '管理评测集、实验与改进提案。', overridable: true },
  { code: 'memory.read', group: 'AI 与质量', label: '查看长期记忆', description: '查看已确认的品牌和账号 Memory。', overridable: true },
  { code: 'memory.write', group: 'AI 与质量', label: '管理长期记忆', description: '新建、失效或更新 Memory。', overridable: true },
  { code: 'context.build', group: 'AI 与质量', label: '构建 AI Context', description: '生成供 AI 使用的结构化 Context。', overridable: true },
  { code: 'system.dangerous', group: '组织与系统', label: '执行高风险系统操作', description: '恢复演示数据等仅 Owner 可用的操作。', overridable: false },
];

const organizationRoleMatrix: Record<OrganizationPermission, readonly User['role'][]> = {
  'master_data.write': ['owner', 'admin'],
  'team.read': ['owner', 'admin'],
  'team.manage': ['owner', 'admin'],
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
export function rolePermissionDefaults(role: User['role']) {
  return Object.fromEntries(permissionCodes.map(permission => [
    permission,
    organizationRoleMatrix[permission].includes(role),
  ])) as Record<OrganizationPermission, boolean>;
}
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
  const nowMs = Date.now();
  const activeOverrides = db.select().from(tables.userPermissionOverrides).where(and(
    eq(tables.userPermissionOverrides.organizationId, validOrganizationId),
    eq(tables.userPermissionOverrides.userId, validUserId),
  )).all().filter(item => item.expiresAt === null || Date.parse(item.expiresAt) > nowMs);
  const overrideByPermission = new Map(activeOverrides.map(item => [item.permissionCode, item.effect]));
  const nonOverridable = new Set<OrganizationPermission>(['team.manage', 'system.dangerous']);
  const baseHas = (permission: OrganizationPermission) => organizationRoleMatrix[permission].includes(actor.role);
  const has = (permission: OrganizationPermission) => {
    const override = nonOverridable.has(permission) ? undefined : overrideByPermission.get(permission);
    return override ? override === 'allow' : baseHas(permission);
  };
  const requirePermission = (permission: OrganizationPermission) => {
    if (!has(permission)) throw forbidden();
  };
  const membershipsFor = (memberId: string) => db.select().from(tables.clientMembers).where(and(
    eq(tables.clientMembers.organizationId, validOrganizationId),
    eq(tables.clientMembers.userId, memberId),
  )).all();
  const memberships = () => membershipsFor(validUserId);
  const isGlobalMasterDataReader = actor.role === 'owner' || actor.role === 'admin';
  const canOpenClientWorkspace = () => isGlobalMasterDataReader
    || masterDataReaderRoles.has(actor.role)
    || memberships().some(row => masterDataReaderRoles.has(row.roleOverride ?? actor.role));
  const canOpenScriptWorkspace = () => has('ai.test') && (
    actor.role === 'owner'
    || actor.role === 'admin'
    || memberships().some(row => contentWriterRoles.has(row.roleOverride ?? actor.role))
  );

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
  const workspaceAccess = () => ({
    scripts: canOpenScriptWorkspace(),
    masterData: canOpenClientWorkspace(),
    contents: canOpenClientWorkspace(),
    shoots: ['owner', 'admin', 'operator', 'viewer', 'photographer'].includes(actor.role),
    edits: ['owner', 'admin', 'operator', 'viewer', 'editor'].includes(actor.role),
    ai: has('ai.test'),
    analytics: canOpenClientWorkspace(),
    ops: has('ops.read'),
    skills: has('skills.read'),
    evals: has('eval.read'),
    team: has('team.read'),
    settings: has('ai.settings'),
  });

  return {
    organization,
    actor,
    baseHas,
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
    workspaceAccess,
  };
}
