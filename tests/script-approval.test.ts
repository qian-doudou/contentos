import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '@/db/schema';
import {
  accounts, aiPointLedger, aiUsageLogs, approvals, brands, clientMembers, clients, contents,
  contentStatusLogs, memories, organizationAiQuotas, organizations, runSteps, runs, scriptVersions,
  skills, stores, users,
} from '@/db/schema';
import { ApiError } from '@/lib/api/envelope';
import { getLlmConfig, OpenAICompatibleClient } from '@/lib/llm/client';
import { qualitySkillInputJsonSchema, qualitySkillOutputJsonSchema } from '@/lib/planner/contracts';
import {
  scriptGeneratorInputJsonSchema, scriptJsonOutputJsonSchema, type ScriptJson,
} from '@/lib/scripts/contracts';
import { publicScriptReviewService, scriptApprovalService } from '@/lib/scripts/service';

const ids = {
  organization: '0198f744-8e18-7ae2-a780-52a0e20caa01',
  foreignOrganization: '0198f744-8e18-7ae2-a780-52a0e20caa02',
  owner: '0198f744-8e18-7ae2-a780-52a0e20caa03',
  operator: '0198f744-8e18-7ae2-a780-52a0e20caa04',
  viewer: '0198f744-8e18-7ae2-a780-52a0e20caa05',
  foreignOwner: '0198f744-8e18-7ae2-a780-52a0e20caa06',
  client: '0198f744-8e18-7ae2-a780-52a0e20caa11',
  brand: '0198f744-8e18-7ae2-a780-52a0e20caa12',
  store: '0198f744-8e18-7ae2-a780-52a0e20caa13',
  account: '0198f744-8e18-7ae2-a780-52a0e20caa14',
  content: '0198f744-8e18-7ae2-a780-52a0e20caa15',
  foreignClient: '0198f744-8e18-7ae2-a780-52a0e20cab11',
  foreignBrand: '0198f744-8e18-7ae2-a780-52a0e20cab12',
  foreignStore: '0198f744-8e18-7ae2-a780-52a0e20cab13',
  foreignAccount: '0198f744-8e18-7ae2-a780-52a0e20cab14',
  foreignContent: '0198f744-8e18-7ae2-a780-52a0e20cab15',
  memory: '0198f744-8e18-7ae2-a780-52a0e20caa21',
  generatorSkill: '0198f744-8e18-7ae2-a780-52a0e20caa31',
  qualitySkill: '0198f744-8e18-7ae2-a780-52a0e20caa32',
  quota: '0198f744-8e18-7ae2-a780-52a0e20caa41',
} as const;

const now = '2026-09-08T08:00:00.000Z';
const tokenA = 'A'.repeat(43);
const tokenB = 'B'.repeat(43);
let sqlite: Database.Database;
let db: ReturnType<typeof drizzle<typeof schema>>;

const manualScript: ScriptJson = {
  title: '老板讲手切羊肉',
  hook: '这盘羊肉好不好，先看纹理。',
  spoken_script: '今天从真实后厨带你看手切羊肉的纹理与现切过程。',
  shots: [{ scene: '后厨', visual: '羊肉近景', spoken_line: '先看纹理。' }],
  product_integration: '手切羊肉',
  cta: '欢迎到店了解。',
  hashtags: ['#菏泽美食', '#德祥楼'],
};

function expectApiError(action: () => unknown, status: number, code: string) {
  return Promise.resolve().then(action).then(
    () => { throw new Error('Expected ApiError'); },
    (error: unknown) => {
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ status, code });
    },
  );
}

function addHierarchy(args: {
  organizationId: string; ownerId: string; clientId: string; brandId: string;
  storeId: string; accountId: string; contentId: string; title: string;
}) {
  db.insert(clients).values({
    id: args.clientId, organizationId: args.organizationId, clientName: args.title, industry: '餐饮', subIndustry: '铜锅涮羊肉',
    cooperationStatus: 'active', contractStart: null, contractEnd: null, monthlyContentTarget: 8,
    ownerUserId: args.ownerId, notes: '', status: 'active', isDemo: false, createdAt: now, updatedAt: now,
  }).run();
  db.insert(brands).values({
    id: args.brandId, organizationId: args.organizationId, clientId: args.clientId, brandName: args.title,
    industry: '餐饮', subIndustry: '铜锅涮羊肉', city: '菏泽', brandPositioning: '鲁西南特色铜锅涮羊肉',
    targetAudienceJson: ['菏泽食客'], coreProductsJson: ['手切羊肉'], coreSellingPointsJson: ['本地羊肉', '现切'],
    brandToneJson: ['真实'], forbiddenTopicsJson: ['虚假承诺'], status: 'active', isDemo: false, createdAt: now, updatedAt: now,
  }).run();
  db.insert(stores).values({
    id: args.storeId, organizationId: args.organizationId, brandId: args.brandId, storeName: '总店', city: '菏泽',
    district: '', address: '', storeType: '', status: 'active', isDemo: false, createdAt: now, updatedAt: now,
  }).run();
  db.insert(accounts).values({
    id: args.accountId, organizationId: args.organizationId, clientId: args.clientId, brandId: args.brandId, storeId: args.storeId,
    platform: 'douyin', accountName: `${args.title}老板IP`, accountType: 'owner_ip', accountGoalJson: ['本地曝光'],
    contentStyleJson: ['真实', '自然'], forbiddenStyleJson: ['过度卖惨'], followers: null,
    status: 'active', isDemo: false, createdAt: now, updatedAt: now,
  }).run();
  db.insert(contents).values({
    id: args.contentId, organizationId: args.organizationId, clientId: args.clientId, brandId: args.brandId, storeId: args.storeId,
    accountId: args.accountId, monthlyPlanId: null, title: `${args.title}内容`, contentType: 'product', contentGoal: 'trust',
    topic: '手切羊肉如何判断', angle: '老板从真实后厨细节讲解', hookType: 'question', hookText: '这盘羊肉新不新鲜怎么看？',
    coreMessage: '展示本地羊肉现切的真实过程', productText: '手切羊肉', ctaType: '到店了解', localElement: '菏泽口音', peopleJson: ['老板'],
    status: 'IDEA', priority: 'normal', operatorId: args.ownerId, plannedPublishDate: null, publishedAt: null, deadline: null,
    externalId: null, importDedupKey: null, importBatchId: null, currentScriptVersionId: null,
    activeApprovedScriptVersionId: null, currentEditVersionId: null, activeApprovedEditVersionId: null,
    aiReviewStatus: null, createdBy: args.ownerId, isDemo: false, createdAt: now, updatedAt: now,
  }).run();
}

function service(userId: string = ids.owner, options: { client?: OpenAICompatibleClient; token?: string; time?: string } = {}) {
  return scriptApprovalService(db, ids.organization, userId, {
    now: () => new Date(options.time ?? now),
    client: options.client ?? new OpenAICompatibleClient(getLlmConfig({})),
    createToken: () => options.token ?? tokenA,
  });
}

class InvalidScriptClient extends OpenAICompatibleClient {
  constructor() { super(getLlmConfig({})); }
  override async complete(input: Parameters<OpenAICompatibleClient['complete']>[0]) {
    if (input.messages[0].content.includes('脚本生成器')) {
      const completion = await super.complete({ ...input, mockText: '{invalid-json' });
      return { ...completion, text: '{invalid-json' };
    }
    return super.complete(input);
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
    { id: ids.operator, organizationId: ids.organization, name: '运营', role: 'operator', status: 'active', isDemo: false, createdAt: now, updatedAt: now },
    { id: ids.viewer, organizationId: ids.organization, name: '查看者', role: 'viewer', status: 'active', isDemo: false, createdAt: now, updatedAt: now },
    { id: ids.foreignOwner, organizationId: ids.foreignOrganization, name: 'B 负责人', role: 'owner', status: 'active', isDemo: false, createdAt: now, updatedAt: now },
  ]).run();
  addHierarchy({ organizationId: ids.organization, ownerId: ids.owner, clientId: ids.client, brandId: ids.brand, storeId: ids.store, accountId: ids.account, contentId: ids.content, title: '德祥楼' });
  addHierarchy({ organizationId: ids.foreignOrganization, ownerId: ids.foreignOwner, clientId: ids.foreignClient, brandId: ids.foreignBrand, storeId: ids.foreignStore, accountId: ids.foreignAccount, contentId: ids.foreignContent, title: '其他品牌' });
  db.insert(clientMembers).values([
    { id: crypto.randomUUID(), organizationId: ids.organization, clientId: ids.client, userId: ids.operator, roleOverride: null, isDemo: false, createdAt: now },
    { id: crypto.randomUUID(), organizationId: ids.organization, clientId: ids.client, userId: ids.viewer, roleOverride: null, isDemo: false, createdAt: now },
  ]).run();
  db.insert(memories).values({
    id: ids.memory, organizationId: ids.organization, scopeType: 'account', scopeId: ids.account,
    memoryKey: 'account.content_style', memoryType: 'preference', valueJson: ['真实', '自然'], summary: '账号风格真实自然',
    importance: 5, confidence: 1, sourceType: 'brand_profile', sourceId: ids.account, effectiveAt: now,
    expiresAt: null, status: 'active', supersedesMemoryId: null, createdBy: ids.owner, isDemo: false, createdAt: now,
  }).run();
  db.insert(skills).values([
    {
      id: ids.generatorSkill, organizationId: null, code: 'script_generator', name: '脚本生成器', description: '',
      systemPrompt: '你是 ContentOS 脚本生成器。', userPromptTemplate: '{{input_json}}',
      inputSchemaJson: scriptGeneratorInputJsonSchema, outputSchemaJson: scriptJsonOutputJsonSchema,
      modelProfile: 'strong', pointCost: 3, enabled: true, currentVersion: 2, isDemo: false, createdAt: now, updatedAt: now,
    },
    {
      id: ids.qualitySkill, organizationId: null, code: 'quality_checker', name: '质量检查器', description: '',
      systemPrompt: '你是质量检查器。', userPromptTemplate: '{{input_json}}',
      inputSchemaJson: qualitySkillInputJsonSchema, outputSchemaJson: qualitySkillOutputJsonSchema,
      modelProfile: 'light', pointCost: 1, enabled: true, currentVersion: 2, isDemo: false, createdAt: now, updatedAt: now,
    },
  ]).run();
  db.insert(organizationAiQuotas).values({
    id: ids.quota, organizationId: ids.organization, periodStart: '2026-01-01T00:00:00.000Z', periodEnd: '2027-01-01T00:00:00.000Z',
    quotaPoints: 100, usedPoints: 0, isDemo: false, createdAt: now, updatedAt: now,
  }).run();
});

afterEach(() => sqlite.close());

describe('script versions and AI generation', () => {
  it('generates a validated V1, traces every step, advances IDEA and bills only the generator after persistence', async () => {
    const result = await service().generate(ids.content, {});
    expect(result).toMatchObject({ billedPoints: 3, qualityStatus: 'passed' });
    expect(result.workspace.versions).toHaveLength(1);
    expect(result.workspace.versions[0]).toMatchObject({ versionNo: 1, sourceType: 'ai', isCurrent: true });
    expect(db.select().from(contents).where(eq(contents.id, ids.content)).get()).toMatchObject({
      status: 'SCRIPTING', currentScriptVersionId: result.workspace.versions[0].id,
    });
    expect(db.select().from(contentStatusLogs).where(eq(contentStatusLogs.contentId, ids.content)).get()).toMatchObject({
      previousStatus: 'IDEA', newStatus: 'SCRIPTING', triggerType: 'system',
    });
    expect(db.select().from(runSteps).where(eq(runSteps.runId, result.runId)).all().map((step) => [step.stepCode, step.status])).toEqual([
      ['context_build', 'succeeded'], ['script_generator', 'succeeded'], ['quality_check', 'succeeded'], ['persist_script_version', 'succeeded'],
    ]);
    expect(db.select().from(runs).where(eq(runs.id, result.runId)).get()?.status).toBe('completed');
    expect(db.select().from(organizationAiQuotas).where(eq(organizationAiQuotas.id, ids.quota)).get()?.usedPoints).toBe(3);
    expect(db.select().from(aiPointLedger).where(eq(aiPointLedger.runId, result.runId)).all()).toHaveLength(1);
    expect(db.select().from(aiUsageLogs).where(eq(aiUsageLogs.runId, result.runId)).all().map((usage) => [usage.skillCode, usage.billedPoints])).toEqual([
      ['script_generator', 3], ['quality_checker', 0],
    ]);
  });

  it('keeps V1/V2 immutable and preserves an old approved version until the new draft is submitted', () => {
    const v1 = service().createManual(ids.content, { scriptJson: manualScript, sourceType: 'operator', changeSummary: '初稿' });
    expect(v1.versions).toHaveLength(1);
    const v2 = service().createManual(ids.content, { scriptJson: { ...manualScript, hook: '第二版钩子' }, sourceType: 'operator', changeSummary: '优化开场' });
    expect(v2.versions.map((version) => [version.versionNo, version.scriptJson.hook])).toEqual([[2, '第二版钩子'], [1, manualScript.hook]]);
    const submitted = service(ids.owner, { token: tokenA }).submitApproval(ids.content, {
      versionId: v2.content.currentScriptVersionId, reviewerType: 'external_client',
    });
    publicScriptReviewService(db, { now: () => new Date(now) }).decide(tokenA, { status: 'approved', comment: 'V2 通过' });
    const approved = service().workspace(ids.content);
    expect(approved.content).toMatchObject({ status: 'APPROVED', activeApprovedScriptVersionId: v2.content.currentScriptVersionId });
    expect(submitted.reviewPath).toBe(`/review/${tokenA}`);

    const v3 = service().createManual(ids.content, { scriptJson: { ...manualScript, hook: '第三版钩子' }, sourceType: 'client_revision', changeSummary: '新一轮草稿' });
    expect(v3.content.status).toBe('APPROVED');
    expect(v3.content.activeApprovedScriptVersionId).toBe(v2.content.currentScriptVersionId);
    expect(v3.versions).toHaveLength(3);
    const resubmitted = service(ids.owner, { token: tokenB }).submitApproval(ids.content, {
      versionId: v3.content.currentScriptVersionId, reviewerType: 'external_client',
    });
    expect(resubmitted.workspace.content).toMatchObject({ status: 'WAITING_APPROVAL', activeApprovedScriptVersionId: null });
    expect(db.select().from(approvals).where(eq(approvals.contentId, ids.content)).all().map((approval) => approval.status).sort()).toEqual(['approved', 'pending']);
    expect(db.select().from(scriptVersions).where(eq(scriptVersions.contentId, ids.content)).all()).toHaveLength(3);
  });

  it('keeps failed generation usage but does not create a version or bill points', async () => {
    await expectApiError(() => service(ids.owner, { client: new InvalidScriptClient() }).generate(ids.content, {}), 502, 'LLM_CALL_FAILED');
    expect(db.select().from(scriptVersions).all()).toHaveLength(0);
    expect(db.select().from(aiPointLedger).all()).toHaveLength(0);
    expect(db.select().from(organizationAiQuotas).where(eq(organizationAiQuotas.id, ids.quota)).get()?.usedPoints).toBe(0);
    expect(db.select().from(runs).get()?.status).toBe('failed');
    expect(db.select().from(aiUsageLogs).all().every((usage) => usage.billedPoints === 0)).toBe(true);
  });

  it('requires a currently effective Active Memory before AI persistence', async () => {
    db.update(memories).set({ status: 'expired' }).where(eq(memories.id, ids.memory)).run();
    await expectApiError(() => service().generate(ids.content, {}), 409, 'ACTIVE_MEMORY_REQUIRED');
    expect(db.select().from(scriptVersions).all()).toHaveLength(0);
    expect(db.select().from(aiPointLedger).all()).toHaveLength(0);
  });
});

describe('script approval security', () => {
  it('supports a named internal reviewer for changes requested and approval', () => {
    const v1 = service().createManual(ids.content, {
      scriptJson: manualScript, sourceType: 'operator', changeSummary: '内部审核初稿',
    });
    const first = service().submitApproval(ids.content, {
      versionId: v1.content.currentScriptVersionId,
      reviewerType: 'internal_user',
      reviewerUserId: ids.owner,
    });
    expect(first.reviewPath).toBeNull();
    const requested = service().decide(first.workspace.approvals[0].id, {
      status: 'changes_requested', comment: '补充食材近景',
    });
    expect(requested.content).toMatchObject({ status: 'SCRIPTING', activeApprovedScriptVersionId: null });

    const v2 = service().createManual(ids.content, {
      scriptJson: { ...manualScript, hook: '现切纹理一镜到底' }, sourceType: 'operator', changeSummary: '补充近景',
    });
    const second = service().submitApproval(ids.content, {
      versionId: v2.content.currentScriptVersionId,
      reviewerType: 'internal_user',
      reviewerUserId: ids.owner,
    });
    const pendingApproval = second.workspace.approvals.find((approval) => approval.status === 'pending');
    expect(pendingApproval).toBeDefined();
    const approved = service().decide(pendingApproval!.id, {
      status: 'approved', comment: '内部审核通过',
    });
    expect(approved.content).toMatchObject({
      status: 'APPROVED', activeApprovedScriptVersionId: v2.content.currentScriptVersionId,
    });
    expect(db.select().from(approvals).where(eq(approvals.contentId, ids.content)).all()
      .map((approval) => approval.status).sort()).toEqual(['approved', 'changes_requested']);
    expect(db.select().from(contentStatusLogs).where(eq(contentStatusLogs.contentId, ids.content)).all()
      .filter((log) => log.triggerType === 'approval').map((log) => `${log.previousStatus}->${log.newStatus}`)).toEqual([
      'SCRIPTING->WAITING_APPROVAL', 'WAITING_APPROVAL->SCRIPTING',
      'SCRIPTING->WAITING_APPROVAL', 'WAITING_APPROVAL->APPROVED',
    ]);
  });

  it('stores only a token hash, scopes the public payload, rejects guessed and expired tokens', async () => {
    const workspace = service().createManual(ids.content, { scriptJson: manualScript, sourceType: 'operator', changeSummary: '提交审核' });
    service(ids.owner, { token: tokenA }).submitApproval(ids.content, {
      versionId: workspace.content.currentScriptVersionId, reviewerType: 'external_client',
      expiresAt: '2026-09-09T08:00:00.000Z',
    });
    const stored = db.select().from(approvals).get()!;
    expect(stored.reviewTokenHash).not.toBe(tokenA);
    expect(stored.reviewTokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(stored)).not.toContain(tokenA);
    const publicView = publicScriptReviewService(db, { now: () => new Date(now) }).view(tokenA);
    expect(Object.keys(publicView).sort()).toEqual(['approval', 'brand', 'content', 'script']);
    expect(publicView).toMatchObject({ brand: { name: '德祥楼' }, content: { title: '德祥楼内容' }, script: { versionNo: 1 } });
    expect(JSON.stringify(publicView)).not.toContain(ids.organization);
    expect(JSON.stringify(publicView)).not.toContain(ids.foreignContent);
    await expectApiError(() => publicScriptReviewService(db).view('C'.repeat(43)), 404, 'REVIEW_LINK_NOT_FOUND');
    await expectApiError(() => publicScriptReviewService(db, { now: () => new Date('2026-09-10T08:00:00.000Z') }).view(tokenA), 410, 'REVIEW_LINK_EXPIRED');
    expect(db.select().from(approvals).get()?.status).toBe('expired');
  });

  it('enforces organization and role boundaries on direct service/API-equivalent calls', () => {
    const operatorWorkspace = service(ids.operator).createManual(ids.content, {
      scriptJson: manualScript, sourceType: 'operator', changeSummary: '运营初稿',
    });
    expect(operatorWorkspace.versions).toHaveLength(1);
    expect(service(ids.viewer).workspace(ids.content).versions).toHaveLength(1);
    expect(() => service(ids.viewer).createManual(ids.content, {
      scriptJson: manualScript, sourceType: 'operator', changeSummary: '越权修改',
    })).toThrow(expect.objectContaining({ status: 403, code: 'PERMISSION_DENIED' }));
    expect(() => service().workspace(ids.foreignContent)).toThrow(expect.objectContaining({ status: 404, code: 'NOT_FOUND' }));
  });

  it('prevents cross-content script pointers and approval version binding at the database boundary', () => {
    const own = service().createManual(ids.content, { scriptJson: manualScript, sourceType: 'operator', changeSummary: '本组织版本' });
    expect(() => sqlite.prepare('update contents set current_script_version_id = ? where id = ?').run(own.versions[0].id, ids.foreignContent))
      .toThrow(/content script pointer does not belong/);
    expect(() => sqlite.prepare(`insert into approvals (
      id, organization_id, content_id, approval_type, version_id, status, reviewer_type,
      reviewer_user_id, review_token_hash, expires_at, comment, is_demo, created_at, updated_at
    ) values (?, ?, ?, 'script', ?, 'pending', 'external_client', null, ?, ?, '', 0, ?, ?)`)
      .run(crypto.randomUUID(), ids.foreignOrganization, ids.foreignContent, own.versions[0].id, 'd'.repeat(64), '2026-09-09T08:00:00.000Z', now, now))
      .toThrow(/script approval version does not belong/);
  });
});
