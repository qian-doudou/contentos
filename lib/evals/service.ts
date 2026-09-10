import { and, asc, desc, eq, inArray, isNull, or } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { z } from 'zod';
import * as tables from '@/db/schema';
import type { EvalCaseRow, ImprovementProposalRow, RatingRow } from '@/db/schema';
import { aiInfrastructureService } from '@/lib/ai/service';
import { skillSchema, skillVersionSchema } from '@/lib/ai/contracts';
import { ApiError } from '@/lib/api/envelope';
import { permissionService } from '@/lib/auth/permissions';
import { OpenAICompatibleClient } from '@/lib/llm/client';
import { parseTraceValue, sanitizeTrace } from '@/lib/ops/trace-safety';
import {
  aggregateEvalMetricsSchema, applyProposalInputSchema, badCaseQuerySchema,
  badCaseSchema, createEvalCaseInputSchema, createProposalInputSchema,
  createRatingInputSchema, deterministicCaseMetricsSchema, evalAssertionsSchema,
  evalCaseSchema, evalDashboardDataSchema, evalExperimentSchema, evalGateSchema,
  improvementProposalOutputSchema, improvementProposalSchema, qualityMetricsSchema,
  ratingSchema, ratingVersionSchema, runEvalInputSchema, scanRunsResultSchema,
  updateBadCaseInputSchema, updateRatingInputSchema,
  type AggregateEvalMetrics, type DeterministicCaseMetrics, type EvalCase,
} from './contracts';
import { badCaseView, insertBadCase, runSnapshots, scanRunForBadCases } from './bad-case-rules';

type Database = BetterSQLite3Database<typeof tables>;
const MIN_AB_SAMPLE_SIZE = 3;
const missing = (message = '记录不存在或不属于当前组织') => new ApiError(404, 'NOT_FOUND', message);

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function unwrapTraceInput(value: unknown) {
  const row = asObject(value);
  return asObject(row?.input) ?? row ?? {};
}

function firstString(value: unknown, keys: Set<string>): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstString(item, keys);
      if (found) return found;
    }
    return null;
  }
  const row = asObject(value);
  if (!row) return null;
  for (const [key, item] of Object.entries(row)) {
    if (keys.has(key) && typeof item === 'string') return item;
    const found = firstString(item, keys);
    if (found) return found;
  }
  return null;
}

function countMarkers(value: unknown, markers: string[]) {
  const text = JSON.stringify(value).toLocaleLowerCase();
  return markers.reduce((count, marker) => count + (text.includes(marker) ? 1 : 0), 0);
}

function highDuplicateDefaultViolations(value: unknown): number {
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + highDuplicateDefaultViolations(item), 0);
  const row = asObject(value);
  if (!row) return 0;
  const level = row.duplicate_level ?? row.duplicateLevel;
  const defaultRecommended = row.selectable === true || row.default_selectable === true
    || row.defaultRecommended === true || row.recommended === true;
  return (level === 'high' && defaultRecommended ? 1 : 0)
    + Object.values(row).reduce<number>((sum, item) => sum + highDuplicateDefaultViolations(item), 0);
}

function lineDiff(oldValue: string, newValue: string) {
  const oldLines = oldValue.split('\n');
  const newLines = newValue.split('\n');
  const result: Array<{ type: 'context' | 'remove' | 'add'; line: string; oldLine: number | null; newLine: number | null }> = [];
  const length = Math.max(oldLines.length, newLines.length);
  for (let index = 0; index < length; index += 1) {
    const before = oldLines[index];
    const after = newLines[index];
    if (before === after && before !== undefined) {
      result.push({ type: 'context', line: before, oldLine: index + 1, newLine: index + 1 });
      continue;
    }
    if (before !== undefined) result.push({ type: 'remove', line: before, oldLine: index + 1, newLine: null });
    if (after !== undefined) result.push({ type: 'add', line: after, oldLine: null, newLine: index + 1 });
  }
  return result;
}

function aggregateCaseMetrics(rows: Array<{
  metrics: DeterministicCaseMetrics;
  durationMs: number;
  estimatedCost: number | null;
}>): AggregateEvalMetrics {
  const sampleSize = rows.length;
  const sum = (select: (row: DeterministicCaseMetrics) => number) =>
    rows.reduce((total, row) => total + select(row.metrics), 0);
  const knownCosts = rows.flatMap((row) => row.estimatedCost === null ? [] : [row.estimatedCost]);
  return aggregateEvalMetricsSchema.parse({
    sampleSize,
    schemaPassRate: sampleSize ? rows.filter((row) => row.metrics.schemaValid).length / sampleSize : 0,
    highDuplicateDefaultViolations: sum((row) => row.highDuplicateDefaultViolations),
    invalidDynamicFacts: sum((row) => row.invalidDynamicFacts),
    forbiddenInformationViolations: sum((row) => row.forbiddenInformationViolations),
    supersededMemoryUses: sum((row) => row.supersededMemoryUses),
    brandFactErrors: sum((row) => row.brandFactErrors),
    keyRulePassRate: sampleSize ? rows.filter((row) => row.metrics.keyRulesPassed).length / sampleSize : 0,
    averageDurationMs: sampleSize ? rows.reduce((sumValue, row) => sumValue + row.durationMs, 0) / sampleSize : 0,
    averageEstimatedCost: knownCosts.length === sampleSize && sampleSize > 0
      ? knownCosts.reduce((sumValue, value) => sumValue + value, 0) / sampleSize
      : null,
    unknownCostRuns: sampleSize - knownCosts.length,
  });
}

export function evaluateReleaseGate(
  metricsA: AggregateEvalMetrics,
  metricsB: AggregateEvalMetrics,
  casePairs: Array<{ id: string; aPassed: boolean; bPassed: boolean }>,
) {
  const reasons: string[] = [];
  const sampleSufficient = metricsB.sampleSize >= MIN_AB_SAMPLE_SIZE;
  if (!sampleSufficient) reasons.push(`数据不足：至少需要 ${MIN_AB_SAMPLE_SIZE} 个 Eval Case`);
  if (metricsB.brandFactErrors > 0) reasons.push('B 存在严重品牌事实错误');
  if (metricsB.supersededMemoryUses > 0) reasons.push('B 使用了 superseded/expired Memory');
  if (metricsB.schemaPassRate < metricsA.schemaPassRate) reasons.push('B 的 Schema 通过率低于基线');
  if (metricsB.highDuplicateDefaultViolations > metricsA.highDuplicateDefaultViolations)
    reasons.push('B 的高重复默认推荐违规增加');
  if (metricsB.keyRulePassRate < metricsA.keyRulePassRate) reasons.push('B 的关键规则通过率总体退化');
  const regressedCaseIds = casePairs.filter((row) => row.aPassed && !row.bPassed).map((row) => row.id);
  const improvedCaseIds = casePairs.filter((row) => !row.aPassed && row.bPassed).map((row) => row.id);
  if (regressedCaseIds.length) reasons.push(`B 有 ${regressedCaseIds.length} 个 Case 发生退化`);
  const canApply = sampleSufficient && reasons.length === 0;
  return evalGateSchema.parse({
    verdict: !sampleSufficient ? 'data_insufficient' : canApply ? 'passed' : 'regressed',
    canApply,
    sampleSufficient,
    sameInputAndContext: true,
    sameModelProfile: true,
    reasons,
    improvedCaseIds,
    regressedCaseIds,
  });
}

export function qualityService(
  db: Database,
  organizationId: string,
  userId: string,
  runtime: {
    now?: () => Date;
    client?: OpenAICompatibleClient;
    proposalMockOutput?: z.infer<typeof improvementProposalOutputSchema>;
    evalMockOutput?: (variant: 'a' | 'b', evalCase: EvalCase) => unknown;
  } = {},
) {
  const permissions = permissionService(db, organizationId, userId);
  const now = runtime.now ?? (() => new Date());
  const timestamp = () => now().toISOString();
  const isDemo = permissions.organization.isDemo;
  const ai = aiInfrastructureService(db, organizationId, userId, { now, client: runtime.client });

  const skillScope = (id: string) => and(
    eq(tables.skills.id, z.uuid().parse(id)),
    or(isNull(tables.skills.organizationId), eq(tables.skills.organizationId, organizationId)),
  );
  const skillById = (id: string) => {
    const row = db.select().from(tables.skills).where(skillScope(id)).get();
    if (!row) throw missing('Skill 不存在');
    return skillSchema.parse(row);
  };
  const skillByCode = (code: string) => {
    const row = db.select().from(tables.skills).where(and(
      eq(tables.skills.code, code),
      or(isNull(tables.skills.organizationId), eq(tables.skills.organizationId, organizationId)),
    )).orderBy(desc(tables.skills.organizationId)).get();
    if (!row) throw missing('Skill 不存在');
    return skillSchema.parse(row);
  };
  const runById = (id: string) => {
    const row = db.select().from(tables.runs).where(and(
      eq(tables.runs.organizationId, organizationId), eq(tables.runs.id, z.uuid().parse(id)),
    )).get();
    if (!row) throw missing('Run 不存在');
    return row;
  };
  const canAccessRun = (run: typeof tables.runs.$inferSelect) => {
    if (permissions.actor.role === 'owner' || permissions.actor.role === 'admin') return true;
    if (run.createdBy === userId) return true;
    const allowed = new Set(permissions.readableClientIds() ?? []);
    const usage = db.select({ clientId: tables.aiUsageLogs.clientId }).from(tables.aiUsageLogs).where(and(
      eq(tables.aiUsageLogs.organizationId, organizationId), eq(tables.aiUsageLogs.runId, run.id),
    )).all();
    return usage.some((row) => row.clientId !== null && allowed.has(row.clientId));
  };
  const requireRunAccess = (run: typeof tables.runs.$inferSelect) => {
    if (!canAccessRun(run)) throw new ApiError(403, 'PERMISSION_DENIED', '当前身份无权评价该 Run');
  };
  const traceForRun = (runId: string, preferredSkill?: string) => {
    const { steps, snapshots } = runSnapshots(db, organizationId, runId);
    const usage = db.select().from(tables.aiUsageLogs).where(and(
      eq(tables.aiUsageLogs.organizationId, organizationId), eq(tables.aiUsageLogs.runId, runId),
    )).orderBy(asc(tables.aiUsageLogs.createdAt)).all();
    const selectedUsage = usage.find((row) => row.skillCode === preferredSkill) ?? usage[0];
    const selectedStep = selectedUsage
      ? steps.find((step) => step.id === selectedUsage.runStepId)
      : steps.find((step) => step.status === 'failed') ?? steps[0];
    return {
      skillCode: selectedUsage?.skillCode ?? 'unknown_skill',
      skillVersion: selectedUsage?.skillVersion ?? 1,
      stepCode: selectedStep?.stepCode ?? 'unknown_step',
      input: unwrapTraceInput(selectedStep ? parseTraceValue(selectedStep.inputJson) : {}),
      output: selectedStep ? parseTraceValue(selectedStep.outputJson) : {},
      context: snapshots.map((row) => ({ id: row.id, snapshot: row.contextSnapshotJson })),
    };
  };
  const ratingView = (row: RatingRow) => {
    const versions = db.select().from(tables.ratingVersions).where(and(
      eq(tables.ratingVersions.organizationId, organizationId), eq(tables.ratingVersions.ratingId, row.id),
    )).orderBy(desc(tables.ratingVersions.versionNo)).all().map((version) => ratingVersionSchema.parse({
      id: version.id,
      organizationId: version.organizationId,
      ratingId: version.ratingId,
      versionNo: version.versionNo,
      overallScore: version.overallScore,
      brandConsistency: version.brandConsistency,
      usability: version.usability,
      novelty: version.novelty,
      comment: version.comment,
      issueTags: version.issueTagsJson,
      markedBadCase: version.markedBadCase,
      ratedBy: version.ratedBy,
      ratedAt: version.ratedAt,
      createdAt: version.createdAt,
    }));
    return ratingSchema.parse({
      id: row.id,
      organizationId: row.organizationId,
      runId: row.runId,
      overallScore: row.overallScore,
      brandConsistency: row.brandConsistency,
      usability: row.usability,
      novelty: row.novelty,
      comment: row.comment,
      issueTags: row.issueTagsJson,
      markedBadCase: row.markedBadCase,
      ratedBy: row.ratedBy,
      ratedAt: row.ratedAt,
      currentVersion: row.currentVersion,
      isDemo: row.isDemo,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      versions,
    });
  };
  const createRatingBadCases = (rating: RatingRow) => {
    const trace = traceForRun(rating.runId);
    const categories: Array<{ category: Parameters<typeof insertBadCase>[1]['category']; severity: Parameters<typeof insertBadCase>[1]['severity']; expected: string }> = [];
    if (rating.overallScore <= 2) categories.push({ category: 'low_rating', severity: 'high', expected: rating.comment || 'AI 输出应达到可用质量并符合品牌事实与业务目标。' });
    if (rating.issueTagsJson.includes('brand_fact_error')) categories.push({ category: 'brand_fact_error', severity: 'critical', expected: rating.comment || '输出不得包含与已确认品牌档案冲突的事实。' });
    if (rating.issueTagsJson.includes('expired_information')) categories.push({ category: 'expired_information', severity: 'critical', expected: rating.comment || '输出不得引用已过期信息。' });
    if (rating.markedBadCase) categories.push({ category: 'manual_flag', severity: 'high', expected: rating.comment || '按人工标注修正此输出。' });
    for (const item of categories) insertBadCase(db, {
      organizationId,
      category: item.category,
      severity: item.severity,
      runId: rating.runId,
      stepCode: trace.stepCode,
      skillCode: trace.skillCode,
      skillVersion: trace.skillVersion,
      inputSnapshot: trace.input,
      contextSnapshot: trace.context,
      output: trace.output,
      expectedBehavior: item.expected,
      ruleGenerated: item.category !== 'manual_flag',
      sourceRatingId: rating.id,
      fingerprint: `rating:${rating.id}:v${rating.currentVersion}:${item.category}`,
      createdBy: rating.ratedBy,
      isDemo: rating.isDemo,
      createdAt: rating.ratedAt,
    });
  };
  const proposalRow = (id: string) => {
    const row = db.select().from(tables.improvementProposals).where(and(
      eq(tables.improvementProposals.organizationId, organizationId),
      eq(tables.improvementProposals.id, z.uuid().parse(id)),
    )).get();
    if (!row) throw missing('Prompt 改进草案不存在');
    return row;
  };
  const experimentView = (row: typeof tables.evalExperiments.$inferSelect) => evalExperimentSchema.parse({
    id: row.id,
    organizationId: row.organizationId,
    proposalId: row.proposalId,
    baselineSkillVersion: row.baselineSkillVersion,
    modelProfile: row.modelProfile,
    caseIds: row.caseIdsJson,
    runIdsA: row.runIdsAJson,
    runIdsB: row.runIdsBJson,
    status: row.status,
    verdict: row.verdict,
    metricsA: row.metricsAJson,
    metricsB: row.metricsBJson,
    comparison: row.comparisonJson,
    createdBy: row.createdBy,
    isDemo: row.isDemo,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
  });
  const proposalView = (row: ImprovementProposalRow) => {
    const skill = skillById(row.skillId);
    const base = db.select().from(tables.skillVersions).where(and(
      eq(tables.skillVersions.skillId, row.skillId), eq(tables.skillVersions.version, row.baseSkillVersion),
    )).get();
    if (!base) throw missing('生产 Skill 基线快照不存在');
    const experiment = db.select().from(tables.evalExperiments).where(and(
      eq(tables.evalExperiments.organizationId, organizationId), eq(tables.evalExperiments.proposalId, row.id),
    )).orderBy(desc(tables.evalExperiments.createdAt)).get();
    return improvementProposalSchema.parse({
      id: row.id,
      organizationId: row.organizationId,
      skillId: row.skillId,
      skillCode: skill.code,
      skillName: skill.name,
      baseSkillVersion: row.baseSkillVersion,
      proposalRunId: row.proposalRunId,
      rootCause: row.rootCause,
      changeReason: row.changeReason,
      oldSystemPrompt: base.systemPrompt,
      oldUserPromptTemplate: base.userPromptTemplate,
      newSystemPrompt: row.newSystemPrompt,
      newUserPromptTemplate: row.newUserPromptTemplate,
      risks: row.risksJson,
      affectedCases: row.affectedCasesJson,
      status: row.status,
      appliedSkillVersion: row.appliedSkillVersion,
      appliedBy: row.appliedBy,
      appliedAt: row.appliedAt,
      createdBy: row.createdBy,
      isDemo: row.isDemo,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      diff: {
        system: lineDiff(base.systemPrompt, row.newSystemPrompt),
        user: lineDiff(base.userPromptTemplate, row.newUserPromptTemplate),
      },
      latestExperiment: experiment ? experimentView(experiment) : null,
    });
  };
  const evalCaseView = (row: EvalCaseRow) => evalCaseSchema.parse({
    id: row.id,
    organizationId: row.organizationId,
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    name: row.name,
    skillCode: row.skillCode,
    skillVersion: row.skillVersion,
    inputSnapshot: row.inputSnapshotJson,
    contextSnapshot: row.contextSnapshotJson,
    expectedBehavior: row.expectedBehavior,
    expectedDuplicateLevel: row.expectedDuplicateLevel,
    assertions: row.assertionsJson,
    status: row.status,
    createdBy: row.createdBy,
    isDemo: row.isDemo,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });

  function deterministicMetrics(
    output: unknown,
    schemaValid: boolean,
    evalCase: EvalCase,
  ) {
    const text = JSON.stringify(output);
    const assertions = evalAssertionsSchema.parse(evalCase.assertions);
    const assertionFailures: string[] = [];
    if (assertions.requireSchemaValid && !schemaValid) assertionFailures.push('Output Schema 未通过');
    for (const required of assertions.requiredText) if (!text.includes(required)) assertionFailures.push(`缺少必需文本：${required}`);
    for (const forbidden of assertions.forbiddenText) if (text.includes(forbidden)) assertionFailures.push(`包含禁用文本：${forbidden}`);
    const actualDuplicateLevel = firstString(output, new Set(['duplicate_level', 'duplicateLevel']));
    const duplicateLevelMatch = evalCase.expectedDuplicateLevel === null
      ? null
      : actualDuplicateLevel === evalCase.expectedDuplicateLevel;
    if (duplicateLevelMatch === false) assertionFailures.push(`重复等级应为 ${evalCase.expectedDuplicateLevel}`);
    const result = deterministicCaseMetricsSchema.parse({
      schemaValid,
      highDuplicateDefaultViolations: highDuplicateDefaultViolations(output),
      invalidDynamicFacts: countMarkers(output, ['unverified_dynamic_fact', 'invalid_dynamic_fact']),
      forbiddenInformationViolations: countMarkers(output, ['forbidden_topic', 'forbidden_style', 'forbidden_information']),
      supersededMemoryUses: countMarkers(output, ['superseded_memory', 'expired_memory']),
      brandFactErrors: countMarkers(output, ['brand_fact_error']),
      duplicateLevelMatch,
      keyRulesPassed: assertionFailures.length === 0,
      assertionFailures,
    });
    return result;
  }

  function qualityMetrics() {
    const usage = db.select().from(tables.aiUsageLogs).where(and(
      eq(tables.aiUsageLogs.organizationId, organizationId), eq(tables.aiUsageLogs.runType, 'production'),
    )).all();
    const badCases = db.select().from(tables.badCases).where(eq(tables.badCases.organizationId, organizationId)).all();
    const group = (code: string) => usage.filter((row) => row.skillCode === code);
    const base = (code: string) => {
      const rows = group(code);
      return {
        totalRuns: rows.length,
        schemaPassRate: rows.length ? rows.filter((row) => row.status === 'completed').length / rows.length : null,
        dataSufficient: rows.length > 0,
      };
    };
    const labeledCases = db.select().from(tables.evalCases).where(and(
      eq(tables.evalCases.organizationId, organizationId),
      eq(tables.evalCases.skillCode, 'duplicate_judge'),
      eq(tables.evalCases.status, 'active'),
    )).all().filter((row) => row.expectedDuplicateLevel !== null);
    const results = db.select().from(tables.evalCaseResults).where(eq(tables.evalCaseResults.organizationId, organizationId))
      .orderBy(desc(tables.evalCaseResults.createdAt)).all();
    const labeledResults = labeledCases.flatMap((evalCase) => {
      const result = results.find((row) => row.evalCaseId === evalCase.id);
      if (!result) return [];
      return [{ expected: evalCase.expectedDuplicateLevel!, actual: firstString(result.outputJson, new Set(['duplicate_level', 'duplicateLevel'])) }];
    });
    const highRows = labeledResults.filter((row) => row.expected === 'high');
    return qualityMetricsSchema.parse({
      planner: {
        ...base('content_planner'),
        highDuplicateDefaultViolations: badCases.filter((row) => row.skillCode === 'content_planner' && row.category === 'high_duplicate_default').length,
        invalidDynamicFacts: badCases.filter((row) => row.skillCode === 'content_planner' && row.category === 'expired_information').length,
      },
      script: {
        ...base('script_generator'),
        forbiddenInformationViolations: badCases.filter((row) => row.skillCode === 'script_generator' && (row.category === 'wrong_style' || row.category === 'unusable_script')).length,
        supersededMemoryUses: badCases.filter((row) => row.skillCode === 'script_generator' && row.category === 'memory_status_violation').length,
        brandFactErrors: badCases.filter((row) => row.skillCode === 'script_generator' && row.category === 'brand_fact_error').length,
      },
      duplicateJudge: {
        ...base('duplicate_judge'),
        labeledCases: labeledResults.length,
        accuracy: labeledResults.length ? labeledResults.filter((row) => row.actual === row.expected).length / labeledResults.length : null,
        highRecall: highRows.length ? highRows.filter((row) => row.actual === 'high').length / highRows.length : null,
      },
      computedAt: timestamp(),
    });
  }

  return {
    dashboard() {
      permissions.require('eval.read');
      const ratings = db.select().from(tables.ratings).where(eq(tables.ratings.organizationId, organizationId))
        .orderBy(desc(tables.ratings.ratedAt)).limit(50).all()
        .filter((row) => canAccessRun(runById(row.runId))).map(ratingView);
      const badCases = db.select().from(tables.badCases).where(eq(tables.badCases.organizationId, organizationId))
        .orderBy(desc(tables.badCases.createdAt)).limit(100).all()
        .filter((row) => canAccessRun(runById(row.runId))).map((row) => badCaseSchema.parse(badCaseView(row)));
      const canManage = permissions.has('eval.manage');
      const proposals = canManage ? db.select().from(tables.improvementProposals).where(eq(tables.improvementProposals.organizationId, organizationId))
        .orderBy(desc(tables.improvementProposals.createdAt)).limit(50).all().map(proposalView) : [];
      const evalCases = canManage ? db.select().from(tables.evalCases).where(eq(tables.evalCases.organizationId, organizationId))
        .orderBy(desc(tables.evalCases.createdAt)).limit(100).all().map(evalCaseView) : [];
      return evalDashboardDataSchema.parse({
        ratings,
        badCases,
        proposals,
        evalCases,
        metrics: qualityMetrics(),
        permissions: {
          canRate: permissions.has('eval.rate'),
          canManage,
          canApply: permissions.has('skills.write'),
        },
      });
    },

    scanRecentRuns() {
      permissions.require('eval.manage');
      const rows = db.select().from(tables.runs).where(and(
        eq(tables.runs.organizationId, organizationId), eq(tables.runs.runType, 'production'),
      )).orderBy(desc(tables.runs.createdAt)).limit(100).all();
      let createdCases = 0;
      db.transaction(() => {
        for (const run of rows) createdCases += scanRunForBadCases(db, organizationId, run.id, userId, now()).length;
      });
      return scanRunsResultSchema.parse({ scannedRuns: rows.length, createdCases });
    },

    listBadCases(input: unknown) {
      permissions.require('eval.read');
      const query = badCaseQuerySchema.parse(input);
      const predicates = [eq(tables.badCases.organizationId, organizationId)];
      if (query.status) predicates.push(eq(tables.badCases.status, query.status));
      if (query.skillCode) predicates.push(eq(tables.badCases.skillCode, query.skillCode));
      return db.select().from(tables.badCases).where(and(...predicates)).orderBy(desc(tables.badCases.createdAt)).all()
        .filter((row) => canAccessRun(runById(row.runId)))
        .map((row) => badCaseSchema.parse(badCaseView(row)));
    },

    updateBadCase(id: string, input: unknown) {
      permissions.require('eval.manage');
      const value = updateBadCaseInputSchema.parse(input);
      const badCase = db.select().from(tables.badCases).where(and(
        eq(tables.badCases.organizationId, organizationId), eq(tables.badCases.id, z.uuid().parse(id)),
      )).get();
      if (!badCase) throw missing('Bad Case 不存在');
      const at = timestamp();
      db.transaction(() => {
        db.update(tables.badCases).set({ ...value, updatedAt: at }).where(and(
          eq(tables.badCases.organizationId, organizationId), eq(tables.badCases.id, badCase.id),
        )).run();
        db.insert(tables.auditLogs).values({
          id: crypto.randomUUID(), organizationId, userId, action: 'bad_case.updated', entityType: 'bad_case', entityId: badCase.id,
          metadataJson: JSON.stringify(value), isDemo, createdAt: at,
        }).run();
      });
      return badCaseSchema.parse(badCaseView({ ...badCase, ...value, updatedAt: at }));
    },

    createRating(input: unknown) {
      permissions.require('eval.rate');
      const value = createRatingInputSchema.parse(input);
      const run = runById(value.runId);
      requireRunAccess(run);
      if (run.runType !== 'production') throw new ApiError(409, 'RATING_PRODUCTION_ONLY', '只允许评价 Production Run');
      const existing = db.select().from(tables.ratings).where(and(
        eq(tables.ratings.organizationId, organizationId), eq(tables.ratings.runId, run.id), eq(tables.ratings.ratedBy, userId),
      )).get();
      if (existing) throw new ApiError(409, 'RATING_EXISTS', '当前用户已评价该 Run，请使用修改评分');
      const at = timestamp();
      const row: RatingRow = {
        id: crypto.randomUUID(), organizationId, runId: run.id,
        overallScore: value.overallScore, brandConsistency: value.brandConsistency,
        usability: value.usability, novelty: value.novelty, comment: value.comment,
        issueTagsJson: value.issueTags, markedBadCase: value.markedBadCase,
        ratedBy: userId, ratedAt: at, currentVersion: 1, isDemo, createdAt: at, updatedAt: at,
      };
      db.transaction(() => {
        db.insert(tables.ratings).values(row).run();
        db.insert(tables.ratingVersions).values({
          id: crypto.randomUUID(), organizationId, ratingId: row.id, versionNo: 1,
          overallScore: row.overallScore, brandConsistency: row.brandConsistency, usability: row.usability,
          novelty: row.novelty, comment: row.comment, issueTagsJson: row.issueTagsJson,
          markedBadCase: row.markedBadCase, ratedBy: userId, ratedAt: at, createdAt: at,
        }).run();
        scanRunForBadCases(db, organizationId, run.id, userId, now());
        createRatingBadCases(row);
      });
      return ratingView(row);
    },

    updateRating(id: string, input: unknown) {
      permissions.require('eval.rate');
      const value = updateRatingInputSchema.parse(input);
      const current = db.select().from(tables.ratings).where(and(
        eq(tables.ratings.organizationId, organizationId), eq(tables.ratings.id, z.uuid().parse(id)),
      )).get();
      if (!current) throw missing('评分不存在');
      if (current.ratedBy !== userId && permissions.actor.role !== 'owner' && permissions.actor.role !== 'admin')
        throw new ApiError(403, 'PERMISSION_DENIED', '只能修改本人评分');
      requireRunAccess(runById(current.runId));
      const at = timestamp();
      const next: RatingRow = {
        ...current,
        overallScore: value.overallScore,
        brandConsistency: value.brandConsistency,
        usability: value.usability,
        novelty: value.novelty,
        comment: value.comment,
        issueTagsJson: value.issueTags,
        markedBadCase: value.markedBadCase,
        ratedBy: userId,
        ratedAt: at,
        currentVersion: current.currentVersion + 1,
        updatedAt: at,
      };
      db.transaction(() => {
        const updated = db.update(tables.ratings).set(next).where(and(
          eq(tables.ratings.organizationId, organizationId), eq(tables.ratings.id, current.id),
          eq(tables.ratings.currentVersion, current.currentVersion),
        )).run();
        if (updated.changes !== 1) throw new ApiError(409, 'STALE_RATING_VERSION', '评分已变化，请刷新后重试');
        db.insert(tables.ratingVersions).values({
          id: crypto.randomUUID(), organizationId, ratingId: current.id, versionNo: next.currentVersion,
          overallScore: next.overallScore, brandConsistency: next.brandConsistency, usability: next.usability,
          novelty: next.novelty, comment: next.comment, issueTagsJson: next.issueTagsJson,
          markedBadCase: next.markedBadCase, ratedBy: userId, ratedAt: at, createdAt: at,
        }).run();
        createRatingBadCases(next);
      });
      return ratingView(next);
    },

    async createProposal(input: unknown) {
      permissions.require('eval.manage');
      const value = createProposalInputSchema.parse(input);
      const cases = db.select().from(tables.badCases).where(and(
        eq(tables.badCases.organizationId, organizationId), inArray(tables.badCases.id, value.badCaseIds),
      )).all();
      if (cases.length !== new Set(value.badCaseIds).size) throw missing('部分 Bad Case 不存在');
      const codes = new Set(cases.map((row) => row.skillCode));
      if (codes.size !== 1) throw new ApiError(409, 'BAD_CASE_SKILL_MISMATCH', '一个草案只能关联同一 Skill 的 Bad Case');
      const skill = skillByCode([...codes][0]);
      const proposalId = crypto.randomUUID();
      const aiInput = {
        current_skill: {
          code: skill.code,
          version: skill.currentVersion,
          system_prompt: skill.systemPrompt,
          user_prompt_template: skill.userPromptTemplate,
          input_schema_json: JSON.stringify(skill.inputSchemaJson),
          output_schema_json: JSON.stringify(skill.outputSchemaJson),
        },
        bad_cases: cases.map((row) => ({
          id: row.id,
          category: row.category,
          severity: row.severity,
          input_snapshot_json: JSON.stringify(sanitizeTrace(row.inputSnapshotJson)),
          context_snapshot_json: JSON.stringify(sanitizeTrace(row.contextSnapshotJson)),
          output_json: JSON.stringify(sanitizeTrace(row.outputJson)),
          expected_behavior: row.expectedBehavior || '输出应满足业务质量要求。',
        })),
        constraints: [
          '只生成 Draft，不修改当前 Skill。',
          '保持输入与输出 Schema 不变。',
          '不得放宽品牌事实、Memory 有效性、Schema 或高重复规则。',
          'affected_cases 只能引用本次 Bad Case。',
        ],
      };
      const mock = runtime.proposalMockOutput ?? {
        root_cause: `现有 ${skill.code} Prompt 对 ${cases.map((row) => row.category).join('、')} 的约束不够明确。`,
        change_reason: '把已确认失败模式转化为显式约束，并保持原输入输出协议不变。',
        new_system_prompt: `${skill.systemPrompt}\n\n质量闭环补充约束：\n${cases.map((row) => `- ${row.expectedBehavior}`).join('\n')}`,
        new_user_prompt_template: `${skill.userPromptTemplate}\n\n在返回结果前逐项核对上述质量闭环约束。`,
        risks: ['约束增强可能降低部分开放性表达，需要通过相同输入 A/B Eval 验证。'],
        affected_cases: cases.map((row) => row.id),
      };
      const generated = await ai.executeEval({
        skillCode: 'prompt_improver',
        data: aiInput,
        subjectId: proposalId,
        mockOutput: mock,
      });
      if (!generated.schemaResult.valid) throw new ApiError(502, 'PROPOSAL_OUTPUT_INVALID', 'Prompt 改进草案未通过 Schema 校验', generated.schemaResult.issues);
      const output = improvementProposalOutputSchema.parse(generated.parsedJson);
      if (output.affected_cases.some((id) => !value.badCaseIds.includes(id)))
        throw new ApiError(502, 'PROPOSAL_CASE_REFERENCE_INVALID', '草案引用了本次范围外的 Bad Case');
      if (output.new_system_prompt === skill.systemPrompt && output.new_user_prompt_template === skill.userPromptTemplate)
        throw new ApiError(409, 'PROPOSAL_NO_CHANGE', '草案未产生 Prompt 变化');
      const at = timestamp();
      const row: ImprovementProposalRow = {
        id: proposalId,
        organizationId,
        skillId: skill.id,
        baseSkillVersion: skill.currentVersion,
        proposalRunId: generated.run.id,
        rootCause: output.root_cause,
        changeReason: output.change_reason,
        newSystemPrompt: output.new_system_prompt,
        newUserPromptTemplate: output.new_user_prompt_template,
        risksJson: output.risks,
        affectedCasesJson: output.affected_cases,
        status: 'draft',
        appliedSkillVersion: null,
        appliedBy: null,
        appliedAt: null,
        createdBy: userId,
        isDemo,
        createdAt: at,
        updatedAt: at,
      };
      db.transaction(() => {
        db.insert(tables.improvementProposals).values(row).run();
        db.update(tables.badCases).set({ status: 'investigating', updatedAt: at }).where(and(
          eq(tables.badCases.organizationId, organizationId), inArray(tables.badCases.id, output.affected_cases),
        )).run();
        db.insert(tables.auditLogs).values({
          id: crypto.randomUUID(), organizationId, userId, action: 'prompt_proposal.created', entityType: 'improvement_proposal',
          entityId: proposalId, metadataJson: JSON.stringify({ skillCode: skill.code, baseVersion: skill.currentVersion, badCaseIds: output.affected_cases }),
          isDemo, createdAt: at,
        }).run();
      });
      return proposalView(row);
    },

    proposalDetail(id: string) {
      permissions.require('eval.read');
      return proposalView(proposalRow(id));
    },

    createEvalCase(input: unknown) {
      permissions.require('eval.manage');
      const value = createEvalCaseInputSchema.parse(input);
      let resolved = value;
      if (value.sourceType === 'bad_case') {
        if (!value.sourceId) throw new ApiError(400, 'SOURCE_ID_REQUIRED', 'Bad Case 来源必须提供 sourceId');
        const source = db.select().from(tables.badCases).where(and(
          eq(tables.badCases.organizationId, organizationId), eq(tables.badCases.id, value.sourceId),
        )).get();
        if (!source) throw missing('Bad Case 不存在');
        resolved = {
          ...value,
          name: value.name || `Bad Case · ${source.category}`,
          skillCode: source.skillCode,
          inputSnapshot: z.record(z.string(), z.unknown()).parse(unwrapTraceInput(source.inputSnapshotJson)),
          contextSnapshot: source.contextSnapshotJson,
          expectedBehavior: source.expectedBehavior,
        };
      } else if (value.sourceType === 'high_rating_production') {
        if (!value.sourceId) throw new ApiError(400, 'SOURCE_ID_REQUIRED', '高评分来源必须提供评分 ID');
        const rating = db.select().from(tables.ratings).where(and(
          eq(tables.ratings.organizationId, organizationId), eq(tables.ratings.id, value.sourceId),
        )).get();
        if (!rating) throw missing('评分不存在');
        if (rating.overallScore < 4) throw new ApiError(409, 'HIGH_RATING_REQUIRED', '只有 overall_score >= 4 的 Production Run 可生成正向 Eval Case');
        const trace = traceForRun(rating.runId);
        resolved = {
          ...value,
          skillCode: trace.skillCode,
          inputSnapshot: z.record(z.string(), z.unknown()).parse(trace.input),
          contextSnapshot: trace.context,
          expectedBehavior: value.expectedBehavior || '保持该高评分 Production Run 的可用质量。',
        };
      }
      const skill = skillByCode(resolved.skillCode);
      const at = timestamp();
      const row: EvalCaseRow = {
        id: crypto.randomUUID(), organizationId, sourceType: resolved.sourceType,
        sourceId: resolved.sourceId ?? null, name: resolved.name, skillCode: skill.code,
        skillVersion: skill.currentVersion, inputSnapshotJson: sanitizeTrace(resolved.inputSnapshot) as Record<string, unknown>,
        contextSnapshotJson: sanitizeTrace(resolved.contextSnapshot), expectedBehavior: resolved.expectedBehavior,
        expectedDuplicateLevel: resolved.expectedDuplicateLevel, assertionsJson: resolved.assertions,
        status: 'active', createdBy: userId, isDemo, createdAt: at, updatedAt: at,
      };
      try {
        db.insert(tables.evalCases).values(row).run();
      } catch (error) {
        if (String(error).includes('UNIQUE')) throw new ApiError(409, 'EVAL_CASE_SOURCE_EXISTS', '该来源已生成 Eval Case');
        throw error;
      }
      return evalCaseView(row);
    },

    async runExperiment(id: string, input: unknown) {
      permissions.require('eval.manage');
      const proposal = proposalRow(id);
      if (proposal.status === 'applied' || proposal.status === 'rejected')
        throw new ApiError(409, 'PROPOSAL_NOT_EVALUABLE', '当前草案状态不可再次评测');
      const value = runEvalInputSchema.parse(input);
      const cases = db.select().from(tables.evalCases).where(and(
        eq(tables.evalCases.organizationId, organizationId),
        inArray(tables.evalCases.id, value.evalCaseIds),
        eq(tables.evalCases.status, 'active'),
      )).all();
      if (cases.length !== new Set(value.evalCaseIds).size) throw missing('部分 Eval Case 不存在或已停用');
      const skill = skillById(proposal.skillId);
      if (skill.currentVersion !== proposal.baseSkillVersion)
        throw new ApiError(409, 'BASELINE_SKILL_CHANGED', '生产 Skill 已变化，请基于最新版本重新创建草案');
      if (cases.some((row) => row.skillCode !== skill.code))
        throw new ApiError(409, 'EVAL_CASE_SKILL_MISMATCH', 'Eval Case 必须与草案 Skill 一致');
      const baselineRow = db.select().from(tables.skillVersions).where(and(
        eq(tables.skillVersions.skillId, skill.id), eq(tables.skillVersions.version, proposal.baseSkillVersion),
      )).get();
      if (!baselineRow) throw missing('基线 Skill 快照不存在');
      const baseline = skillVersionSchema.parse(baselineRow);
      const experimentId = crypto.randomUUID();
      const createdAt = timestamp();
      const emptyMetrics = aggregateCaseMetrics([]);
      const pendingGate = evaluateReleaseGate(emptyMetrics, emptyMetrics, []);
      db.insert(tables.evalExperiments).values({
        id: experimentId, organizationId, proposalId: proposal.id,
        baselineSkillVersion: proposal.baseSkillVersion, modelProfile: baseline.modelProfile,
        caseIdsJson: cases.map((row) => row.id), runIdsAJson: [], runIdsBJson: [],
        status: 'running', verdict: 'data_insufficient', metricsAJson: emptyMetrics,
        metricsBJson: emptyMetrics, comparisonJson: pendingGate,
        createdBy: userId, isDemo, createdAt, completedAt: null,
      }).run();
      const aRows: Array<{ id: string; metrics: DeterministicCaseMetrics; durationMs: number; estimatedCost: number | null }> = [];
      const bRows: Array<{ id: string; metrics: DeterministicCaseMetrics; durationMs: number; estimatedCost: number | null }> = [];
      const runIdsA: string[] = [];
      const runIdsB: string[] = [];
      try {
        for (const caseRow of cases) {
          const evalCase = evalCaseView(caseRow);
          for (const variant of ['a', 'b'] as const) {
            const result = await ai.executeEvalVariant({
              skillId: skill.id,
              version: baseline.version,
              systemPrompt: variant === 'a' ? baseline.systemPrompt : proposal.newSystemPrompt,
              userPromptTemplate: variant === 'a' ? baseline.userPromptTemplate : proposal.newUserPromptTemplate,
              inputSchemaJson: baseline.inputSchemaJson,
              outputSchemaJson: baseline.outputSchemaJson,
              modelProfile: baseline.modelProfile,
              pointCost: baseline.pointCost,
              data: evalCase.inputSnapshot,
              subjectId: experimentId,
              variant,
              contextSnapshot: evalCase.contextSnapshot,
              mockOutput: runtime.evalMockOutput?.(variant, evalCase),
            });
            const output = result.parsedJson ?? { rawOutput: result.rawOutput };
            const metrics = deterministicMetrics(output, result.schemaResult.valid, evalCase);
            const destination = variant === 'a' ? aRows : bRows;
            const runIds = variant === 'a' ? runIdsA : runIdsB;
            destination.push({ id: evalCase.id, metrics, durationMs: result.usage.durationMs, estimatedCost: result.usage.estimatedCost });
            runIds.push(result.run.id);
            db.insert(tables.evalCaseResults).values({
              id: crypto.randomUUID(), organizationId, experimentId, evalCaseId: evalCase.id,
              variant, runId: result.run.id, outputJson: sanitizeTrace(output), metricsJson: metrics,
              schemaValid: result.schemaResult.valid, durationMs: result.usage.durationMs,
              estimatedCost: result.usage.estimatedCost, model: result.usage.model, createdAt: timestamp(),
            }).run();
          }
        }
        const metricsA = aggregateCaseMetrics(aRows);
        const metricsB = aggregateCaseMetrics(bRows);
        const gate = evaluateReleaseGate(metricsA, metricsB, cases.map((row) => ({
          id: row.id,
          aPassed: aRows.find((item) => item.id === row.id)?.metrics.keyRulesPassed ?? false,
          bPassed: bRows.find((item) => item.id === row.id)?.metrics.keyRulesPassed ?? false,
        })));
        const completedAt = timestamp();
        db.transaction(() => {
          db.update(tables.evalExperiments).set({
            runIdsAJson: runIdsA, runIdsBJson: runIdsB, status: 'completed', verdict: gate.verdict,
            metricsAJson: metricsA, metricsBJson: metricsB, comparisonJson: gate, completedAt,
          }).where(and(eq(tables.evalExperiments.organizationId, organizationId), eq(tables.evalExperiments.id, experimentId))).run();
          db.update(tables.improvementProposals).set({ status: 'evaluated', updatedAt: completedAt }).where(and(
            eq(tables.improvementProposals.organizationId, organizationId), eq(tables.improvementProposals.id, proposal.id),
          )).run();
          db.insert(tables.auditLogs).values({
            id: crypto.randomUUID(), organizationId, userId, action: 'prompt_proposal.evaluated', entityType: 'eval_experiment',
            entityId: experimentId, metadataJson: JSON.stringify({ verdict: gate.verdict, sampleSize: cases.length }), isDemo, createdAt: completedAt,
          }).run();
        });
        return experimentView({
          ...db.select().from(tables.evalExperiments).where(and(
            eq(tables.evalExperiments.organizationId, organizationId), eq(tables.evalExperiments.id, experimentId),
          )).get()!,
        });
      } catch (error) {
        const metricsA = aggregateCaseMetrics(aRows);
        const metricsB = aggregateCaseMetrics(bRows);
        const failedGate = evalGateSchema.parse({
          ...evaluateReleaseGate(metricsA, metricsB, []),
          verdict: 'data_insufficient',
          canApply: false,
          reasons: [error instanceof Error ? `Eval 失败：${error.message}` : 'Eval 失败'],
        });
        db.update(tables.evalExperiments).set({
          runIdsAJson: runIdsA, runIdsBJson: runIdsB, status: 'failed', completedAt: timestamp(),
          metricsAJson: metricsA, metricsBJson: metricsB, comparisonJson: failedGate,
        }).where(and(eq(tables.evalExperiments.organizationId, organizationId), eq(tables.evalExperiments.id, experimentId))).run();
        throw error;
      }
    },

    applyProposal(id: string, input: unknown) {
      permissions.require('skills.write');
      applyProposalInputSchema.parse(input);
      const proposal = proposalRow(id);
      if (proposal.status !== 'evaluated') throw new ApiError(409, 'PROPOSAL_NOT_EVALUATED', '草案必须先完成 Eval/A-B');
      const experiment = db.select().from(tables.evalExperiments).where(and(
        eq(tables.evalExperiments.organizationId, organizationId), eq(tables.evalExperiments.proposalId, proposal.id),
        eq(tables.evalExperiments.status, 'completed'),
      )).orderBy(desc(tables.evalExperiments.createdAt)).get();
      if (!experiment) throw new ApiError(409, 'EVAL_RESULT_REQUIRED', '缺少已完成的 A/B Eval');
      const gate = evalGateSchema.parse(experiment.comparisonJson);
      if (!gate.canApply || gate.verdict !== 'passed')
        throw new ApiError(409, 'PROPOSAL_RELEASE_GATE_FAILED', gate.reasons.join('；') || '草案未通过上线门槛');
      const current = skillById(proposal.skillId);
      if (current.currentVersion !== proposal.baseSkillVersion)
        throw new ApiError(409, 'BASELINE_SKILL_CHANGED', '生产 Skill 已变化，请重新创建和评测草案');
      const nextVersion = current.currentVersion + 1;
      const at = timestamp();
      db.transaction(() => {
        let productionSkillId = current.id;
        if (current.organizationId === null) {
          const existingOverride = db.select({ id: tables.skills.id }).from(tables.skills).where(and(
            eq(tables.skills.organizationId, organizationId), eq(tables.skills.code, current.code),
          )).get();
          if (existingOverride) throw new ApiError(409, 'BASELINE_SKILL_CHANGED', '组织已存在更新的 Skill，请基于当前生产版本重新创建草案');
          productionSkillId = crypto.randomUUID();
          db.insert(tables.skills).values({
            id: productionSkillId, organizationId, code: current.code, name: current.name,
            description: current.description, systemPrompt: proposal.newSystemPrompt,
            userPromptTemplate: proposal.newUserPromptTemplate, inputSchemaJson: current.inputSchemaJson,
            outputSchemaJson: current.outputSchemaJson, modelProfile: current.modelProfile,
            pointCost: current.pointCost, enabled: current.enabled, currentVersion: nextVersion,
            isDemo, createdAt: at, updatedAt: at,
          }).run();
          const history = db.select().from(tables.skillVersions).where(eq(tables.skillVersions.skillId, current.id)).all();
          for (const version of history) db.insert(tables.skillVersions).values({
            ...version, id: crypto.randomUUID(), organizationId, skillId: productionSkillId,
            createdBy: null, isDemo,
          }).run();
        } else {
          const updated = db.update(tables.skills).set({
            systemPrompt: proposal.newSystemPrompt,
            userPromptTemplate: proposal.newUserPromptTemplate,
            currentVersion: nextVersion,
            updatedAt: at,
          }).where(and(skillScope(current.id), eq(tables.skills.currentVersion, current.currentVersion))).run();
          if (updated.changes !== 1) throw new ApiError(409, 'STALE_SKILL_VERSION', 'Skill 版本已变化，请刷新后重试');
        }
        db.insert(tables.skillVersions).values({
          id: crypto.randomUUID(), organizationId, skillId: productionSkillId, version: nextVersion,
          systemPrompt: proposal.newSystemPrompt, userPromptTemplate: proposal.newUserPromptTemplate,
          inputSchemaJson: current.inputSchemaJson, outputSchemaJson: current.outputSchemaJson,
          modelProfile: current.modelProfile, pointCost: current.pointCost,
          changeReason: proposal.changeReason, createdBy: userId, isDemo: current.isDemo, createdAt: at,
        }).run();
        db.update(tables.improvementProposals).set({
          status: 'applied', appliedSkillVersion: nextVersion, appliedBy: userId, appliedAt: at, updatedAt: at,
        }).where(and(eq(tables.improvementProposals.organizationId, organizationId), eq(tables.improvementProposals.id, proposal.id))).run();
        db.update(tables.badCases).set({ status: 'resolved', updatedAt: at }).where(and(
          eq(tables.badCases.organizationId, organizationId), inArray(tables.badCases.id, proposal.affectedCasesJson),
        )).run();
        db.insert(tables.auditLogs).values({
          id: crypto.randomUUID(), organizationId, userId, action: 'prompt_proposal.applied', entityType: 'skill', entityId: productionSkillId,
          metadataJson: JSON.stringify({ proposalId: proposal.id, sourceSkillId: current.id, fromVersion: current.currentVersion, toVersion: nextVersion, experimentId: experiment.id }),
          isDemo, createdAt: at,
        }).run();
      });
      return proposalView({
        ...proposal,
        status: 'applied', appliedSkillVersion: nextVersion, appliedBy: userId, appliedAt: at, updatedAt: at,
      });
    },
  };
}
