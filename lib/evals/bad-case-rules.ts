import { and, asc, desc, eq, inArray, lte } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as tables from '@/db/schema';
import type { BadCaseRow } from '@/db/schema';
import type { badCaseCategories, badCaseSeverities } from '@/db/constants';
import { parseTraceValue, sanitizeTrace, snapshotIdsFrom } from '@/lib/ops/trace-safety';

type Database = BetterSQLite3Database<typeof tables>;
type Category = (typeof badCaseCategories)[number];
type Severity = (typeof badCaseSeverities)[number];

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function collectMemoryIds(value: unknown, target = new Set<string>()) {
  if (Array.isArray(value)) {
    for (const item of value) collectMemoryIds(item, target);
    return target;
  }
  const row = object(value);
  if (!row) return target;
  for (const [key, item] of Object.entries(row)) {
    if ((key === 'memoryIds' || key === 'memory_ids') && Array.isArray(item)) {
      for (const id of item) if (typeof id === 'string') target.add(id);
    }
    collectMemoryIds(item, target);
  }
  return target;
}

function errorCode(value: unknown) {
  return object(value)?.code;
}

export function runSnapshots(db: Database, organizationId: string, runId: string) {
  const steps = db.select().from(tables.runSteps).where(and(
    eq(tables.runSteps.organizationId, organizationId),
    eq(tables.runSteps.runId, runId),
  )).orderBy(asc(tables.runSteps.sequence)).all();
  const snapshotIds = new Set<string>();
  for (const step of steps) {
    snapshotIdsFrom(parseTraceValue(step.inputJson), snapshotIds);
    snapshotIdsFrom(parseTraceValue(step.outputJson), snapshotIds);
  }
  const snapshots = snapshotIds.size ? db.select().from(tables.contextSnapshots).where(and(
    eq(tables.contextSnapshots.organizationId, organizationId),
    inArray(tables.contextSnapshots.id, [...snapshotIds]),
  )).all() : [];
  return { steps, snapshots };
}

export function insertBadCase(db: Database, input: {
  organizationId: string;
  category: Category;
  severity: Severity;
  runId: string;
  stepCode: string;
  skillCode: string;
  skillVersion: number;
  inputSnapshot: unknown;
  contextSnapshot: unknown;
  output: unknown;
  expectedBehavior: string;
  ruleGenerated: boolean;
  sourceRatingId?: string | null;
  fingerprint: string;
  createdBy: string;
  isDemo: boolean;
  createdAt: string;
}) {
  const id = crypto.randomUUID();
  const result = db.insert(tables.badCases).values({
    id,
    organizationId: input.organizationId,
    category: input.category,
    severity: input.severity,
    runId: input.runId,
    stepCode: input.stepCode,
    skillCode: input.skillCode,
    skillVersion: input.skillVersion,
    inputSnapshotJson: sanitizeTrace(input.inputSnapshot),
    contextSnapshotJson: sanitizeTrace(input.contextSnapshot),
    outputJson: sanitizeTrace(input.output),
    expectedBehavior: input.expectedBehavior,
    status: 'open',
    ruleGenerated: input.ruleGenerated,
    sourceRatingId: input.sourceRatingId ?? null,
    fingerprint: input.fingerprint,
    createdBy: input.createdBy,
    isDemo: input.isDemo,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  }).onConflictDoNothing().run();
  return result.changes === 1 ? id : null;
}

export function scanRunForBadCases(
  db: Database,
  organizationId: string,
  runId: string,
  fallbackUserId: string,
  at = new Date(),
) {
  const run = db.select().from(tables.runs).where(and(
    eq(tables.runs.organizationId, organizationId), eq(tables.runs.id, runId),
  )).get();
  if (!run) return [] as string[];
  const { steps, snapshots } = runSnapshots(db, organizationId, run.id);
  const usage = db.select().from(tables.aiUsageLogs).where(and(
    eq(tables.aiUsageLogs.organizationId, organizationId), eq(tables.aiUsageLogs.runId, run.id),
  )).orderBy(asc(tables.aiUsageLogs.createdAt)).all();
  const contextSnapshot = snapshots.map((row) => ({
    id: row.id,
    accountId: row.accountId,
    contentId: row.contentId,
    monthlyPlanId: row.monthlyPlanId,
    snapshot: row.contextSnapshotJson,
  }));
  const createdBy = run.createdBy ?? fallbackUserId;
  const createdAt = at.toISOString();
  const ids: string[] = [];

  const memoryIds = [...collectMemoryIds(contextSnapshot)];
  if (memoryIds.length) {
    const invalid = db.select().from(tables.memories).where(and(
      eq(tables.memories.organizationId, organizationId),
      inArray(tables.memories.id, memoryIds),
    )).all().filter((memory) => memory.status !== 'active'
      || memory.effectiveAt > run.createdAt
      || (memory.expiresAt !== null && memory.expiresAt <= run.createdAt));
    if (invalid.length) {
      const firstUsage = usage[0];
      const targetStep = firstUsage
        ? steps.find((step) => step.id === firstUsage.runStepId)
        : steps.find((step) => step.stepCode === 'context_build') ?? steps[0];
      const inserted = insertBadCase(db, {
        organizationId,
        category: 'memory_status_violation',
        severity: 'critical',
        runId: run.id,
        stepCode: targetStep?.stepCode ?? 'context_build',
        skillCode: firstUsage?.skillCode ?? 'context_builder',
        skillVersion: firstUsage?.skillVersion ?? 1,
        inputSnapshot: targetStep ? parseTraceValue(targetStep.inputJson) : {},
        contextSnapshot,
        output: { invalidMemoryIds: invalid.map((memory) => memory.id) },
        expectedBehavior: 'Production/Eval Context 不得引用 superseded、expired、inactive 或尚未生效的 Memory。',
        ruleGenerated: true,
        fingerprint: `${run.id}:memory_status_violation:${invalid.map((memory) => memory.id).sort().join(',')}`,
        createdBy,
        isDemo: run.isDemo,
        createdAt,
      });
      if (inserted) ids.push(inserted);
    }
  }

  const highCandidates = db.select().from(tables.plannerCandidates).where(and(
    eq(tables.plannerCandidates.organizationId, organizationId),
    eq(tables.plannerCandidates.sourceRunId, run.id),
    eq(tables.plannerCandidates.duplicateLevel, 'high'),
    eq(tables.plannerCandidates.selectable, true),
  )).all();
  for (const candidate of highCandidates) {
    const plannerUsage = usage.find((row) => row.skillCode === 'content_planner') ?? usage[0];
    const targetStep = plannerUsage ? steps.find((step) => step.id === plannerUsage.runStepId) : steps[0];
    const inserted = insertBadCase(db, {
      organizationId,
      category: 'high_duplicate_default',
      severity: 'critical',
      runId: run.id,
      stepCode: targetStep?.stepCode ?? 'candidate_duplicate_judge',
      skillCode: plannerUsage?.skillCode ?? 'content_planner',
      skillVersion: plannerUsage?.skillVersion ?? 1,
      inputSnapshot: targetStep ? parseTraceValue(targetStep.inputJson) : {},
      contextSnapshot,
      output: { candidateId: candidate.id, duplicateLevel: candidate.duplicateLevel, selectable: candidate.selectable },
      expectedBehavior: 'duplicate_level=high 的 Planner 候选必须默认不可选。',
      ruleGenerated: true,
      fingerprint: `${run.id}:high_duplicate_default:${candidate.id}`,
      createdBy,
      isDemo: run.isDemo,
      createdAt,
    });
    if (inserted) ids.push(inserted);
  }

  for (const currentUsage of usage) {
    const currentStep = steps.find((step) => step.id === currentUsage.runStepId);
    if (!currentStep || errorCode(parseTraceValue(currentStep.errorJson)) !== 'LLM_OUTPUT_INVALID') continue;
    const recent = db.select().from(tables.aiUsageLogs).where(and(
      eq(tables.aiUsageLogs.organizationId, organizationId),
      eq(tables.aiUsageLogs.skillCode, currentUsage.skillCode),
      eq(tables.aiUsageLogs.runType, 'production'),
      lte(tables.aiUsageLogs.createdAt, currentUsage.createdAt),
    )).orderBy(desc(tables.aiUsageLogs.createdAt)).limit(2).all();
    if (recent.length < 2 || recent.some((row) => row.status !== 'failed')) continue;
    const recentSteps = db.select().from(tables.runSteps).where(and(
      eq(tables.runSteps.organizationId, organizationId),
      inArray(tables.runSteps.id, recent.map((row) => row.runStepId)),
    )).all();
    if (recentSteps.some((step) => errorCode(parseTraceValue(step.errorJson)) !== 'LLM_OUTPUT_INVALID')) continue;
    const inserted = insertBadCase(db, {
      organizationId,
      category: 'schema_repeated_failure',
      severity: 'high',
      runId: run.id,
      stepCode: currentStep.stepCode,
      skillCode: currentUsage.skillCode,
      skillVersion: currentUsage.skillVersion,
      inputSnapshot: parseTraceValue(currentStep.inputJson),
      contextSnapshot,
      output: parseTraceValue(currentStep.outputJson),
      expectedBehavior: '正式 LLM 输出必须一次重试内通过 JSON 解析和 Output Schema 校验。',
      ruleGenerated: true,
      fingerprint: `${run.id}:schema_repeated_failure:${currentUsage.skillCode}`,
      createdBy,
      isDemo: run.isDemo,
      createdAt,
    });
    if (inserted) ids.push(inserted);
  }
  return ids;
}

export function badCaseView(row: BadCaseRow) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    category: row.category,
    severity: row.severity,
    runId: row.runId,
    stepCode: row.stepCode,
    skillCode: row.skillCode,
    skillVersion: row.skillVersion,
    inputSnapshot: row.inputSnapshotJson,
    contextSnapshot: row.contextSnapshotJson,
    output: row.outputJson,
    expectedBehavior: row.expectedBehavior,
    status: row.status,
    ruleGenerated: row.ruleGenerated,
    sourceRatingId: row.sourceRatingId,
    fingerprint: row.fingerprint,
    createdBy: row.createdBy,
    isDemo: row.isDemo,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
