import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '@/db/schema';
import { auditLogs, clientMembers, organizations, userPermissionOverrides, users } from '@/db/schema';
import { permissionService } from '@/lib/auth/permissions';
import { identityData } from '@/lib/auth/identity';
import { localContextIds } from '@/lib/api/context';
import { ApiError } from '@/lib/api/envelope';
import { masterDataService } from '@/lib/master-data/service';
import { teamService } from '@/lib/team/service';

const ids = {
  organizationA: '0198f744-8e18-7ae2-a780-52a0e20c3931',
  organizationB: '0198f744-8e18-7ae2-a780-52a0e20c3932',
  owner: '0198f744-8e18-7ae2-a780-52a0e20c3933',
  admin: '0198f744-8e18-7ae2-a780-52a0e20c3934',
  operator: '0198f744-8e18-7ae2-a780-52a0e20c3935',
  photographer: '0198f744-8e18-7ae2-a780-52a0e20c3936',
  editor: '0198f744-8e18-7ae2-a780-52a0e20c3937',
  viewer: '0198f744-8e18-7ae2-a780-52a0e20c3938',
  ownerB: '0198f744-8e18-7ae2-a780-52a0e20c3939',
} as const;

let sqlite: Database.Database;
let db: ReturnType<typeof drizzle<typeof schema>>;

function expectApiError(action: () => unknown, status: number, code: string) {
  try {
    action();
    throw new Error('Expected ApiError');
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status, code });
  }
}

beforeEach(() => {
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  for (const file of readdirSync(resolve('drizzle')).filter(name => name.endsWith('.sql')).sort())
    sqlite.exec(readFileSync(resolve('drizzle', file), 'utf8').replaceAll('--> statement-breakpoint', ''));
  db = drizzle(sqlite, { schema });
  const now = '2026-09-07T01:00:00.000Z';
  db.insert(organizations).values([
    { id: ids.organizationA, name: '组织 A', status: 'active', isDemo: false, createdAt: now, updatedAt: now },
    { id: ids.organizationB, name: '组织 B', status: 'active', isDemo: false, createdAt: now, updatedAt: now },
  ]).run();
  db.insert(users).values([
    { id: ids.owner, organizationId: ids.organizationA, name: '所有者', role: 'owner', status: 'active', isDemo: false, createdAt: now, updatedAt: now },
    { id: ids.admin, organizationId: ids.organizationA, name: '管理员', role: 'admin', status: 'active', isDemo: false, createdAt: now, updatedAt: now },
    { id: ids.operator, organizationId: ids.organizationA, name: '运营', role: 'operator', status: 'active', isDemo: false, createdAt: now, updatedAt: now },
    { id: ids.photographer, organizationId: ids.organizationA, name: '摄影', role: 'photographer', status: 'active', isDemo: false, createdAt: now, updatedAt: now },
    { id: ids.editor, organizationId: ids.organizationA, name: '剪辑', role: 'editor', status: 'active', isDemo: false, createdAt: now, updatedAt: now },
    { id: ids.viewer, organizationId: ids.organizationA, name: '查看', role: 'viewer', status: 'active', isDemo: false, createdAt: now, updatedAt: now },
    { id: ids.ownerB, organizationId: ids.organizationB, name: '所有者 B', role: 'owner', status: 'active', isDemo: false, createdAt: now, updatedAt: now },
  ]).run();
});

afterEach(() => sqlite.close());

describe('central permissions and client membership scope', () => {
  it('lets an operator read only assigned clients and returns 403 for a same-organization unassigned ID', () => {
    const owner = masterDataService(db, ids.organizationA, ids.owner);
    const assigned = owner.createClient({ clientName: '已分配', industry: '餐饮' });
    const unassigned = owner.createClient({ clientName: '未分配', industry: '零售' });
    expect(masterDataService(db, ids.organizationA, ids.operator).listClients({}).items).toEqual([]);
    db.insert(clientMembers).values({
      id: crypto.randomUUID(), organizationId: ids.organizationA, clientId: assigned.id, userId: ids.operator,
      roleOverride: null, isDemo: false, createdAt: new Date().toISOString(),
    }).run();
    const operator = masterDataService(db, ids.organizationA, ids.operator);
    const list = operator.listClients({});
    expect(list.items.map(item => item.id)).toEqual([assigned.id]);
    expect(list.filters.industries).toEqual(['餐饮']);
    expect(operator.clientDetail(assigned.id).client.id).toBe(assigned.id);
    expectApiError(() => operator.clientDetail(unassigned.id), 403, 'PERMISSION_DENIED');
    expectApiError(() => operator.updateClient(assigned.id, { notes: '越权修改' }), 403, 'PERMISSION_DENIED');
  });

  it('keeps cross-organization IDs indistinguishable from missing records', () => {
    const foreign = masterDataService(db, ids.organizationB, ids.ownerB).createClient({ clientName: '外部客户', industry: '餐饮' });
    expectApiError(() => masterDataService(db, ids.organizationA, ids.operator).clientDetail(foreign.id), 404, 'NOT_FOUND');
  });

  it('blocks photographer and viewer writes while allowing assigned viewer reads', () => {
    const owner = masterDataService(db, ids.organizationA, ids.owner);
    const client = owner.createClient({ clientName: '权限客户', industry: '餐饮' });
    db.insert(clientMembers).values([
      { id: crypto.randomUUID(), organizationId: ids.organizationA, clientId: client.id, userId: ids.photographer, roleOverride: null, isDemo: false, createdAt: new Date().toISOString() },
      { id: crypto.randomUUID(), organizationId: ids.organizationA, clientId: client.id, userId: ids.viewer, roleOverride: null, isDemo: false, createdAt: new Date().toISOString() },
    ]).run();
    const photographer = masterDataService(db, ids.organizationA, ids.photographer);
    const viewer = masterDataService(db, ids.organizationA, ids.viewer);
    expectApiError(() => photographer.clientDetail(client.id), 403, 'PERMISSION_DENIED');
    expectApiError(() => photographer.updateClient(client.id, { notes: '不允许' }), 403, 'PERMISSION_DENIED');
    expect(viewer.clientDetail(client.id).client.id).toBe(client.id);
    expectApiError(() => viewer.createClient({ clientName: '不允许', industry: '餐饮' }), 403, 'PERMISSION_DENIED');
    expectApiError(() => viewer.updateClient(client.id, { notes: '不允许' }), 403, 'PERMISSION_DENIED');
  });

  it('supports a scoped role override without granting organization-level writes', () => {
    const owner = masterDataService(db, ids.organizationA, ids.owner);
    const client = owner.createClient({ clientName: '临时查看', industry: '餐饮' });
    db.insert(clientMembers).values({
      id: crypto.randomUUID(), organizationId: ids.organizationA, clientId: client.id, userId: ids.photographer,
      roleOverride: 'viewer', isDemo: false, createdAt: new Date().toISOString(),
    }).run();
    const photographer = masterDataService(db, ids.organizationA, ids.photographer);
    expect(photographer.clientDetail(client.id).client.id).toBe(client.id);
    expect(permissionService(db, ids.organizationA, ids.photographer).workspaceAccess()).toMatchObject({
      scripts: false,
      masterData: true,
      contents: true,
      shoots: true,
      edits: false,
      analytics: true,
    });
    expectApiError(() => photographer.updateClient(client.id, { notes: '不允许' }), 403, 'PERMISSION_DENIED');
  });

  it('lets Admin manage organization data but reserves dangerous operations for Owner', () => {
    expect(masterDataService(db, ids.organizationA, ids.admin).createClient({ clientName: '管理员客户', industry: '餐饮' }).clientName).toBe('管理员客户');
    expectApiError(() => permissionService(db, ids.organizationA, ids.admin).require('system.dangerous'), 403, 'PERMISSION_DENIED');
    expect(() => permissionService(db, ids.organizationA, ids.owner).require('system.dangerous')).not.toThrow();
    expect(teamService(db, ids.organizationA, ids.owner).list().members).toHaveLength(6);
    expectApiError(() => teamService(db, ids.organizationA, ids.operator).list(), 403, 'PERMISSION_DENIED');
  });

  it('combines role defaults, client scope and audited user overrides', () => {
    const client = masterDataService(db, ids.organizationA, ids.owner)
      .createClient({ clientName: '运营负责客户', industry: '餐饮' });
    const result = teamService(db, ids.organizationA, ids.owner).update(ids.operator, {
      role: 'operator',
      status: 'active',
      clientAccess: [{ clientId: client.id, roleOverride: null }],
      permissionOverrides: [
        { permissionCode: 'ops.read', effect: 'allow', expiresAt: '2027-09-07T01:00:00.000Z' },
        { permissionCode: 'skills.read', effect: 'deny', expiresAt: null },
      ],
      changeReason: '负责该客户并参与运营排查',
    });
    const operator = result.members.find(member => member.id === ids.operator);
    expect(operator?.clientAccess).toEqual([{ clientId: client.id, clientName: '运营负责客户', roleOverride: null }]);
    expect(operator?.effectivePermissions).toMatchObject({ 'ops.read': true, 'skills.read': false });
    expect(operator?.workspaceAccess).toMatchObject({ scripts: true, ops: true, skills: false });

    const resolved = permissionService(db, ids.organizationA, ids.operator);
    expect(resolved.has('ops.read')).toBe(true);
    expect(resolved.has('skills.read')).toBe(false);
    expect(resolved.canWriteClient(client.id)).toBe(true);
    expect(db.select().from(userPermissionOverrides).all()).toEqual(expect.arrayContaining([
      expect.objectContaining({ userId: ids.operator, permissionCode: 'ops.read', effect: 'allow', grantedBy: ids.owner }),
      expect.objectContaining({ userId: ids.operator, permissionCode: 'skills.read', effect: 'deny', grantedBy: ids.owner }),
    ]));
    expect(db.select().from(auditLogs).all()).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'team.permissions.updated', entityId: ids.operator, userId: ids.owner }),
    ]));
  });

  it('creates a team account with initial scopes, permissions and an audit record', () => {
    const client = masterDataService(db, ids.organizationA, ids.owner)
      .createClient({ clientName: '新成员客户', industry: '本地生活' });
    const result = teamService(db, ids.organizationA, ids.owner).create({
      name: '新运营',
      role: 'operator',
      status: 'active',
      clientAccess: [{ clientId: client.id, roleOverride: null }],
      permissionOverrides: [{ permissionCode: 'ops.read', effect: 'allow', expiresAt: null }],
      changeReason: '加入客户运营项目',
    });
    const member = result.members.find(item => item.name === '新运营');
    expect(member).toMatchObject({ role: 'operator', status: 'active', clientCount: 1 });
    expect(member?.workspaceAccess).toMatchObject({ scripts: true, contents: true, ops: true });
    expect(member?.isDemo).toBe(false);
    expect(identityData(db, ids.organizationA, member!.id, true).currentUser.name).toBe('新运营');
    expect(db.select().from(auditLogs).all()).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'team.account.created', entityId: member!.id, userId: ids.owner }),
    ]));
  });

  it('prevents non-owners creating privileged accounts and non-managers creating any account', () => {
    const input = {
      name: '越权账号', role: 'admin', status: 'active', clientAccess: [], permissionOverrides: [], changeReason: '越权创建账号',
    } as const;
    expectApiError(() => teamService(db, ids.organizationA, ids.admin).create(input), 403, 'PERMISSION_DENIED');
    expectApiError(() => teamService(db, ids.organizationA, ids.operator).create({ ...input, role: 'viewer' }), 403, 'PERMISSION_DENIED');
  });

  it('ignores expired user overrides and rejects protected permission overrides', () => {
    const now = '2026-09-07T01:00:00.000Z';
    db.insert(userPermissionOverrides).values({
      id: crypto.randomUUID(), organizationId: ids.organizationA, userId: ids.operator,
      permissionCode: 'ai.settings', effect: 'allow', reason: '历史临时授权', expiresAt: '2020-01-01T00:00:00.000Z',
      grantedBy: ids.owner, isDemo: false, createdAt: now, updatedAt: now,
    }).run();
    expect(permissionService(db, ids.organizationA, ids.operator).has('ai.settings')).toBe(false);
    expectApiError(() => teamService(db, ids.organizationA, ids.owner).update(ids.operator, {
      role: 'operator', status: 'active', clientAccess: [],
      permissionOverrides: [{ permissionCode: 'team.manage', effect: 'allow', expiresAt: null }],
      changeReason: '尝试提升受保护权限',
    }), 400, 'PERMISSION_NOT_OVERRIDABLE');
  });

  it('prevents self-service changes and lower administrators managing privileged roles', () => {
    expectApiError(() => teamService(db, ids.organizationA, ids.owner).update(ids.owner, {
      role: 'owner', status: 'active', clientAccess: [], permissionOverrides: [], changeReason: '修改自己',
    }), 403, 'PERMISSION_DENIED');
    expectApiError(() => teamService(db, ids.organizationA, ids.admin).update(ids.owner, {
      role: 'viewer', status: 'active', clientAccess: [], permissionOverrides: [], changeReason: '越级修改',
    }), 403, 'PERMISSION_DENIED');
    expectApiError(() => teamService(db, ids.organizationA, ids.viewer).update(ids.operator, {
      role: 'operator', status: 'active', clientAccess: [], permissionOverrides: [], changeReason: '无权修改',
    }), 403, 'PERMISSION_DENIED');
  });

  it('enforces organization-matching foreign keys on client_members', () => {
    const foreign = masterDataService(db, ids.organizationB, ids.ownerB).createClient({ clientName: '外部客户', industry: '餐饮' });
    expect(() => db.insert(clientMembers).values({
      id: crypto.randomUUID(), organizationId: ids.organizationA, clientId: foreign.id, userId: ids.operator,
      roleOverride: null, isDemo: false, createdAt: new Date().toISOString(),
    }).run()).toThrow(/FOREIGN KEY constraint failed/);
  });
});

describe('development identity context', () => {
  it('returns server-authorized workspace access for every organization role', () => {
    expect(identityData(db, ids.organizationA, ids.owner, true).workspaceAccess).toEqual({
      scripts: true, masterData: true, contents: true, shoots: true, edits: true, ai: true,
      analytics: true, ops: true, skills: true, evals: true, team: true, settings: true,
    });
    expect(identityData(db, ids.organizationA, ids.admin, true).workspaceAccess).toEqual({
      scripts: true, masterData: true, contents: true, shoots: true, edits: true, ai: true,
      analytics: true, ops: true, skills: true, evals: true, team: true, settings: true,
    });
    expect(identityData(db, ids.organizationA, ids.operator, true).workspaceAccess).toEqual({
      scripts: false, masterData: true, contents: true, shoots: true, edits: true, ai: true,
      analytics: true, ops: false, skills: true, evals: true, team: false, settings: false,
    });
    expect(identityData(db, ids.organizationA, ids.photographer, true).workspaceAccess).toEqual({
      scripts: false, masterData: false, contents: false, shoots: true, edits: false, ai: false,
      analytics: false, ops: false, skills: false, evals: false, team: false, settings: false,
    });
    expect(identityData(db, ids.organizationA, ids.editor, true).workspaceAccess).toEqual({
      scripts: false, masterData: false, contents: false, shoots: false, edits: true, ai: false,
      analytics: false, ops: false, skills: false, evals: false, team: false, settings: false,
    });
    expect(identityData(db, ids.organizationA, ids.viewer, true).workspaceAccess).toEqual({
      scripts: false, masterData: true, contents: true, shoots: true, edits: true, ai: false,
      analytics: true, ops: false, skills: false, evals: false, team: false, settings: false,
    });
  });

  it('accepts the development cookie but ignores it in production', () => {
    const request = new Request('http://localhost/api/clients', { headers: { cookie: `contentos_dev_user_id=${ids.viewer}` } });
    expect(localContextIds(request, { NODE_ENV: 'development', LOCAL_ORGANIZATION_ID: ids.organizationA, LOCAL_USER_ID: ids.owner }).userId).toBe(ids.viewer);
    expect(localContextIds(request, { NODE_ENV: 'production', LOCAL_ORGANIZATION_ID: ids.organizationA, LOCAL_USER_ID: ids.owner }).userId).toBe(ids.owner);
  });
});
