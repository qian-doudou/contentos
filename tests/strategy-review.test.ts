import Database from 'better-sqlite3';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '@/db/schema';
import {
  aiPointLedger,
  aiUsageLogs,
  clientMembers,
  contents,
  contextSnapshots,
  editVersions,
  memories,
  monthlyPlans,
  organizationAiQuotas,
  organizations,
  runs,
  skills,
  strategyReviews,
  users,
} from '@/db/schema';
import { ApiError } from '@/lib/api/envelope';
import { contentService } from '@/lib/content/service';
import { masterDataService } from '@/lib/master-data/service';
import { memoryService } from '@/lib/memory/service';
import { performanceService } from '@/lib/performance/service';
import { getLlmConfig, OpenAICompatibleClient, type LlmCompletion } from '@/lib/llm/client';
import {
  performanceAnalyzerInputJsonSchema,
  performanceAnalyzerOutputJsonSchema,
  strategyPlannerInputJsonSchema,
  strategyPlannerOutputJsonSchema,
  strategyPlannerOutputSchema,
} from '@/lib/strategy-review/contracts';
import { aggregateStrategyMetrics, strategyReviewService } from '@/lib/strategy-review/service';

const ids = {
  organization: '0198f744-8e18-7ae2-a780-52a0e20cdf01',
  owner: '0198f744-8e18-7ae2-a780-52a0e20cdf02',
  operator: '0198f744-8e18-7ae2-a780-52a0e20cdf03',
  viewer: '0198f744-8e18-7ae2-a780-52a0e20cdf04',
  analyzer: '0198f744-8e18-7ae2-a780-52a0e20cdf05',
  planner: '0198f744-8e18-7ae2-a780-52a0e20cdf06',
  quota: '0198f744-8e18-7ae2-a780-52a0e20cdf07',
} as const;
const now = '2026-10-01T02:00:00.000Z';
const period = {
  periodStart: '2026-09-01T00:00:00.000Z',
  periodEnd: '2026-09-30T23:59:59.999Z',
};

let sqlite: Database.Database;
let db: ReturnType<typeof drizzle<typeof schema>>;
let hierarchy: ReturnType<typeof makeHierarchy>;

function expectApiError(action: () => unknown, status: number, code: string) {
  try {
    action();
    throw new Error('Expected ApiError');
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status, code });
  }
}

function makeHierarchy() {
  const master = masterDataService(db, ids.organization, ids.owner);
  const client = master.createClient({ clientName: '德祥楼', industry: '餐饮' });
  const brand = master.createBrand({ clientId: client.id, brandName: '德祥楼', city: '菏泽' });
  const store = master.createStore({ brandId: brand.id, storeName: '总店' });
  const account = master.createAccount({
    clientId: client.id,
    brandId: brand.id,
    storeId: store.id,
    accountName: '德祥楼老板IP',
  });
  return { client, brand, store, account };
}

function addPublished(input: {
  title: string;
  publishedAt: string;
  contentType: 'product' | 'conversion';
  hookType: 'question' | 'result';
  contentGoal: 'trust' | 'gmv';
  snapshots: Array<{ time: string; views: number; clicks: number; gmv: number }>;
}) {
  const content = contentService(db, ids.organization, ids.owner).createContent({
    accountId: hierarchy.account.id,
    title: input.title,
    contentType: input.contentType,
    contentGoal: input.contentGoal,
    hookType: input.hookType,
    topic: '本地门店表现',
    angle: `角度：${input.title}`,
    coreMessage: `核心信息：${input.title}`,
    operatorId: ids.operator,
  });
  const editId = crypto.randomUUID();
  db.insert(editVersions).values({
    id: editId,
    organizationId: ids.organization,
    contentId: content.id,
    versionNo: 1,
    assetUrl: 'https://example.test/video.mp4',
    assetType: 'url',
    note: '测试成片',
    createdBy: ids.owner,
    isDemo: false,
    createdAt: now,
  }).run();
  db.update(contents).set({ status: 'READY_TO_PUBLISH', activeApprovedEditVersionId: editId, currentEditVersionId: editId })
    .where(and(eq(contents.organizationId, ids.organization), eq(contents.id, content.id))).run();
  const publish = performanceService(db, ids.organization, ids.owner, { now: () => new Date(now) }).createPublish(content.id, {
    platform: 'douyin',
    publishedAt: input.publishedAt,
    postUrl: `https://www.douyin.com/video/${content.id}`,
    platformPostId: content.id,
  }).publish;
  for (const item of input.snapshots)
    performanceService(db, ids.organization, ids.owner, { now: () => new Date(now) }).addSnapshot(publish.id, {
      snapshotTime: item.time,
      views: item.views,
      likes: 0,
      comments: 0,
      shares: 0,
      favorites: 0,
      groupbuyClicks: item.clicks,
      gmv: item.gmv,
    });
  return content;
}

function service(userId: string = ids.owner) {
  return strategyReviewService(db, ids.organization, userId, {
    now: () => new Date(now),
    client: new OpenAICompatibleClient(getLlmConfig({ LLM_API_KEY: '' })),
  });
}

class InvalidMixClient extends OpenAICompatibleClient {
  override async complete(input: Parameters<OpenAICompatibleClient['complete']>[0]): Promise<LlmCompletion> {
    const strategy = input.messages[0]?.content.includes('策略');
    return {
      text: JSON.stringify(strategy ? {
        next_period_goal: 'gmv',
        recommended_content_mix: { product: 60, conversion: 30 },
        keep: [], reduce: [], test: [], next_actions: [],
      } : {
        summary: '程序事实解释', effective_patterns: [], weak_patterns: [], observations: [],
        sample_size_notes: '两条样本', confidence: 0.4,
      }),
      providerRequestId: strategy ? 'invalid-strategy' : 'valid-analysis',
      model: strategy ? 'qwen-strong' : 'qwen-standard',
      inputTokens: 100,
      outputTokens: 50,
      durationMs: 5,
      attempts: 1,
      mode: 'live',
    };
  }
}

beforeEach(() => {
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  for (const file of readdirSync(resolve('drizzle')).filter((name) => name.endsWith('.sql')).sort())
    sqlite.exec(readFileSync(resolve('drizzle', file), 'utf8').replaceAll('--> statement-breakpoint', ''));
  db = drizzle(sqlite, { schema });
  db.insert(organizations).values({
    id: ids.organization, name: '组织', status: 'active', isDemo: false, createdAt: now, updatedAt: now,
  }).run();
  db.insert(users).values([
    { id: ids.owner, organizationId: ids.organization, name: '负责人', role: 'owner', status: 'active', isDemo: false, createdAt: now, updatedAt: now },
    { id: ids.operator, organizationId: ids.organization, name: '运营', role: 'operator', status: 'active', isDemo: false, createdAt: now, updatedAt: now },
    { id: ids.viewer, organizationId: ids.organization, name: '查看者', role: 'viewer', status: 'active', isDemo: false, createdAt: now, updatedAt: now },
  ]).run();
  hierarchy = makeHierarchy();
  db.insert(clientMembers).values([
    { id: crypto.randomUUID(), organizationId: ids.organization, clientId: hierarchy.client.id, userId: ids.operator, roleOverride: null, isDemo: false, createdAt: now },
    { id: crypto.randomUUID(), organizationId: ids.organization, clientId: hierarchy.client.id, userId: ids.viewer, roleOverride: null, isDemo: false, createdAt: now },
  ]).run();
  db.insert(monthlyPlans).values({
    id: crypto.randomUUID(), organizationId: ids.organization, accountId: hierarchy.account.id,
    year: 2026, month: 9, primaryGoal: 'gmv', plannedContentCount: 8,
    campaignNotes: '九月计划', keyProductsJson: [], contentMixJson: { product: 50, conversion: 50 },
    status: 'active', createdBy: ids.owner, isDemo: false, createdAt: now, updatedAt: now,
  }).run();
  db.insert(skills).values([
    {
      id: ids.analyzer, organizationId: null, code: 'performance_analyzer', name: '表现分析器', description: '',
      systemPrompt: '解释程序指标，只返回 JSON', userPromptTemplate: '{{input_json}}',
      inputSchemaJson: performanceAnalyzerInputJsonSchema, outputSchemaJson: performanceAnalyzerOutputJsonSchema,
      modelProfile: 'standard', pointCost: 2, enabled: true, currentVersion: 2, isDemo: false, createdAt: now, updatedAt: now,
    },
    {
      id: ids.planner, organizationId: null, code: 'strategy_planner', name: '策略规划器', description: '',
      systemPrompt: '给出下一周期策略，只返回 JSON', userPromptTemplate: '{{input_json}}',
      inputSchemaJson: strategyPlannerInputJsonSchema, outputSchemaJson: strategyPlannerOutputJsonSchema,
      modelProfile: 'strong', pointCost: 3, enabled: true, currentVersion: 2, isDemo: false, createdAt: now, updatedAt: now,
    },
  ]).run();
  db.insert(organizationAiQuotas).values({
    id: ids.quota, organizationId: ids.organization,
    periodStart: '2026-01-01T00:00:00.000Z', periodEnd: '2027-01-01T00:00:00.000Z',
    quotaPoints: 100, usedPoints: 0, isDemo: false, createdAt: now, updatedAt: now,
  }).run();
});

afterEach(() => sqlite.close());

describe('compute-first strategy metrics', () => {
  it('uses one latest snapshot per published content and computes exact aggregates in code', () => {
    addPublished({
      title: '产品高位', publishedAt: '2026-09-10T04:00:00.000Z', contentType: 'product', hookType: 'question', contentGoal: 'trust',
      snapshots: [
        { time: '2026-09-11T00:00:00.000Z', views: 100, clicks: 10, gmv: 200 },
        { time: '2026-09-20T00:00:00.000Z', views: 200, clicks: 20, gmv: 400 },
      ],
    });
    addPublished({
      title: '转化低位', publishedAt: '2026-09-20T04:00:00.000Z', contentType: 'conversion', hookType: 'result', contentGoal: 'gmv',
      snapshots: [{ time: '2026-09-25T00:00:00.000Z', views: 100, clicks: 5, gmv: 100 }],
    });
    const result = aggregateStrategyMetrics(db, ids.organization, hierarchy.account.id, period.periodStart, period.periodEnd, now);
    expect(result).toMatchObject({
      publishedContentCount: 2,
      sampledContentCount: 2,
      viewsSampleCount: 2,
      totalViews: 300,
      averageViews: 150,
      medianViews: 150,
    });
    expect(result.groupbuyCtr).toBeCloseTo(25 / 300);
    expect(result.gmvPer1000Views).toBeCloseTo((500 / 300) * 1000);
    expect(result.topContents.map((item) => item.title)).toEqual(['产品高位', '转化低位']);
    expect(result.bottomContents.map((item) => item.title)).toEqual(['转化低位', '产品高位']);
    expect(result.byContentType).toEqual(expect.arrayContaining([
      expect.objectContaining({ value: 'product', contentCount: 1, averageViews: 200 }),
      expect.objectContaining({ value: 'conversion', contentCount: 1, averageViews: 100 }),
    ]));
    expect(result.publishFrequency.averageIntervalDays).toBe(10);
  });

  it('returns empty deterministic facts and never invokes AI without snapshots', async () => {
    const preview = service().aggregate({ accountId: hierarchy.account.id, ...period });
    expect(preview).toMatchObject({ canGenerate: false, metrics: { publishedContentCount: 0, sampledContentCount: 0, totalViews: 0 } });
    await expect(service().generate({ accountId: hierarchy.account.id, ...period }))
      .rejects.toMatchObject({ status: 409, code: 'INSUFFICIENT_PERFORMANCE_DATA' });
    expect(db.select().from(runs).all()).toEqual([]);
    expect(db.select().from(aiUsageLogs).all()).toEqual([]);
    expect(db.select().from(aiPointLedger).all()).toEqual([]);
  });
});

describe('AI review confirmation gates', () => {
  beforeEach(() => {
    addPublished({
      title: '样本一', publishedAt: '2026-09-10T04:00:00.000Z', contentType: 'product', hookType: 'question', contentGoal: 'trust',
      snapshots: [{ time: '2026-09-20T00:00:00.000Z', views: 200, clicks: 20, gmv: 400 }],
    });
    addPublished({
      title: '样本二', publishedAt: '2026-09-20T04:00:00.000Z', contentType: 'conversion', hookType: 'result', contentGoal: 'gmv',
      snapshots: [{ time: '2026-09-25T00:00:00.000Z', views: 100, clicks: 5, gmv: 100 }],
    });
  });

  it('separates facts from AI, bills only after persistence, and writes no Memory before confirmation', async () => {
    const generated = await service(ids.operator).generate({ accountId: hierarchy.account.id, ...period });
    expect(generated.review.status).toBe('draft');
    expect(generated.review.metricsSnapshotJson.totalViews).toBe(300);
    expect(generated.billedPoints).toBe(5);
    expect(db.select().from(memories).all()).toEqual([]);
    expect(db.select().from(aiPointLedger).all()).toMatchObject([{ skillCode: 'strategy_review', points: 5 }]);
    expect(db.select().from(organizationAiQuotas).where(eq(organizationAiQuotas.id, ids.quota)).get()?.usedPoints).toBe(5);
    expect(db.select().from(aiUsageLogs).all().map((item) => item.billedPoints).sort((a, b) => a - b)).toEqual([2, 3]);
    expect(db.select().from(runs).where(eq(runs.id, generated.runId)).get()?.status).toBe('completed_with_warnings');
    expect(db.select().from(contextSnapshots).where(eq(contextSnapshots.id, generated.contextSnapshotId)).get()).toBeTruthy();
    expectApiError(() => service(ids.viewer).confirm(generated.review.id, {}), 403, 'PERMISSION_DENIED');
  });

  it('blocks low-sample performance memory, confirms strategy memory, and exposes it to the next Context', async () => {
    const generated = await service().generate({ accountId: hierarchy.account.id, ...period });
    expectApiError(() => service().confirm(generated.review.id, { savePerformancePattern: true }), 409, 'PERFORMANCE_SAMPLE_BELOW_THRESHOLD');
    expect(db.select().from(memories).all()).toEqual([]);
    const confirmed = service().confirm(generated.review.id, { savePerformancePattern: false });
    expect(confirmed.review.status).toBe('confirmed');
    expect(confirmed.performanceMemoryId).toBeNull();
    expect(db.select().from(memories).where(eq(memories.sourceType, 'confirmed_strategy')).all()).toHaveLength(1);
    const context = memoryService(db, ids.organization, ids.owner, { now: () => new Date('2026-10-02T00:00:00.000Z') })
      .buildContext({ accountId: hierarchy.account.id, focus: '下一周期策略' });
    expect(context.snapshot.memoryIds).toContain(confirmed.strategyMemoryId);
    expect(service().createNextPlan(generated.review.id).plan).toMatchObject({ year: 2026, month: 10, status: 'inactive' });
    expectApiError(() => service().createNextPlan(generated.review.id), 409, 'PLAN_PERIOD_CONFLICT');
  });

  it('allows an explicitly confirmed performance pattern only after the admin threshold is met', async () => {
    service().updateConfig({ minimumSampleSize: 2 });
    const generated = await service().generate({ accountId: hierarchy.account.id, ...period });
    const confirmed = service().confirm(generated.review.id, { savePerformancePattern: true });
    expect(confirmed.performanceMemoryId).not.toBeNull();
    expect(db.select().from(memories).where(eq(memories.sourceType, 'confirmed_performance')).get()).toMatchObject({
      id: confirmed.performanceMemoryId,
      memoryType: 'performance_pattern',
      sourceId: generated.review.id,
    });
    expect(db.select().from(strategyReviews).where(eq(strategyReviews.id, generated.review.id)).get()).toMatchObject({
      status: 'confirmed', confirmedBy: ids.owner,
    });
  });

  it('validates the recommended mix in code and enforces account permissions', async () => {
    expect(strategyPlannerOutputSchema.safeParse({
      next_period_goal: 'gmv', recommended_content_mix: { product: 60, conversion: 30 },
      keep: [], reduce: [], test: [], next_actions: [],
    }).success).toBe(false);
    await expect(service(ids.viewer).generate({ accountId: hierarchy.account.id, ...period }))
      .rejects.toMatchObject({ status: 403, code: 'PERMISSION_DENIED' });
    expect(() => service().aggregate({ accountId: crypto.randomUUID(), ...period })).toThrow(ApiError);
  });

  it('records invalid strategy output but does not persist, bill, or consume quota', async () => {
    const invalid = strategyReviewService(db, ids.organization, ids.owner, {
      now: () => new Date(now),
      client: new InvalidMixClient(getLlmConfig({ LLM_API_KEY: '' })),
    });
    await expect(invalid.generate({ accountId: hierarchy.account.id, ...period }))
      .rejects.toMatchObject({ status: 502, code: 'LLM_OUTPUT_INVALID' });
    expect(db.select().from(strategyReviews).all()).toEqual([]);
    expect(db.select().from(aiPointLedger).all()).toEqual([]);
    expect(db.select().from(organizationAiQuotas).where(eq(organizationAiQuotas.id, ids.quota)).get()?.usedPoints).toBe(0);
    expect(db.select().from(aiUsageLogs).all().every((item) => item.billedPoints === 0)).toBe(true);
    expect(db.select().from(runs).get()?.status).toBe('failed');
  });
});
