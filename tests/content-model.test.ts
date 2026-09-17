import Database from 'better-sqlite3';
import { inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '@/db/schema';
import { clientMembers, monthlyPlans, organizations, users } from '@/db/schema';
import { ApiError } from '@/lib/api/envelope';
import { calculateMixStats, contentService } from '@/lib/content/service';
import { masterDataService } from '@/lib/master-data/service';

const ids = {
  organizationA: '0198f744-8e18-7ae2-a780-52a0e20c4931',
  organizationB: '0198f744-8e18-7ae2-a780-52a0e20c4932',
  owner: '0198f744-8e18-7ae2-a780-52a0e20c4933',
  operator: '0198f744-8e18-7ae2-a780-52a0e20c4934',
  viewer: '0198f744-8e18-7ae2-a780-52a0e20c4935',
  ownerB: '0198f744-8e18-7ae2-a780-52a0e20c4936',
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

function hierarchy(organizationId: string, ownerId: string, suffix: string) {
  const service = masterDataService(db, organizationId, ownerId);
  const client = service.createClient({ clientName: `客户 ${suffix}`, industry: '餐饮' });
  const brand = service.createBrand({ clientId: client.id, brandName: `品牌 ${suffix}` });
  const store = service.createStore({ brandId: brand.id, storeName: `门店 ${suffix}` });
  const account = service.createAccount({
    clientId: client.id, brandId: brand.id, storeId: store.id, accountName: `账号 ${suffix}`,
  });
  return { client, brand, store, account };
}

function assign(clientId: string, userId: string) {
  db.insert(clientMembers).values({
    id: crypto.randomUUID(), organizationId: ids.organizationA, clientId, userId,
    roleOverride: null, isDemo: false, createdAt: new Date().toISOString(),
  }).run();
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

describe('monthly content plans', () => {
  it('enforces a unique account period and validates empty and non-empty mixes', () => {
    const first = hierarchy(ids.organizationA, ids.owner, 'A');
    const second = hierarchy(ids.organizationA, ids.owner, 'B');
    const service = contentService(db, ids.organizationA, ids.owner);
    const firstPlan = service.createPlan({
      accountId: first.account.id, year: 2026, month: 9, primaryGoal: 'exposure',
      plannedContentCount: 8, contentMixJson: { persona: 50, product: 50 },
    });
    expectApiError(() => service.createPlan({
      accountId: first.account.id, year: 2026, month: 9, primaryGoal: 'trust',
      plannedContentCount: 4, contentMixJson: { trust: 100 },
    }), 409, 'PLAN_PERIOD_CONFLICT');
    expect(() => service.createPlan({
      accountId: first.account.id, year: 2026, month: 10, primaryGoal: 'exposure',
      plannedContentCount: 2, contentMixJson: { persona: 60, product: 30 },
    })).toThrow();
    expect(service.createPlan({
      accountId: first.account.id, year: 2026, month: 10, primaryGoal: 'exposure', plannedContentCount: 0,
    }).contentMixJson).toEqual({});
    expect(service.createPlan({
      accountId: second.account.id, year: 2026, month: 9, primaryGoal: 'conversion',
      plannedContentCount: 0, contentMixJson: { conversion: 100 },
    }).contentMixJson).toEqual({ conversion: 100 });
    expectApiError(() => service.updatePlan(firstPlan.id, { accountId: second.account.id }), 409, 'PARENT_IMMUTABLE');

    expect(() => db.insert(monthlyPlans).values({ ...firstPlan, id: crypto.randomUUID() }).run())
      .toThrow(/UNIQUE constraint failed/);
  });

  it('calculates integer type targets deterministically and reports actual content counts', () => {
    const data = hierarchy(ids.organizationA, ids.owner, 'A');
    assign(data.client.id, ids.operator);
    const service = contentService(db, ids.organizationA, ids.owner);
    const plan = service.createPlan({
      accountId: data.account.id, year: 2026, month: 9, primaryGoal: 'exposure',
      plannedContentCount: 7, contentMixJson: { persona: 50, product: 50 },
    });
    for (const [index, contentType] of ['persona', 'persona', 'product'].entries())
      service.createContent({
        accountId: data.account.id, monthlyPlanId: plan.id, title: `内容 ${index + 1}`,
        contentType, contentGoal: 'exposure', operatorId: ids.operator,
      });
    const detail = service.planDetail(plan.id);
    expect(detail.plan.createdContentCount).toBe(3);
    expect(detail.mixStats).toEqual([
      { contentType: 'persona', percentage: 50, targetCount: 4, actualCount: 2 },
      { contentType: 'product', percentage: 50, targetCount: 3, actualCount: 1 },
    ]);
    expect(calculateMixStats(0, {})).toEqual([]);
  });
});

describe('content master records', () => {
  it('derives the hierarchy, stores structured fields, filters and paginates without script text', () => {
    const data = hierarchy(ids.organizationA, ids.owner, 'A');
    assign(data.client.id, ids.operator);
    const service = contentService(db, ids.organizationA, ids.owner);
    const plan = service.createPlan({
      accountId: data.account.id, year: 2026, month: 9, primaryGoal: 'exposure',
      plannedContentCount: 3, contentMixJson: { persona: 67, product: 33 },
    });
    const created = service.createContent({
      accountId: data.account.id, monthlyPlanId: plan.id, title: '老板带你看现切羊肉',
      contentType: 'persona', contentGoal: 'exposure', topic: '本地羊肉', angle: '老板视角',
      hookType: 'local', hookText: '菏泽人涎羊肉看哪里', coreMessage: '现切才有风味',
      productText: '手切羊肉', ctaType: '到店', localElement: '菏泽', peopleJson: ['老板'],
      priority: 'high', operatorId: ids.operator,
    });
    expect(created).toMatchObject({
      clientId: data.client.id, brandId: data.brand.id, storeId: data.store.id, accountId: data.account.id,
      currentScriptVersionId: null, activeApprovedScriptVersionId: null,
      currentEditVersionId: null, activeApprovedEditVersionId: null, aiReviewStatus: null,
    });
    expect('script' in created).toBe(false);
    service.createContent({
      accountId: data.account.id, monthlyPlanId: plan.id, title: '手切羊肉产品特写',
      contentType: 'product', contentGoal: 'conversion', operatorId: ids.operator,
    });
    const page = service.listContents({ contentType: 'persona', search: '羊肉', page: 1, pageSize: 1 });
    expect(page.total).toBe(1);
    expect(page.items[0].title).toBe(created.title);
    expect(service.listContents({ contentGoal: 'trust' }).items).toEqual([]);
    expect(() => service.createContent({
      accountId: data.account.id, title: '非法枚举', contentType: 'viral', contentGoal: 'exposure', operatorId: ids.operator,
    })).toThrow();
    expect(() => service.createContent({
      accountId: data.account.id, title: '双写脚本', contentType: 'persona', contentGoal: 'exposure',
      operatorId: ids.operator, script: '不应该保存',
    })).toThrow();
  });

  it('rejects plans from another account', () => {
    const first = hierarchy(ids.organizationA, ids.owner, 'A');
    const second = hierarchy(ids.organizationA, ids.owner, 'B');
    assign(first.client.id, ids.operator);
    const service = contentService(db, ids.organizationA, ids.owner);
    const plan = service.createPlan({
      accountId: second.account.id, year: 2026, month: 9, primaryGoal: 'exposure',
      plannedContentCount: 1, contentMixJson: { persona: 100 },
    });
    expectApiError(() => service.createContent({
      accountId: first.account.id, monthlyPlanId: plan.id, title: '错误计划', contentType: 'persona',
      contentGoal: 'exposure', operatorId: ids.operator,
    }), 409, 'PLAN_ACCOUNT_MISMATCH');
  });

  it('queries and paginates every board column independently from the table page', () => {
    const data = hierarchy(ids.organizationA, ids.owner, 'board');
    assign(data.client.id, ids.operator);
    const service = contentService(db, ids.organizationA, ids.owner);
    const rows = Array.from({ length: 26 }, (_, index) => service.createContent({
      accountId: data.account.id,
      title: `看板内容 ${index + 1}`,
      contentType: 'persona',
      contentGoal: 'exposure',
      operatorId: ids.operator,
    }));
    db.update(schema.contents).set({ status: 'PUBLISHED', publishedAt: '2026-09-07T02:00:00.000Z' })
      .where(inArray(schema.contents.id, rows.slice(13).map(row => row.id))).run();

    const board = service.contentBoard({ page: 2, pageSize: 12 });
    const ideas = board.columns.find(column => column.id === 'ideas');
    const published = board.columns.find(column => column.id === 'published');
    expect(board.total).toBe(26);
    expect(ideas).toMatchObject({ total: 13, page: 1, pageSize: 12 });
    expect(ideas?.items).toHaveLength(12);
    expect(published).toMatchObject({ total: 13, page: 1, pageSize: 12 });
    expect(published?.items).toHaveLength(12);

    const publishedPageTwo = service.contentBoard({ column: 'published', page: 2, pageSize: 12 });
    expect(publishedPageTwo.total).toBe(26);
    expect(publishedPageTwo.columns).toHaveLength(1);
    expect(publishedPageTwo.columns[0]).toMatchObject({ id: 'published', total: 13, page: 2, pageSize: 12 });
    expect(publishedPageTwo.columns[0].items).toHaveLength(1);
  });

  it('matches workbench grouped-status and due-soon filters exactly', () => {
    const data = hierarchy(ids.organizationA, ids.owner, 'dashboard-filter');
    assign(data.client.id, ids.operator);
    const service = contentService(db, ids.organizationA, ids.owner, {
      now: () => new Date('2026-09-07T01:00:00.000Z'),
    });
    const rows = Array.from({ length: 6 }, (_, index) => service.createContent({
      accountId: data.account.id,
      title: `工作台筛选 ${index + 1}`,
      contentType: 'persona',
      contentGoal: 'exposure',
      operatorId: ids.operator,
    }));
    const setContent = (index: number, values: Partial<typeof schema.contents.$inferInsert>) =>
      db.update(schema.contents).set(values).where(inArray(schema.contents.id, [rows[index].id])).run();
    setContent(1, { status: 'SCRIPTING' });
    setContent(2, { status: 'WAITING_APPROVAL' });
    setContent(3, { status: 'WAITING_REVIEW' });
    setContent(4, { status: 'EDITING', deadline: '2026-09-08T01:00:00.000Z' });
    setContent(5, { status: 'PUBLISHED', deadline: '2026-09-08T01:00:00.000Z' });

    expect(service.listContents({ statuses: 'IDEA,SCRIPTING' }).items.map(row => row.status).sort())
      .toEqual(['IDEA', 'SCRIPTING']);
    expect(service.listContents({ statuses: 'WAITING_APPROVAL,WAITING_REVIEW' }).items.map(row => row.status).sort())
      .toEqual(['WAITING_APPROVAL', 'WAITING_REVIEW']);
    expect(service.listContents({ deadlineState: 'dueSoon' }).items.map(row => row.id)).toEqual([rows[4].id]);

    const approvalBoard = service.contentBoard({ statuses: 'WAITING_APPROVAL,WAITING_REVIEW' });
    expect(approvalBoard.total).toBe(2);
    expect(approvalBoard.columns.find(column => column.id === 'approval')?.total).toBe(1);
    expect(approvalBoard.columns.find(column => column.id === 'publish')?.total).toBe(1);
    expect(() => service.listContents({ statuses: 'IDEA,NOT_A_STATUS' })).toThrow();
  });
});

describe('content permissions and organization isolation', () => {
  it('allows an assigned operator, keeps viewer read-only and returns 403 for unassigned data', () => {
    const assigned = hierarchy(ids.organizationA, ids.owner, 'assigned');
    const unassigned = hierarchy(ids.organizationA, ids.owner, 'unassigned');
    assign(assigned.client.id, ids.operator);
    assign(assigned.client.id, ids.viewer);
    const owner = contentService(db, ids.organizationA, ids.owner);
    const plan = owner.createPlan({
      accountId: assigned.account.id, year: 2026, month: 9, primaryGoal: 'exposure',
      plannedContentCount: 1, contentMixJson: { persona: 100 },
    });
    const operator = contentService(db, ids.organizationA, ids.operator);
    const created = operator.createContent({
      accountId: assigned.account.id, monthlyPlanId: plan.id, title: '可管理内容',
      contentType: 'persona', contentGoal: 'exposure', operatorId: ids.operator,
    });
    expect(operator.updateContent(created.id, { priority: 'urgent' }).priority).toBe('urgent');
    expectApiError(() => operator.createPlan({
      accountId: unassigned.account.id, year: 2026, month: 9, primaryGoal: 'trust', plannedContentCount: 0,
    }), 403, 'PERMISSION_DENIED');
    expectApiError(() => operator.listContents({ accountId: unassigned.account.id }), 403, 'PERMISSION_DENIED');

    const viewer = contentService(db, ids.organizationA, ids.viewer);
    expect(viewer.contentDetail(created.id).content.id).toBe(created.id);
    expectApiError(() => viewer.updateContent(created.id, { priority: 'low' }), 403, 'PERMISSION_DENIED');
    expectApiError(() => viewer.createPlan({
      accountId: assigned.account.id, year: 2026, month: 10, primaryGoal: 'trust', plannedContentCount: 0,
    }), 403, 'PERMISSION_DENIED');
  });

  it('returns 404 for foreign organization IDs and enforces organization-matching foreign keys', () => {
    const local = hierarchy(ids.organizationA, ids.owner, 'A');
    const foreign = hierarchy(ids.organizationB, ids.ownerB, 'B');
    const foreignPlan = contentService(db, ids.organizationB, ids.ownerB).createPlan({
      accountId: foreign.account.id, year: 2026, month: 9, primaryGoal: 'exposure', plannedContentCount: 0,
    });
    const localService = contentService(db, ids.organizationA, ids.owner);
    expectApiError(() => localService.planDetail(foreignPlan.id), 404, 'NOT_FOUND');
    expectApiError(() => localService.createPlan({
      accountId: foreign.account.id, year: 2026, month: 10, primaryGoal: 'exposure', plannedContentCount: 0,
    }), 404, 'NOT_FOUND');
    expect(() => db.insert(monthlyPlans).values({
      id: crypto.randomUUID(), organizationId: ids.organizationB, accountId: local.account.id,
      year: 2026, month: 11, primaryGoal: 'exposure', plannedContentCount: 0, campaignNotes: '',
      keyProductsJson: [], contentMixJson: {}, status: 'active', createdBy: ids.ownerB,
      isDemo: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }).run()).toThrow(/FOREIGN KEY constraint failed/);
  });
});
