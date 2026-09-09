import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '@/db/schema';
import {
  accounts, aiUsageLogs, brands, clientMembers, clients, contentStatusLogs, contents,
  contextSnapshots, editVersions, monthlyPlans, organizationAiQuotas, organizations,
  publishes, runSteps, runs, scriptVersions, shootContents, shoots, stores, users,
} from '@/db/schema';
import { ApiError } from '@/lib/api/envelope';
import { calculateDeliveryRisk, opsService } from '@/lib/ops/service';

const ids = {
  organization: crypto.randomUUID(),
  foreignOrganization: crypto.randomUUID(),
  owner: crypto.randomUUID(),
  operator: crypto.randomUUID(),
  photographer: crypto.randomUUID(),
  editor: crypto.randomUUID(),
  viewer: crypto.randomUUID(),
  foreignOwner: crypto.randomUUID(),
  client: crypto.randomUUID(),
  brand: crypto.randomUUID(),
  store: crypto.randomUUID(),
  account: crypto.randomUUID(),
  plan: crypto.randomUUID(),
  publishedContent: crypto.randomUUID(),
  editVersion: crypto.randomUUID(),
  ideaContent: crypto.randomUUID(),
  dueContent: crypto.randomUUID(),
  shootContent: crypto.randomUUID(),
  scriptVersion: crypto.randomUUID(),
  shoot: crypto.randomUUID(),
  shootItem: crypto.randomUUID(),
  publish: crypto.randomUUID(),
  quota: crypto.randomUUID(),
  run: crypto.randomUUID(),
  runStep: crypto.randomUUID(),
  runStepTwo: crypto.randomUUID(),
  snapshot: crypto.randomUUID(),
  foreignRun: crypto.randomUUID(),
  foreignStep: crypto.randomUUID(),
} as const;

const now = '2026-09-15T04:00:00.000Z';
let sqlite: Database.Database;
let db: ReturnType<typeof drizzle<typeof schema>>;

function contentRow(id: string, overrides: Partial<typeof contents.$inferInsert> = {}): typeof contents.$inferInsert {
  return {
    id,
    organizationId: ids.organization,
    clientId: ids.client,
    brandId: ids.brand,
    storeId: ids.store,
    accountId: ids.account,
    monthlyPlanId: ids.plan,
    title: `内容 ${id.slice(0, 4)}`,
    contentType: 'persona',
    contentGoal: 'exposure',
    topic: '', angle: '', hookType: 'other', hookText: '', coreMessage: '', productText: '',
    ctaType: '', localElement: '', peopleJson: [], status: 'IDEA', priority: 'normal',
    operatorId: ids.operator,
    editorId: null,
    createdBy: ids.operator,
    isDemo: false,
    createdAt: '2026-09-10T02:00:00.000Z',
    updatedAt: '2026-09-10T02:00:00.000Z',
    ...overrides,
  };
}

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
  for (const file of readdirSync(resolve('drizzle')).filter((name) => name.endsWith('.sql')).sort())
    sqlite.exec(readFileSync(resolve('drizzle', file), 'utf8').replaceAll('--> statement-breakpoint', ''));
  db = drizzle(sqlite, { schema });
  db.insert(organizations).values([
    { id: ids.organization, name: '组织 A', status: 'active', isDemo: false, createdAt: now, updatedAt: now },
    { id: ids.foreignOrganization, name: '组织 B', status: 'active', isDemo: false, createdAt: now, updatedAt: now },
  ]).run();
  db.insert(users).values([
    { id: ids.owner, organizationId: ids.organization, name: '负责人', role: 'owner', status: 'active', isDemo: false, createdAt: now, updatedAt: now },
    { id: ids.operator, organizationId: ids.organization, name: '运营 A', role: 'operator', status: 'active', isDemo: false, createdAt: now, updatedAt: now },
    { id: ids.photographer, organizationId: ids.organization, name: '摄影 A', role: 'photographer', status: 'active', isDemo: false, createdAt: now, updatedAt: now },
    { id: ids.editor, organizationId: ids.organization, name: '剪辑 A', role: 'editor', status: 'active', isDemo: false, createdAt: now, updatedAt: now },
    { id: ids.viewer, organizationId: ids.organization, name: '查看者', role: 'viewer', status: 'active', isDemo: false, createdAt: now, updatedAt: now },
    { id: ids.foreignOwner, organizationId: ids.foreignOrganization, name: '负责人 B', role: 'owner', status: 'active', isDemo: false, createdAt: now, updatedAt: now },
  ]).run();
  db.insert(clients).values({
    id: ids.client, organizationId: ids.organization, clientName: '德祥楼', industry: '餐饮',
    subIndustry: '', cooperationStatus: 'active', monthlyContentTarget: 10, ownerUserId: ids.owner,
    notes: '', status: 'active', isDemo: false, createdAt: now, updatedAt: now,
  }).run();
  db.insert(brands).values({
    id: ids.brand, organizationId: ids.organization, clientId: ids.client, brandName: '德祥楼',
    industry: '餐饮', subIndustry: '', city: '菏泽', brandPositioning: '', targetAudienceJson: [],
    coreProductsJson: [], coreSellingPointsJson: [], brandToneJson: [], forbiddenTopicsJson: [],
    status: 'active', isDemo: false, createdAt: now, updatedAt: now,
  }).run();
  db.insert(stores).values({
    id: ids.store, organizationId: ids.organization, brandId: ids.brand, storeName: '门店', city: '菏泽',
    district: '', address: '', storeType: '', status: 'active', isDemo: false, createdAt: now, updatedAt: now,
  }).run();
  db.insert(accounts).values({
    id: ids.account, organizationId: ids.organization, clientId: ids.client, brandId: ids.brand, storeId: ids.store,
    platform: 'douyin', accountName: '老板 IP', accountType: 'owner_ip', accountGoalJson: [], contentStyleJson: [],
    forbiddenStyleJson: [], followers: null, status: 'active', isDemo: false, createdAt: now, updatedAt: now,
  }).run();
  db.insert(clientMembers).values([
    { id: crypto.randomUUID(), organizationId: ids.organization, clientId: ids.client, userId: ids.operator, roleOverride: null, isDemo: false, createdAt: now },
    { id: crypto.randomUUID(), organizationId: ids.organization, clientId: ids.client, userId: ids.viewer, roleOverride: null, isDemo: false, createdAt: now },
  ]).run();
  db.insert(monthlyPlans).values({
    id: ids.plan, organizationId: ids.organization, accountId: ids.account, year: 2026, month: 9,
    primaryGoal: 'exposure', plannedContentCount: 10, campaignNotes: '', keyProductsJson: [],
    contentMixJson: { persona: 100 }, status: 'active', createdBy: ids.owner, isDemo: false, createdAt: now, updatedAt: now,
  }).run();

  db.insert(contents).values(contentRow(ids.publishedContent, { status: 'SHOT', editorId: ids.editor, title: '已发布内容' })).run();
  db.insert(editVersions).values({
    id: ids.editVersion, organizationId: ids.organization, contentId: ids.publishedContent, versionNo: 1,
    assetUrl: 'https://example.com/video', assetType: 'url', note: '', createdBy: ids.editor,
    isDemo: false, createdAt: '2026-09-12T03:00:00.000Z',
  }).run();
  sqlite.prepare('update contents set status = ?, current_edit_version_id = ?, active_approved_edit_version_id = ? where id = ?')
    .run('READY_TO_PUBLISH', ids.editVersion, ids.editVersion, ids.publishedContent);
  db.insert(publishes).values({
    id: ids.publish, organizationId: ids.organization, contentId: ids.publishedContent, platform: 'douyin',
    publishedAt: '2026-09-12T04:00:00.000Z', postUrl: 'https://example.com/post', platformPostId: null,
    status: 'active', createdBy: ids.operator, isDemo: false, createdAt: '2026-09-12T04:00:00.000Z',
  }).run();
  sqlite.prepare('update contents set status = ?, published_at = ? where id = ?').run('PUBLISHED', '2026-09-12T04:00:00.000Z', ids.publishedContent);
  db.insert(contentStatusLogs).values({
    id: crypto.randomUUID(), organizationId: ids.organization, contentId: ids.publishedContent,
    previousStatus: 'SHOT', newStatus: 'EDITING', triggerType: 'edit', triggerId: null,
    operatorId: ids.editor, reason: '开始剪辑', isDemo: false, createdAt: '2026-09-12T02:00:00.000Z',
  }).run();

  db.insert(contents).values([
    contentRow(ids.ideaContent, { title: '已延期选题', deadline: '2026-09-14T04:00:00.000Z' }),
    contentRow(ids.dueContent, { title: '即将延期选题', deadline: '2026-09-16T04:00:00.000Z' }),
    contentRow(ids.shootContent, { title: '拍摄内容', status: 'APPROVED' }),
  ]).run();
  db.insert(scriptVersions).values({
    id: ids.scriptVersion, organizationId: ids.organization, contentId: ids.shootContent, versionNo: 1,
    scriptJson: { title: '拍摄内容', hook: '', spoken_script: '', shots: [], product_integration: '', cta: '', hashtags: [] },
    sourceType: 'operator', changeSummary: '', createdBy: ids.operator, isDemo: false, createdAt: now,
  }).run();
  sqlite.prepare('update contents set current_script_version_id = ?, active_approved_script_version_id = ? where id = ?')
    .run(ids.scriptVersion, ids.scriptVersion, ids.shootContent);
  db.insert(shoots).values({
    id: ids.shoot, organizationId: ids.organization, clientId: ids.client, storeId: ids.store,
    shootDate: '2026-09-15', startTime: '13:00', endTime: '15:00', operatorId: ids.operator,
    photographerId: ids.photographer, location: '门店', notes: '', status: 'completed', isDemo: false, createdAt: now, updatedAt: now,
  }).run();
  db.insert(shootContents).values({
    id: ids.shootItem, organizationId: ids.organization, shootId: ids.shoot, contentId: ids.shootContent,
    approvedScriptVersionId: ids.scriptVersion, shootItemStatus: 'shot', missingShots: '', note: '',
    isDemo: false, createdAt: now, updatedAt: now,
  }).run();

  db.insert(organizationAiQuotas).values({
    id: ids.quota, organizationId: ids.organization, periodStart: '2026-01-01T00:00:00.000Z',
    periodEnd: '2027-01-01T00:00:00.000Z', quotaPoints: 100, usedPoints: 90,
    isDemo: false, createdAt: now, updatedAt: now,
  }).run();
  db.insert(runs).values({
    id: ids.run, organizationId: ids.organization, runType: 'production', subjectType: 'script_generation',
    subjectId: ids.publishedContent, status: 'failed', startedAt: now, finishedAt: now,
    createdBy: ids.owner, isDemo: false, createdAt: now,
  }).run();
  db.insert(runSteps).values([
    { id: ids.runStep, organizationId: ids.organization, runId: ids.run, sequence: 0, stepCode: 'context_build', status: 'succeeded', inputJson: JSON.stringify({ api_key: 'secret', database_path: '/Users/private/db.sqlite' }), outputJson: JSON.stringify({ contextSnapshotId: ids.snapshot }), errorJson: null, startedAt: now, finishedAt: now, durationMs: 10, warningCodesJson: null, isDemo: false },
    { id: ids.runStepTwo, organizationId: ids.organization, runId: ids.run, sequence: 1, stepCode: 'script_generator', status: 'failed', inputJson: null, outputJson: null, errorJson: JSON.stringify({ code: 'MODEL_FAILED' }), startedAt: now, finishedAt: now, durationMs: 20, warningCodesJson: JSON.stringify(['retry_exhausted']), isDemo: false },
  ]).run();
  db.insert(contextSnapshots).values({
    id: ids.snapshot, organizationId: ids.organization, accountId: ids.account, contentId: ids.publishedContent,
    monthlyPlanId: ids.plan, contextSnapshotJson: { apiKey: 'hidden', snapshot: { estimatedTokens: 12 } },
    createdBy: ids.owner, isDemo: false, createdAt: now,
  }).run();
  db.insert(aiUsageLogs).values([
    { id: crypto.randomUUID(), organizationId: ids.organization, runId: ids.run, runStepId: ids.runStep, runType: 'production', userId: ids.owner, clientId: ids.client, accountId: ids.account, skillCode: 'script_generator', skillVersion: 2, providerRequestId: 'req-1', model: 'qwen-max', inputTokens: 100, outputTokens: 50, estimatedCost: 0.25, billedPoints: 3, attempts: 2, durationMs: 10, status: 'completed', isDemo: false, createdAt: now },
    { id: crypto.randomUUID(), organizationId: ids.organization, runId: ids.run, runStepId: ids.runStepTwo, runType: 'production', userId: ids.owner, clientId: ids.client, accountId: ids.account, skillCode: 'quality_checker', skillVersion: 2, providerRequestId: null, model: 'qwen-plus', inputTokens: null, outputTokens: null, estimatedCost: null, billedPoints: 0, attempts: 1, durationMs: 20, status: 'failed', isDemo: false, createdAt: now },
  ]).run();

  db.insert(runs).values({
    id: ids.foreignRun, organizationId: ids.foreignOrganization, runType: 'test', subjectType: 'skill:private',
    subjectId: null, status: 'completed', startedAt: now, finishedAt: now, createdBy: ids.foreignOwner, isDemo: false, createdAt: now,
  }).run();
  db.insert(runSteps).values({
    id: ids.foreignStep, organizationId: ids.foreignOrganization, runId: ids.foreignRun, sequence: 0,
    stepCode: 'llm.invoke', status: 'succeeded', inputJson: null, outputJson: null, errorJson: null,
    startedAt: now, finishedAt: now, durationMs: 1, warningCodesJson: null, isDemo: false,
  }).run();
  db.insert(aiUsageLogs).values({
    id: crypto.randomUUID(), organizationId: ids.foreignOrganization, runId: ids.foreignRun, runStepId: ids.foreignStep,
    runType: 'test', userId: ids.foreignOwner, clientId: null, accountId: null, skillCode: 'private', skillVersion: 1,
    providerRequestId: null, model: 'foreign-model', inputTokens: 999, outputTokens: 999, estimatedCost: 99,
    billedPoints: 0, attempts: 1, durationMs: 1, status: 'completed', isDemo: false, createdAt: now,
  }).run();
});

afterEach(() => sqlite.close());

describe('delivery risk computation', () => {
  it('uses natural-month progress and configured high/medium tolerances', () => {
    const at = new Date(now);
    expect(calculateDeliveryRisk({ year: 2026, month: 9, planStatus: 'active', plannedCount: 10, publishedCount: 1 }, undefined, at)).toMatchObject({ riskLevel: 'high', periodState: 'current', periodProgressRate: 0.5 });
    expect(calculateDeliveryRisk({ year: 2026, month: 9, planStatus: 'active', plannedCount: 10, publishedCount: 3 }, undefined, at)).toMatchObject({ riskLevel: 'medium' });
    expect(calculateDeliveryRisk({ year: 2026, month: 9, planStatus: 'active', plannedCount: 10, publishedCount: 5 }, undefined, at)).toMatchObject({ riskLevel: 'low' });
  });

  it('marks past gaps without applying the current-day curve', () => {
    expect(calculateDeliveryRisk({ year: 2026, month: 8, planStatus: 'active', plannedCount: 10, publishedCount: 8 }, undefined, new Date(now))).toMatchObject({ periodState: 'overdue', periodProgressRate: 1, riskLevel: 'high' });
    expect(calculateDeliveryRisk({ year: 2026, month: 8, planStatus: 'inactive', plannedCount: 10, publishedCount: 8 }, undefined, new Date(now))).toMatchObject({ periodState: 'closed_with_gap', periodProgressRate: 1 });
  });
});

describe('operations facts, cost and trace', () => {
  it('computes fulfillment and role facts from persisted business rows', () => {
    const result = opsService(db, ids.organization, ids.owner, { now: () => new Date(now) }).overview({});
    expect(result.summary).toEqual({ planCount: 1, plannedCount: 10, publishedCount: 1, remainingCount: 9, highRiskPlanCount: 1 });
    expect(result.quota).toMatchObject({ usageRate: 0.9, alertLevel: 'critical_90' });
    expect(result.teamFacts.find((fact) => fact.kind === 'operator')).toMatchObject({ metrics: { clientCount: 1, contentsCreated: 4, publishedCount: 1, overdueCount: 1 } });
    expect(result.teamFacts.find((fact) => fact.kind === 'photographer')).toMatchObject({ metrics: { shootCount: 1, plannedItemCount: 1, completedItemCount: 1 } });
    expect(result.teamFacts.find((fact) => fact.kind === 'editor')).toMatchObject({ metrics: { submittedVersionCount: 1, averageHandlingMs: 3_600_000 } });
  });

  it('builds a client-scoped personal workbench for the assigned operator', () => {
    const result = opsService(db, ids.organization, ids.operator, { now: () => new Date(now) }).personalWorkbench();
    expect(result.counts).toMatchObject({ scriptsToWrite: 2, todayShoots: 1, dueSoon: 1, highRiskClients: 1 });
    expect(result.tasks.some((task) => task.urgency === 'overdue')).toBe(true);
    expect(result.highRiskClients[0]).toMatchObject({ clientName: '德祥楼', remainingCount: 9 });
  });

  it('keeps unknown cost explicit and excludes other organizations', () => {
    const result = opsService(db, ids.organization, ids.owner, { now: () => new Date(now) }).aiCost({ from: '2026-09-01', to: '2026-09-30' });
    expect(result.totals).toMatchObject({ callCount: 2, inputTokens: 100, outputTokens: 50, billedPoints: 3, estimatedCost: null, knownEstimatedCost: 0.25, unknownCostCalls: 1 });
    expect(result.groups.byModel.map((row) => row.key)).not.toContain('foreign-model');
  });

  it('returns a sanitized Run timeline, context, retries and business result', () => {
    const result = opsService(db, ids.organization, ids.owner, { now: () => new Date(now) }).runDetail(ids.run);
    expect(result.totals).toMatchObject({ retryCount: 1, estimatedCost: null, billedPoints: 3 });
    expect(result.contextSnapshots).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(JSON.stringify(result)).not.toContain('/Users/private');
    expect(JSON.stringify(result)).not.toContain('hidden');
    expect(result.errors).toHaveLength(1);
    expect(result.businessResult).toMatchObject({ type: 'script_generation', id: ids.publishedContent, status: 'PUBLISHED' });
  });

  it('enforces management permission, validates parameters and hides foreign Run IDs', () => {
    expectApiError(() => opsService(db, ids.organization, ids.operator).overview({}), 403, 'PERMISSION_DENIED');
    expectApiError(() => opsService(db, ids.organization, ids.viewer).aiCost({}), 403, 'PERMISSION_DENIED');
    expectApiError(() => opsService(db, ids.organization, ids.owner).runDetail(ids.foreignRun), 404, 'RUN_NOT_FOUND');
    expect(() => opsService(db, ids.organization, ids.owner).runDetail('bad')).toThrow();
  });
});
