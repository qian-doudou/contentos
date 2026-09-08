import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '@/db/schema';
import { clientMembers, contentStatusLogs, contents, organizations, users } from '@/db/schema';
import { contentStatuses } from '@/db/constants';
import { ApiError } from '@/lib/api/envelope';
import { contentService } from '@/lib/content/service';
import {
  assertContentTransition, contentTransitionRules, deadlineFlags, kanbanColumns, manualNextStatuses, transitionRule,
} from '@/lib/content/workflow';
import { masterDataService } from '@/lib/master-data/service';

const ids = {
  organizationA: '0198f744-8e18-7ae2-a780-52a0e20c6931',
  organizationB: '0198f744-8e18-7ae2-a780-52a0e20c6932',
  owner: '0198f744-8e18-7ae2-a780-52a0e20c6933',
  operator: '0198f744-8e18-7ae2-a780-52a0e20c6934',
  viewer: '0198f744-8e18-7ae2-a780-52a0e20c6935',
  ownerB: '0198f744-8e18-7ae2-a780-52a0e20c6936',
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

function hierarchy(organizationId: string = ids.organizationA, ownerId: string = ids.owner, suffix = 'A') {
  const master = masterDataService(db, organizationId, ownerId);
  const client = master.createClient({ clientName: `客户 ${suffix}`, industry: '餐饮' });
  const brand = master.createBrand({ clientId: client.id, brandName: `品牌 ${suffix}` });
  const store = master.createStore({ brandId: brand.id, storeName: `门店 ${suffix}` });
  const account = master.createAccount({ clientId: client.id, brandId: brand.id, storeId: store.id, accountName: `账号 ${suffix}` });
  return { client, account };
}

function assign(clientId: string, userId: string) {
  db.insert(clientMembers).values({
    id: crypto.randomUUID(), organizationId: ids.organizationA, clientId, userId,
    roleOverride: null, isDemo: false, createdAt: '2026-09-07T01:00:00.000Z',
  }).run();
}

function createContent() {
  const data = hierarchy();
  assign(data.client.id, ids.operator);
  assign(data.client.id, ids.viewer);
  const content = contentService(db, ids.organizationA, ids.owner).createContent({
    accountId: data.account.id, title: '工作流内容', contentType: 'persona', contentGoal: 'exposure',
    operatorId: ids.operator, deadline: '2026-09-09T00:00:00.000Z',
  });
  return { ...data, content };
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
    { id: ids.operator, organizationId: ids.organizationA, name: '运营', role: 'operator', status: 'active', isDemo: false, createdAt: now, updatedAt: now },
    { id: ids.viewer, organizationId: ids.organizationA, name: '查看', role: 'viewer', status: 'active', isDemo: false, createdAt: now, updatedAt: now },
    { id: ids.ownerB, organizationId: ids.organizationB, name: '所有者 B', role: 'owner', status: 'active', isDemo: false, createdAt: now, updatedAt: now },
  ]).run();
});

afterEach(() => sqlite.close());

describe('deterministic content state machine', () => {
  it('contains exactly the specified legal transitions and rejects every other pair', () => {
    const expected = [
      'IDEA>SCRIPTING', 'SCRIPTING>WAITING_APPROVAL', 'WAITING_APPROVAL>SCRIPTING', 'WAITING_APPROVAL>APPROVED', 'APPROVED>WAITING_APPROVAL',
      'APPROVED>WAITING_SHOOT', 'WAITING_SHOOT>APPROVED', 'WAITING_SHOOT>SHOT', 'SHOT>EDITING',
      'EDITING>WAITING_REVIEW', 'WAITING_REVIEW>REVISION', 'REVISION>WAITING_REVIEW',
      'WAITING_REVIEW>READY_TO_PUBLISH', 'READY_TO_PUBLISH>PUBLISHED', 'PUBLISHED>REVIEWED',
    ];
    expect(contentTransitionRules.map(rule => `${rule.from}>${rule.to}`)).toEqual(expected);
    for (const from of contentStatuses) for (const to of contentStatuses) {
      const rule = transitionRule(from, to);
      if (expected.includes(`${from}>${to}`)) {
        expect(rule).toBeDefined();
        expect(() => assertContentTransition(from, to, rule!.trigger)).not.toThrow();
      } else {
        expect(rule).toBeUndefined();
        expectApiError(() => assertContentTransition(from, to, 'manual'), 409, 'INVALID_STATUS_TRANSITION');
      }
    }
  });

  it('maps every low-level status into exactly one requested Kanban column', () => {
    const mapped = kanbanColumns.flatMap(column => column.statuses);
    expect(mapped).toHaveLength(contentStatuses.length);
    expect([...mapped].sort()).toEqual([...contentStatuses].sort());
    expect(manualNextStatuses('WAITING_APPROVAL')).toEqual([]);
    expect(manualNextStatuses('APPROVED')).toEqual([]);
  });

  it('computes overdue and due-soon at exact deterministic boundaries', () => {
    const now = new Date('2026-09-07T00:00:00.000Z');
    expect(deadlineFlags('2026-09-06T23:59:59.999Z', 'IDEA', now)).toEqual({ overdue: true, dueSoon: false });
    expect(deadlineFlags('2026-09-09T00:00:00.000Z', 'SCRIPTING', now)).toEqual({ overdue: false, dueSoon: true });
    expect(deadlineFlags('2026-09-09T00:00:00.001Z', 'SCRIPTING', now)).toEqual({ overdue: false, dueSoon: false });
    expect(deadlineFlags('2026-09-01T00:00:00.000Z', 'PUBLISHED', now)).toEqual({ overdue: false, dueSoon: false });
    expect(deadlineFlags(null, 'IDEA', now)).toEqual({ overdue: false, dueSoon: false });
  });
});

describe('transactional transition service', () => {
  it('updates status and appends immutable history with the acting operator', () => {
    const data = createContent();
    const service = contentService(db, ids.organizationA, ids.operator, { now: () => new Date('2026-09-07T02:00:00.000Z') });
    expect(data.content.status).toBe('IDEA');
    const first = service.transitionContent(data.content.id, { newStatus: 'SCRIPTING', reason: '开始编写脚本' });
    expect(first.content.status).toBe('SCRIPTING');
    expect(first.log).toMatchObject({ previousStatus: 'IDEA', newStatus: 'SCRIPTING', triggerType: 'manual', triggerId: null, operatorId: ids.operator });
    const history = service.contentHistory(data.content.id);
    expect(history.currentStatus).toBe('SCRIPTING');
    expect(history.items).toHaveLength(1);
    expect(history.items[0]).toMatchObject({ previousStatus: 'IDEA', newStatus: 'SCRIPTING', operatorName: '运营' });
  });

  it('rolls the content update back when the status log side effect fails', () => {
    const data = createContent();
    sqlite.exec(`create trigger reject_status_log before insert on content_status_logs begin
      select raise(abort, 'forced status log failure');
    end`);
    const service = contentService(db, ids.organizationA, ids.operator);
    expect(() => service.transitionContent(data.content.id, { newStatus: 'SCRIPTING', reason: '应当回滚' })).toThrow(/forced status log failure/);
    expect(db.select({ status: contents.status }).from(contents).where(eq(contents.id, data.content.id)).get()?.status).toBe('IDEA');
    expect(db.select().from(contentStatusLogs).all()).toEqual([]);
  });

  it('keeps invalid and business-side-effect transitions out of the generic API path', () => {
    const data = createContent();
    const service = contentService(db, ids.organizationA, ids.owner);
    expectApiError(() => service.transitionContent(data.content.id, { newStatus: 'APPROVED', reason: '跳级' }), 409, 'INVALID_STATUS_TRANSITION');
    for (const [from, to] of [
      ['SCRIPTING', 'WAITING_APPROVAL'], ['WAITING_APPROVAL', 'SCRIPTING'], ['WAITING_APPROVAL', 'APPROVED'],
      ['APPROVED', 'WAITING_APPROVAL'],
      ['APPROVED', 'WAITING_SHOOT'], ['WAITING_SHOOT', 'APPROVED'], ['WAITING_SHOOT', 'SHOT'],
      ['READY_TO_PUBLISH', 'PUBLISHED'],
    ] as const) {
      db.update(contents).set({ status: from }).where(eq(contents.id, data.content.id)).run();
      expectApiError(() => service.transitionContent(data.content.id, { newStatus: to, reason: '需要业务事务' }), 409, 'BUSINESS_TRIGGER_REQUIRED');
      expect(db.select({ status: contents.status }).from(contents).where(eq(contents.id, data.content.id)).get()?.status).toBe(from);
    }
    expect(service.contentHistory(data.content.id).items).toEqual([]);
  });

  it('enforces client permissions and organization isolation for transition and history', () => {
    const data = createContent();
    const viewer = contentService(db, ids.organizationA, ids.viewer);
    expect(viewer.contentHistory(data.content.id).currentStatus).toBe('IDEA');
    expectApiError(() => viewer.transitionContent(data.content.id, { newStatus: 'SCRIPTING', reason: '越权' }), 403, 'PERMISSION_DENIED');

    const unassigned = hierarchy(ids.organizationA, ids.owner, 'unassigned');
    const other = contentService(db, ids.organizationA, ids.owner).createContent({
      accountId: unassigned.account.id, title: '未分配内容', contentType: 'persona', contentGoal: 'exposure', operatorId: ids.owner,
    });
    expectApiError(() => contentService(db, ids.organizationA, ids.operator).contentHistory(other.id), 403, 'PERMISSION_DENIED');

    const foreign = hierarchy(ids.organizationB, ids.ownerB, 'foreign');
    const foreignContent = contentService(db, ids.organizationB, ids.ownerB).createContent({
      accountId: foreign.account.id, title: '外部内容', contentType: 'persona', contentGoal: 'exposure', operatorId: ids.ownerB,
    });
    expectApiError(() => contentService(db, ids.organizationA, ids.owner).contentHistory(foreignContent.id), 404, 'NOT_FOUND');
  });
});
