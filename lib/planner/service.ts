import { and, asc, count, desc, eq, gt, inArray, lte, ne, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { z } from 'zod';
import * as tables from '@/db/schema';
import { ApiError } from '@/lib/api/envelope';
import { permissionService } from '@/lib/auth/permissions';
import { calculateMixStats } from '@/lib/content/service';
import { contentSchema } from '@/lib/content/contracts';
import { duplicateJudgeOutputSchema } from '@/lib/history/contracts';
import { historyRetrievalService } from '@/lib/history/service';
import { contextBuilder } from '@/lib/memory/context-builder';
import type { ContextBuildResult } from '@/lib/memory/contracts';
import { OpenAICompatibleClient } from '@/lib/llm/client';
import { plannerAiRuntime } from './ai-runtime';
import {
  persistPlannerResultSchema, persistPlannerSelectionSchema, plannerInputSchema,
  plannerItemSchema, plannerOutputSchema, plannerPageDataSchema, plannerSessionViewSchema,
  qualityOutputSchema, reanglePlannerCandidateSchema,
  type PlannerInput, type PlannerItem, type PlannerOutput, type QualityIssue,
} from './contracts';

type Database = BetterSQLite3Database<typeof tables>;
const missing = () => new ApiError(404, 'NOT_FOUND', '记录不存在或不属于当前组织');
const STEP_CODES = [
  'context_build', 'content_planner', 'candidate_retrieval',
  'candidate_duplicate_judge', 'quality_check', 'persist_selected_contents',
] as const;

function json(value: unknown) { return JSON.stringify(value); }
function duration(start: number, end: number) { return Math.max(0, end - start); }

function priceTokens(value: string) {
  return [...new Set(value.match(/(?:¥|￥)\s*\d+(?:\.\d+)?|\d+(?:\.\d+)?\s*(?:元|块|折|%)/g) ?? [])];
}

function activityAndQuantityTokens(value: string) {
  return [...new Set([
    ...(value.match(/买[^，。；\s]{0,6}赠[^，。；\s]{0,6}|满\s*\d+\s*减\s*\d+|限时(?:优惠|活动|折扣)|(?:团购|活动|优惠)价|免费赠送|进店送/gu) ?? []),
    ...(value.match(/\d+(?:\.\d+)?\s*(?:斤|克|份|盘|人份)/gu) ?? []),
  ])];
}

function scrubUnverifiedDynamicFacts(item: PlannerItem, allowedText: string) {
  const fields = ['title', 'topic', 'angle', 'hook_idea', 'core_message', 'recommended_reason'] as const;
  const invalid = fields.flatMap((field) => [...priceTokens(item[field]), ...activityAndQuantityTokens(item[field])]
    .filter((token) => !allowedText.includes(token)).map((token) => ({ field, token })));
  if (!invalid.length) return { item, issues: [] as QualityIssue[] };
  const next = { ...item };
  for (const { field, token } of invalid) next[field] = next[field].replaceAll(token,
    /斤|克|份|盘|人份/u.test(token) ? '适量' : /元|块|折|%|¥|￥/u.test(token) ? '当期到店价' : '当期门店活动');
  return {
    item: plannerItemSchema.parse(next),
    issues: [{
      code: 'unverified_dynamic_fact' as const,
      message: '已移除 Context 中无有效来源的动态价格，候选改为以到店实时信息为准。',
      field: invalid[0].field, blocking: false,
    }],
  };
}

function mockPlanner(input: PlannerInput, context: ContextBuildResult, count = input.plannedCount): PlannerOutput {
  const stable = new Map(context.layers.l1StableContext.map((item) => [item.key, item.value]));
  const products = Array.isArray(stable.get('brand.core_products'))
    ? (stable.get('brand.core_products') as unknown[]).filter((item): item is string => typeof item === 'string')
    : [];
  const positioning = typeof stable.get('brand.positioning') === 'string' ? stable.get('brand.positioning') as string : context.account.brandName;
  const patterns = [
    { type: 'persona' as const, hook: 'identity' as const, title: '老板的一天从选食材开始', topic: '老板日常与选品标准', angle: '跟拍老板开店前的真实准备过程' },
    { type: 'product' as const, hook: 'question' as const, title: `一份${products[0] ?? '招牌产品'}好不好，看这几个细节`, topic: '核心产品判断方法', angle: '用可观察的产品细节建立信任' },
    { type: 'local' as const, hook: 'local' as const, title: `本地人熟悉的${products[1] ?? '到店体验'}`, topic: '本地消费习惯', angle: '从本地顾客的真实选择切入' },
    { type: 'conversion' as const, hook: 'mistake' as const, title: '第一次到店怎么选更合适', topic: '到店决策指南', angle: '按人数与需求给出不夸张的选择建议' },
    { type: 'process' as const, hook: 'secret' as const, title: '后厨里最不能省的一道流程', topic: '门店标准流程', angle: '展示容易被忽略的真实操作环节' },
    { type: 'trust' as const, hook: 'result' as const, title: '顾客愿意再来的原因藏在细节里', topic: '真实服务细节', angle: '从一次完整到店体验建立信任' },
  ];
  return plannerOutputSchema.parse({
    planning_summary: `围绕${positioning}与当前计划缺口，生成 ${count} 条可验证、可拍摄的内容候选。`,
    items: Array.from({ length: count }, (_, index) => {
      const pattern = patterns[index % patterns.length];
      const suffix = index >= patterns.length ? `（${Math.floor(index / patterns.length) + 1}）` : '';
      return {
        title: `${pattern.title}${suffix}`, content_type: pattern.type, content_goal: input.primaryGoal,
        topic: pattern.topic, angle: pattern.angle, hook_type: pattern.hook,
        hook_idea: index === 0 ? '你看到的是开门营业，老板先做的其实是这一件事。' : `别急着下结论，先看第 ${index + 1} 个真实细节。`,
        core_message: `用真实现场呈现${products[index % Math.max(products.length, 1)] ?? context.account.brandName}，不使用未经确认的价格或活动。`,
        recommended_reason: '匹配账号风格，并补充当前月度计划的结构化内容供给。',
      };
    }),
  });
}

export function aiPlannerService(
  db: Database,
  organizationId: string,
  userId: string,
  runtime: { now?: () => Date; client?: OpenAICompatibleClient } = {},
) {
  const permissions = permissionService(db, organizationId, userId);
  const now = runtime.now ?? (() => new Date());
  const timestamp = () => now().toISOString();
  const ai = plannerAiRuntime(db, organizationId, userId, runtime);
  const history = historyRetrievalService(db, organizationId, userId, { now });
  const contexts = contextBuilder(db, organizationId, userId, { now });
  const isDemo = permissions.organization.isDemo;

  const account = (id: string, write = true) => {
    const row = db.select().from(tables.accounts).where(and(
      eq(tables.accounts.organizationId, organizationId), eq(tables.accounts.id, z.uuid().parse(id)),
    )).get();
    if (!row) throw missing();
    if (write) permissions.requireClientWrite(row.clientId); else permissions.requireClientRead(row.clientId);
    return row;
  };

  const currentPlan = (accountId: string) => {
    const at = now();
    return db.select().from(tables.monthlyPlans).where(and(
      eq(tables.monthlyPlans.organizationId, organizationId), eq(tables.monthlyPlans.accountId, accountId),
      eq(tables.monthlyPlans.year, at.getUTCFullYear()), eq(tables.monthlyPlans.month, at.getUTCMonth() + 1),
      eq(tables.monthlyPlans.status, 'active'),
    )).get() ?? null;
  };

  const gaps = (plan: typeof tables.monthlyPlans.$inferSelect | null) => {
    if (!plan) return [];
    const actual = Object.fromEntries(db.select({ contentType: tables.contents.contentType, value: count() })
      .from(tables.contents).where(and(
        eq(tables.contents.organizationId, organizationId), eq(tables.contents.monthlyPlanId, plan.id),
      )).groupBy(tables.contents.contentType).all().map((row) => [row.contentType, row.value]));
    return calculateMixStats(plan.plannedContentCount, plan.contentMixJson, actual)
      .map((row) => ({ ...row, gap: Math.max(0, row.targetCount - row.actualCount) }));
  };

  const session = (id: string) => {
    const row = db.select().from(tables.plannerSessions).where(and(
      eq(tables.plannerSessions.organizationId, organizationId), eq(tables.plannerSessions.id, z.uuid().parse(id)),
    )).get();
    if (!row) throw missing();
    account(row.accountId);
    return row;
  };

  const view = (row: typeof tables.plannerSessions.$inferSelect) => {
    const accountRow = account(row.accountId);
    const run = db.select({ status: tables.runs.status }).from(tables.runs).where(and(
      eq(tables.runs.organizationId, organizationId), eq(tables.runs.id, row.runId),
    )).get();
    if (!run) throw missing();
    const candidates = db.select().from(tables.plannerCandidates).where(and(
      eq(tables.plannerCandidates.organizationId, organizationId),
      eq(tables.plannerCandidates.plannerSessionId, row.id),
      ne(tables.plannerCandidates.status, 'replaced'),
    )).orderBy(asc(tables.plannerCandidates.sequence)).all().map((item) => ({
      id: item.id, sequence: item.sequence, revision: item.revision, title: item.title,
      contentType: item.contentType, contentGoal: item.contentGoal, topic: item.topic, angle: item.angle,
      hookType: item.hookType, hookIdea: item.hookIdea, coreMessage: item.coreMessage,
      recommendedReason: item.recommendedReason, duplicateLevel: item.duplicateLevel,
      similarContents: item.similarContentsJson, duplicateReason: item.duplicateReason,
      alternativeAngles: item.alternativeAnglesJson, qualityStatus: item.qualityStatus,
      qualityIssues: item.qualityIssuesJson, selectable: item.selectable, status: item.status,
      persistedContentId: item.persistedContentId,
    }));
    return plannerSessionViewSchema.parse({
      id: row.id, runId: row.runId, accountId: row.accountId, accountName: accountRow.accountName,
      monthlyPlanId: row.monthlyPlanId, contextSnapshotId: row.contextSnapshotId,
      plannedCount: row.plannedCount, shootDate: row.shootDate, primaryGoal: row.primaryGoal,
      specialRequirements: row.specialRequirements, planningSummary: row.planningSummary,
      status: row.status, plannerSkillVersion: row.plannerSkillVersion,
      plannerPointCost: row.plannerPointCost, selectedCount: row.selectedCount,
      completedAt: row.completedAt, createdAt: row.createdAt, updatedAt: row.updatedAt,
      candidates, gaps: gaps(row.monthlyPlanId ? db.select().from(tables.monthlyPlans).where(and(
        eq(tables.monthlyPlans.organizationId, organizationId), eq(tables.monthlyPlans.accountId, row.accountId),
        eq(tables.monthlyPlans.id, row.monthlyPlanId),
      )).get() ?? null : null), run,
    });
  };

  const step = (runId: string, code: typeof STEP_CODES[number]) => {
    const row = db.select().from(tables.runSteps).where(and(
      eq(tables.runSteps.organizationId, organizationId), eq(tables.runSteps.runId, runId), eq(tables.runSteps.stepCode, code),
    )).orderBy(desc(tables.runSteps.sequence)).get();
    if (!row) throw missing();
    return row;
  };

  const startStep = (id: string, input: unknown) => {
    const startedAt = timestamp();
    db.update(tables.runSteps).set({ status: 'running', inputJson: json(input), startedAt })
      .where(and(eq(tables.runSteps.organizationId, organizationId), eq(tables.runSteps.id, id))).run();
    return now().getTime();
  };
  const finishStep = (id: string, started: number, output: unknown, warnings: string[] = []) => {
    const finishedAt = timestamp();
    db.update(tables.runSteps).set({ status: 'succeeded', outputJson: json(output), errorJson: null,
      warningCodesJson: warnings.length ? json(warnings) : null, finishedAt, durationMs: duration(started, now().getTime()) })
      .where(and(eq(tables.runSteps.organizationId, organizationId), eq(tables.runSteps.id, id))).run();
  };
  const failRun = (runId: string, stepId: string, error: unknown) => {
    const finishedAt = timestamp();
    const detail = { code: error instanceof ApiError ? error.code : 'PLANNER_FAILED', message: error instanceof Error ? error.message : 'Planner 失败' };
    db.transaction(() => {
      db.update(tables.runSteps).set({ status: 'failed', errorJson: json(detail), finishedAt })
        .where(and(eq(tables.runSteps.organizationId, organizationId), eq(tables.runSteps.id, stepId))).run();
      db.update(tables.runSteps).set({ status: 'skipped', errorJson: json({ code: 'UPSTREAM_FAILED' }), finishedAt })
        .where(and(eq(tables.runSteps.organizationId, organizationId), eq(tables.runSteps.runId, runId), eq(tables.runSteps.status, 'pending'))).run();
      db.update(tables.runs).set({ status: 'failed', finishedAt })
        .where(and(eq(tables.runs.organizationId, organizationId), eq(tables.runs.id, runId))).run();
      db.update(tables.plannerSessions).set({ status: 'failed', updatedAt: finishedAt })
        .where(and(eq(tables.plannerSessions.organizationId, organizationId), eq(tables.plannerSessions.runId, runId))).run();
    });
  };

  const createTracking = (input: PlannerInput, accountId: string, planId: string | null, skillVersion: number, pointCost: number) => {
    const createdAt = timestamp();
    const runId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    db.transaction(() => {
      db.insert(tables.runs).values({ id: runId, organizationId, runType: 'production', subjectType: 'ai_content_planner',
        subjectId: sessionId, status: 'running', startedAt: createdAt, finishedAt: null,
        createdBy: userId, isDemo, createdAt }).run();
      db.insert(tables.runSteps).values(STEP_CODES.map((code, sequence) => ({
        id: crypto.randomUUID(), organizationId, runId, sequence, stepCode: code, status: 'pending' as const,
        inputJson: null, outputJson: null, errorJson: null, startedAt: null, finishedAt: null,
        durationMs: null, warningCodesJson: null, isDemo,
      }))).run();
      db.insert(tables.plannerSessions).values({
        id: sessionId, organizationId, runId, accountId, monthlyPlanId: planId, contextSnapshotId: null,
        plannedCount: input.plannedCount, shootDate: input.shootDate, primaryGoal: input.primaryGoal,
        specialRequirements: input.specialRequirements, planningSummary: '', status: 'generating',
        plannerSkillVersion: skillVersion, plannerPointCost: pointCost, selectedCount: 0,
        createdBy: userId, isDemo, completedAt: null, createdAt, updatedAt: createdAt,
      }).run();
    });
    return { runId, sessionId };
  };

  const plannerAiInput = (input: PlannerInput, context: ContextBuildResult, planGaps: ReturnType<typeof gaps>, replacement: Record<string, unknown> = {}) => ({
    request: { account_id: input.accountId, planned_count: input.plannedCount, shoot_date: input.shootDate ?? '',
      primary_goal: input.primaryGoal, special_requirements: input.specialRequirements ?? '' },
    context: context.layers, plan_gaps: planGaps, replacement,
  });

  const allowedDynamicText = (context: ContextBuildResult) => json({
    stable: context.layers.l1StableContext,
    current: context.layers.l2Current,
    memories: context.layers.l3Memories,
  });

  const deterministicQuality = (candidateId: string, item: PlannerItem, accountRow: typeof tables.accounts.$inferSelect, planGaps: ReturnType<typeof gaps>, primaryGoal: PlannerInput['primaryGoal'], inherited: QualityIssue[]) => {
    const brand = db.select().from(tables.brands).where(and(
      eq(tables.brands.organizationId, organizationId), eq(tables.brands.id, accountRow.brandId),
    )).get();
    if (!brand) throw missing();
    const full = `${item.title} ${item.topic} ${item.angle} ${item.hook_idea} ${item.core_message}`;
    const issues: QualityIssue[] = [...inherited];
    for (const topic of brand.forbiddenTopicsJson.filter(Boolean)) if (full.includes(topic)) issues.push({
      code: 'forbidden_topic', message: `命中禁用主题：${topic}`, field: null, blocking: true,
    });
    for (const style of accountRow.forbiddenStyleJson.filter(Boolean)) if (full.includes(style)) issues.push({
      code: 'forbidden_style', message: `命中禁用风格：${style}`, field: null, blocking: true,
    });
    const typeGap = planGaps.find((gap) => gap.contentType === item.content_type);
    if (planGaps.length && (!typeGap || typeGap.targetCount === 0) && item.content_goal !== primaryGoal) issues.push({
      code: 'plan_conflict', message: '该类型未配置在本月内容组合中，且内容目标与本次主目标不一致。', field: 'content_type', blocking: false,
    });
    const status = issues.some((issue) => issue.blocking) ? 'blocked' : issues.length ? 'warning' : 'passed';
    return { candidate_id: candidateId, status, issues } as const;
  };

  async function evaluateItems(args: {
    runId: string; input: PlannerInput; context: ContextBuildResult; items: PlannerItem[];
    retrievalStepId: string; duplicateStepId: string; qualityStepId: string;
    sequenceOffset?: number;
  }) {
    const accountRow = account(args.input.accountId);
    const planGaps = gaps(currentPlan(accountRow.id));
    const retrievalStarted = startStep(args.retrievalStepId, { candidateCount: args.items.length, accountId: accountRow.id });
    const retrievals = [];
    for (const rawItem of args.items) {
      const scrubbed = scrubUnverifiedDynamicFacts(rawItem, allowedDynamicText(args.context));
      const candidateId = crypto.randomUUID();
      const retrieval = await history.retrieveForRun({
        accountId: accountRow.id, title: scrubbed.item.title, contentType: scrubbed.item.content_type,
        contentGoal: scrubbed.item.content_goal, topic: scrubbed.item.topic, angle: scrubbed.item.angle,
        hookText: scrubbed.item.hook_idea, coreMessage: scrubbed.item.core_message,
      }, args.runId);
      retrievals.push({ candidateId, item: scrubbed.item, inheritedIssues: scrubbed.issues, retrieval });
    }
    finishStep(args.retrievalStepId, retrievalStarted, { retrievalIds: retrievals.map((item) => item.retrieval.retrievalId), top10Counts: retrievals.map((item) => item.retrieval.top10.length) });

    const duplicateStarted = startStep(args.duplicateStepId, { candidateIds: retrievals.map((item) => item.candidateId) });
    const duplicateWarnings: string[] = [];
    const judged: Array<(typeof retrievals)[number] & { judgment: z.infer<typeof duplicateJudgeOutputSchema> }> = [];
    for (const item of retrievals) {
      let judgment = item.retrieval.fallbackJudgment;
      if (item.retrieval.judgeInput.length) {
        try {
          const result = await ai.invoke({
            runId: args.runId, stepId: args.duplicateStepId, skillCode: 'duplicate_judge',
            accountId: accountRow.id, clientId: accountRow.clientId,
            input: {
              candidate: { title: item.item.title, content_type: item.item.content_type, content_goal: item.item.content_goal,
                topic: item.item.topic, angle: item.item.angle, hook_text: item.item.hook_idea, core_message: item.item.core_message },
              similar_contents: item.retrieval.judgeInput,
            }, outputSchema: duplicateJudgeOutputSchema, mockOutput: item.retrieval.fallbackJudgment,
            validateOutput(output) {
              const allowed = new Set(item.retrieval.judgeInputContentIds);
              if (output.similar_content_ids.some((id) => !allowed.has(id)))
                throw new ApiError(502, 'DUPLICATE_REFERENCE_INVALID', 'duplicate_judge 引用了本次 Top5 之外的 content_id');
            },
          });
          judgment = result.output;
        } catch (error) {
          duplicateWarnings.push(error instanceof ApiError ? error.code : 'DUPLICATE_JUDGE_FALLBACK');
        }
      }
      judged.push({ ...item, judgment });
    }
    finishStep(args.duplicateStepId, duplicateStarted, { results: judged.map((item) => ({ candidateId: item.candidateId, ...item.judgment })) }, duplicateWarnings);

    const deterministic = judged.map((entry) => deterministicQuality(entry.candidateId, entry.item, accountRow, planGaps, args.input.primaryGoal, entry.inheritedIssues));
    const qualityStarted = startStep(args.qualityStepId, { candidateIds: judged.map((item) => item.candidateId) });
    let quality = deterministic;
    const qualityWarnings: string[] = [];
    try {
      const result = await ai.invoke({
        runId: args.runId, stepId: args.qualityStepId, skillCode: 'quality_checker', accountId: accountRow.id,
        clientId: accountRow.clientId,
        input: {
          candidates: judged.map((entry) => ({ candidate_id: entry.candidateId, ...entry.item })),
          constraints: { forbidden_topics: db.select({ value: tables.brands.forbiddenTopicsJson }).from(tables.brands).where(and(
            eq(tables.brands.organizationId, organizationId), eq(tables.brands.id, accountRow.brandId),
          )).get()?.value ?? [], forbidden_styles: accountRow.forbiddenStyleJson,
          verified_facts: { stable: args.context.layers.l1StableContext, current: args.context.layers.l2Current, memories: args.context.layers.l3Memories },
          dynamic_fact_source: 'context_l1_l2_l3_only' },
          plan_gaps: planGaps,
        }, outputSchema: qualityOutputSchema, mockOutput: { candidates: deterministic.map((item) => ({
          ...item, issues: item.issues.map((issue) => ({ ...issue, field: issue.field ?? '' })),
        })) },
        validateOutput(output) {
          const expected = new Set(judged.map((item) => item.candidateId));
          if (output.candidates.length !== expected.size || output.candidates.some((item) => !expected.has(item.candidate_id)))
            throw new ApiError(502, 'QUALITY_REFERENCE_INVALID', 'quality_checker 候选引用不完整或越界');
        },
      });
      quality = result.output.candidates.map((aiItem) => {
        const base = deterministic.find((item) => item.candidate_id === aiItem.candidate_id)!;
        const mergedIssues = [...base.issues, ...aiItem.issues.filter((issue) => !base.issues.some((baseIssue) => baseIssue.code === issue.code && baseIssue.message === issue.message))];
        return { candidate_id: aiItem.candidate_id, status: mergedIssues.some((issue) => issue.blocking) || aiItem.status === 'blocked' ? 'blocked' as const : mergedIssues.length || aiItem.status === 'warning' ? 'warning' as const : 'passed' as const, issues: mergedIssues };
      });
    } catch (error) {
      qualityWarnings.push(error instanceof ApiError ? error.code : 'QUALITY_CHECKER_FALLBACK');
    }
    if (quality.some((item) => item.status !== 'passed')) qualityWarnings.push('QUALITY_ISSUES_PRESENT');
    finishStep(args.qualityStepId, qualityStarted, { results: quality }, qualityWarnings);
    return judged.map((entry, index) => {
      const checked = quality.find((item) => item.candidate_id === entry.candidateId)!;
      return {
        id: entry.candidateId, sequence: (args.sequenceOffset ?? 0) + index, revision: 1,
        item: entry.item, retrieval: entry.retrieval, judgment: entry.judgment, quality: checked,
        selectable: entry.judgment.duplicate_level !== 'high' && checked.status !== 'blocked',
      };
    });
  }

  return {
    pageData() {
      const readable = permissions.readableClientIds();
      const predicates = [eq(tables.accounts.organizationId, organizationId), eq(tables.accounts.status, 'active')];
      if (readable) predicates.push(readable.length ? inArray(tables.accounts.clientId, readable) : sql`0 = 1`);
      let plannerPointCost: number | null = null;
      try { plannerPointCost = ai.skill('content_planner').pointCost; } catch { plannerPointCost = null; }
      const quota = ai.activeQuota();
      const accounts = db.select({ id: tables.accounts.id, accountName: tables.accounts.accountName,
        clientId: tables.accounts.clientId, clientName: tables.clients.clientName })
        .from(tables.accounts).innerJoin(tables.clients, and(
          eq(tables.clients.organizationId, organizationId), eq(tables.clients.id, tables.accounts.clientId),
        )).where(and(...predicates)).orderBy(asc(tables.clients.clientName), asc(tables.accounts.accountName)).all()
        .map((item) => {
          const plan = currentPlan(item.id);
          return { ...item, canWrite: permissions.canWriteClient(item.clientId),
            currentPlan: plan ? { id: plan.id, year: plan.year, month: plan.month, primaryGoal: plan.primaryGoal, plannedContentCount: plan.plannedContentCount } : null,
            gaps: gaps(plan),
          };
        });
      return plannerPageDataSchema.parse({ accounts, remainingPoints: quota ? quota.quotaPoints - quota.usedPoints : 0,
        plannerPointCost, mode: ai.publicConfig.mode, permissions: { canPlan: plannerPointCost !== null && permissions.has('ai.test') && accounts.some((item) => item.canWrite) } });
    },

    detail(id: string) { return view(session(id)); },

    async generate(input: unknown) {
      const value = plannerInputSchema.parse(input);
      const accountRow = account(value.accountId);
      permissions.require('ai.test');
      const plannerSkill = ai.skill('content_planner');
      ai.requireQuota(plannerSkill.pointCost);
      const plan = currentPlan(accountRow.id);
      const tracking = createTracking(value, accountRow.id, plan?.id ?? null, plannerSkill.currentVersion, plannerSkill.pointCost);
      let activeStepId = step(tracking.runId, 'context_build').id;
      try {
        const contextStarted = startStep(activeStepId, { accountId: value.accountId, monthlyPlanId: plan?.id ?? null, focus: [value.primaryGoal, value.specialRequirements].filter(Boolean).join(' ') });
        const context = contexts.build({ accountId: value.accountId, ...(plan ? { monthlyPlanId: plan.id } : {}), focus: [value.primaryGoal, value.specialRequirements].filter(Boolean).join(' ') });
        db.update(tables.plannerSessions).set({ contextSnapshotId: context.snapshotId, updatedAt: timestamp() })
          .where(and(eq(tables.plannerSessions.organizationId, organizationId), eq(tables.plannerSessions.id, tracking.sessionId))).run();
        finishStep(activeStepId, contextStarted, { snapshotId: context.snapshotId, snapshot: context.snapshot });

        const plannerStep = step(tracking.runId, 'content_planner');
        activeStepId = plannerStep.id;
        const planGaps = gaps(plan);
        const plannerInput = plannerAiInput(value, context, planGaps);
        const plannerStarted = startStep(plannerStep.id, { request: plannerInput.request, contextSnapshotId: context.snapshotId, planGaps });
        const generated = await ai.invoke({
          runId: tracking.runId, stepId: plannerStep.id, skillCode: 'content_planner', accountId: accountRow.id,
          clientId: accountRow.clientId, input: plannerInput, outputSchema: plannerOutputSchema,
          mockOutput: mockPlanner(value, context),
          validateOutput(output) {
            if (output.items.length !== value.plannedCount)
              throw new ApiError(502, 'PLANNER_COUNT_MISMATCH', `Planner 应返回 ${value.plannedCount} 条候选`);
          },
        });
        finishStep(plannerStep.id, plannerStarted, { rawOutput: generated.rawOutput, parsed: generated.output, schemaValid: true, mode: generated.mode });

        activeStepId = step(tracking.runId, 'candidate_retrieval').id;
        const evaluated = await evaluateItems({ runId: tracking.runId, input: value, context, items: generated.output.items,
          retrievalStepId: activeStepId, duplicateStepId: step(tracking.runId, 'candidate_duplicate_judge').id,
          qualityStepId: step(tracking.runId, 'quality_check').id });
        const updatedAt = timestamp();
        db.transaction(() => {
          db.insert(tables.plannerCandidates).values(evaluated.map((entry) => ({
            id: entry.id, organizationId, plannerSessionId: tracking.sessionId, accountId: accountRow.id,
            sourceRunId: tracking.runId, sequence: entry.sequence, revision: entry.revision, replacesCandidateId: null,
            title: entry.item.title, contentType: entry.item.content_type, contentGoal: entry.item.content_goal,
            topic: entry.item.topic, angle: entry.item.angle, hookType: entry.item.hook_type, hookIdea: entry.item.hook_idea,
            coreMessage: entry.item.core_message, recommendedReason: entry.item.recommended_reason,
            duplicateLevel: entry.judgment.duplicate_level,
            similarContentsJson: entry.retrieval.top10.map(({ contentId, title, topic, angle, similarity, ruleScore }) => ({ contentId, title, topic, angle, similarity, ruleScore })),
            duplicateReason: entry.judgment.reason, alternativeAnglesJson: entry.judgment.alternative_angles,
            qualityStatus: entry.quality.status, qualityIssuesJson: entry.quality.issues,
            selectable: entry.selectable, status: 'active' as const, persistedContentId: null,
            isDemo, createdAt: updatedAt, updatedAt,
          }))).run();
          db.update(tables.plannerSessions).set({ planningSummary: generated.output.planning_summary, status: 'awaiting_selection', updatedAt })
            .where(and(eq(tables.plannerSessions.organizationId, organizationId), eq(tables.plannerSessions.id, tracking.sessionId))).run();
          db.update(tables.runs).set({ status: 'manual_review_required' })
            .where(and(eq(tables.runs.organizationId, organizationId), eq(tables.runs.id, tracking.runId))).run();
          db.insert(tables.auditLogs).values({ id: crypto.randomUUID(), organizationId, userId, action: 'planner.candidates_generated',
            entityType: 'planner_session', entityId: tracking.sessionId, metadataJson: json({ candidateCount: evaluated.length }), isDemo, createdAt: updatedAt }).run();
        });
        return view(session(tracking.sessionId));
      } catch (error) {
        failRun(tracking.runId, activeStepId, error);
        throw error;
      }
    },

    persist(id: string, input: unknown) {
      const value = persistPlannerSelectionSchema.parse(input);
      const row = session(id);
      if (row.status !== 'awaiting_selection') throw new ApiError(409, 'PLANNER_SESSION_FINALIZED', '该策划会话已结束');
      const selected = db.select().from(tables.plannerCandidates).where(and(
        eq(tables.plannerCandidates.organizationId, organizationId), eq(tables.plannerCandidates.plannerSessionId, row.id),
        inArray(tables.plannerCandidates.id, value.candidateIds), eq(tables.plannerCandidates.status, 'active'),
      )).all();
      if (selected.length !== value.candidateIds.length) throw new ApiError(404, 'CANDIDATE_NOT_FOUND', '候选不存在、已替换或不属于当前会话');
      if (selected.some((item) => !item.selectable || item.duplicateLevel === 'high' || item.qualityStatus === 'blocked'))
        throw new ApiError(409, 'CANDIDATE_NOT_SELECTABLE', '高度重复或质量阻断的候选不能保存');
      const accountRow = account(row.accountId);
      const persistStep = step(row.runId, 'persist_selected_contents');
      const startedAt = timestamp();
      const createdIds: string[] = [];
      try {
        db.transaction(() => {
          const at = timestamp();
          const claimed = db.update(tables.plannerSessions).set({ updatedAt: at }).where(and(
            eq(tables.plannerSessions.organizationId, organizationId), eq(tables.plannerSessions.id, row.id),
            eq(tables.plannerSessions.status, 'awaiting_selection'),
          )).run();
          if (claimed.changes !== 1)
            throw new ApiError(409, 'PLANNER_SESSION_FINALIZED', '该策划会话已结束');
          let quota: typeof tables.organizationAiQuotas.$inferSelect | null = null;
          if (row.plannerPointCost > 0) {
            quota = db.select().from(tables.organizationAiQuotas).where(and(
              eq(tables.organizationAiQuotas.organizationId, organizationId), lte(tables.organizationAiQuotas.periodStart, at),
              gt(tables.organizationAiQuotas.periodEnd, at),
            )).orderBy(desc(tables.organizationAiQuotas.periodStart)).get() ?? null;
            if (!quota) throw new ApiError(402, 'AI_QUOTA_EXCEEDED', 'AI Points 额度期不可用');
          }
          db.update(tables.runSteps).set({ status: 'running', inputJson: json({ candidateIds: value.candidateIds }), startedAt })
            .where(and(eq(tables.runSteps.organizationId, organizationId), eq(tables.runSteps.id, persistStep.id), eq(tables.runSteps.status, 'pending'))).run();
          for (const candidate of selected) {
            const content = contentSchema.parse({
              id: crypto.randomUUID(), organizationId, clientId: accountRow.clientId, brandId: accountRow.brandId,
              storeId: accountRow.storeId, accountId: accountRow.id, monthlyPlanId: row.monthlyPlanId,
              title: candidate.title, contentType: candidate.contentType, contentGoal: candidate.contentGoal,
              topic: candidate.topic, angle: candidate.angle, hookType: candidate.hookType, hookText: candidate.hookIdea,
              coreMessage: candidate.coreMessage, productText: '', ctaType: '', localElement: '', peopleJson: [],
              status: 'IDEA', priority: 'normal', operatorId: userId, plannedPublishDate: null, publishedAt: null,
              deadline: null, externalId: null, importDedupKey: null, importBatchId: null,
              currentScriptVersionId: null, activeApprovedScriptVersionId: null, currentEditVersionId: null,
              activeApprovedEditVersionId: null, aiReviewStatus: candidate.qualityStatus,
              createdBy: userId, isDemo, createdAt: at, updatedAt: at,
            });
            db.insert(tables.contents).values(content).run();
            db.update(tables.plannerCandidates).set({ status: 'persisted', persistedContentId: content.id, updatedAt: at })
              .where(and(eq(tables.plannerCandidates.organizationId, organizationId), eq(tables.plannerCandidates.id, candidate.id))).run();
            createdIds.push(content.id);
          }
          db.update(tables.plannerCandidates).set({ status: 'dismissed', updatedAt: at }).where(and(
            eq(tables.plannerCandidates.organizationId, organizationId), eq(tables.plannerCandidates.plannerSessionId, row.id),
            eq(tables.plannerCandidates.status, 'active'),
          )).run();
          if (row.plannerPointCost > 0 && quota) {
            const changed = db.update(tables.organizationAiQuotas).set({ usedPoints: sql`${tables.organizationAiQuotas.usedPoints} + ${row.plannerPointCost}`, updatedAt: at })
              .where(and(eq(tables.organizationAiQuotas.organizationId, organizationId), eq(tables.organizationAiQuotas.id, quota.id),
                sql`${tables.organizationAiQuotas.usedPoints} + ${row.plannerPointCost} <= ${tables.organizationAiQuotas.quotaPoints}`)).run();
            if (changed.changes !== 1) throw new ApiError(402, 'AI_QUOTA_EXCEEDED', 'AI Points 余额不足');
            db.insert(tables.aiPointLedger).values({ id: crypto.randomUUID(), organizationId, runId: row.runId,
              skillCode: 'content_planner', points: row.plannerPointCost, ledgerType: 'consume',
              reason: 'AI Content Planner 已选候选成功写入内容库', isDemo, createdAt: at }).run();
            const usage = db.select({ id: tables.aiUsageLogs.id }).from(tables.aiUsageLogs).where(and(
              eq(tables.aiUsageLogs.organizationId, organizationId), eq(tables.aiUsageLogs.runId, row.runId),
              eq(tables.aiUsageLogs.skillCode, 'content_planner'), eq(tables.aiUsageLogs.status, 'completed'),
            )).orderBy(asc(tables.aiUsageLogs.createdAt)).get();
            if (usage) db.update(tables.aiUsageLogs).set({ billedPoints: row.plannerPointCost })
              .where(and(eq(tables.aiUsageLogs.organizationId, organizationId), eq(tables.aiUsageLogs.id, usage.id))).run();
          }
          db.update(tables.plannerSessions).set({ status: 'completed', selectedCount: selected.length, completedAt: at, updatedAt: at })
            .where(and(eq(tables.plannerSessions.organizationId, organizationId), eq(tables.plannerSessions.id, row.id), eq(tables.plannerSessions.status, 'awaiting_selection'))).run();
          db.update(tables.runSteps).set({ status: 'succeeded', outputJson: json({ contentIds: createdIds, billedPoints: row.plannerPointCost }),
            finishedAt: at, durationMs: duration(new Date(startedAt).getTime(), now().getTime()) })
            .where(and(eq(tables.runSteps.organizationId, organizationId), eq(tables.runSteps.id, persistStep.id))).run();
          const hasWarnings = db.select({ id: tables.runSteps.id }).from(tables.runSteps).where(and(
            eq(tables.runSteps.organizationId, organizationId), eq(tables.runSteps.runId, row.runId),
            sql`${tables.runSteps.warningCodesJson} IS NOT NULL`,
          )).get();
          db.update(tables.runs).set({ status: hasWarnings ? 'completed_with_warnings' : 'completed', finishedAt: at })
            .where(and(eq(tables.runs.organizationId, organizationId), eq(tables.runs.id, row.runId))).run();
          db.insert(tables.auditLogs).values({ id: crypto.randomUUID(), organizationId, userId, action: 'planner.selection_persisted',
            entityType: 'planner_session', entityId: row.id, metadataJson: json({ contentIds: createdIds, billedPoints: row.plannerPointCost }), isDemo, createdAt: at }).run();
        });
      } catch (error) {
        const at = timestamp();
        const latestStatus = db.select({ status: tables.plannerSessions.status }).from(tables.plannerSessions).where(and(
          eq(tables.plannerSessions.organizationId, organizationId), eq(tables.plannerSessions.id, row.id),
        )).get()?.status;
        if (latestStatus === 'completed') throw error;
        db.update(tables.runSteps).set({ status: 'failed', inputJson: json({ candidateIds: value.candidateIds }),
          errorJson: json({ code: error instanceof ApiError ? error.code : 'PERSIST_FAILED' }), startedAt, finishedAt: at,
          durationMs: duration(new Date(startedAt).getTime(), now().getTime()) })
          .where(and(eq(tables.runSteps.organizationId, organizationId), eq(tables.runSteps.id, persistStep.id))).run();
        db.update(tables.runs).set({ status: 'failed', finishedAt: at })
          .where(and(eq(tables.runs.organizationId, organizationId), eq(tables.runs.id, row.runId))).run();
        db.update(tables.plannerSessions).set({ status: 'failed', updatedAt: at })
          .where(and(eq(tables.plannerSessions.organizationId, organizationId), eq(tables.plannerSessions.id, row.id))).run();
        throw error;
      }
      return persistPlannerResultSchema.parse({ session: view(session(row.id)), contentIds: createdIds, billedPoints: row.plannerPointCost });
    },

    async reangle(id: string, candidateId: string, input: unknown) {
      const value = reanglePlannerCandidateSchema.parse(input);
      const row = session(id);
      if (row.status !== 'awaiting_selection') throw new ApiError(409, 'PLANNER_SESSION_FINALIZED', '该策划会话已结束');
      const current = db.select().from(tables.plannerCandidates).where(and(
        eq(tables.plannerCandidates.organizationId, organizationId), eq(tables.plannerCandidates.plannerSessionId, row.id),
        eq(tables.plannerCandidates.id, z.uuid().parse(candidateId)), eq(tables.plannerCandidates.status, 'active'),
      )).get();
      if (!current) throw missing();
      ai.requireQuota(row.plannerPointCost);
      const snapshot = row.contextSnapshotId ? db.select().from(tables.contextSnapshots).where(and(
        eq(tables.contextSnapshots.organizationId, organizationId), eq(tables.contextSnapshots.id, row.contextSnapshotId),
      )).get() : null;
      if (!snapshot) throw missing();
      const context = { snapshotId: snapshot.id, ...(snapshot.contextSnapshotJson as Omit<ContextBuildResult, 'snapshotId' | 'account'>),
        account: { id: row.accountId, name: account(row.accountId).accountName, brandId: account(row.accountId).brandId,
          brandName: db.select({ value: tables.brands.brandName }).from(tables.brands).where(and(eq(tables.brands.organizationId, organizationId), eq(tables.brands.id, account(row.accountId).brandId))).get()?.value ?? '',
          clientId: account(row.accountId).clientId } } as ContextBuildResult;
      const maxSequence = db.select({ value: sql<number>`coalesce(max(${tables.runSteps.sequence}), -1)` }).from(tables.runSteps).where(and(
        eq(tables.runSteps.organizationId, organizationId), eq(tables.runSteps.runId, row.runId),
      )).get()?.value ?? 5;
      const codes = ['content_planner', 'candidate_retrieval', 'candidate_duplicate_judge', 'quality_check'] as const;
      const newSteps = codes.map((code, index) => ({ id: crypto.randomUUID(), organizationId, runId: row.runId,
        sequence: maxSequence + index + 1, stepCode: code, status: 'pending' as const, inputJson: null, outputJson: null,
        errorJson: null, startedAt: null, finishedAt: null, durationMs: null, warningCodesJson: null, isDemo }));
      db.insert(tables.runSteps).values(newSteps).run();
      try {
        const request: PlannerInput = { accountId: row.accountId, plannedCount: 1, shootDate: row.shootDate,
          primaryGoal: row.primaryGoal, specialRequirements: row.specialRequirements };
        const plannerInput = plannerAiInput(request, context, gaps(currentPlan(row.accountId)), {
          replaces_candidate_id: current.id, previous: { title: current.title, topic: current.topic, angle: current.angle,
            hook_idea: current.hookIdea, core_message: current.coreMessage }, requested_angle: value.alternativeAngle ?? '',
          instruction: '必须采用不同的 Angle、Hook 与 Core Message，且不得只改写标题。',
        });
        const started = startStep(newSteps[0].id, { request: plannerInput.request, replacement: plannerInput.replacement, contextSnapshotId: context.snapshotId });
        const generated = await ai.invoke({ runId: row.runId, stepId: newSteps[0].id, skillCode: 'content_planner',
          accountId: row.accountId, clientId: account(row.accountId).clientId, input: plannerInput,
          outputSchema: plannerOutputSchema, mockOutput: mockPlanner(request, context, 1),
          validateOutput(output) { if (output.items.length !== 1) throw new ApiError(502, 'PLANNER_COUNT_MISMATCH', '换角度必须返回 1 条候选'); },
        });
        const replacement = { ...generated.output.items[0],
          angle: value.alternativeAngle || `${generated.output.items[0].angle}，避开原候选的表达路径`,
          title: generated.output.items[0].title === current.title ? `${generated.output.items[0].title}·新角度` : generated.output.items[0].title };
        finishStep(newSteps[0].id, started, { parsed: replacement, mode: generated.mode });
        const evaluated = await evaluateItems({ runId: row.runId, input: request, context, items: [plannerItemSchema.parse(replacement)],
          retrievalStepId: newSteps[1].id, duplicateStepId: newSteps[2].id, qualityStepId: newSteps[3].id,
          sequenceOffset: current.sequence });
        const entry = evaluated[0];
        const at = timestamp();
        db.transaction(() => {
          db.update(tables.plannerCandidates).set({ status: 'replaced', updatedAt: at }).where(and(
            eq(tables.plannerCandidates.organizationId, organizationId), eq(tables.plannerCandidates.id, current.id), eq(tables.plannerCandidates.status, 'active'),
          )).run();
          db.insert(tables.plannerCandidates).values({
            id: entry.id, organizationId, plannerSessionId: row.id, accountId: row.accountId, sourceRunId: row.runId,
            sequence: current.sequence, revision: current.revision + 1, replacesCandidateId: current.id,
            title: entry.item.title, contentType: entry.item.content_type, contentGoal: entry.item.content_goal,
            topic: entry.item.topic, angle: entry.item.angle, hookType: entry.item.hook_type, hookIdea: entry.item.hook_idea,
            coreMessage: entry.item.core_message, recommendedReason: entry.item.recommended_reason,
            duplicateLevel: entry.judgment.duplicate_level,
            similarContentsJson: entry.retrieval.top10.map(({ contentId, title, topic, angle, similarity, ruleScore }) => ({ contentId, title, topic, angle, similarity, ruleScore })),
            duplicateReason: entry.judgment.reason, alternativeAnglesJson: entry.judgment.alternative_angles,
            qualityStatus: entry.quality.status, qualityIssuesJson: entry.quality.issues,
            selectable: entry.selectable, status: 'active', persistedContentId: null, isDemo, createdAt: at, updatedAt: at,
          }).run();
          db.insert(tables.auditLogs).values({ id: crypto.randomUUID(), organizationId, userId,
            action: 'planner.candidate_reangled', entityType: 'planner_candidate', entityId: entry.id,
            metadataJson: json({ replacedCandidateId: current.id, revision: current.revision + 1 }), isDemo, createdAt: at }).run();
        });
        return view(session(row.id));
      } catch (error) {
        const active = newSteps.find((item) => db.select({ status: tables.runSteps.status }).from(tables.runSteps).where(eq(tables.runSteps.id, item.id)).get()?.status === 'running') ?? newSteps[0];
        const at = timestamp();
        db.update(tables.runSteps).set({ status: 'failed', errorJson: json({ code: error instanceof ApiError ? error.code : 'REANGLE_FAILED' }), finishedAt: at })
          .where(and(eq(tables.runSteps.organizationId, organizationId), eq(tables.runSteps.id, active.id))).run();
        db.update(tables.runSteps).set({ status: 'skipped', errorJson: json({ code: 'UPSTREAM_FAILED' }), finishedAt: at })
          .where(and(eq(tables.runSteps.organizationId, organizationId), eq(tables.runSteps.runId, row.runId), eq(tables.runSteps.status, 'pending'))).run();
        throw error;
      }
    },
  };
}
