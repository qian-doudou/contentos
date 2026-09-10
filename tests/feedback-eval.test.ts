import Database from 'better-sqlite3';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '@/db/schema';
import {
  aiUsageLogs, badCases, evalCaseResults, improvementProposals, organizationAiQuotas, organizations,
  runSteps, runs, skillVersions, skills, users,
} from '@/db/schema';
import { ApiError } from '@/lib/api/envelope';
import { aiInfrastructureService } from '@/lib/ai/service';
import {
  promptImproverInputJsonSchema, promptImproverOutputJsonSchema,
  type EvalCase,
} from '@/lib/evals/contracts';
import { qualityService } from '@/lib/evals/service';
import { getLlmConfig, OpenAICompatibleClient } from '@/lib/llm/client';

const ids = {
  organization: '0198f744-8e18-7ae2-a780-52a0e20c8101',
  foreignOrganization: '0198f744-8e18-7ae2-a780-52a0e20c8102',
  owner: '0198f744-8e18-7ae2-a780-52a0e20c8103',
  operator: '0198f744-8e18-7ae2-a780-52a0e20c8104',
  viewer: '0198f744-8e18-7ae2-a780-52a0e20c8105',
  foreignOwner: '0198f744-8e18-7ae2-a780-52a0e20c8106',
  plannerSkill: '0198f744-8e18-7ae2-a780-52a0e20c8107',
  plannerVersion: '0198f744-8e18-7ae2-a780-52a0e20c8108',
  improverSkill: '0198f744-8e18-7ae2-a780-52a0e20c8109',
  improverVersion: '0198f744-8e18-7ae2-a780-52a0e20c8110',
  productionRun: '0198f744-8e18-7ae2-a780-52a0e20c8111',
  productionStep: '0198f744-8e18-7ae2-a780-52a0e20c8112',
  productionUsage: '0198f744-8e18-7ae2-a780-52a0e20c8113',
} as const;

const now = '2026-09-10T05:00:00.000Z';
const plannerInputSchema = {
  type: 'object', properties: { brief: { type: 'string', minLength: 1 } },
  required: ['brief'], additionalProperties: false,
} as const;
const plannerOutputSchema = {
  type: 'object', properties: {
    result: { type: 'string', minLength: 1 },
    warnings: { type: 'array', items: { type: 'string' } },
  }, required: ['result', 'warnings'], additionalProperties: false,
} as const;

let sqlite: Database.Database;
let db: ReturnType<typeof drizzle<typeof schema>>;

function mockClient() {
  return new OpenAICompatibleClient(getLlmConfig({ LLM_API_KEY: '' }));
}

function expectApiError(action: () => unknown, status: number, code: string) {
  try { action(); throw new Error('Expected ApiError'); }
  catch (error) { expect(error).toBeInstanceOf(ApiError); expect(error).toMatchObject({ status, code }); }
}

function insertRun(input: {
  id: string; stepId: string; usageId: string; status?: 'completed' | 'failed';
  createdAt?: string; errorCode?: string;
}) {
  const createdAt = input.createdAt ?? now;
  const status = input.status ?? 'completed';
  db.insert(runs).values({
    id: input.id, organizationId: ids.organization, runType: 'production', subjectType: 'skill:content_planner',
    subjectId: null, status, startedAt: createdAt, finishedAt: createdAt, createdBy: ids.owner,
    isDemo: false, createdAt,
  }).run();
  db.insert(runSteps).values({
    id: input.stepId, organizationId: ids.organization, runId: input.id, sequence: 0,
    stepCode: 'content_planner', status: status === 'completed' ? 'succeeded' : 'failed', inputJson: JSON.stringify({ input: { brief: '本地羊肉内容' } }),
    outputJson: JSON.stringify({ parsedJson: { result: 'safe', warnings: [] } }),
    errorJson: input.errorCode ? JSON.stringify({ code: input.errorCode }) : null,
    startedAt: createdAt, finishedAt: createdAt, durationMs: 10, warningCodesJson: null, isDemo: false,
  }).run();
  db.insert(aiUsageLogs).values({
    id: input.usageId, organizationId: ids.organization, runId: input.id, runStepId: input.stepId,
    runType: 'production', userId: ids.owner, clientId: null, accountId: null,
    skillCode: 'content_planner', skillVersion: 1, providerRequestId: null,
    model: 'qwen-test', inputTokens: 10, outputTokens: 5, estimatedCost: null,
    billedPoints: status === 'completed' ? 1 : 0, attempts: 1, durationMs: 10,
    status, isDemo: false, createdAt,
  }).run();
}

function service(userId: string = ids.owner, runtime: {
  proposalMockOutput?: {
    root_cause: string; change_reason: string; new_system_prompt: string;
    new_user_prompt_template: string; risks: string[]; affected_cases: string[];
  };
  evalMockOutput?: (variant: 'a' | 'b', evalCase: EvalCase) => unknown;
} = {}, organizationId: string = ids.organization) {
  return qualityService(db, organizationId, userId, {
    now: () => new Date(now), client: mockClient(), ...runtime,
  });
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
    { id: ids.foreignOwner, organizationId: ids.foreignOrganization, name: '外部负责人', role: 'owner', status: 'active', isDemo: false, createdAt: now, updatedAt: now },
  ]).run();
  db.insert(organizationAiQuotas).values({
    id: crypto.randomUUID(), organizationId: ids.organization, periodStart: '2026-01-01T00:00:00.000Z',
    periodEnd: '2027-01-01T00:00:00.000Z', quotaPoints: 100, usedPoints: 0,
    isDemo: false, createdAt: now, updatedAt: now,
  }).run();
  db.insert(skills).values([
    {
      id: ids.plannerSkill, organizationId: null, code: 'content_planner', name: '内容策划', description: '',
      systemPrompt: '生产基线 Prompt', userPromptTemplate: '{{input_json}}', inputSchemaJson: plannerInputSchema,
      outputSchemaJson: plannerOutputSchema, modelProfile: 'standard', pointCost: 1, enabled: true,
      currentVersion: 1, isDemo: false, createdAt: now, updatedAt: now,
    },
    {
      id: ids.improverSkill, organizationId: null, code: 'prompt_improver', name: 'Prompt 改进器', description: '',
      systemPrompt: '只创建改进草案', userPromptTemplate: '{{input_json}}', inputSchemaJson: promptImproverInputJsonSchema,
      outputSchemaJson: promptImproverOutputJsonSchema, modelProfile: 'strong', pointCost: 0, enabled: true,
      currentVersion: 1, isDemo: false, createdAt: now, updatedAt: now,
    },
  ]).run();
  db.insert(skillVersions).values([
    {
      id: ids.plannerVersion, organizationId: null, skillId: ids.plannerSkill, version: 1,
      systemPrompt: '生产基线 Prompt', userPromptTemplate: '{{input_json}}', inputSchemaJson: plannerInputSchema,
      outputSchemaJson: plannerOutputSchema, modelProfile: 'standard', pointCost: 1,
      changeReason: '初始化', createdBy: null, isDemo: false, createdAt: now,
    },
    {
      id: ids.improverVersion, organizationId: null, skillId: ids.improverSkill, version: 1,
      systemPrompt: '只创建改进草案', userPromptTemplate: '{{input_json}}', inputSchemaJson: promptImproverInputJsonSchema,
      outputSchemaJson: promptImproverOutputJsonSchema, modelProfile: 'strong', pointCost: 0,
      changeReason: '初始化', createdBy: null, isDemo: false, createdAt: now,
    },
  ]).run();
  insertRun({ id: ids.productionRun, stepId: ids.productionStep, usageId: ids.productionUsage });
});

afterEach(() => sqlite.close());

describe('ratings and Bad Case rules', () => {
  it('creates Bad Cases from low scores and preserves rating history', () => {
    const api = service();
    const rating = api.createRating({
      runId: ids.productionRun, overallScore: 2, brandConsistency: 1, usability: 2, novelty: 3,
      comment: '包含不存在的品牌事实', issueTags: ['brand_fact_error'], markedBadCase: false,
    });
    expect(rating.currentVersion).toBe(1);
    expect(db.select().from(badCases).all().map((row) => row.category).sort()).toEqual(['brand_fact_error', 'low_rating']);

    const updated = api.updateRating(rating.id, {
      overallScore: 4, brandConsistency: 4, usability: 4, novelty: 4,
      comment: '复核后调整', issueTags: [], markedBadCase: false,
    });
    expect(updated.currentVersion).toBe(2);
    expect(updated.versions.map((version) => version.overallScore)).toEqual([4, 2]);
    expect(() => sqlite.prepare('update rating_versions set comment = ? where rating_id = ?').run('覆盖历史', rating.id)).toThrow(/immutable/);
  });

  it('enforces server permissions and organization isolation', () => {
    expectApiError(() => service(ids.viewer).dashboard(), 403, 'PERMISSION_DENIED');
    service().createRating({
      runId: ids.productionRun, overallScore: 2, brandConsistency: 2, usability: 2, novelty: 2,
      comment: '仅负责人可见的未绑定客户 Run', issueTags: [], markedBadCase: false,
    });
    expect(service(ids.operator).dashboard().ratings).toEqual([]);
    expect(service(ids.operator).dashboard().badCases).toEqual([]);
    expect(service(ids.foreignOwner, {}, ids.foreignOrganization).dashboard().ratings).toEqual([]);
    expectApiError(() => service(ids.foreignOwner, {}, ids.foreignOrganization).createRating({
      runId: ids.productionRun, overallScore: 3, brandConsistency: 3, usability: 3, novelty: 3,
      comment: '', issueTags: [], markedBadCase: false,
    }), 404, 'NOT_FOUND');
  });

  it('detects two consecutive schema failures idempotently', () => {
    insertRun({ id: crypto.randomUUID(), stepId: crypto.randomUUID(), usageId: crypto.randomUUID(), status: 'failed', errorCode: 'LLM_OUTPUT_INVALID', createdAt: '2026-09-10T05:01:00.000Z' });
    insertRun({ id: crypto.randomUUID(), stepId: crypto.randomUUID(), usageId: crypto.randomUUID(), status: 'failed', errorCode: 'LLM_OUTPUT_INVALID', createdAt: '2026-09-10T05:02:00.000Z' });
    const first = service().scanRecentRuns();
    const second = service().scanRecentRuns();
    expect(first.createdCases).toBe(1);
    expect(second.createdCases).toBe(0);
    expect(db.select().from(badCases).where(eq(badCases.category, 'schema_repeated_failure')).all()).toHaveLength(1);
  });
});

describe('Prompt draft, A/B Eval and release gate', () => {
  it('keeps Draft isolated, blocks regression, then applies a passing version without changing the global Skill', async () => {
    const rating = service().createRating({
      runId: ids.productionRun, overallScore: 2, brandConsistency: 2, usability: 2, novelty: 3,
      comment: '需要更严格约束', issueTags: [], markedBadCase: false,
    });
    const badCase = db.select().from(badCases).where(eq(badCases.sourceRatingId, rating.id)).get()!;
    const proposalOutput = {
      root_cause: '约束不足', change_reason: '增加事实校验',
      new_system_prompt: '改进草案 Prompt', new_user_prompt_template: '{{input_json}}\n先核验事实',
      risks: ['表达可能更保守'], affected_cases: [badCase.id],
    };
    const draft = await service(ids.owner, { proposalMockOutput: proposalOutput }).createProposal({ badCaseIds: [badCase.id] });
    expect(draft.status).toBe('draft');
    expect(db.select().from(skills).where(eq(skills.id, ids.plannerSkill)).get()?.systemPrompt).toBe('生产基线 Prompt');

    const caseIds = [];
    for (let index = 1; index <= 3; index += 1) {
      const evalCase = service().createEvalCase({
        sourceType: 'manual', sourceId: null, name: `固定 Case ${index}`, skillCode: 'content_planner',
        inputSnapshot: { brief: `样本 ${index}` }, contextSnapshot: { memoryIds: [`memory-${index}`] },
        expectedBehavior: '输出可用内容', expectedDuplicateLevel: null,
        assertions: { requiredText: ['safe'], forbiddenText: ['bad'], requireSchemaValid: true },
      });
      caseIds.push(evalCase.id);
    }

    const regressed = await service(ids.owner, {
      evalMockOutput: (variant) => ({ result: variant === 'a' ? 'safe' : 'bad', warnings: [] }),
    }).runExperiment(draft.id, { evalCaseIds: caseIds });
    expect(regressed.verdict).toBe('regressed');
    expect(regressed.comparison.regressedCaseIds).toHaveLength(3);
    expectApiError(() => service().applyProposal(draft.id, { confirm: 'APPLY_EVALUATED_PROMPT' }), 409, 'PROPOSAL_RELEASE_GATE_FAILED');

    const passed = await service(ids.owner, {
      evalMockOutput: () => ({ result: 'safe', warnings: [] }),
    }).runExperiment(draft.id, { evalCaseIds: caseIds });
    expect(passed.verdict).toBe('passed');
    expect(passed.comparison).toMatchObject({ canApply: true, sameInputAndContext: true, sameModelProfile: true });
    const results = db.select().from(evalCaseResults).where(eq(evalCaseResults.experimentId, passed.id)).all();
    for (const caseId of caseIds) {
      const pair = results.filter((result) => result.evalCaseId === caseId);
      expect(pair).toHaveLength(2);
      expect(new Set(pair.map((result) => result.model)).size).toBe(1);
      const traceInputs = pair.map((result) => {
        const step = db.select().from(runSteps).where(eq(runSteps.runId, result.runId)).get()!;
        return JSON.parse(step.inputJson!) as { input: unknown; metadata: { contextSnapshot: unknown } };
      });
      expect(traceInputs[0].input).toEqual(traceInputs[1].input);
      expect(traceInputs[0].metadata.contextSnapshot).toEqual(traceInputs[1].metadata.contextSnapshot);
    }

    const applied = service().applyProposal(draft.id, { confirm: 'APPLY_EVALUATED_PROMPT' });
    expect(applied).toMatchObject({ status: 'applied', appliedSkillVersion: 2 });
    expect(db.select().from(skills).where(eq(skills.id, ids.plannerSkill)).get()?.systemPrompt).toBe('生产基线 Prompt');
    const override = db.select().from(skills).where(and(
      eq(skills.organizationId, ids.organization), eq(skills.code, 'content_planner'),
    )).get()!;
    expect(override).toMatchObject({ systemPrompt: '改进草案 Prompt', currentVersion: 2 });
    expect(db.select().from(skillVersions).where(eq(skillVersions.skillId, override.id)).all().map((row) => row.version).sort((a, b) => a - b)).toEqual([1, 2]);
    expect(aiInfrastructureService(db, ids.organization, ids.owner, { client: mockClient(), now: () => new Date(now) }).listSkills().items.filter((skill) => skill.code === 'content_planner')).toHaveLength(1);
    expect(db.select().from(improvementProposals).where(eq(improvementProposals.id, draft.id)).get()?.status).toBe('applied');
    const nextProduction = await aiInfrastructureService(db, ids.organization, ids.owner, {
      client: mockClient(), now: () => new Date(now),
    }).executeProduction({
      skillCode: 'content_planner', data: { brief: '新版本生产追踪' }, persistBusinessResult: () => undefined,
    });
    expect(nextProduction).toMatchObject({
      run: { runType: 'production', status: 'completed' },
      usage: { skillCode: 'content_planner', skillVersion: 2, billedPoints: 1 },
    });
  });

  it('reports data insufficient below the minimum sample instead of announcing a winner', async () => {
    const rating = service().createRating({
      runId: ids.productionRun, overallScore: 2, brandConsistency: 2, usability: 2, novelty: 2,
      comment: '低评分', issueTags: [], markedBadCase: false,
    });
    const badCase = db.select().from(badCases).where(eq(badCases.sourceRatingId, rating.id)).get()!;
    const draft = await service(ids.owner, { proposalMockOutput: {
      root_cause: '根因', change_reason: '原因', new_system_prompt: '新 Prompt',
      new_user_prompt_template: '{{input_json}}', risks: ['风险'], affected_cases: [badCase.id],
    } }).createProposal({ badCaseIds: [badCase.id] });
    const evalCase = service().createEvalCase({
      sourceType: 'manual', sourceId: null, name: '单个 Case', skillCode: 'content_planner',
      inputSnapshot: { brief: '单个样本' }, contextSnapshot: {}, expectedBehavior: '有效', expectedDuplicateLevel: null,
      assertions: { requiredText: [], forbiddenText: [], requireSchemaValid: true },
    });
    const result = await service(ids.owner, { evalMockOutput: () => ({ result: 'safe', warnings: [] }) })
      .runExperiment(draft.id, { evalCaseIds: [evalCase.id] });
    expect(result).toMatchObject({ verdict: 'data_insufficient', comparison: { canApply: false, sampleSufficient: false } });
    expectApiError(() => service().applyProposal(draft.id, { confirm: 'APPLY_EVALUATED_PROMPT' }), 409, 'PROPOSAL_RELEASE_GATE_FAILED');
  });
});
