import Database from 'better-sqlite3';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '@/db/schema';
import {
  approvals, clientMembers, contents, contentStatusLogs, editVersions, organizations, users,
} from '@/db/schema';
import { ApiError } from '@/lib/api/envelope';
import { contentService } from '@/lib/content/service';
import { editReviewService, publicEditReviewService } from '@/lib/edits/service';
import { masterDataService } from '@/lib/master-data/service';

const ids = {
  organizationA: '0198f744-8e18-7ae2-a780-52a0e20ccd01',
  organizationB: '0198f744-8e18-7ae2-a780-52a0e20ccd02',
  ownerA: '0198f744-8e18-7ae2-a780-52a0e20ccd03',
  operatorA: '0198f744-8e18-7ae2-a780-52a0e20ccd04',
  editorA: '0198f744-8e18-7ae2-a780-52a0e20ccd05',
  editorB: '0198f744-8e18-7ae2-a780-52a0e20ccd06',
  viewerA: '0198f744-8e18-7ae2-a780-52a0e20ccd07',
  photographerA: '0198f744-8e18-7ae2-a780-52a0e20ccd08',
  ownerB: '0198f744-8e18-7ae2-a780-52a0e20ccd09',
} as const;
const fixedNow = '2026-09-08T08:00:00.000Z';
const tokenA = 'A'.repeat(43);
const tokenB = 'B'.repeat(43);

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

function shotContent(title: string, editorId: string = ids.editorA) {
  const row = contentService(db, ids.organizationA, ids.ownerA).createContent({
    accountId: hierarchyA.account.id, title, contentType: 'process', contentGoal: 'trust',
    topic: '门店实拍', angle: '真实过程', hookType: 'identity', hookText: '老板带你看现场',
    coreMessage: '保留真实细节', operatorId: ids.operatorA,
  });
  db.update(contents).set({ status: 'SHOT', editorId }).where(and(
    eq(contents.organizationId, ids.organizationA), eq(contents.id, row.id),
  )).run();
  return row.id;
}

function service(userId: string = ids.ownerA, options: { token?: string; time?: string } = {}) {
  return editReviewService(db, ids.organizationA, userId, {
    now: () => new Date(options.time ?? fixedNow), createToken: () => options.token ?? tokenA,
  });
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
    { id: ids.operatorA, organizationId: ids.organizationA, name: '运营', role: 'operator', status: 'active', isDemo: false, createdAt: fixedNow, updatedAt: fixedNow },
    { id: ids.editorA, organizationId: ids.organizationA, name: '剪辑 A', role: 'editor', status: 'active', isDemo: false, createdAt: fixedNow, updatedAt: fixedNow },
    { id: ids.editorB, organizationId: ids.organizationA, name: '剪辑 B', role: 'editor', status: 'active', isDemo: false, createdAt: fixedNow, updatedAt: fixedNow },
    { id: ids.viewerA, organizationId: ids.organizationA, name: '查看者', role: 'viewer', status: 'active', isDemo: false, createdAt: fixedNow, updatedAt: fixedNow },
    { id: ids.photographerA, organizationId: ids.organizationA, name: '摄影', role: 'photographer', status: 'active', isDemo: false, createdAt: fixedNow, updatedAt: fixedNow },
    { id: ids.ownerB, organizationId: ids.organizationB, name: 'B 负责人', role: 'owner', status: 'active', isDemo: false, createdAt: fixedNow, updatedAt: fixedNow },
  ]).run();
  hierarchyA = hierarchy(ids.organizationA, ids.ownerA, 'A');
  addMembership(hierarchyA.client.id, ids.operatorA);
  addMembership(hierarchyA.client.id, ids.viewerA);
});

afterEach(() => sqlite.close());

describe('immutable edit version workflow', () => {
  it('keeps V1/V2/V3, supports the revision loop and clears an old approved pointer on a new submission', () => {
    const contentId = shotContent('版本循环');
    const started = service(ids.editorA).start(contentId, {});
    expect(started.content.status).toBe('EDITING');
    const first = service(ids.editorA).submitVersion(contentId, {
      assetType: 'url', assetUrl: 'https://media.example.test/final-v1.mp4', note: '初剪',
      reviewerType: 'internal_user', reviewerUserId: ids.operatorA,
    });
    expect(first.workspace).toMatchObject({ content: { status: 'WAITING_REVIEW' } });
    expect(first.workspace.versions[0]).toMatchObject({ versionNo: 1, isCurrent: true, isActiveApproved: false });
    const firstApproval = first.workspace.approvals.find((item) => item.status === 'pending')!;
    const revision = service(ids.operatorA).decide(firstApproval.id, { status: 'changes_requested', comment: '补充锅底特写' });
    expect(revision.content.status).toBe('REVISION');

    const second = service(ids.editorA).submitVersion(contentId, {
      assetType: 'local_reference', assetUrl: 'assets/de-xiang-lou/final-v2.mp4', note: '补充锅底特写',
      reviewerType: 'internal_user', reviewerUserId: ids.operatorA,
    });
    expect(second.workspace.versions.map((item) => item.versionNo)).toEqual([2, 1]);
    const secondApproval = second.workspace.approvals.find((item) => item.status === 'pending')!;
    const approved = service(ids.operatorA).decide(secondApproval.id, { status: 'approved', comment: '成片通过' });
    expect(approved.content).toMatchObject({
      status: 'READY_TO_PUBLISH', currentEditVersionId: second.workspace.versions[0].id,
      activeApprovedEditVersionId: second.workspace.versions[0].id,
    });

    const third = service(ids.editorA).submitVersion(contentId, {
      assetType: 'url', assetUrl: 'https://media.example.test/final-v3.mp4', note: '发布前替换字幕',
      reviewerType: 'internal_user', reviewerUserId: ids.operatorA,
    });
    expect(third.workspace.content).toMatchObject({ status: 'WAITING_REVIEW', activeApprovedEditVersionId: null });
    expect(third.workspace.versions.map((item) => item.versionNo)).toEqual([3, 2, 1]);
    expect(third.workspace.approvals.map((item) => item.status).sort()).toEqual(['approved', 'changes_requested', 'pending']);
    expect(() => db.update(editVersions).set({ note: '试图覆盖' }).where(eq(editVersions.id, third.workspace.versions[0].id)).run())
      .toThrow(/edit version is immutable/);
    expect(db.select().from(contentStatusLogs).where(eq(contentStatusLogs.contentId, contentId)).all()
      .map((item) => `${item.previousStatus}->${item.newStatus}:${item.triggerType}`)).toEqual([
      'SHOT->EDITING:edit', 'EDITING->WAITING_REVIEW:edit', 'WAITING_REVIEW->REVISION:approval',
      'REVISION->WAITING_REVIEW:edit', 'WAITING_REVIEW->READY_TO_PUBLISH:approval',
      'READY_TO_PUBLISH->WAITING_REVIEW:edit',
    ]);
  });

  it('rolls back version, approval, status and pointers when the status-log side effect fails', () => {
    const contentId = shotContent('事务回滚');
    service(ids.editorA).start(contentId, {});
    sqlite.exec(`create trigger reject_edit_status_log before insert on content_status_logs begin
      select raise(abort, 'forced edit log failure');
    end`);
    expect(() => service(ids.editorA).submitVersion(contentId, {
      assetType: 'url', assetUrl: 'https://media.example.test/rollback.mp4', note: '',
      reviewerType: 'internal_user', reviewerUserId: ids.operatorA,
    })).toThrow(/forced edit log failure/);
    expect(db.select().from(editVersions).where(eq(editVersions.contentId, contentId)).all()).toEqual([]);
    expect(db.select().from(approvals).where(eq(approvals.contentId, contentId)).all()).toEqual([]);
    expect(db.select().from(contents).where(eq(contents.id, contentId)).get()).toMatchObject({
      status: 'EDITING', currentEditVersionId: null, activeApprovedEditVersionId: null,
    });
  });
});

describe('external final-video review token', () => {
  it('stores only the hash, exposes only the bound edit and applies the public approval transaction', () => {
    const contentId = shotContent('外部成片审核');
    service(ids.editorA).start(contentId, {});
    const submitted = service(ids.editorA, { token: tokenA }).submitVersion(contentId, {
      assetType: 'url', assetUrl: 'https://media.example.test/external-v1.mp4', note: '客户审核版',
      reviewerType: 'external_client', expiresAt: '2026-09-09T08:00:00.000Z',
    });
    expect(submitted.reviewPath).toBe(`/review/${tokenA}`);
    const stored = db.select().from(approvals).where(eq(approvals.contentId, contentId)).get()!;
    expect(stored.reviewTokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(stored)).not.toContain(tokenA);
    const publicView = publicEditReviewService(db, { now: () => new Date(fixedNow) }).view(tokenA);
    expect(Object.keys(publicView).sort()).toEqual(['approval', 'brand', 'content', 'edit']);
    expect(publicView).toMatchObject({ content: { title: '外部成片审核' }, edit: { versionNo: 1, note: '客户审核版' } });
    expect(JSON.stringify(publicView)).not.toContain(ids.organizationA);
    expectApiError(() => publicEditReviewService(db).view('Z'.repeat(43)), 404, 'REVIEW_LINK_NOT_FOUND');
    const decided = publicEditReviewService(db, { now: () => new Date(fixedNow) }).decide(tokenA, {
      status: 'approved', comment: '客户确认成片',
    });
    expect(decided.approval.status).toBe('approved');
    expect(db.select().from(contents).where(eq(contents.id, contentId)).get()).toMatchObject({
      status: 'READY_TO_PUBLISH', activeApprovedEditVersionId: submitted.workspace.versions[0].id,
    });
  });

  it('expires a token and can reissue a new token for the same immutable version', () => {
    const contentId = shotContent('过期与重发');
    service(ids.editorA).start(contentId, {});
    const submitted = service(ids.editorA, { token: tokenA }).submitVersion(contentId, {
      assetType: 'url', assetUrl: 'https://media.example.test/expiry-v1.mp4', note: '',
      reviewerType: 'external_client', expiresAt: '2026-09-09T08:00:00.000Z',
    });
    expectApiError(
      () => publicEditReviewService(db, { now: () => new Date('2026-09-10T08:00:00.000Z') }).view(tokenA),
      410, 'REVIEW_LINK_EXPIRED',
    );
    const reissued = service(ids.editorA, { token: tokenB, time: '2026-09-10T08:00:00.000Z' }).resubmitApproval(contentId, {
      versionId: submitted.workspace.versions[0].id, reviewerType: 'external_client',
      expiresAt: '2026-09-11T08:00:00.000Z',
    });
    expect(reissued.reviewPath).toBe(`/review/${tokenB}`);
    expect(reissued.workspace.versions).toHaveLength(1);
    expect(reissued.workspace.approvals.map((item) => item.status).sort()).toEqual(['expired', 'pending']);
    expect(publicEditReviewService(db, { now: () => new Date('2026-09-10T08:00:00.000Z') }).view(tokenB).edit.versionNo).toBe(1);
  });
});

describe('edit permissions, isolation and database guards', () => {
  it('limits Editor to own tasks, keeps Viewer read-only and blocks Photographer and cross-organization access', () => {
    const ownId = shotContent('剪辑 A 任务');
    const otherId = shotContent('剪辑 B 任务', ids.editorB);
    expect(service(ids.editorA).list({}).items.map((item) => item.id)).toEqual([ownId]);
    expect(service(ids.editorA).workspace(ownId).content.editorId).toBe(ids.editorA);
    expectApiError(() => service(ids.editorA).workspace(otherId), 403, 'PERMISSION_DENIED');
    expect(service(ids.viewerA).workspace(ownId).content.id).toBe(ownId);
    expectApiError(() => service(ids.viewerA).start(ownId, {}), 403, 'PERMISSION_DENIED');
    expectApiError(() => service(ids.photographerA).list({}), 403, 'PERMISSION_DENIED');
    service(ids.editorA).start(ownId, {});
    expectApiError(() => service(ids.operatorA).submitVersion(ownId, {
      assetType: 'url', assetUrl: 'https://media.example.test/forbidden.mp4', note: '',
      reviewerType: 'internal_user', reviewerUserId: ids.operatorA,
    }), 403, 'PERMISSION_DENIED');

    const hierarchyB = hierarchy(ids.organizationB, ids.ownerB, 'B');
    const foreignContent = contentService(db, ids.organizationB, ids.ownerB).createContent({
      accountId: hierarchyB.account.id, title: 'B 内容', contentType: 'process', contentGoal: 'trust', operatorId: ids.ownerB,
    });
    db.update(contents).set({ status: 'SHOT' }).where(eq(contents.id, foreignContent.id)).run();
    expectApiError(() => service(ids.ownerA).workspace(foreignContent.id), 404, 'NOT_FOUND');
  });

  it('rejects invalid lifecycle calls, editor roles, cross-content pointers and approval bindings', () => {
    const contentId = shotContent('数据库边界');
    expectApiError(() => service(ids.editorA).submitVersion(contentId, {
      assetType: 'url', assetUrl: 'https://media.example.test/not-started.mp4', note: '',
      reviewerType: 'internal_user', reviewerUserId: ids.operatorA,
    }), 409, 'EDIT_VERSION_NOT_ALLOWED');
    expect(() => sqlite.prepare('update contents set editor_id = ? where id = ?').run(ids.ownerA, contentId))
      .toThrow(/content editor role is invalid/);
    service(ids.editorA).start(contentId, {});
    expectApiError(() => service(ids.editorA).start(contentId, {}), 409, 'INVALID_STATUS_TRANSITION');
    const submitted = service(ids.editorA).submitVersion(contentId, {
      assetType: 'url', assetUrl: 'https://media.example.test/guard-v1.mp4', note: '',
      reviewerType: 'internal_user', reviewerUserId: ids.operatorA,
    });
    const otherContentId = shotContent('其他内容', ids.editorB);
    const versionId = submitted.workspace.versions[0].id;
    expect(() => sqlite.prepare('update contents set current_edit_version_id = ? where id = ?').run(versionId, otherContentId))
      .toThrow(/content edit pointer does not belong/);
    expect(() => sqlite.prepare(`insert into approvals (
      id, organization_id, content_id, approval_type, version_id, status, reviewer_type,
      reviewer_user_id, review_token_hash, expires_at, comment, is_demo, created_at, updated_at
    ) values (?, ?, ?, 'final_video', ?, 'pending', 'external_client', null, ?, ?, '', 0, ?, ?)`).run(
      crypto.randomUUID(), ids.organizationA, otherContentId, versionId, 'c'.repeat(64),
      '2026-09-09T08:00:00.000Z', fixedNow, fixedNow,
    )).toThrow(/final video approval version does not belong/);
  });
});
