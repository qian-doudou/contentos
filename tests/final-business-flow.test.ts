import Database from 'better-sqlite3';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '@/db/schema';
import {
  aiPointLedger, approvals, clientMembers, contentEmbeddings, contents, contentStatusLogs, editVersions,
  memories, monthlyPlans, organizationAiQuotas, organizations, performanceSnapshots, runSteps, runs,
  scriptVersions, skills, users,
} from '@/db/schema';
import { teamService } from '@/lib/team/service';
import { masterDataService } from '@/lib/master-data/service';
import { contentService } from '@/lib/content/service';
import { memoryService } from '@/lib/memory/service';
import { historyRetrievalService } from '@/lib/history/service';
import { aiPlannerService } from '@/lib/planner/service';
import { scriptApprovalService } from '@/lib/scripts/service';
import { shootService } from '@/lib/shoots/service';
import { editReviewService } from '@/lib/edits/service';
import { performanceService } from '@/lib/performance/service';
import { strategyReviewService } from '@/lib/strategy-review/service';
import { ApiError } from '@/lib/api/envelope';
import { getLlmConfig, OpenAICompatibleClient } from '@/lib/llm/client';
import { duplicateJudgeInputJsonSchema, duplicateJudgeOutputJsonSchema } from '@/lib/history/contracts';
import {
  plannerSkillInputJsonSchema, plannerSkillOutputJsonSchema,
  qualitySkillInputJsonSchema, qualitySkillOutputJsonSchema,
} from '@/lib/planner/contracts';
import { scriptGeneratorInputJsonSchema, scriptJsonOutputJsonSchema } from '@/lib/scripts/contracts';
import {
  performanceAnalyzerInputJsonSchema, performanceAnalyzerOutputJsonSchema,
  strategyPlannerInputJsonSchema, strategyPlannerOutputJsonSchema,
} from '@/lib/strategy-review/contracts';

const ids = {
  organization: '0198f744-8e18-7ae2-a780-52a0e20cf001', owner: '0198f744-8e18-7ae2-a780-52a0e20cf002',
  operator: '0198f744-8e18-7ae2-a780-52a0e20cf003', photographer: '0198f744-8e18-7ae2-a780-52a0e20cf004',
  editor: '0198f744-8e18-7ae2-a780-52a0e20cf005', viewer: '0198f744-8e18-7ae2-a780-52a0e20cf006',
} as const;
const now = '2026-09-10T08:00:00.000Z';
let sqlite: Database.Database;
let db: ReturnType<typeof drizzle<typeof schema>>;
const mockClient = () => new OpenAICompatibleClient(getLlmConfig({ LLM_API_KEY: '' }));

function expectApiError(action: () => unknown, status: number, code: string) {
  try { action(); throw new Error('Expected ApiError'); }
  catch (error) { expect(error).toBeInstanceOf(ApiError); expect(error).toMatchObject({ status, code }); }
}

beforeEach(() => {
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  for (const file of readdirSync(resolve('drizzle')).filter((name) => name.endsWith('.sql')).sort())
    sqlite.exec(readFileSync(resolve('drizzle', file), 'utf8').replaceAll('--> statement-breakpoint', ''));
  db = drizzle(sqlite, { schema });
  db.insert(organizations).values({
    id: ids.organization, name: '最终联调组织', status: 'active', isDemo: false, createdAt: now, updatedAt: now,
  }).run();
  db.insert(users).values([
    { id: ids.owner, organizationId: ids.organization, name: '负责人', role: 'owner', status: 'active', isDemo: false, createdAt: now, updatedAt: now },
    { id: ids.operator, organizationId: ids.organization, name: '运营', role: 'operator', status: 'active', isDemo: false, createdAt: now, updatedAt: now },
    { id: ids.photographer, organizationId: ids.organization, name: '摄影', role: 'photographer', status: 'active', isDemo: false, createdAt: now, updatedAt: now },
    { id: ids.editor, organizationId: ids.organization, name: '剪辑', role: 'editor', status: 'active', isDemo: false, createdAt: now, updatedAt: now },
    { id: ids.viewer, organizationId: ids.organization, name: '查看者', role: 'viewer', status: 'active', isDemo: false, createdAt: now, updatedAt: now },
  ]).run();
  const definitions = [
    { code: 'content_planner', name: '内容策划', input: plannerSkillInputJsonSchema, output: plannerSkillOutputJsonSchema, profile: 'standard', points: 2 },
    { code: 'duplicate_judge', name: '重复判断', input: duplicateJudgeInputJsonSchema, output: duplicateJudgeOutputJsonSchema, profile: 'light', points: 1 },
    { code: 'quality_checker', name: '质量门禁', input: qualitySkillInputJsonSchema, output: qualitySkillOutputJsonSchema, profile: 'light', points: 1 },
    { code: 'script_generator', name: '脚本生成', input: scriptGeneratorInputJsonSchema, output: scriptJsonOutputJsonSchema, profile: 'strong', points: 3 },
    { code: 'performance_analyzer', name: '表现分析', input: performanceAnalyzerInputJsonSchema, output: performanceAnalyzerOutputJsonSchema, profile: 'standard', points: 2 },
    { code: 'strategy_planner', name: '策略规划', input: strategyPlannerInputJsonSchema, output: strategyPlannerOutputJsonSchema, profile: 'strong', points: 3 },
  ] as const;
  db.insert(skills).values(definitions.map((definition) => ({
    id: crypto.randomUUID(), organizationId: null, code: definition.code, name: definition.name, description: '',
    systemPrompt: `ContentOS ${definition.name}`, userPromptTemplate: '{{input_json}}',
    inputSchemaJson: definition.input, outputSchemaJson: definition.output, modelProfile: definition.profile,
    pointCost: definition.points, enabled: true, currentVersion: 1, isDemo: false, createdAt: now, updatedAt: now,
  }))).run();
  db.insert(organizationAiQuotas).values({
    id: crypto.randomUUID(), organizationId: ids.organization, periodStart: '2026-01-01T00:00:00.000Z',
    periodEnd: '2027-01-01T00:00:00.000Z', quotaPoints: 100, usedPoints: 0,
    isDemo: false, createdAt: now, updatedAt: now,
  }).run();
});

afterEach(() => sqlite.close());

describe('final MVP business integration', () => {
  it('runs the real data, AI Mock, approval, production and review chain without bypassing services', async () => {
    expect(teamService(db, ids.organization, ids.owner).list().members).toHaveLength(5);
    const master = masterDataService(db, ids.organization, ids.owner);
    const client = master.createClient({
      clientName: '联调客户', industry: '餐饮', subIndustry: '铜锅涮', cooperationStatus: 'active',
      monthlyContentTarget: 8, ownerUserId: ids.owner, notes: '最终链路验证',
    });
    const brand = master.createBrand({
      clientId: client.id, brandName: '联调品牌', industry: '餐饮', subIndustry: '铜锅涮', city: '菏泽',
      brandPositioning: '本地真实铜锅涮', targetAudienceJson: ['本地食客'], coreProductsJson: ['手切羊肉', '铜锅涮'],
      coreSellingPointsJson: ['现切', '传统铜锅'], brandToneJson: ['真实'], forbiddenTopicsJson: ['虚假承诺'],
    });
    const store = master.createStore({ brandId: brand.id, storeName: '联调门店', city: '菏泽', district: '牡丹区' });
    const account = master.createAccount({
      clientId: client.id, brandId: brand.id, storeId: store.id, accountName: '联调老板IP', accountType: 'owner_ip',
      accountGoalJson: ['本地曝光', '团购转化'], contentStyleJson: ['真实', '自然'], forbiddenStyleJson: ['过度卖惨'],
    });
    db.insert(clientMembers).values([
      { id: crypto.randomUUID(), organizationId: ids.organization, clientId: client.id, userId: ids.operator, roleOverride: null, isDemo: false, createdAt: now },
      { id: crypto.randomUUID(), organizationId: ids.organization, clientId: client.id, userId: ids.viewer, roleOverride: null, isDemo: false, createdAt: now },
    ]).run();
    expect(masterDataService(db, ids.organization, ids.operator).clientDetail(client.id).client.id).toBe(client.id);
    expectApiError(() => masterDataService(db, ids.organization, ids.viewer).updateClient(client.id, { notes: '越权' }), 403, 'PERMISSION_DENIED');
    expectApiError(() => masterDataService(db, ids.organization, ids.photographer).updateClient(client.id, { notes: '越权' }), 403, 'PERMISSION_DENIED');

    const memory = memoryService(db, ids.organization, ids.owner, { now: () => new Date(now) });
    expect(memory.initialize({ accountId: account.id }).created).toHaveLength(6);
    const oldPrice = memory.createOrReplaceManual({
      accountId: account.id, scopeType: 'account', memoryKey: 'campaign.price', memoryType: 'temporary',
      valueJson: '旧价99元', summary: '旧价99元', importance: 5, confidence: 1,
    }).memory;
    const currentPrice = memory.createOrReplaceManual({
      accountId: account.id, scopeType: 'account', memoryKey: 'campaign.price', memoryType: 'temporary',
      valueJson: '当前价88元', summary: '当前价88元', importance: 5, confidence: 1,
    }).memory;
    const context = memory.buildContext({ accountId: account.id, focus: '团购价格' });
    expect(context.snapshot.memoryIds).toContain(currentPrice.id);
    expect(context.snapshot.memoryIds).not.toContain(oldPrice.id);

    const contentData = contentService(db, ids.organization, ids.owner, { now: () => new Date(now) });
    const plan = contentData.createPlan({
      accountId: account.id, year: 2026, month: 9, primaryGoal: 'conversion', plannedContentCount: 8,
      campaignNotes: '最终联调', keyProductsJson: ['手切羊肉'], contentMixJson: { persona: 25, product: 25, local: 25, conversion: 25 },
    });
    expect(contentData.planDetail(plan.id).plan.createdContentCount).toBe(0);

    const history = historyRetrievalService(db, ids.organization, ids.owner, { now: () => new Date(now) });
    const preview = history.previewImport({ format: 'json', dedupStrategy: 'external_id', payload: JSON.stringify([
      { account_id: account.id, external_id: 'history-1', title: '老板一天', content_type: 'persona', content_goal: 'exposure', topic: '开门准备', angle: '跟拍备菜', hook_text: '开门前忙什么', core_message: '真实备菜', published_at: '2026-08-01T04:00:00.000Z' },
      { account_id: account.id, external_id: 'history-2', title: '顾客如何选锅底', content_type: 'education', content_goal: 'trust', topic: '点单建议', angle: '顾客视角', hook_text: '第一次别点错', core_message: '按需求选择', published_at: '2026-08-02T04:00:00.000Z' },
    ]) });
    const imported = await history.commitImport({ batchId: preview.batch.id });
    expect(imported).toMatchObject({ contentIds: expect.any(Array), embedding: { indexed: 2, mode: 'fallback' } });
    const firstEmbedding = db.select().from(contentEmbeddings).where(eq(contentEmbeddings.contentId, imported.contentIds[0])).get()!;
    contentData.updateContent(imported.contentIds[0], { angle: '更新后的顾客视角' });
    expect(await history.syncContentEmbedding(imported.contentIds[0])).toMatchObject({ indexed: 1, mode: 'fallback' });
    expect(db.select().from(contentEmbeddings).where(eq(contentEmbeddings.id, firstEmbedding.id)).get()?.status).toBe('stale');

    const planner = aiPlannerService(db, ids.organization, ids.owner, { now: () => new Date(now), client: mockClient() });
    const session = await planner.generate({ accountId: account.id, plannedCount: 8, shootDate: '2026-09-12', primaryGoal: 'conversion', specialRequirements: '优先新角度' });
    expect(session.candidates).toHaveLength(8);
    expect(db.select().from(contents).where(eq(contents.monthlyPlanId, plan.id)).all()).toHaveLength(0);
    const reangled = await planner.reangle(session.id, session.candidates[0].id, { alternativeAngle: '从第一次到店的顾客决策切入' });
    expect(reangled.candidates.some((candidate) => candidate.revision === 2)).toBe(true);
    const selected = reangled.candidates.find((candidate) => candidate.status === 'active' && candidate.selectable);
    expect(selected, '至少应有一条可保存候选').toBeDefined();
    const persisted = planner.persist(session.id, { candidateIds: [selected!.id] });
    const contentId = persisted.contentIds[0];
    expect(db.select().from(contents).where(eq(contents.id, contentId)).get()?.status).toBe('IDEA');

    const scriptsOwner = scriptApprovalService(db, ids.organization, ids.owner, { now: () => new Date(now), client: mockClient() });
    const generatedScript = await scriptsOwner.generate(contentId, {});
    expect(generatedScript.workspace.versions[0]).toMatchObject({ versionNo: 1, sourceType: 'ai' });
    const v1Script = generatedScript.workspace.versions[0].scriptJson;
    const scriptsOperator = scriptApprovalService(db, ids.organization, ids.operator, { now: () => new Date(now) });
    const v2 = scriptsOperator.createManual(contentId, {
      scriptJson: { ...v1Script, hook: '运营修改的V2开场' }, sourceType: 'operator', changeSummary: '调整开场',
    });
    const submittedScript = scriptsOperator.submitApproval(contentId, {
      versionId: v2.content.currentScriptVersionId, reviewerType: 'internal_user', reviewerUserId: ids.owner,
    });
    const scriptApproval = submittedScript.workspace.approvals.find((item) => item.status === 'pending')!;
    expect(scriptsOwner.decide(scriptApproval.id, { status: 'approved', comment: '脚本通过' }).content.status).toBe('APPROVED');

    const shooting = shootService(db, ids.organization, ids.operator, { now: () => new Date(now) });
    const shoot = shooting.create({
      clientId: client.id, storeId: store.id, shootDate: '2026-09-12', startTime: '09:00', endTime: '11:00',
      operatorId: ids.operator, photographerId: ids.photographer, location: '联调门店', notes: '联调拍摄',
    });
    const scheduled = shooting.addContent(shoot.shoot.id, { contentId });
    const shot = shootService(db, ids.organization, ids.photographer, { now: () => new Date(now) })
      .actOnItem(shoot.shoot.id, scheduled.items[0].id, { action: 'shot' });
    expect(shot).toMatchObject({ shoot: { status: 'completed' }, items: [{ shootItemStatus: 'shot' }] });

    const editsOwner = editReviewService(db, ids.organization, ids.owner, { now: () => new Date(now) });
    editsOwner.assign(contentId, { editorId: ids.editor });
    const editsEditor = editReviewService(db, ids.organization, ids.editor, { now: () => new Date(now) });
    editsEditor.start(contentId, { reason: '开始初剪' });
    const editV1 = editsEditor.submitVersion(contentId, {
      assetType: 'url', assetUrl: 'https://media.example.test/final-v1.mp4', note: '成片V1',
      reviewerType: 'internal_user', reviewerUserId: ids.owner,
    });
    const editApprovalV1 = editV1.workspace.approvals.find((item) => item.status === 'pending')!;
    expect(editsOwner.decide(editApprovalV1.id, { status: 'changes_requested', comment: '补充锅底特写' }).content.status).toBe('REVISION');
    const editV2 = editsEditor.submitVersion(contentId, {
      assetType: 'local_reference', assetUrl: 'assets/final-v2.mp4', note: '成片V2已补镜头',
      reviewerType: 'internal_user', reviewerUserId: ids.owner,
    });
    const editApprovalV2 = editV2.workspace.approvals.find((item) => item.status === 'pending')!;
    expect(editsOwner.decide(editApprovalV2.id, { status: 'approved', comment: '成片通过' }).content.status).toBe('READY_TO_PUBLISH');

    const performance = performanceService(db, ids.organization, ids.operator, { now: () => new Date(now) });
    const publish = performance.createPublish(contentId, {
      platform: 'douyin', publishedAt: '2026-09-11T04:00:00.000Z', postUrl: 'https://www.douyin.com/video/integration', platformPostId: 'integration-post',
    }).publish;
    performance.addSnapshot(publish.id, { snapshotTime: '2026-09-12T04:00:00.000Z', views: 1000, likes: 50, comments: 5, shares: 5, favorites: 10, groupbuyClicks: 50, orders: 5, gmv: 500 });
    performance.addSnapshot(publish.id, { snapshotTime: '2026-09-13T04:00:00.000Z', views: 2000, likes: 100, comments: 10, shares: 10, favorites: 20, groupbuyClicks: 100, orders: 10, gmv: 1000 });
    expect(performance.contentPerformance(contentId).snapshots).toHaveLength(2);

    const strategy = strategyReviewService(db, ids.organization, ids.owner, { now: () => new Date(now), client: mockClient() });
    strategy.updateConfig({ minimumSampleSize: 1 });
    const period = { accountId: account.id, periodStart: '2026-09-01T00:00:00.000Z', periodEnd: '2026-09-30T23:59:59.999Z' };
    expect(strategy.aggregate(period).metrics).toMatchObject({ sampledContentCount: 1, totalViews: 2000 });
    const review = await strategy.generate(period);
    const confirmed = strategy.confirm(review.review.id, { savePerformancePattern: true });
    expect(confirmed).toMatchObject({ review: { status: 'confirmed' }, strategyMemoryId: expect.any(String), performanceMemoryId: expect.any(String) });
    expect(strategy.createNextPlan(review.review.id).plan).toMatchObject({ year: 2026, month: 10, status: 'inactive' });

    expect(db.select().from(contents).where(eq(contents.id, contentId)).get()).toMatchObject({ status: 'PUBLISHED', publishedAt: '2026-09-11T04:00:00.000Z' });
    expect(db.select().from(scriptVersions).where(eq(scriptVersions.contentId, contentId)).all()).toHaveLength(2);
    expect(db.select().from(editVersions).where(eq(editVersions.contentId, contentId)).all()).toHaveLength(2);
    expect(db.select().from(approvals).where(eq(approvals.contentId, contentId)).all()).toHaveLength(3);
    expect(db.select().from(performanceSnapshots).all()).toHaveLength(2);
    expect(db.select().from(contentStatusLogs).where(eq(contentStatusLogs.contentId, contentId)).all().map((log) => log.newStatus)).toEqual([
      'SCRIPTING', 'WAITING_APPROVAL', 'APPROVED', 'WAITING_SHOOT', 'SHOT', 'EDITING', 'WAITING_REVIEW', 'REVISION', 'WAITING_REVIEW', 'READY_TO_PUBLISH', 'PUBLISHED',
    ]);
    expect(db.select().from(aiPointLedger).all().map((entry) => entry.points).reduce((sum, points) => sum + points, 0)).toBe(10);
    expect(db.select().from(organizationAiQuotas).get()?.usedPoints).toBe(10);
    expect(db.select().from(memories).where(and(eq(memories.organizationId, ids.organization), eq(memories.sourceType, 'confirmed_strategy'))).all()).toHaveLength(1);
    expect(db.select().from(memories).where(and(eq(memories.organizationId, ids.organization), eq(memories.sourceType, 'confirmed_performance'))).all()).toHaveLength(1);
    expect(db.select().from(monthlyPlans).where(eq(monthlyPlans.accountId, account.id)).all()).toHaveLength(2);
    expect(db.select().from(runs).all().every((run) => ['completed', 'completed_with_warnings'].includes(run.status))).toBe(true);
    expect(db.select().from(runSteps).all().every((step) => step.status === 'succeeded')).toBe(true);
  });
});
