import Database from 'better-sqlite3';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '@/db/schema';
import {
  clientMembers, contents, contentStatusLogs, organizations, scriptVersions, shootContents, users,
} from '@/db/schema';
import { ApiError } from '@/lib/api/envelope';
import { contentService } from '@/lib/content/service';
import { masterDataService } from '@/lib/master-data/service';
import type { ScriptJson } from '@/lib/scripts/contracts';
import { shootService } from '@/lib/shoots/service';
import { deriveShootStatus, shootProgress } from '@/lib/shoots/workflow';

const ids = {
  organizationA: '0198f744-8e18-7ae2-a780-52a0e20c8a01',
  organizationB: '0198f744-8e18-7ae2-a780-52a0e20c8a02',
  ownerA: '0198f744-8e18-7ae2-a780-52a0e20c8a03',
  operatorA: '0198f744-8e18-7ae2-a780-52a0e20c8a04',
  photographerA: '0198f744-8e18-7ae2-a780-52a0e20c8a05',
  photographerB: '0198f744-8e18-7ae2-a780-52a0e20c8a06',
  viewerA: '0198f744-8e18-7ae2-a780-52a0e20c8a07',
  editorA: '0198f744-8e18-7ae2-a780-52a0e20c8a08',
  ownerB: '0198f744-8e18-7ae2-a780-52a0e20c8a09',
} as const;

const fixedNow = '2026-09-08T08:00:00.000Z';
const script: ScriptJson = {
  title: '已批准脚本',
  hook: '这盘羊肉好不好，先看纹理。',
  spoken_script: '在备菜区真实展示手切羊肉的纹理和现切过程。',
  shots: [{ scene: '备菜区', visual: '羊肉纹理特写' }],
  product_integration: '手切羊肉',
  cta: '到店了解',
  hashtags: ['#菏泽美食'],
};

let sqlite: Database.Database;
let db: ReturnType<typeof drizzle<typeof schema>>;
let hierarchyA: ReturnType<typeof createHierarchy>;

function expectApiError(action: () => unknown, status: number, code: string) {
  try {
    action();
    throw new Error('Expected ApiError');
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status, code });
  }
}

function createHierarchy(organizationId: string, ownerId: string, suffix: string) {
  const master = masterDataService(db, organizationId, ownerId);
  const client = master.createClient({ clientName: `客户 ${suffix}`, industry: '餐饮' });
  const brand = master.createBrand({ clientId: client.id, brandName: `品牌 ${suffix}` });
  const store = master.createStore({ brandId: brand.id, storeName: `门店 ${suffix}`, address: `地址 ${suffix}` });
  const account = master.createAccount({
    clientId: client.id, brandId: brand.id, storeId: store.id, accountName: `账号 ${suffix}`,
  });
  return { client, brand, store, account };
}

function assign(clientId: string, userId: string) {
  db.insert(clientMembers).values({
    id: crypto.randomUUID(), organizationId: ids.organizationA, clientId, userId,
    roleOverride: null, isDemo: false, createdAt: fixedNow,
  }).run();
}

function approvedContent(title: string, status: 'APPROVED' | 'SCRIPTING' = 'APPROVED', activeApproved = true) {
  const content = contentService(db, ids.organizationA, ids.ownerA).createContent({
    accountId: hierarchyA.account.id, title, contentType: 'product', contentGoal: 'trust',
    hookText: script.hook, productText: script.product_integration, peopleJson: ['老板'], operatorId: ids.operatorA,
  });
  const versionId = crypto.randomUUID();
  db.insert(scriptVersions).values({
    id: versionId, organizationId: ids.organizationA, contentId: content.id, versionNo: 1,
    scriptJson: script, sourceType: 'operator', changeSummary: '测试已批准版本', createdBy: ids.operatorA,
    isDemo: false, createdAt: fixedNow,
  }).run();
  db.update(contents).set({
    status,
    currentScriptVersionId: versionId,
    activeApprovedScriptVersionId: activeApproved ? versionId : null,
  }).where(and(eq(contents.organizationId, ids.organizationA), eq(contents.id, content.id))).run();
  return { ...content, id: content.id, versionId };
}

function createShoot(userId: string = ids.ownerA, overrides: Record<string, unknown> = {}) {
  return shootService(db, ids.organizationA, userId, { now: () => new Date(fixedNow) }).create({
    clientId: hierarchyA.client.id,
    storeId: hierarchyA.store.id,
    shootDate: '2026-09-10',
    startTime: '09:00',
    endTime: '11:00',
    operatorId: ids.operatorA,
    photographerId: ids.photographerA,
    location: '门店备菜区',
    notes: '',
    ...overrides,
  });
}

function service(userId: string = ids.ownerA) {
  return shootService(db, ids.organizationA, userId, { now: () => new Date(fixedNow) });
}

beforeEach(() => {
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  for (const file of readdirSync(resolve('drizzle')).filter((name) => name.endsWith('.sql')).sort())
    sqlite.exec(readFileSync(resolve('drizzle', file), 'utf8').replaceAll('--> statement-breakpoint', ''));
  db = drizzle(sqlite, { schema });
  db.insert(organizations).values([
    { id: ids.organizationA, name: '组织 A', status: 'active', isDemo: false, createdAt: fixedNow, updatedAt: fixedNow },
    { id: ids.organizationB, name: '组织 B', status: 'active', isDemo: false, createdAt: fixedNow, updatedAt: fixedNow },
  ]).run();
  db.insert(users).values([
    { id: ids.ownerA, organizationId: ids.organizationA, name: '负责人', role: 'owner', status: 'active', isDemo: false, createdAt: fixedNow, updatedAt: fixedNow },
    { id: ids.operatorA, organizationId: ids.organizationA, name: '运营 A', role: 'operator', status: 'active', isDemo: false, createdAt: fixedNow, updatedAt: fixedNow },
    { id: ids.photographerA, organizationId: ids.organizationA, name: '摄影 A', role: 'photographer', status: 'active', isDemo: false, createdAt: fixedNow, updatedAt: fixedNow },
    { id: ids.photographerB, organizationId: ids.organizationA, name: '摄影 B', role: 'photographer', status: 'active', isDemo: false, createdAt: fixedNow, updatedAt: fixedNow },
    { id: ids.viewerA, organizationId: ids.organizationA, name: '查看者', role: 'viewer', status: 'active', isDemo: false, createdAt: fixedNow, updatedAt: fixedNow },
    { id: ids.editorA, organizationId: ids.organizationA, name: '剪辑', role: 'editor', status: 'active', isDemo: false, createdAt: fixedNow, updatedAt: fixedNow },
    { id: ids.ownerB, organizationId: ids.organizationB, name: 'B 负责人', role: 'owner', status: 'active', isDemo: false, createdAt: fixedNow, updatedAt: fixedNow },
  ]).run();
  hierarchyA = createHierarchy(ids.organizationA, ids.ownerA, 'A');
  assign(hierarchyA.client.id, ids.operatorA);
  assign(hierarchyA.client.id, ids.viewerA);
});

afterEach(() => sqlite.close());

describe('shoot status calculation', () => {
  it('derives every overall state from checklist items without a mutable completed count', () => {
    expect(deriveShootStatus([])).toBe('planned');
    expect(deriveShootStatus(['planned', 'cancelled'])).toBe('planned');
    expect(deriveShootStatus(['shot', 'planned'])).toBe('in_progress');
    expect(deriveShootStatus(['shot', 'shot'])).toBe('completed');
    expect(deriveShootStatus(['cancelled', 'cancelled'])).toBe('cancelled');
    expect(deriveShootStatus(['rescheduled', 'rescheduled'])).toBe('rescheduled');
    expect(deriveShootStatus(['shot', 'missing_shots', 'cancelled'])).toBe('partially_completed');
    expect(shootProgress(['shot', 'missing_shots', 'rescheduled', 'cancelled'])).toEqual({
      total: 4, shot: 1, issues: 1, rescheduled: 1, cancelled: 1,
    });
  });
});

describe('transactional shoot workflow', () => {
  it('only schedules APPROVED content with an active approved script and restores status on removal', () => {
    const shoot = createShoot();
    const noActive = approvedContent('没有活动脚本', 'APPROVED', false);
    expectApiError(() => service().addContent(shoot.shoot.id, { contentId: noActive.id }), 409, 'APPROVED_SCRIPT_REQUIRED');
    const scripting = approvedContent('未批准状态', 'SCRIPTING');
    expectApiError(() => service().addContent(shoot.shoot.id, { contentId: scripting.id }), 409, 'CONTENT_NOT_APPROVED');

    const ready = approvedContent('可排期内容');
    const added = service().addContent(shoot.shoot.id, { contentId: ready.id });
    expect(added.items).toHaveLength(1);
    expect(added.items[0]).toMatchObject({
      contentId: ready.id, approvedScriptVersionId: ready.versionId, shootItemStatus: 'planned', approvedScript: script,
    });
    expect(db.select().from(contents).where(eq(contents.id, ready.id)).get()?.status).toBe('WAITING_SHOOT');
    expect(db.select().from(contentStatusLogs).where(eq(contentStatusLogs.contentId, ready.id)).get()).toMatchObject({
      previousStatus: 'APPROVED', newStatus: 'WAITING_SHOOT', triggerType: 'shoot', triggerId: added.items[0].id,
    });

    const removed = service().actOnItem(shoot.shoot.id, added.items[0].id, { action: 'remove' });
    expect(removed.items[0].shootItemStatus).toBe('cancelled');
    expect(removed.shoot.status).toBe('cancelled');
    expect(db.select().from(contents).where(eq(contents.id, ready.id)).get()?.status).toBe('APPROVED');
    expect(db.select().from(shootContents).where(eq(shootContents.id, added.items[0].id)).get()).toBeDefined();
  });

  it('keeps status, checklist and logs in one transaction when a side effect fails', () => {
    const shoot = createShoot();
    const ready = approvedContent('回滚测试');
    sqlite.exec(`create trigger reject_shoot_status_log before insert on content_status_logs begin
      select raise(abort, 'forced shoot log failure');
    end`);
    expect(() => service().addContent(shoot.shoot.id, { contentId: ready.id })).toThrow(/forced shoot log failure/);
    expect(db.select().from(shootContents).all()).toEqual([]);
    expect(db.select().from(contents).where(eq(contents.id, ready.id)).get()?.status).toBe('APPROVED');
  });

  it('calculates in-progress, partial completion and final completion from item results', () => {
    const shoot = createShoot();
    const prepared = ['内容一', '内容二', '内容三'].map((title) => approvedContent(title));
    let detail = shoot;
    for (const content of prepared) detail = service().addContent(shoot.shoot.id, { contentId: content.id });
    const [first, second, third] = detail.items;
    detail = service(ids.photographerA).actOnItem(shoot.shoot.id, first.id, { action: 'shot' });
    expect(detail.shoot.status).toBe('in_progress');
    detail = service(ids.photographerA).actOnItem(shoot.shoot.id, second.id, {
      action: 'missing_shots', missingShots: '缺少锅底火焰特写', note: '现场补拍',
    });
    expect(detail.shoot.status).toBe('in_progress');
    expect(db.select().from(contents).where(eq(contents.id, second.contentId)).get()?.status).toBe('WAITING_SHOOT');
    detail = service(ids.photographerA).actOnItem(shoot.shoot.id, third.id, { action: 'shot' });
    expect(detail.shoot.status).toBe('partially_completed');
    expect(detail.shoot).toMatchObject({ itemCount: 3, shotCount: 2, issueCount: 1 });
    detail = service(ids.photographerA).actOnItem(shoot.shoot.id, second.id, { action: 'shot' });
    expect(detail.shoot).toMatchObject({ status: 'completed', shotCount: 3, issueCount: 0 });
    expect(db.select().from(contents).where(eq(contents.id, second.contentId)).get()?.status).toBe('SHOT');
  });

  it('reschedules without deleting history and can bind the pending content to a new shoot', () => {
    const original = createShoot();
    const target = createShoot(ids.ownerA, { shootDate: '2026-09-12', startTime: '14:00', endTime: '16:00' });
    const ready = approvedContent('改期内容');
    const added = service().addContent(original.shoot.id, { contentId: ready.id });
    const rescheduled = service().actOnItem(original.shoot.id, added.items[0].id, {
      action: 'rescheduled', note: '门店临时闭店', newShootId: target.shoot.id,
    });
    expect(rescheduled.shoot.status).toBe('rescheduled');
    expect(rescheduled.items[0]).toMatchObject({ shootItemStatus: 'rescheduled', note: '门店临时闭店' });
    const targetDetail = service().detail(target.shoot.id);
    expect(targetDetail.items[0]).toMatchObject({ contentId: ready.id, shootItemStatus: 'planned', approvedScriptVersionId: ready.versionId });
    expect(db.select().from(shootContents).where(eq(shootContents.contentId, ready.id)).all()).toHaveLength(2);
    expect(db.select().from(contents).where(eq(contents.id, ready.id)).get()?.status).toBe('WAITING_SHOOT');
  });
});

describe('shoot permissions and database isolation', () => {
  it('lets assigned operators manage, assigned photographers execute, viewers read and blocks every wider scope', () => {
    const unrelatedStore = masterDataService(db, ids.organizationA, ids.ownerA).createStore({
      brandId: hierarchyA.brand.id, storeName: '同客户未分配门店', address: '另一地址',
    });
    const shoot = createShoot(ids.operatorA);
    const ready = approvedContent('权限拍摄');
    const added = service(ids.operatorA).addContent(shoot.shoot.id, { contentId: ready.id });
    expect(service(ids.photographerA).list({}).items.map((item) => item.id)).toEqual([shoot.shoot.id]);
    const photographerDetail = service(ids.photographerA).detail(shoot.shoot.id);
    expect(photographerDetail.items[0].approvedScript).toEqual(script);
    expect(photographerDetail.options.stores.map((store) => store.id)).toEqual([hierarchyA.store.id]);
    expect(photographerDetail.options.stores.map((store) => store.id)).not.toContain(unrelatedStore.id);
    expectApiError(() => service(ids.photographerB).detail(shoot.shoot.id), 403, 'PERMISSION_DENIED');
    expect(service(ids.viewerA).detail(shoot.shoot.id).items).toHaveLength(1);
    expectApiError(() => service(ids.viewerA).actOnItem(shoot.shoot.id, added.items[0].id, { action: 'shot' }), 403, 'PERMISSION_DENIED');
    expectApiError(() => service(ids.editorA).list({}), 403, 'PERMISSION_DENIED');

    const unassigned = createHierarchy(ids.organizationA, ids.ownerA, 'unassigned');
    expectApiError(() => createShoot(ids.operatorA, { clientId: unassigned.client.id, storeId: unassigned.store.id }), 403, 'PERMISSION_DENIED');
  });

  it('returns 404 for another organization and enforces hierarchy and roles at the SQLite boundary', () => {
    const hierarchyB = createHierarchy(ids.organizationB, ids.ownerB, 'B');
    db.insert(users).values({
      id: '0198f744-8e18-7ae2-a780-52a0e20c8a10', organizationId: ids.organizationB, name: 'B 摄影',
      role: 'photographer', status: 'active', isDemo: false, createdAt: fixedNow, updatedAt: fixedNow,
    }).run();
    const foreign = shootService(db, ids.organizationB, ids.ownerB, { now: () => new Date(fixedNow) }).create({
      clientId: hierarchyB.client.id, storeId: hierarchyB.store.id, shootDate: '2026-09-10', startTime: '09:00', endTime: '11:00',
      operatorId: ids.ownerB, photographerId: '0198f744-8e18-7ae2-a780-52a0e20c8a10', location: '', notes: '',
    });
    expectApiError(() => service().detail(foreign.shoot.id), 404, 'NOT_FOUND');

    const other = createHierarchy(ids.organizationA, ids.ownerA, 'other');
    expect(() => sqlite.prepare(`insert into shoots (
      id, organization_id, client_id, store_id, shoot_date, start_time, end_time, operator_id, photographer_id,
      location, notes, status, is_demo, created_at, updated_at
    ) values (?, ?, ?, ?, '2026-09-10', '09:00', '11:00', ?, ?, '', '', 'planned', 0, ?, ?)`).run(
      crypto.randomUUID(), ids.organizationA, hierarchyA.client.id, other.store.id,
      ids.ownerA, ids.photographerA, fixedNow, fixedNow,
    )).toThrow(/shoot store does not belong to client/);
    expect(() => sqlite.prepare(`insert into shoots (
      id, organization_id, client_id, store_id, shoot_date, start_time, end_time, operator_id, photographer_id,
      location, notes, status, is_demo, created_at, updated_at
    ) values (?, ?, ?, ?, '2026-09-10', '09:00', '11:00', ?, ?, '', '', 'planned', 0, ?, ?)`).run(
      crypto.randomUUID(), ids.organizationA, hierarchyA.client.id, hierarchyA.store.id,
      ids.ownerA, ids.ownerA, fixedNow, fixedNow,
    )).toThrow(/shoot photographer role is invalid/);
  });
});
