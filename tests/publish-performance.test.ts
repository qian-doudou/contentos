import Database from 'better-sqlite3';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '@/db/schema';
import {
  clientMembers, contents, contentStatusLogs, editVersions, organizations,
  performanceImportBatches, performanceSnapshots, publishes, users,
} from '@/db/schema';
import { ApiError } from '@/lib/api/envelope';
import { contentService } from '@/lib/content/service';
import { masterDataService } from '@/lib/master-data/service';
import { calculateDerivedMetrics, performanceService } from '@/lib/performance/service';

const ids = {
  organizationA: '0198f744-8e18-7ae2-a780-52a0e20cce01',
  organizationB: '0198f744-8e18-7ae2-a780-52a0e20cce02',
  ownerA: '0198f744-8e18-7ae2-a780-52a0e20cce03',
  operatorA: '0198f744-8e18-7ae2-a780-52a0e20cce04',
  operatorUnassigned: '0198f744-8e18-7ae2-a780-52a0e20cce05',
  editorA: '0198f744-8e18-7ae2-a780-52a0e20cce06',
  viewerA: '0198f744-8e18-7ae2-a780-52a0e20cce07',
  photographerA: '0198f744-8e18-7ae2-a780-52a0e20cce08',
  ownerB: '0198f744-8e18-7ae2-a780-52a0e20cce09',
} as const;
const fixedNow = '2026-09-09T02:00:00.000Z';

let sqlite: Database.Database;
let db: ReturnType<typeof drizzle<typeof schema>>;
let hierarchyA: ReturnType<typeof hierarchy>;

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
  const master = masterDataService(db, organizationId, ownerId);
  const client = master.createClient({ clientName: `客户 ${suffix}`, industry: '餐饮' });
  const brand = master.createBrand({ clientId: client.id, brandName: `品牌 ${suffix}`, city: '菏泽' });
  const store = master.createStore({ brandId: brand.id, storeName: `门店 ${suffix}` });
  const account = master.createAccount({
    clientId: client.id, brandId: brand.id, storeId: store.id, accountName: `账号 ${suffix}`,
  });
  return { client, brand, store, account };
}

function addMembership(clientId: string, userId: string) {
  db.insert(clientMembers).values({
    id: crypto.randomUUID(), organizationId: ids.organizationA, clientId, userId,
    roleOverride: null, isDemo: false, createdAt: fixedNow,
  }).run();
}

function readyContent(
  title: string,
  organizationId: string = ids.organizationA,
  ownerId: string = ids.ownerA,
  target: ReturnType<typeof hierarchy> = hierarchyA,
) {
  const content = contentService(db, organizationId, ownerId).createContent({
    accountId: target.account.id, title, contentType: 'conversion', contentGoal: 'gmv',
    topic: '团购转化', angle: '真实到店过程', hookType: 'result', hookText: '看看真实到店结果',
    coreMessage: '如实展示团购到店流程', operatorId: ownerId,
  });
  const editId = crypto.randomUUID();
  db.insert(editVersions).values({
    id: editId, organizationId, contentId: content.id, versionNo: 1,
    assetUrl: 'https://media.example.test/final.mp4', assetType: 'url', note: '已批准成片',
    createdBy: ownerId, isDemo: false, createdAt: fixedNow,
  }).run();
  db.update(contents).set({
    status: 'READY_TO_PUBLISH', currentEditVersionId: editId, activeApprovedEditVersionId: editId,
  }).where(and(eq(contents.organizationId, organizationId), eq(contents.id, content.id))).run();
  return content.id;
}

function service(userId: string = ids.ownerA, organizationId: string = ids.organizationA, time = fixedNow) {
  return performanceService(db, organizationId, userId, { now: () => new Date(time) });
}

function publishReady(contentId: string, userId: string = ids.ownerA, platformPostId: string | null = 'douyin-post-1') {
  return service(userId).createPublish(contentId, {
    platform: 'douyin', publishedAt: '2026-09-09T01:00:00.000Z',
    postUrl: 'https://www.douyin.com/video/123456789', platformPostId,
  }).publish;
}

beforeEach(() => {
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  for (const file of readdirSync(resolve('drizzle')).filter(name => name.endsWith('.sql')).sort())
    sqlite.exec(readFileSync(resolve('drizzle', file), 'utf8').replaceAll('--> statement-breakpoint', ''));
  db = drizzle(sqlite, { schema });
  db.insert(organizations).values([
    { id: ids.organizationA, name: '组织 A', status: 'active', isDemo: false, createdAt: fixedNow, updatedAt: fixedNow },
    { id: ids.organizationB, name: '组织 B', status: 'active', isDemo: false, createdAt: fixedNow, updatedAt: fixedNow },
  ]).run();
  db.insert(users).values([
    { id: ids.ownerA, organizationId: ids.organizationA, name: '负责人', role: 'owner', status: 'active', isDemo: false, createdAt: fixedNow, updatedAt: fixedNow },
    { id: ids.operatorA, organizationId: ids.organizationA, name: '运营', role: 'operator', status: 'active', isDemo: false, createdAt: fixedNow, updatedAt: fixedNow },
    { id: ids.operatorUnassigned, organizationId: ids.organizationA, name: '未分配运营', role: 'operator', status: 'active', isDemo: false, createdAt: fixedNow, updatedAt: fixedNow },
    { id: ids.editorA, organizationId: ids.organizationA, name: '剪辑', role: 'editor', status: 'active', isDemo: false, createdAt: fixedNow, updatedAt: fixedNow },
    { id: ids.viewerA, organizationId: ids.organizationA, name: '查看者', role: 'viewer', status: 'active', isDemo: false, createdAt: fixedNow, updatedAt: fixedNow },
    { id: ids.photographerA, organizationId: ids.organizationA, name: '摄影', role: 'photographer', status: 'active', isDemo: false, createdAt: fixedNow, updatedAt: fixedNow },
    { id: ids.ownerB, organizationId: ids.organizationB, name: 'B 负责人', role: 'owner', status: 'active', isDemo: false, createdAt: fixedNow, updatedAt: fixedNow },
  ]).run();
  hierarchyA = hierarchy(ids.organizationA, ids.ownerA, 'A');
  addMembership(hierarchyA.client.id, ids.operatorA);
  addMembership(hierarchyA.client.id, ids.viewerA);
});

afterEach(() => sqlite.close());

describe('publish transaction', () => {
  it('atomically creates one active publish, advances status and writes the linked status log', () => {
    const contentId = readyContent('待发布内容');
    const result = publishReady(contentId, ids.operatorA);
    expect(result).toMatchObject({ contentId, platform: 'douyin', status: 'active', platformPostId: 'douyin-post-1' });
    expect(db.select().from(contents).where(eq(contents.id, contentId)).get()).toMatchObject({
      status: 'PUBLISHED', publishedAt: '2026-09-09T01:00:00.000Z',
    });
    expect(db.select().from(contentStatusLogs).where(eq(contentStatusLogs.contentId, contentId)).get()).toMatchObject({
      previousStatus: 'READY_TO_PUBLISH', newStatus: 'PUBLISHED', triggerType: 'publish', triggerId: result.id,
    });
    expectApiError(() => publishReady(contentId, ids.operatorA, 'douyin-post-2'), 409, 'PUBLISH_STATUS_INVALID');
    expect(db.select().from(publishes).where(eq(publishes.contentId, contentId)).all()).toHaveLength(1);
  });

  it('rejects an invalid lifecycle or missing approved edit and rolls back every side effect when logging fails', () => {
    const invalid = contentService(db, ids.organizationA, ids.ownerA).createContent({
      accountId: hierarchyA.account.id, title: '未批准', contentType: 'product', contentGoal: 'trust', operatorId: ids.ownerA,
    });
    expectApiError(() => publishReady(invalid.id), 409, 'PUBLISH_STATUS_INVALID');
    db.update(contents).set({ status: 'READY_TO_PUBLISH' }).where(eq(contents.id, invalid.id)).run();
    expectApiError(() => publishReady(invalid.id), 409, 'APPROVED_EDIT_REQUIRED');

    const contentId = readyContent('发布事务回滚');
    sqlite.exec(`create trigger reject_publish_log before insert on content_status_logs begin
      select raise(abort, 'forced publish log failure');
    end`);
    expect(() => publishReady(contentId)).toThrow(/forced publish log failure/);
    expect(db.select().from(publishes).where(eq(publishes.contentId, contentId)).all()).toEqual([]);
    expect(db.select().from(contents).where(eq(contents.id, contentId)).get()).toMatchObject({
      status: 'READY_TO_PUBLISH', publishedAt: null,
    });
  });
});

describe('performance snapshots and derived metrics', () => {
  it('calculates metrics in code and returns null for missing or zero denominators', () => {
    expect(calculateDerivedMetrics({
      snapshotTime: fixedNow, views: 1000, likes: 80, comments: 10, shares: 5, favorites: 5,
      profileVisits: 30, groupbuyClicks: 20, orders: 4, gmv: 800,
    })).toEqual({ engagementRate: 0.1, groupbuyCtr: 0.02, orderConversionRate: 0.2, gmvPer1000Views: 800 });
    expect(calculateDerivedMetrics({
      snapshotTime: fixedNow, views: 0, likes: 0, comments: 0, shares: 0, favorites: 0,
      profileVisits: null, groupbuyClicks: 0, orders: 0, gmv: 0,
    })).toEqual({ engagementRate: null, groupbuyCtr: null, orderConversionRate: null, gmvPer1000Views: null });
    expect(calculateDerivedMetrics({
      snapshotTime: fixedNow, views: 100, likes: null, comments: 0, shares: 0, favorites: 0,
      profileVisits: null, groupbuyClicks: null, orders: null, gmv: null,
    })).toEqual({ engagementRate: null, groupbuyCtr: null, orderConversionRate: null, gmvPer1000Views: null });
  });

  it('keeps every snapshot immutable, rejects duplicates and negative values', () => {
    const contentId = readyContent('快照历史');
    const publish = publishReady(contentId);
    const first = service().addSnapshot(publish.id, {
      snapshotTime: '2026-09-09T03:00:00.000Z', views: 100, likes: 8, comments: 1,
      shares: 1, favorites: 0, profileVisits: null, groupbuyClicks: 10, orders: 2, gmv: 200,
    });
    expect(first.derived).toEqual({ engagementRate: 0.1, groupbuyCtr: 0.1, orderConversionRate: 0.2, gmvPer1000Views: 2000 });
    service().addSnapshot(publish.id, { snapshotTime: '2026-09-09T04:00:00.000Z', views: 0 });
    expect(service().contentPerformance(contentId).snapshots).toHaveLength(2);
    expectApiError(() => service().addSnapshot(publish.id, {
      snapshotTime: '2026-09-09T03:00:00.000Z', views: 200,
    }), 409, 'SNAPSHOT_TIME_EXISTS');
    expect(() => service().addSnapshot(publish.id, {
      snapshotTime: '2026-09-09T05:00:00.000Z', views: -1,
    })).toThrow();
    expect(() => db.update(performanceSnapshots).set({ views: 999 }).where(eq(performanceSnapshots.id, first.id)).run())
      .toThrow(/performance snapshot is immutable/);
    expect(db.select().from(performanceSnapshots).where(eq(performanceSnapshots.id, first.id)).get()?.views).toBe(100);
  });
});

describe('CSV performance import', () => {
  const mapping = {
    publishId: 'publish_id', platformPostId: 'platform_post_id', snapshotTime: 'snapshot_time',
    views: 'views', likes: 'likes', comments: 'comments', shares: 'shares', favorites: 'favorites',
    profileVisits: 'profile_visits', groupbuyClicks: 'groupbuy_clicks', orders: 'orders', gmv: 'gmv',
  };

  it('previews mapped rows, reports errors and only commits a clean persisted preview', () => {
    const contentId = readyContent('CSV 内容');
    const publish = publishReady(contentId);
    const header = Object.values(mapping).join(',');
    const dirty = service().previewImport({
      mapping,
      payload: `${header}\n${publish.id},${publish.platformPostId},2026-09-09T05:00:00Z,100,8,1,1,0,5,10,2,200\n${publish.id},${publish.platformPostId},2026-09-09T06:00:00Z,-1,8,1,1,0,5,10,2,200`,
    });
    expect(dirty.batch).toMatchObject({ validRows: 1, invalidRows: 1, duplicateRows: 0 });
    expect(dirty.canCommit).toBe(false);
    expectApiError(() => service().commitImport({ batchId: dirty.batch.id }), 409, 'IMPORT_HAS_INVALID_ROWS');

    const clean = service().previewImport({
      mapping,
      payload: `${header}\n${publish.id},${publish.platformPostId},2026-09-09T05:00:00Z,100,8,1,1,0,5,10,2,200\n${publish.id},${publish.platformPostId},2026-09-09T07:00:00Z,,,,,,,,,`,
    });
    expect(clean).toMatchObject({ canCommit: true, batch: { validRows: 2, invalidRows: 0 } });
    const committed = service().commitImport({ batchId: clean.batch.id });
    expect(committed.snapshotIds).toHaveLength(2);
    expect(db.select().from(performanceSnapshots).where(eq(performanceSnapshots.publishId, publish.id)).all()).toHaveLength(2);
    expectApiError(() => service().commitImport({ batchId: clean.batch.id }), 409, 'IMPORT_ALREADY_FINALIZED');
    expect(db.select().from(performanceImportBatches).where(eq(performanceImportBatches.id, clean.batch.id)).get())
      .toMatchObject({ status: 'committed', committedRows: 2 });
  });

  it('reports duplicate rows and rejects mapping to a missing header', () => {
    const contentId = readyContent('CSV 去重');
    const publish = publishReady(contentId);
    const header = Object.values(mapping).join(',');
    const row = `${publish.id},${publish.platformPostId},2026-09-09T05:00:00Z,100,8,1,1,0,5,10,2,200`;
    const preview = service().previewImport({ mapping, payload: `${header}\n${row}\n${row}` });
    expect(preview.items.map(item => item.status)).toEqual(['valid', 'duplicate']);
    expectApiError(() => service().previewImport({
      mapping: { publishId: 'missing', snapshotTime: 'snapshot_time' }, payload: `${header}\n${row}`,
    }), 400, 'MAPPING_HEADER_NOT_FOUND');
  });
});

describe('analytics permissions, isolation and filters', () => {
  it('filters by account/time/taxonomy and enforces server-side write permission', () => {
    const contentId = readyContent('筛选内容');
    const publish = publishReady(contentId, ids.operatorA);
    service(ids.operatorA).addSnapshot(publish.id, {
      snapshotTime: '2026-09-09T03:00:00.000Z', views: 100, likes: 1, comments: 1, shares: 1, favorites: 1,
    });
    expect(service(ids.viewerA).listAnalytics({ accountId: hierarchyA.account.id, contentType: 'conversion', hookType: 'result', contentGoal: 'gmv' }).total).toBe(1);
    expect(service(ids.viewerA).listAnalytics({ contentType: 'persona' }).items).toEqual([]);
    expect(service(ids.viewerA).listAnalytics({ from: '2026-09-10T00:00:00.000Z' }).total).toBe(0);
    expectApiError(() => service(ids.viewerA).addSnapshot(publish.id, { snapshotTime: '2026-09-09T04:00:00.000Z' }), 403, 'PERMISSION_DENIED');
    expectApiError(() => service(ids.operatorUnassigned).contentPerformance(contentId), 403, 'PERMISSION_DENIED');
    expectApiError(() => service(ids.photographerA).listAnalytics({}), 403, 'PERMISSION_DENIED');
  });

  it('returns 404 across organizations without exposing foreign records', () => {
    const hierarchyB = hierarchy(ids.organizationB, ids.ownerB, 'B');
    const foreignContentId = readyContent('B 内容', ids.organizationB, ids.ownerB, hierarchyB);
    const foreignPublish = service(ids.ownerB, ids.organizationB).createPublish(foreignContentId, {
      platform: 'douyin', publishedAt: '2026-09-09T01:00:00.000Z',
      postUrl: 'https://www.douyin.com/video/foreign', platformPostId: 'foreign-post',
    }).publish;
    expectApiError(() => service().contentPerformance(foreignContentId), 404, 'NOT_FOUND');
    expectApiError(() => service().addSnapshot(foreignPublish.id, { snapshotTime: fixedNow }), 404, 'NOT_FOUND');
  });
});
