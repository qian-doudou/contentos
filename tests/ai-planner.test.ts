import Database from 'better-sqlite3';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '@/db/schema';
import {
  accounts, aiPointLedger, aiUsageLogs, brands, clientMembers, clients, contents, memories,
  monthlyPlans, organizationAiQuotas, organizations, plannerCandidates, plannerSessions,
  runSteps, runs, skills, stores, users,
} from '@/db/schema';
import { ApiError } from '@/lib/api/envelope';
import { shootingDifficultyByMethod, shootingRequirementsByMethod, storyStructureByInnovation } from '@/lib/creative/contracts';
import { duplicateJudgeInputJsonSchema, duplicateJudgeOutputJsonSchema } from '@/lib/history/contracts';
import { getLlmConfig, OpenAICompatibleClient } from '@/lib/llm/client';
import {
  plannerSkillInputJsonSchema, plannerSkillOutputJsonSchema,
  qualitySkillInputJsonSchema, qualitySkillOutputJsonSchema,
} from '@/lib/planner/contracts';
import { aiPlannerService } from '@/lib/planner/service';

const ids = {
  organization: '0198f744-8e18-7ae2-a780-52a0e20c9a01', foreignOrganization: '0198f744-8e18-7ae2-a780-52a0e20c9a02',
  owner: '0198f744-8e18-7ae2-a780-52a0e20c9a03', operator: '0198f744-8e18-7ae2-a780-52a0e20c9a04', viewer: '0198f744-8e18-7ae2-a780-52a0e20c9a05', foreignOwner: '0198f744-8e18-7ae2-a780-52a0e20c9a06',
  client: '0198f744-8e18-7ae2-a780-52a0e20c9a11', brand: '0198f744-8e18-7ae2-a780-52a0e20c9a12', store: '0198f744-8e18-7ae2-a780-52a0e20c9a13', account: '0198f744-8e18-7ae2-a780-52a0e20c9a14',
  foreignClient: '0198f744-8e18-7ae2-a780-52a0e20c9a21', foreignBrand: '0198f744-8e18-7ae2-a780-52a0e20c9a22', foreignStore: '0198f744-8e18-7ae2-a780-52a0e20c9a23', foreignAccount: '0198f744-8e18-7ae2-a780-52a0e20c9a24',
  plan: '0198f744-8e18-7ae2-a780-52a0e20c9a31', historical: '0198f744-8e18-7ae2-a780-52a0e20c9a32',
  plannerSkill: '0198f744-8e18-7ae2-a780-52a0e20c9a41', duplicateSkill: '0198f744-8e18-7ae2-a780-52a0e20c9a42', qualitySkill: '0198f744-8e18-7ae2-a780-52a0e20c9a43',
  quota: '0198f744-8e18-7ae2-a780-52a0e20c9a51', oldPrice: '0198f744-8e18-7ae2-a780-52a0e20c9a61', currentPrice: '0198f744-8e18-7ae2-a780-52a0e20c9a62',
} as const;
const now = '2026-09-08T08:00:00.000Z';
let sqlite: Database.Database;
let db: ReturnType<typeof drizzle<typeof schema>>;

function expectApiError(action: () => unknown, status: number, code: string) {
  return Promise.resolve().then(action).then(() => { throw new Error('Expected ApiError'); }, (error: unknown) => {
    expect(error).toBeInstanceOf(ApiError); expect(error).toMatchObject({ status, code });
  });
}

function hierarchy(organizationId: string, userId: string, clientId: string, brandId: string, storeId: string, accountId: string) {
  db.insert(clients).values({ id: clientId, organizationId, clientName: '德祥楼', industry: '餐饮', subIndustry: '铜锅涮羊肉',
    cooperationStatus: 'active', contractStart: null, contractEnd: null, monthlyContentTarget: 8, ownerUserId: userId,
    notes: '', status: 'active', isDemo: false, createdAt: now, updatedAt: now }).run();
  db.insert(brands).values({ id: brandId, organizationId, clientId, brandName: '德祥楼', industry: '餐饮', subIndustry: '铜锅涮羊肉', city: '菏泽',
    brandPositioning: '鲁西南特色铜锅涮羊肉', targetAudienceJson: ['菏泽本地食客'], coreProductsJson: ['手切羊肉', '铜锅涮'],
    coreSellingPointsJson: ['本地羊肉', '现切'], brandToneJson: ['真实'], forbiddenTopicsJson: ['虚假承诺'],
    status: 'active', isDemo: false, createdAt: now, updatedAt: now }).run();
  db.insert(stores).values({ id: storeId, organizationId, brandId, storeName: '总店', city: '菏泽', district: '', address: '', storeType: '',
    status: 'active', isDemo: false, createdAt: now, updatedAt: now }).run();
  db.insert(accounts).values({ id: accountId, organizationId, clientId, brandId, storeId, platform: 'douyin', accountName: '德祥楼老板IP',
    accountType: 'owner_ip', accountGoalJson: ['本地曝光'], contentStyleJson: ['真实', '自然'], forbiddenStyleJson: ['过度卖惨'], followers: null,
    status: 'active', isDemo: false, createdAt: now, updatedAt: now }).run();
}

function addContent(id: string, status: 'IDEA' | 'PUBLISHED', title: string, contentType: 'persona' | 'product' = 'persona') {
  db.insert(contents).values({ id, organizationId: ids.organization, clientId: ids.client, brandId: ids.brand, storeId: ids.store,
    accountId: ids.account, monthlyPlanId: status === 'IDEA' ? ids.plan : null, title, contentType, contentGoal: 'exposure',
    topic: '老板日常与选品标准', angle: '老板在后厨展示当天现切纹理', hookType: 'identity', hookText: '老板开门前先做什么',
    coreMessage: '本地羊肉当天现切', productText: '', ctaType: '', localElement: '', peopleJson: [], status, priority: 'normal',
    operatorId: ids.owner, plannedPublishDate: null, publishedAt: status === 'PUBLISHED' ? '2026-08-01T00:00:00.000Z' : null,
    deadline: null, externalId: null, importDedupKey: null, importBatchId: null, currentScriptVersionId: null,
    activeApprovedScriptVersionId: null, currentEditVersionId: null, activeApprovedEditVersionId: null, aiReviewStatus: null,
    createdBy: ids.owner, isDemo: false, createdAt: now, updatedAt: now }).run();
}

function service(userId: string = ids.owner, client = new OpenAICompatibleClient(getLlmConfig({}))) {
  return aiPlannerService(db, ids.organization, userId, { now: () => new Date(now), client });
}

class OldPriceClient extends OpenAICompatibleClient {
  constructor() { super(getLlmConfig({})); }
  override async complete(input: Parameters<OpenAICompatibleClient['complete']>[0]) {
    if (input.messages[0].content.includes('AI Content Planner')) {
      const text = JSON.stringify({ planning_summary: '价格约束测试', items: [{ title: '99元吃遍招牌菜', content_type: 'conversion', content_goal: 'conversion',
        topic: '99元套餐', angle: '用99元价格吸引到店', hook_type: 'price', hook_idea: '99元到底能吃什么',
        core_message: '99元可享受手切羊肉', recommended_reason: '明确价格更容易转化' }] });
      const result = await super.complete({ ...input, mockText: text });
      return { ...result, text };
    }
    return super.complete(input);
  }
}

class InvalidPlannerClient extends OpenAICompatibleClient {
  constructor() { super(getLlmConfig({})); }
  override async complete(input: Parameters<OpenAICompatibleClient['complete']>[0]) {
    if (input.messages[0].content.includes('AI Content Planner')) {
      const result = await super.complete({ ...input, mockText: '{not-json' });
      return { ...result, text: '{not-json' };
    }
    return super.complete(input);
  }
}

beforeEach(() => {
  sqlite = new Database(':memory:'); sqlite.pragma('foreign_keys = ON');
  for (const file of readdirSync(resolve('drizzle')).filter((name) => name.endsWith('.sql')).sort())
    sqlite.exec(readFileSync(resolve('drizzle', file), 'utf8').replaceAll('--> statement-breakpoint', ''));
  db = drizzle(sqlite, { schema });
  db.insert(organizations).values([
    { id: ids.organization, name: '组织A', status: 'active', isDemo: false, createdAt: now, updatedAt: now },
    { id: ids.foreignOrganization, name: '组织B', status: 'active', isDemo: false, createdAt: now, updatedAt: now },
  ]).run();
  db.insert(users).values([
    { id: ids.owner, organizationId: ids.organization, name: '负责人', role: 'owner', status: 'active', isDemo: false, createdAt: now, updatedAt: now },
    { id: ids.operator, organizationId: ids.organization, name: '运营', role: 'operator', status: 'active', isDemo: false, createdAt: now, updatedAt: now },
    { id: ids.viewer, organizationId: ids.organization, name: '查看者', role: 'viewer', status: 'active', isDemo: false, createdAt: now, updatedAt: now },
    { id: ids.foreignOwner, organizationId: ids.foreignOrganization, name: 'B负责人', role: 'owner', status: 'active', isDemo: false, createdAt: now, updatedAt: now },
  ]).run();
  hierarchy(ids.organization, ids.owner, ids.client, ids.brand, ids.store, ids.account);
  hierarchy(ids.foreignOrganization, ids.foreignOwner, ids.foreignClient, ids.foreignBrand, ids.foreignStore, ids.foreignAccount);
  db.insert(clientMembers).values([
    { id: crypto.randomUUID(), organizationId: ids.organization, clientId: ids.client, userId: ids.operator, roleOverride: null, isDemo: false, createdAt: now },
    { id: crypto.randomUUID(), organizationId: ids.organization, clientId: ids.client, userId: ids.viewer, roleOverride: null, isDemo: false, createdAt: now },
  ]).run();
  db.insert(monthlyPlans).values({ id: ids.plan, organizationId: ids.organization, accountId: ids.account, year: 2026, month: 9,
    primaryGoal: 'exposure', plannedContentCount: 4, campaignNotes: '', keyProductsJson: ['手切羊肉'], contentMixJson: { persona: 50, product: 50 },
    status: 'active', createdBy: ids.owner, isDemo: false, createdAt: now, updatedAt: now }).run();
  addContent(ids.historical, 'PUBLISHED', '老板的一天从选食材开始');
  addContent(crypto.randomUUID(), 'IDEA', '已有计划内容');
  db.insert(skills).values([
    { id: ids.plannerSkill, organizationId: null, code: 'content_planner', name: '内容策划器', description: '', systemPrompt: '你是 ContentOS AI Content Planner。',
      userPromptTemplate: '{{input_json}}', inputSchemaJson: plannerSkillInputJsonSchema, outputSchemaJson: plannerSkillOutputJsonSchema,
      modelProfile: 'standard', pointCost: 2, enabled: true, currentVersion: 2, isDemo: false, createdAt: now, updatedAt: now },
    { id: ids.duplicateSkill, organizationId: null, code: 'duplicate_judge', name: '重复判断', description: '', systemPrompt: '重复度判定',
      userPromptTemplate: '{{input_json}}', inputSchemaJson: duplicateJudgeInputJsonSchema, outputSchemaJson: duplicateJudgeOutputJsonSchema,
      modelProfile: 'light', pointCost: 1, enabled: true, currentVersion: 2, isDemo: false, createdAt: now, updatedAt: now },
    { id: ids.qualitySkill, organizationId: null, code: 'quality_checker', name: '质量检查器', description: '', systemPrompt: '质量检查器',
      userPromptTemplate: '{{input_json}}', inputSchemaJson: qualitySkillInputJsonSchema, outputSchemaJson: qualitySkillOutputJsonSchema,
      modelProfile: 'light', pointCost: 1, enabled: true, currentVersion: 2, isDemo: false, createdAt: now, updatedAt: now },
  ]).run();
  db.insert(organizationAiQuotas).values({ id: ids.quota, organizationId: ids.organization, periodStart: '2026-01-01T00:00:00.000Z',
    periodEnd: '2027-01-01T00:00:00.000Z', quotaPoints: 100, usedPoints: 0, isDemo: false, createdAt: now, updatedAt: now }).run();
  db.insert(memories).values([
    { id: ids.oldPrice, organizationId: ids.organization, scopeType: 'account', scopeId: ids.account, memoryKey: 'campaign.current_price', memoryType: 'temporary',
      valueJson: '99元', summary: '旧团购价99元', importance: 5, confidence: 1, sourceType: 'manual', sourceId: null,
      effectiveAt: '2026-07-01T00:00:00.000Z', expiresAt: null, status: 'superseded', supersedesMemoryId: null, createdBy: ids.owner, isDemo: false, createdAt: now },
    { id: ids.currentPrice, organizationId: ids.organization, scopeType: 'account', scopeId: ids.account, memoryKey: 'campaign.current_price', memoryType: 'temporary',
      valueJson: '88元', summary: '当前团购价88元', importance: 5, confidence: 1, sourceType: 'manual', sourceId: null,
      effectiveAt: '2026-09-01T00:00:00.000Z', expiresAt: null, status: 'active', supersedesMemoryId: ids.oldPrice, createdBy: ids.owner, isDemo: false, createdAt: now },
  ]).run();
});

afterEach(() => sqlite.close());

describe('AI Content Planner', () => {
  it('calculates gaps, traces the production workflow, writes selected only, then bills once', async () => {
    const page = service().pageData();
    expect(page.accounts[0].gaps).toEqual(expect.arrayContaining([
      expect.objectContaining({ contentType: 'persona', targetCount: 2, actualCount: 1, gap: 1 }),
      expect.objectContaining({ contentType: 'product', targetCount: 2, actualCount: 0, gap: 2 }),
    ]));
    const before = db.select().from(contents).all().length;
    const result = await service().generate({ accountId: ids.account, plannedCount: 3, shootDate: null, primaryGoal: 'conversion', specialRequirements: null });
    expect(result).toMatchObject({ status: 'awaiting_selection', run: { status: 'manual_review_required' }, plannedCount: 3 });
    expect(result.candidates).toHaveLength(3);
    expect(result.candidates[0].creativeBrief).toMatchObject({
      sellingPoint: expect.any(String), creativeConcept: expect.any(String), audienceMoment: expect.any(String),
      targetDurationSeconds: expect.any(Number), shootingMethod: expect.any(String), innovationLevel: expect.any(String),
    });
    expect(result.candidates[0].creativeBrief.hookOptions.length).toBeGreaterThanOrEqual(2);
    expect(result.candidates[0].creativeBrief.sellingPointOptions.length).toBeGreaterThanOrEqual(2);
    expect(result.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        contentType: 'product',
        title: expect.stringContaining('手切羊肉'),
        coreMessage: expect.stringContaining('手切羊肉'),
      }),
    ]));
    expect(db.select().from(contents).all()).toHaveLength(before);
    expect(db.select().from(runSteps).where(eq(runSteps.runId, result.runId)).all().map((item) => [item.stepCode, item.status])).toEqual([
      ['context_build', 'succeeded'], ['content_planner', 'succeeded'], ['candidate_retrieval', 'succeeded'],
      ['candidate_duplicate_judge', 'succeeded'], ['quality_check', 'succeeded'], ['persist_selected_contents', 'pending'],
    ]);
    expect(db.select().from(aiUsageLogs).where(eq(aiUsageLogs.runId, result.runId)).all().every((item) => item.billedPoints === 0)).toBe(true);
    const choice = result.candidates.find((item) => item.selectable)!;
    const saved = service().persist(result.id, { candidateIds: [choice.id] });
    expect(saved.contentIds).toHaveLength(1);
    expect(db.select().from(contents).all()).toHaveLength(before + 1);
    expect(db.select().from(organizationAiQuotas).where(eq(organizationAiQuotas.id, ids.quota)).get()?.usedPoints).toBe(2);
    expect(db.select().from(aiPointLedger).where(eq(aiPointLedger.runId, result.runId)).all()).toHaveLength(1);
    expect(db.select().from(runs).where(eq(runs.id, result.runId)).get()?.status).toBe('completed');
  });

  it('persists user-adjusted duration, shooting setup, innovation, selling point and hook for script generation', async () => {
    const result = await service().generate({
      accountId: ids.account, plannedCount: 3, shootDate: null, primaryGoal: 'trust',
      specialRequirements: '创意强度：分别提供稳妥型、创新型和突破型。\n出镜条件：ai_recommended。',
    });
    const candidate = result.candidates.find(item => item.selectable)!;
    const hook = candidate.creativeBrief.hookOptions[1];
    const sellingPoint = candidate.creativeBrief.sellingPointOptions[1];
    const method = 'interview' as const;
    const level = 'bold' as const;
    const creativeBrief = {
      ...candidate.creativeBrief,
      targetDurationSeconds: 60,
      shootingMethod: method,
      shootingDifficulty: shootingDifficultyByMethod[method],
      shootingRequirements: shootingRequirementsByMethod[method],
      onCameraRole: 'staff' as const,
      innovationLevel: level,
      storyStructure: storyStructureByInnovation[level],
      sellingPoint,
      hookType: hook.type,
      hookText: hook.text,
    };

    const saved = service().persist(result.id, {
      candidateIds: [candidate.id], candidateOverrides: [{ candidateId: candidate.id, creativeBrief }],
    });
    const content = db.select().from(contents).where(eq(contents.id, saved.contentIds[0])).get()!;
    expect(content).toMatchObject({
      hookType: hook.type, hookText: hook.text, coreMessage: sellingPoint, productText: sellingPoint,
      creativeBriefJson: expect.objectContaining({
        targetDurationSeconds: 60, shootingMethod: 'interview', shootingDifficulty: 'standard',
        onCameraRole: 'staff', innovationLevel: 'bold', sellingPoint, hookText: hook.text,
      }),
    });
  });

  it('rejects tampered creative fields without finalizing or billing the planning session', async () => {
    const result = await service().generate({ accountId: ids.account, plannedCount: 1, shootDate: null, primaryGoal: 'trust', specialRequirements: null });
    const candidate = result.candidates[0];
    await expectApiError(() => service().persist(result.id, {
      candidateIds: [candidate.id],
      candidateOverrides: [{ candidateId: candidate.id, creativeBrief: { ...candidate.creativeBrief, creativeConcept: '前端擅自替换的创意' } }],
    }), 400, 'INVALID_CREATIVE_OVERRIDE');
    expect(db.select().from(plannerSessions).where(eq(plannerSessions.id, result.id)).get()?.status).toBe('awaiting_selection');
    expect(db.select().from(organizationAiQuotas).where(eq(organizationAiQuotas.id, ids.quota)).get()?.usedPoints).toBe(0);
  });

  it('generates distinct effect-and-topic choices for a refreshed direction batch', async () => {
    const first = await service().generate({
      accountId: ids.account, plannedCount: 3, shootDate: null, primaryGoal: 'conversion',
      specialRequirements: 'AI 方向批次：1。自主决定每条候选的视频效果与重点内容。',
    });
    const refreshed = await service().generate({
      accountId: ids.account, plannedCount: 3, shootDate: null, primaryGoal: 'conversion',
      specialRequirements: `AI 方向批次：2。避开上一批：${first.candidates.map(candidate => candidate.title).join('；')}`,
    });

    expect(new Set(first.candidates.map(candidate => candidate.contentGoal)).size).toBe(3);
    expect(new Set(refreshed.candidates.map(candidate => candidate.contentGoal)).size).toBe(3);
    expect(refreshed.candidates.map(candidate => candidate.title))
      .not.toEqual(first.candidates.map(candidate => candidate.title));
    expect(db.select().from(organizationAiQuotas).where(eq(organizationAiQuotas.id, ids.quota)).get()?.usedPoints).toBe(0);
  });

  it('blocks high-duplicate selection and preserves candidates until explicit save', async () => {
    const before = db.select().from(contents).all().length;
    db.update(contents).set({
      title: '门店负责人开始一天工作前先做什么', topic: '负责人日常与服务标准',
      angle: '跟拍负责人开始一天工作前的真实准备过程', hookText: '你看到的是开门营业，老板先做的其实是这一件事。',
      coreMessage: '用真实现场呈现手切羊肉，不使用未经确认的价格或活动。',
    }).where(eq(contents.id, ids.historical)).run();
    const result = await service().generate({ accountId: ids.account, plannedCount: 1, shootDate: null, primaryGoal: 'exposure', specialRequirements: null });
    const candidate = result.candidates[0];
    expect(candidate).toMatchObject({ duplicateLevel: 'high', selectable: false });
    await expectApiError(() => service().persist(result.id, { candidateIds: [candidate.id] }), 409, 'CANDIDATE_NOT_SELECTABLE');
    expect(db.select().from(contents).all()).toHaveLength(before);
    expect(db.select().from(organizationAiQuotas).where(eq(organizationAiQuotas.id, ids.quota)).get()?.usedPoints).toBe(0);
  });

  it('removes an old unverified price, and re-angle creates a new version with a fresh dedup pass', async () => {
    const result = await service(ids.owner, new OldPriceClient()).generate({ accountId: ids.account, plannedCount: 1,
      shootDate: '2026-09-20', primaryGoal: 'conversion', specialRequirements: null });
    expect(JSON.stringify(result.candidates[0])).not.toContain('99元');
    expect(JSON.stringify(result.candidates[0])).toContain('unverified_dynamic_fact');
    const oldId = result.candidates[0].id;
    const changed = await service().reangle(result.id, oldId, { alternativeAngle: '从顾客第一次到店的决策视角' });
    expect(changed.candidates[0]).toMatchObject({ revision: 2, angle: '从顾客第一次到店的决策视角' });
    expect(changed.candidates[0].id).not.toBe(oldId);
    expect(db.select().from(plannerCandidates).where(eq(plannerCandidates.id, oldId)).get()?.status).toBe('replaced');
    expect(db.select().from(runSteps).where(and(eq(runSteps.runId, result.runId), eq(runSteps.stepCode, 'candidate_retrieval'))).all()).toHaveLength(2);
    expect(db.select().from(organizationAiQuotas).where(eq(organizationAiQuotas.id, ids.quota)).get()?.usedPoints).toBe(0);
  });

  it('does not bill failed LLM output and enforces organization/role boundaries', async () => {
    const before = db.select().from(contents).all().length;
    await expectApiError(() => service(ids.owner, new InvalidPlannerClient()).generate({ accountId: ids.account, plannedCount: 1,
      shootDate: null, primaryGoal: 'exposure', specialRequirements: null }), 502, 'LLM_CALL_FAILED');
    expect(db.select().from(organizationAiQuotas).where(eq(organizationAiQuotas.id, ids.quota)).get()?.usedPoints).toBe(0);
    expect(db.select().from(aiPointLedger).all()).toHaveLength(0);
    expect(db.select().from(contents).all()).toHaveLength(before);
    expect(db.select().from(plannerSessions).get()?.status).toBe('failed');
    await expectApiError(() => service(ids.viewer).generate({ accountId: ids.account, plannedCount: 1, shootDate: null,
      primaryGoal: 'exposure', specialRequirements: null }), 403, 'PERMISSION_DENIED');
    await expectApiError(() => service().generate({ accountId: ids.foreignAccount, plannedCount: 1, shootDate: null,
      primaryGoal: 'exposure', specialRequirements: null }), 404, 'NOT_FOUND');
  });

  it('rejects invalid inputs and insufficient quota before creating a Run', async () => {
    await expect(service().generate({ accountId: ids.account, plannedCount: 21, shootDate: null,
      primaryGoal: 'exposure', specialRequirements: null })).rejects.toHaveProperty('issues');
    db.update(organizationAiQuotas).set({ usedPoints: 99 }).where(eq(organizationAiQuotas.id, ids.quota)).run();
    const before = db.select().from(runs).all().length;
    await expectApiError(() => service().generate({ accountId: ids.account, plannedCount: 1, shootDate: null,
      primaryGoal: 'exposure', specialRequirements: null }), 402, 'AI_QUOTA_EXCEEDED');
    expect(db.select().from(runs).all()).toHaveLength(before);
  });
});
