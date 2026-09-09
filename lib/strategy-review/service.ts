import { and, asc, count, desc, eq, gte, gt, inArray, lte, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { z } from 'zod';
import * as tables from '@/db/schema';
import { ApiError } from '@/lib/api/envelope';
import { permissionService } from '@/lib/auth/permissions';
import { contentService } from '@/lib/content/service';
import { calculateDerivedMetrics } from '@/lib/performance/service';
import { contextBuilder } from '@/lib/memory/context-builder';
import { OpenAICompatibleClient } from '@/lib/llm/client';
import { plannerAiRuntime } from '@/lib/planner/ai-runtime';
import {
  confirmStrategyReviewSchema,
  generateStrategyReviewSchema,
  nextPeriodPlanResultSchema,
  performanceAnalyzerOutputSchema,
  rejectStrategyReviewSchema,
  strategyMetricsSnapshotSchema,
  strategyPlannerOutputSchema,
  strategyReviewConfigSchema,
  strategyReviewConfirmationResultSchema,
  strategyReviewGenerationResultSchema,
  strategyReviewListQuerySchema,
  strategyReviewListSchema,
  strategyReviewPeriodSchema,
  strategyReviewSchema,
  strategyReviewViewSchema,
  updateStrategyReviewConfigSchema,
  type PerformanceAnalyzerOutput,
  type StrategyMetricsSnapshot,
  type StrategyPlannerOutput,
} from './contracts';

type Database = BetterSQLite3Database<typeof tables>;
type SnapshotRow = typeof tables.performanceSnapshots.$inferSelect;
type ContentRow = typeof tables.contents.$inferSelect;
type PublishRow = typeof tables.publishes.$inferSelect;
type Sample = { content: ContentRow; publish: PublishRow; snapshot: SnapshotRow };

const CONFIG_KEY = 'strategy_review.config';
const DEFAULT_CONFIG = { minimumSampleSize: 5 } as const;
const STEP_CODES = [
  'metrics_aggregate',
  'context_build',
  'performance_analyzer',
  'strategy_planner',
  'persist_strategy_review',
] as const;
const missing = () => new ApiError(404, 'NOT_FOUND', '记录不存在或不属于当前组织');
const json = (value: unknown) => JSON.stringify(value);
const duration = (started: number, ended: number) => Math.max(0, ended - started);

function safeRatio(numerator: number, denominator: number, multiplier = 1) {
  if (denominator === 0) return null;
  const value = (numerator / denominator) * multiplier;
  return Number.isFinite(value) ? value : null;
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function pairedRatio(
  samples: Sample[],
  numerator: (row: SnapshotRow) => number | null,
  denominator: (row: SnapshotRow) => number | null,
  multiplier = 1,
) {
  const pairs = samples.flatMap((sample) => {
    const top = numerator(sample.snapshot);
    const bottom = denominator(sample.snapshot);
    return top === null || bottom === null ? [] : [{ top, bottom }];
  });
  return safeRatio(
    pairs.reduce((sum, pair) => sum + pair.top, 0),
    pairs.reduce((sum, pair) => sum + pair.bottom, 0),
    multiplier,
  );
}

function groupMetrics(samples: Sample[], value: (sample: Sample) => string) {
  const groups = new Map<string, Sample[]>();
  for (const sample of samples) groups.set(value(sample), [...(groups.get(value(sample)) ?? []), sample]);
  return [...groups.entries()]
    .map(([group, rows]) => {
      const views = rows.flatMap((row) => (row.snapshot.views === null ? [] : [row.snapshot.views]));
      return {
        value: group,
        contentCount: rows.length,
        viewsSampleCount: views.length,
        averageViews: average(views),
        medianViews: median(views),
        groupbuyCtr: pairedRatio(rows, (row) => row.groupbuyClicks, (row) => row.views),
        gmvPer1000Views: pairedRatio(rows, (row) => row.gmv, (row) => row.views, 1000),
      };
    })
    .sort((a, b) => (b.averageViews ?? -1) - (a.averageViews ?? -1) || a.value.localeCompare(b.value));
}

function ranked(sample: Sample) {
  const metrics = calculateDerivedMetrics({
    snapshotTime: sample.snapshot.snapshotTime,
    views: sample.snapshot.views,
    likes: sample.snapshot.likes,
    comments: sample.snapshot.comments,
    shares: sample.snapshot.shares,
    favorites: sample.snapshot.favorites,
    profileVisits: sample.snapshot.profileVisits,
    groupbuyClicks: sample.snapshot.groupbuyClicks,
    orders: sample.snapshot.orders,
    gmv: sample.snapshot.gmv,
  });
  return {
    contentId: sample.content.id,
    title: sample.content.title,
    contentType: sample.content.contentType,
    hookType: sample.content.hookType,
    contentGoal: sample.content.contentGoal,
    topic: sample.content.topic,
    angle: sample.content.angle,
    coreMessage: sample.content.coreMessage,
    publishedAt: sample.publish.publishedAt,
    snapshotTime: sample.snapshot.snapshotTime,
    views: sample.snapshot.views!,
    groupbuyCtr: metrics.groupbuyCtr,
    gmvPer1000Views: metrics.gmvPer1000Views,
  };
}

/** Deterministic, LLM-free metrics boundary. One latest snapshot per publish avoids
 * summing cumulative snapshots more than once. */
export function aggregateStrategyMetrics(
  db: Database,
  organizationId: string,
  accountId: string,
  periodStart: string,
  periodEnd: string,
  generatedAt: string,
): StrategyMetricsSnapshot {
  strategyReviewPeriodSchema.parse({ accountId, periodStart, periodEnd });
  const account = db
    .select()
    .from(tables.accounts)
    .where(and(eq(tables.accounts.organizationId, organizationId), eq(tables.accounts.id, accountId)))
    .get();
  if (!account) throw missing();
  const published = db
    .select({ publish: tables.publishes, content: tables.contents })
    .from(tables.publishes)
    .innerJoin(
      tables.contents,
      and(
        eq(tables.contents.organizationId, tables.publishes.organizationId),
        eq(tables.contents.id, tables.publishes.contentId),
      ),
    )
    .where(
      and(
        eq(tables.publishes.organizationId, organizationId),
        eq(tables.publishes.status, 'active'),
        eq(tables.contents.accountId, accountId),
        gte(tables.publishes.publishedAt, periodStart),
        lte(tables.publishes.publishedAt, periodEnd),
      ),
    )
    .orderBy(asc(tables.publishes.publishedAt), asc(tables.publishes.id))
    .all();
  const samples = published.flatMap(({ publish, content }) => {
    const snapshot = db
      .select()
      .from(tables.performanceSnapshots)
      .where(
        and(
          eq(tables.performanceSnapshots.organizationId, organizationId),
          eq(tables.performanceSnapshots.publishId, publish.id),
          lte(tables.performanceSnapshots.snapshotTime, periodEnd),
        ),
      )
      .orderBy(desc(tables.performanceSnapshots.snapshotTime), desc(tables.performanceSnapshots.id))
      .get();
    return snapshot ? [{ publish, content, snapshot }] : [];
  });
  const views = samples.flatMap((sample) => (sample.snapshot.views === null ? [] : [sample.snapshot.views]));
  const rankedSamples = samples
    .filter((sample) => sample.snapshot.views !== null)
    .sort((a, b) => b.snapshot.views! - a.snapshot.views! || a.content.id.localeCompare(b.content.id));
  const publishedTimes = published.map((item) => new Date(item.publish.publishedAt).getTime()).sort((a, b) => a - b);
  const intervals = publishedTimes.slice(1).map((value, index) => (value - publishedTimes[index]) / 86_400_000);
  const start = new Date(periodStart);
  const end = new Date(periodEnd);
  const periodDays = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 86_400_000));
  const planDate = start;
  const currentPlan = db
    .select()
    .from(tables.monthlyPlans)
    .where(
      and(
        eq(tables.monthlyPlans.organizationId, organizationId),
        eq(tables.monthlyPlans.accountId, accountId),
        eq(tables.monthlyPlans.year, planDate.getUTCFullYear()),
        eq(tables.monthlyPlans.month, planDate.getUTCMonth() + 1),
        eq(tables.monthlyPlans.status, 'active'),
      ),
    )
    .get();
  return strategyMetricsSnapshotSchema.parse({
    account: { id: account.id, name: account.accountName, clientId: account.clientId },
    period: { start: periodStart, end: periodEnd },
    publishedContentCount: published.length,
    sampledContentCount: samples.length,
    viewsSampleCount: views.length,
    totalViews: views.reduce((sum, value) => sum + value, 0),
    averageViews: average(views),
    medianViews: median(views),
    byContentType: groupMetrics(samples, (sample) => sample.content.contentType),
    byHookType: groupMetrics(samples, (sample) => sample.content.hookType),
    byContentGoal: groupMetrics(samples, (sample) => sample.content.contentGoal),
    topContents: rankedSamples.slice(0, 5).map(ranked),
    bottomContents: [...rankedSamples].reverse().slice(0, 5).map(ranked),
    groupbuyCtr: pairedRatio(samples, (row) => row.groupbuyClicks, (row) => row.views),
    gmvPer1000Views: pairedRatio(samples, (row) => row.gmv, (row) => row.views, 1000),
    publishFrequency: {
      periodDays,
      publishesPerWeek: (published.length / periodDays) * 7,
      averageIntervalDays: average(intervals),
    },
    currentMonthlyPlan: currentPlan
      ? {
          id: currentPlan.id,
          year: currentPlan.year,
          month: currentPlan.month,
          primaryGoal: currentPlan.primaryGoal,
          plannedContentCount: currentPlan.plannedContentCount,
          contentMixJson: currentPlan.contentMixJson,
          campaignNotes: currentPlan.campaignNotes,
        }
      : null,
    generatedAt,
    snapshotSelection: 'latest_per_publish_at_period_end',
  });
}

export function strategyReviewService(
  db: Database,
  organizationId: string,
  userId: string,
  runtime: { now?: () => Date; client?: OpenAICompatibleClient } = {},
) {
  const permissions = permissionService(db, organizationId, userId);
  const now = runtime.now ?? (() => new Date());
  const timestamp = () => now().toISOString();
  const ai = plannerAiRuntime(db, organizationId, userId, runtime);
  const contexts = contextBuilder(db, organizationId, userId, { now });
  const isDemo = permissions.organization.isDemo;

  const account = (id: string, write = false) => {
    const row = db
      .select()
      .from(tables.accounts)
      .where(and(eq(tables.accounts.organizationId, organizationId), eq(tables.accounts.id, z.uuid().parse(id))))
      .get();
    if (!row) throw missing();
    if (write) permissions.requireClientWrite(row.clientId);
    else permissions.requireClientRead(row.clientId);
    return row;
  };
  const config = () => {
    const row = db
      .select({ valueJson: tables.appSettings.valueJson })
      .from(tables.appSettings)
      .where(and(eq(tables.appSettings.organizationId, organizationId), eq(tables.appSettings.key, CONFIG_KEY)))
      .get();
    if (!row) return strategyReviewConfigSchema.parse(DEFAULT_CONFIG);
    try {
      return strategyReviewConfigSchema.parse(JSON.parse(row.valueJson));
    } catch {
      throw new ApiError(500, 'STRATEGY_CONFIG_INVALID', '策略复盘样本阈值配置无效');
    }
  };
  const accounts = () => {
    const readable = permissions.readableClientIds();
    const predicates = [eq(tables.accounts.organizationId, organizationId)];
    if (readable) predicates.push(readable.length ? inArray(tables.accounts.clientId, readable) : sql`0 = 1`);
    return db
      .select({
        id: tables.accounts.id,
        name: tables.accounts.accountName,
        clientId: tables.accounts.clientId,
        clientName: tables.clients.clientName,
      })
      .from(tables.accounts)
      .innerJoin(
        tables.clients,
        and(eq(tables.clients.organizationId, organizationId), eq(tables.clients.id, tables.accounts.clientId)),
      )
      .where(and(...predicates))
      .orderBy(asc(tables.clients.clientName), asc(tables.accounts.accountName))
      .all()
      .map((row) => ({ ...row, canWrite: permissions.canWriteClient(row.clientId) }));
  };
  const review = (id: string) => {
    const row = db
      .select()
      .from(tables.strategyReviews)
      .where(and(eq(tables.strategyReviews.organizationId, organizationId), eq(tables.strategyReviews.id, z.uuid().parse(id))))
      .get();
    if (!row) throw missing();
    account(row.accountId);
    return strategyReviewSchema.parse(row);
  };
  const view = (row: ReturnType<typeof review>) => {
    const option = accounts().find((item) => item.id === row.accountId);
    if (!option) throw missing();
    const threshold = config().minimumSampleSize;
    return strategyReviewViewSchema.parse({
      ...row,
      accountName: option.name,
      clientName: option.clientName,
      permissions: {
        canWrite: option.canWrite,
        canConfirm: option.canWrite && row.status === 'draft',
        canCreateNextPlan: option.canWrite && row.status === 'confirmed',
      },
      sampleThreshold: threshold,
      sampleThresholdMet: row.metricsSnapshotJson.sampledContentCount >= threshold,
    });
  };
  const step = (runId: string, code: (typeof STEP_CODES)[number]) => {
    const row = db
      .select()
      .from(tables.runSteps)
      .where(
        and(
          eq(tables.runSteps.organizationId, organizationId),
          eq(tables.runSteps.runId, runId),
          eq(tables.runSteps.stepCode, code),
        ),
      )
      .get();
    if (!row) throw missing();
    return row;
  };
  const startStep = (id: string, input: unknown) => {
    const startedAt = timestamp();
    db.update(tables.runSteps)
      .set({ status: 'running', inputJson: json(input), startedAt })
      .where(and(eq(tables.runSteps.organizationId, organizationId), eq(tables.runSteps.id, id)))
      .run();
    return now().getTime();
  };
  const finishStep = (id: string, started: number, output: unknown, warnings: string[] = []) => {
    const finishedAt = timestamp();
    db.update(tables.runSteps)
      .set({
        status: 'succeeded',
        outputJson: json(output),
        warningCodesJson: warnings.length ? json(warnings) : null,
        finishedAt,
        durationMs: duration(started, now().getTime()),
      })
      .where(and(eq(tables.runSteps.organizationId, organizationId), eq(tables.runSteps.id, id)))
      .run();
  };
  const failRun = (runId: string, activeStepId: string, error: unknown) => {
    const at = timestamp();
    const detail = {
      code: error instanceof ApiError ? error.code : 'STRATEGY_REVIEW_FAILED',
      message: error instanceof Error ? error.message : '策略复盘失败',
    };
    db.transaction(() => {
      db.update(tables.runSteps)
        .set({ status: 'failed', errorJson: json(detail), finishedAt: at })
        .where(and(eq(tables.runSteps.organizationId, organizationId), eq(tables.runSteps.id, activeStepId)))
        .run();
      db.update(tables.runSteps)
        .set({ status: 'skipped', errorJson: json({ code: 'UPSTREAM_FAILED' }), finishedAt: at })
        .where(
          and(
            eq(tables.runSteps.organizationId, organizationId),
            eq(tables.runSteps.runId, runId),
            eq(tables.runSteps.status, 'pending'),
          ),
        )
        .run();
      db.update(tables.runs)
        .set({ status: 'failed', finishedAt: at })
        .where(and(eq(tables.runs.organizationId, organizationId), eq(tables.runs.id, runId)))
        .run();
    });
  };
  const audit = (entityType: string, entityId: string, action: string, metadata: unknown = {}) =>
    db.insert(tables.auditLogs)
      .values({
        id: crypto.randomUUID(),
        organizationId,
        userId,
        entityType,
        entityId,
        action,
        metadataJson: json(metadata),
        isDemo,
        createdAt: timestamp(),
      })
      .run();

  const mockAnalysis = (metrics: StrategyMetricsSnapshot): PerformanceAnalyzerOutput =>
    performanceAnalyzerOutputSchema.parse({
      summary: metrics.sampledContentCount
        ? `本周期 ${metrics.sampledContentCount} 条内容有有效表现快照，平均播放 ${Math.round(metrics.averageViews ?? 0)}。`
        : '本周期没有可用于分析的表现快照。',
      effective_patterns: metrics.topContents.length
        ? [`播放较高内容集中在“${metrics.topContents[0].contentType}”类型，需结合更多样本继续验证。`]
        : [],
      weak_patterns: metrics.bottomContents.length
        ? [`低位内容“${metrics.bottomContents[0].title}”需要复查切入角度与 Hook。`]
        : [],
      observations: [
        `团购点击率：${metrics.groupbuyCtr === null ? '数据不足' : metrics.groupbuyCtr.toFixed(4)}`,
        `千次播放 GMV：${metrics.gmvPer1000Views === null ? '数据不足' : metrics.gmvPer1000Views.toFixed(2)}`,
      ],
      sample_size_notes: `结论基于 ${metrics.sampledContentCount} 条最新快照，样本较少时仅作为方向性解释。`,
      confidence: metrics.sampledContentCount >= config().minimumSampleSize ? 0.75 : 0.35,
    });
  const mockStrategy = (metrics: StrategyMetricsSnapshot): StrategyPlannerOutput => {
    const currentMix = metrics.currentMonthlyPlan?.contentMixJson ?? {};
    const currentTotal = Object.values(currentMix).reduce((sum, value) => sum + value, 0);
    const leadingType = metrics.byContentType[0]?.value;
    const mix = currentTotal === 100 ? currentMix : { [leadingType ?? 'other']: 100 };
    return strategyPlannerOutputSchema.parse({
      next_period_goal:
        metrics.currentMonthlyPlan?.primaryGoal ?? metrics.topContents[0]?.contentGoal ?? 'exposure',
      recommended_content_mix: mix,
      keep: metrics.topContents.length ? ['保留高位内容中已被数据支持的表达结构。'] : [],
      reduce: metrics.bottomContents.length ? ['减少连续使用低位内容的同类切入角度。'] : [],
      test: ['下一周期只改变一个关键变量进行小样本测试。'],
      next_actions: ['建立下月计划草案', '为每类内容设置可观察的复盘指标'],
    });
  };

  return {
    aggregate(input: unknown) {
      const value = strategyReviewPeriodSchema.parse(input);
      const target = account(value.accountId);
      const metrics = aggregateStrategyMetrics(
        db,
        organizationId,
        target.id,
        value.periodStart,
        value.periodEnd,
        timestamp(),
      );
      const threshold = config().minimumSampleSize;
      return {
        metrics,
        sampleThreshold: threshold,
        sampleThresholdMet: metrics.sampledContentCount >= threshold,
        canGenerate: permissions.canWriteClient(target.clientId) && metrics.sampledContentCount > 0,
      };
    },

    list(input: unknown) {
      const query = strategyReviewListQuerySchema.parse(input);
      const options = accounts();
      const accountIds = options.map((item) => item.id);
      if (query.accountId) account(query.accountId);
      const predicates = [eq(tables.strategyReviews.organizationId, organizationId)];
      predicates.push(accountIds.length ? inArray(tables.strategyReviews.accountId, accountIds) : sql`0 = 1`);
      if (query.accountId) predicates.push(eq(tables.strategyReviews.accountId, query.accountId));
      if (query.status) predicates.push(eq(tables.strategyReviews.status, query.status));
      const rows = db
        .select()
        .from(tables.strategyReviews)
        .where(and(...predicates))
        .orderBy(desc(tables.strategyReviews.createdAt), desc(tables.strategyReviews.id))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize)
        .all();
      return strategyReviewListSchema.parse({
        items: rows.map((row) => view(strategyReviewSchema.parse(row))),
        total:
          db.select({ value: count() }).from(tables.strategyReviews).where(and(...predicates)).get()?.value ?? 0,
        page: query.page,
        pageSize: query.pageSize,
        options: { accounts: options },
        config: config(),
        permissions: { canConfigure: permissions.has('ai.settings') },
      });
    },

    detail(id: string) {
      return view(review(id));
    },

    async generate(input: unknown) {
      const value = generateStrategyReviewSchema.parse(input);
      const target = account(value.accountId, true);
      const metrics = aggregateStrategyMetrics(
        db,
        organizationId,
        target.id,
        value.periodStart,
        value.periodEnd,
        timestamp(),
      );
      if (!metrics.sampledContentCount)
        throw new ApiError(409, 'INSUFFICIENT_PERFORMANCE_DATA', '当前周期没有有效 Performance Snapshot，暂不调用 AI');
      const analyzerSkill = ai.skill('performance_analyzer');
      const strategySkill = ai.skill('strategy_planner');
      const totalPoints = analyzerSkill.pointCost + strategySkill.pointCost;
      ai.requireQuota(totalPoints);
      const runId = crypto.randomUUID();
      const reviewId = crypto.randomUUID();
      const createdAt = timestamp();
      db.transaction(() => {
        db.insert(tables.runs)
          .values({
            id: runId,
            organizationId,
            runType: 'production',
            subjectType: 'strategy_review',
            subjectId: reviewId,
            status: 'running',
            startedAt: createdAt,
            finishedAt: null,
            createdBy: userId,
            isDemo,
            createdAt,
          })
          .run();
        db.insert(tables.runSteps)
          .values(
            STEP_CODES.map((code, sequence) => ({
              id: crypto.randomUUID(),
              organizationId,
              runId,
              sequence,
              stepCode: code,
              status: 'pending' as const,
              inputJson: null,
              outputJson: null,
              errorJson: null,
              startedAt: null,
              finishedAt: null,
              durationMs: null,
              warningCodesJson: null,
              isDemo,
            })),
          )
          .run();
      });
      let activeStepId = step(runId, 'metrics_aggregate').id;
      try {
        const metricStarted = startStep(activeStepId, value);
        finishStep(
          activeStepId,
          metricStarted,
          metrics,
          metrics.sampledContentCount < config().minimumSampleSize
            ? ['SAMPLE_BELOW_CONFIGURED_THRESHOLD']
            : [],
        );

        activeStepId = step(runId, 'context_build').id;
        const contextStarted = startStep(activeStepId, {
          accountId: target.id,
          monthlyPlanId: metrics.currentMonthlyPlan?.id ?? null,
          focus: '账号周期表现复盘与下一周期策略',
        });
        const context = contexts.build({
          accountId: target.id,
          ...(metrics.currentMonthlyPlan ? { monthlyPlanId: metrics.currentMonthlyPlan.id } : {}),
          focus: '账号周期表现复盘与下一周期策略',
        });
        const confirmedStrategies = context.layers.l3Memories.filter(
          (memory) => memory.memoryType === 'strategy' && memory.sourceType === 'confirmed_strategy',
        );
        const activeMemories = context.layers.l3Memories.filter(
          (memory) => !(memory.memoryType === 'strategy' && memory.sourceType === 'confirmed_strategy'),
        );
        finishStep(activeStepId, contextStarted, {
          contextSnapshotId: context.snapshotId,
          memoryIds: context.snapshot.memoryIds,
          truncations: context.snapshot.truncations,
        });
        const { topContents, bottomContents, ...aggregateFacts } = metrics;
        const sharedInput = {
          metrics_snapshot: aggregateFacts,
          top_contents: topContents,
          bottom_contents: bottomContents,
          current_monthly_plan: metrics.currentMonthlyPlan ?? {},
          active_memories: activeMemories,
          confirmed_strategy_memories: confirmedStrategies,
        };

        activeStepId = step(runId, 'performance_analyzer').id;
        const analysisStarted = startStep(activeStepId, {
          contextSnapshotId: context.snapshotId,
          sampleCount: metrics.sampledContentCount,
        });
        const analyzed = await ai.invoke({
          runId,
          stepId: activeStepId,
          skillCode: 'performance_analyzer',
          accountId: target.id,
          clientId: target.clientId,
          input: sharedInput,
          outputSchema: performanceAnalyzerOutputSchema,
          mockOutput: mockAnalysis(metrics),
        });
        finishStep(activeStepId, analysisStarted, { parsed: analyzed.output, mode: analyzed.mode });

        activeStepId = step(runId, 'strategy_planner').id;
        const strategyStarted = startStep(activeStepId, { contextSnapshotId: context.snapshotId });
        const planned = await ai.invoke({
          runId,
          stepId: activeStepId,
          skillCode: 'strategy_planner',
          accountId: target.id,
          clientId: target.clientId,
          input: {
            metrics_snapshot: aggregateFacts,
            performance_analysis: analyzed.output,
            current_monthly_plan: metrics.currentMonthlyPlan ?? {},
            active_memories: activeMemories,
            confirmed_strategy_memories: confirmedStrategies,
          },
          outputSchema: strategyPlannerOutputSchema,
          mockOutput: mockStrategy(metrics),
        });
        finishStep(activeStepId, strategyStarted, { parsed: planned.output, mode: planned.mode });

        activeStepId = step(runId, 'persist_strategy_review').id;
        const persistStarted = startStep(activeStepId, { reviewId });
        const row = strategyReviewSchema.parse({
          id: reviewId,
          organizationId,
          accountId: target.id,
          periodStart: value.periodStart,
          periodEnd: value.periodEnd,
          metricsSnapshotJson: metrics,
          previousStrategyMemoryIdsJson: confirmedStrategies.map((memory) => memory.id),
          aiAnalysisJson: analyzed.output,
          aiStrategyJson: planned.output,
          status: 'draft',
          confirmedBy: null,
          confirmedAt: null,
          isDemo,
          createdAt,
        });
        db.transaction(() => {
          let quota: typeof tables.organizationAiQuotas.$inferSelect | null = null;
          if (totalPoints > 0) {
            quota = db
              .select()
              .from(tables.organizationAiQuotas)
              .where(
                and(
                  eq(tables.organizationAiQuotas.organizationId, organizationId),
                  lte(tables.organizationAiQuotas.periodStart, createdAt),
                  gt(tables.organizationAiQuotas.periodEnd, createdAt),
                ),
              )
              .orderBy(desc(tables.organizationAiQuotas.periodStart))
              .get() ?? null;
            if (!quota) throw new ApiError(402, 'AI_QUOTA_EXCEEDED', 'AI Points 额度期不可用');
            const updated = db
              .update(tables.organizationAiQuotas)
              .set({ usedPoints: sql`${tables.organizationAiQuotas.usedPoints} + ${totalPoints}`, updatedAt: timestamp() })
              .where(
                and(
                  eq(tables.organizationAiQuotas.organizationId, organizationId),
                  eq(tables.organizationAiQuotas.id, quota.id),
                  sql`${tables.organizationAiQuotas.usedPoints} + ${totalPoints} <= ${tables.organizationAiQuotas.quotaPoints}`,
                ),
              )
              .run();
            if (updated.changes !== 1) throw new ApiError(402, 'AI_QUOTA_EXCEEDED', 'AI Points 余额不足');
          }
          db.insert(tables.strategyReviews).values(row).run();
          if (totalPoints > 0)
            db.insert(tables.aiPointLedger)
              .values({
                id: crypto.randomUUID(),
                organizationId,
                runId,
                skillCode: 'strategy_review',
                points: totalPoints,
                ledgerType: 'consume',
                reason: '表现分析与策略规划均已成功持久化',
                isDemo,
                createdAt: timestamp(),
              })
              .run();
          for (const selectedSkill of [analyzerSkill, strategySkill]) {
            db.update(tables.aiUsageLogs)
              .set({ billedPoints: selectedSkill.pointCost })
              .where(
                and(
                  eq(tables.aiUsageLogs.organizationId, organizationId),
                  eq(tables.aiUsageLogs.runId, runId),
                  eq(tables.aiUsageLogs.skillCode, selectedSkill.code),
                  eq(tables.aiUsageLogs.status, 'completed'),
                ),
              )
              .run();
          }
          const at = timestamp();
          db.update(tables.runSteps)
            .set({
              status: 'succeeded',
              outputJson: json({ reviewId, billedPoints: totalPoints }),
              finishedAt: at,
              durationMs: duration(persistStarted, now().getTime()),
            })
            .where(and(eq(tables.runSteps.organizationId, organizationId), eq(tables.runSteps.id, activeStepId)))
            .run();
          db.update(tables.runs)
            .set({
              status:
                metrics.sampledContentCount < config().minimumSampleSize
                  ? 'completed_with_warnings'
                  : 'completed',
              finishedAt: at,
            })
            .where(and(eq(tables.runs.organizationId, organizationId), eq(tables.runs.id, runId)))
            .run();
          audit('strategy_review', reviewId, 'strategy_review.generated', {
            runId,
            sampleCount: metrics.sampledContentCount,
            billedPoints: totalPoints,
          });
        });
        return strategyReviewGenerationResultSchema.parse({
          review: view(row),
          runId,
          contextSnapshotId: context.snapshotId,
          billedPoints: totalPoints,
        });
      } catch (error) {
        failRun(runId, activeStepId, error);
        throw error;
      }
    },

    confirm(id: string, input: unknown) {
      const value = confirmStrategyReviewSchema.parse(input);
      const row = review(id);
      const target = account(row.accountId, true);
      if (row.status !== 'draft') throw new ApiError(409, 'STRATEGY_REVIEW_FINALIZED', '该策略复盘已完成决策');
      const threshold = config().minimumSampleSize;
      if (value.savePerformancePattern && row.metricsSnapshotJson.sampledContentCount < threshold)
        throw new ApiError(
          409,
          'PERFORMANCE_SAMPLE_BELOW_THRESHOLD',
          `有效样本 ${row.metricsSnapshotJson.sampledContentCount} 条，未达到管理员配置阈值 ${threshold} 条`,
        );
      const at = timestamp();
      const strategyMemoryId = crypto.randomUUID();
      const performanceMemoryId = value.savePerformancePattern ? crypto.randomUUID() : null;
      db.transaction(() => {
        const updated = db
          .update(tables.strategyReviews)
          .set({ status: 'confirmed', confirmedBy: userId, confirmedAt: at })
          .where(
            and(
              eq(tables.strategyReviews.organizationId, organizationId),
              eq(tables.strategyReviews.id, row.id),
              eq(tables.strategyReviews.status, 'draft'),
            ),
          )
          .run();
        if (updated.changes !== 1) throw new ApiError(409, 'STRATEGY_REVIEW_FINALIZED', '该策略复盘已完成决策');
        db.insert(tables.memories)
          .values({
            id: strategyMemoryId,
            organizationId,
            scopeType: 'account',
            scopeId: target.id,
            memoryKey: `strategy.review.${row.id}`,
            memoryType: 'strategy',
            valueJson: row.aiStrategyJson,
            summary: `已确认策略：${row.periodStart.slice(0, 10)} 至 ${row.periodEnd.slice(0, 10)}`,
            importance: 5,
            confidence: row.aiAnalysisJson.confidence,
            sourceType: 'confirmed_strategy',
            sourceId: row.id,
            effectiveAt: at,
            expiresAt: null,
            status: 'active',
            supersedesMemoryId: null,
            createdBy: userId,
            isDemo,
            createdAt: at,
          })
          .run();
        if (performanceMemoryId)
          db.insert(tables.memories)
            .values({
              id: performanceMemoryId,
              organizationId,
              scopeType: 'account',
              scopeId: target.id,
              memoryKey: `performance.review.${row.id}`,
              memoryType: 'performance_pattern',
              valueJson: row.aiAnalysisJson,
              summary: `人工确认的表现规律：${row.aiAnalysisJson.summary}`,
              importance: 4,
              confidence: row.aiAnalysisJson.confidence,
              sourceType: 'confirmed_performance',
              sourceId: row.id,
              effectiveAt: at,
              expiresAt: null,
              status: 'active',
              supersedesMemoryId: null,
              createdBy: userId,
              isDemo,
              createdAt: at,
            })
            .run();
        audit('strategy_review', row.id, 'strategy_review.confirmed', {
          strategyMemoryId,
          performanceMemoryId,
        });
      });
      return strategyReviewConfirmationResultSchema.parse({
        review: view(review(row.id)),
        strategyMemoryId,
        performanceMemoryId,
      });
    },

    reject(id: string, input: unknown) {
      const value = rejectStrategyReviewSchema.parse(input);
      const row = review(id);
      account(row.accountId, true);
      if (row.status !== 'draft') throw new ApiError(409, 'STRATEGY_REVIEW_FINALIZED', '该策略复盘已完成决策');
      db.transaction(() => {
        const updated = db
          .update(tables.strategyReviews)
          .set({ status: 'rejected' })
          .where(
            and(
              eq(tables.strategyReviews.organizationId, organizationId),
              eq(tables.strategyReviews.id, row.id),
              eq(tables.strategyReviews.status, 'draft'),
            ),
          )
          .run();
        if (updated.changes !== 1) throw new ApiError(409, 'STRATEGY_REVIEW_FINALIZED', '该策略复盘已完成决策');
        audit('strategy_review', row.id, 'strategy_review.rejected', { reason: value.reason });
      });
      return view(review(row.id));
    },

    createNextPlan(id: string) {
      const row = review(id);
      account(row.accountId, true);
      if (row.status !== 'confirmed') throw new ApiError(409, 'STRATEGY_REVIEW_NOT_CONFIRMED', '确认策略后才能创建下月计划草案');
      const periodEnd = new Date(row.periodEnd);
      const next = new Date(Date.UTC(periodEnd.getUTCFullYear(), periodEnd.getUTCMonth() + 1, 1));
      const plannedContentCount =
        row.metricsSnapshotJson.currentMonthlyPlan?.plannedContentCount ?? row.metricsSnapshotJson.publishedContentCount;
      const plan = contentService(db, organizationId, userId, { now }).createPlan({
        accountId: row.accountId,
        year: next.getUTCFullYear(),
        month: next.getUTCMonth() + 1,
        primaryGoal: row.aiStrategyJson.next_period_goal,
        plannedContentCount,
        campaignNotes: `由已确认策略复盘 ${row.id} 创建的下月草案；确认前请人工复核。`,
        keyProductsJson: [],
        contentMixJson: plannedContentCount > 0 ? row.aiStrategyJson.recommended_content_mix : {},
        status: 'inactive',
      });
      audit('strategy_review', row.id, 'strategy_review.next_plan_created', { planId: plan.id });
      return nextPeriodPlanResultSchema.parse({ plan, sourceReviewId: row.id });
    },

    getConfig() {
      return { config: config(), permissions: { canWrite: permissions.has('ai.settings') } };
    },

    updateConfig(input: unknown) {
      permissions.require('ai.settings');
      const value = updateStrategyReviewConfigSchema.parse(input);
      const at = timestamp();
      db.transaction(() => {
        db.insert(tables.appSettings)
          .values({
            id: crypto.randomUUID(),
            organizationId,
            key: CONFIG_KEY,
            valueJson: json(value),
            isSecret: false,
            isDemo,
            createdAt: at,
            updatedAt: at,
          })
          .onConflictDoUpdate({
            target: [tables.appSettings.organizationId, tables.appSettings.key],
            set: { valueJson: json(value), updatedAt: at },
          })
          .run();
        audit('app_setting', CONFIG_KEY, 'strategy_review.config_updated', value);
      });
      return { config: value, permissions: { canWrite: true } };
    },
  };
}
