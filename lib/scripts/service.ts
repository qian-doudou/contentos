import { createHash, randomBytes } from 'node:crypto';
import { and, asc, desc, eq, gt, lte, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { z } from 'zod';
import * as tables from '@/db/schema';
import { ApiError } from '@/lib/api/envelope';
import { permissionService } from '@/lib/auth/permissions';
import { assertContentTransition } from '@/lib/content/workflow';
import { OpenAICompatibleClient } from '@/lib/llm/client';
import { contextBuilder } from '@/lib/memory/context-builder';
import { plannerAiRuntime } from '@/lib/planner/ai-runtime';
import { qualityOutputSchema, type QualityIssue } from '@/lib/planner/contracts';
import {
  approvalDecisionInputSchema,
  approvalViewSchema,
  createManualScriptSchema,
  generateScriptInputSchema,
  generateScriptResultSchema,
  publicScriptReviewSchema,
  scriptJsonSchema,
  scriptVersionSchema,
  scriptWorkspaceSchema,
  submitApprovalResultSchema,
  submitScriptApprovalSchema,
  type ScriptJson,
} from './contracts';

type Database = BetterSQLite3Database<typeof tables>;
const STEP_CODES = ['context_build', 'script_generator', 'quality_check', 'persist_script_version'] as const;
const missing = () => new ApiError(404, 'NOT_FOUND', '记录不存在或不属于当前组织');
const json = (value: unknown) => JSON.stringify(value);
const elapsed = (started: number, finished: number) => Math.max(0, finished - started);
const tokenSchema = z.string().trim().regex(/^[A-Za-z0-9_-]{43,128}$/, '审核 Token 格式无效');

function tokenHash(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function priceTokens(value: string) {
  return [...new Set(value.match(/(?:¥|￥)\s*\d+(?:\.\d+)?|\d+(?:\.\d+)?\s*(?:元|块|折|%)/g) ?? [])];
}

function activityTokens(value: string) {
  return [...new Set(value.match(/买[^，。；\s]{0,6}赠[^，。；\s]{0,6}|满\s*\d+\s*减\s*\d+|限时(?:优惠|活动|折扣)|(?:团购|活动|优惠)价|免费赠送|进店送/gu) ?? [])];
}

function scriptText(script: ScriptJson) {
  return [
    script.title,
    script.hook,
    script.spoken_script,
    script.product_integration,
    script.cta,
    ...script.hashtags,
    json(script.shots),
  ].join('\n');
}

function deterministicQuality(
  contentId: string,
  script: ScriptJson,
  brand: typeof tables.brands.$inferSelect,
  account: typeof tables.accounts.$inferSelect,
  allowedFacts: string,
) {
  const full = scriptText(script);
  const issues: QualityIssue[] = [];
  for (const topic of brand.forbiddenTopicsJson.filter(Boolean)) {
    if (full.includes(topic)) issues.push({
      code: 'forbidden_topic', message: `脚本命中禁用主题：${topic}`, field: null, blocking: true,
    });
  }
  for (const style of account.forbiddenStyleJson.filter(Boolean)) {
    if (full.includes(style)) issues.push({
      code: 'forbidden_style', message: `脚本命中禁用风格：${style}`, field: null, blocking: true,
    });
  }
  const unsupportedFacts = [...priceTokens(full), ...activityTokens(full)].filter((item) => !allowedFacts.includes(item));
  if (unsupportedFacts.length) issues.push({
    code: 'unverified_dynamic_fact',
    message: `脚本包含 Context 无有效来源的动态事实：${[...new Set(unsupportedFacts)].join('、')}`,
    field: 'spoken_script',
    blocking: true,
  });
  return {
    candidate_id: contentId,
    status: issues.some((issue) => issue.blocking) ? 'blocked' as const : issues.length ? 'warning' as const : 'passed' as const,
    issues,
  };
}

function mockScript(
  content: typeof tables.contents.$inferSelect,
  brand: typeof tables.brands.$inferSelect,
): ScriptJson {
  const product = content.productText || brand.coreProductsJson[0] || '招牌产品';
  const hook = content.hookText || `在${brand.city || '本地'}，很多人第一次了解这件事都会忽略一个细节。`;
  return scriptJsonSchema.parse({
    title: content.title,
    hook,
    spoken_script: `${hook}\n我是店里的老板。今天不讲夸张噱头，就从真实现场带你看看${content.topic || content.title}。${content.coreMessage || `我们会把${product}的关键细节讲清楚。`}到店时可以按自己的需求选择，具体信息以门店当期公示为准。`,
    shots: [
      { scene: '门店开场', visual: '老板在真实门店环境出镜', spoken_line: hook },
      { scene: '核心展示', visual: `近景展示${product}与制作过程`, spoken_line: content.coreMessage || `把${product}的真实细节展示清楚。` },
      { scene: '结尾行动', visual: '老板面向镜头自然收尾', spoken_line: content.ctaType || '欢迎到店按实际需求了解。' },
    ],
    product_integration: content.productText,
    cta: content.ctaType || '欢迎到店了解，具体信息以门店当期公示为准。',
    hashtags: [...new Set([brand.city ? `#${brand.city}美食` : '#本地生活', `#${brand.brandName}`, '#真实探店'])],
  });
}

function assertDraftable(status: (typeof tables.contents.$inferSelect)['status']) {
  if (!['IDEA', 'SCRIPTING', 'APPROVED'].includes(status))
    throw new ApiError(409, 'SCRIPT_DRAFT_NOT_ALLOWED', '当前内容状态不允许创建脚本草稿');
}

export function scriptApprovalService(
  db: Database,
  organizationId: string,
  userId: string,
  runtime: { now?: () => Date; client?: OpenAICompatibleClient; createToken?: () => string } = {},
) {
  const permissions = permissionService(db, organizationId, userId);
  const now = runtime.now ?? (() => new Date());
  const timestamp = () => now().toISOString();
  const ai = plannerAiRuntime(db, organizationId, userId, runtime);
  const contexts = contextBuilder(db, organizationId, userId, { now });
  const createToken = runtime.createToken ?? (() => randomBytes(32).toString('base64url'));
  const isDemo = permissions.organization.isDemo;

  function content(id: string, write = false) {
    const row = db.select().from(tables.contents).where(and(
      eq(tables.contents.organizationId, organizationId),
      eq(tables.contents.id, z.uuid().parse(id)),
    )).get();
    if (!row) throw missing();
    if (write) permissions.requireClientWrite(row.clientId);
    else permissions.requireClientRead(row.clientId);
    return row;
  }

  function accountFor(row: typeof tables.contents.$inferSelect, requireActive = false) {
    const account = db.select().from(tables.accounts).where(and(
      eq(tables.accounts.organizationId, organizationId),
      eq(tables.accounts.id, row.accountId),
      eq(tables.accounts.clientId, row.clientId),
    )).get();
    if (!account) throw missing();
    if (requireActive && account.status !== 'active') throw new ApiError(409, 'ACCOUNT_INACTIVE', '账号已停用，不能生成或提交脚本');
    return account;
  }

  function brandFor(row: typeof tables.contents.$inferSelect, requireActive = false) {
    const brand = db.select().from(tables.brands).where(and(
      eq(tables.brands.organizationId, organizationId),
      eq(tables.brands.id, row.brandId),
      eq(tables.brands.clientId, row.clientId),
    )).get();
    if (!brand) throw missing();
    if (requireActive && brand.status !== 'active') throw new ApiError(409, 'BRAND_INACTIVE', '品牌已停用，不能生成或提交脚本');
    return brand;
  }

  function scriptVersion(contentId: string, versionId: string) {
    const row = db.select().from(tables.scriptVersions).where(and(
      eq(tables.scriptVersions.organizationId, organizationId),
      eq(tables.scriptVersions.contentId, contentId),
      eq(tables.scriptVersions.id, z.uuid().parse(versionId)),
    )).get();
    if (!row) throw missing();
    return row;
  }

  function activeQuota() {
    const at = timestamp();
    return db.select().from(tables.organizationAiQuotas).where(and(
      eq(tables.organizationAiQuotas.organizationId, organizationId),
      lte(tables.organizationAiQuotas.periodStart, at),
      gt(tables.organizationAiQuotas.periodEnd, at),
    )).orderBy(desc(tables.organizationAiQuotas.periodStart)).get() ?? null;
  }

  function expirePending(contentId: string) {
    const at = timestamp();
    db.update(tables.approvals).set({ status: 'expired', updatedAt: at }).where(and(
      eq(tables.approvals.organizationId, organizationId),
      eq(tables.approvals.contentId, contentId),
      eq(tables.approvals.status, 'pending'),
      lte(tables.approvals.expiresAt, at),
    )).run();
  }

  function workspace(id: string) {
    const row = content(id);
    expirePending(row.id);
    const account = accountFor(row);
    const brand = brandFor(row);
    const versions = db.select().from(tables.scriptVersions).where(and(
      eq(tables.scriptVersions.organizationId, organizationId),
      eq(tables.scriptVersions.contentId, row.id),
    )).orderBy(desc(tables.scriptVersions.versionNo)).all().map((version) => {
      const creator = db.select({ name: tables.users.name }).from(tables.users).where(and(
        eq(tables.users.organizationId, organizationId), eq(tables.users.id, version.createdBy),
      )).get();
      if (!creator) throw missing();
      return scriptVersionSchema.parse({
        ...version,
        creatorName: creator.name,
        isCurrent: row.currentScriptVersionId === version.id,
        isActiveApproved: row.activeApprovedScriptVersionId === version.id,
      });
    });
    const versionNumbers = new Map(versions.map((version) => [version.id, version.versionNo]));
    const approvals = db.select().from(tables.approvals).where(and(
      eq(tables.approvals.organizationId, organizationId),
      eq(tables.approvals.contentId, row.id),
      eq(tables.approvals.approvalType, 'script'),
    )).orderBy(desc(tables.approvals.createdAt), desc(tables.approvals.id)).all().map((approval) => {
      const reviewer = approval.reviewerUserId ? db.select({ name: tables.users.name }).from(tables.users).where(and(
        eq(tables.users.organizationId, organizationId), eq(tables.users.id, approval.reviewerUserId),
      )).get() : null;
      return approvalViewSchema.parse({
        id: approval.id,
        contentId: approval.contentId,
        approvalType: approval.approvalType,
        versionId: approval.versionId,
        versionNo: versionNumbers.get(approval.versionId) ?? 0,
        status: approval.status,
        reviewerType: approval.reviewerType,
        reviewerUserId: approval.reviewerUserId,
        reviewerName: reviewer?.name ?? null,
        expiresAt: approval.expiresAt,
        comment: approval.comment,
        isDemo: approval.isDemo,
        createdAt: approval.createdAt,
        updatedAt: approval.updatedAt,
      });
    });
    const quota = activeQuota();
    let generatorPointCost: number | null = null;
    try { generatorPointCost = ai.skill('script_generator').pointCost; } catch { generatorPointCost = null; }
    return scriptWorkspaceSchema.parse({
      content: {
        id: row.id,
        title: row.title,
        status: row.status,
        accountId: row.accountId,
        accountName: account.accountName,
        brandName: brand.brandName,
        currentScriptVersionId: row.currentScriptVersionId,
        activeApprovedScriptVersionId: row.activeApprovedScriptVersionId,
      },
      versions,
      approvals,
      remainingPoints: quota ? quota.quotaPoints - quota.usedPoints : 0,
      generatorPointCost,
      mode: ai.publicConfig.mode,
      permissions: {
        canWrite: permissions.canWriteClient(row.clientId),
        canReview: permissions.has('master_data.write'),
      },
    });
  }

  function createRun(contentId: string) {
    const at = timestamp();
    const runId = crypto.randomUUID();
    db.transaction(() => {
      db.insert(tables.runs).values({
        id: runId,
        organizationId,
        runType: 'production',
        subjectType: 'script_generation',
        subjectId: contentId,
        status: 'running',
        startedAt: at,
        finishedAt: null,
        createdBy: userId,
        isDemo,
        createdAt: at,
      }).run();
      db.insert(tables.runSteps).values(STEP_CODES.map((code, sequence) => ({
        id: crypto.randomUUID(), organizationId, runId, sequence, stepCode: code,
        status: 'pending' as const, inputJson: null, outputJson: null, errorJson: null,
        startedAt: null, finishedAt: null, durationMs: null, warningCodesJson: null, isDemo,
      }))).run();
    });
    return runId;
  }

  function step(runId: string, code: typeof STEP_CODES[number]) {
    const row = db.select().from(tables.runSteps).where(and(
      eq(tables.runSteps.organizationId, organizationId),
      eq(tables.runSteps.runId, runId),
      eq(tables.runSteps.stepCode, code),
    )).get();
    if (!row) throw missing();
    return row;
  }

  function startStep(id: string, input: unknown) {
    const startedAt = timestamp();
    db.update(tables.runSteps).set({ status: 'running', inputJson: json(input), startedAt }).where(and(
      eq(tables.runSteps.organizationId, organizationId), eq(tables.runSteps.id, id),
    )).run();
    return now().getTime();
  }

  function finishStep(id: string, started: number, output: unknown, warningCodes: string[] = []) {
    const finishedAt = timestamp();
    db.update(tables.runSteps).set({
      status: 'succeeded',
      outputJson: json(output),
      errorJson: null,
      finishedAt,
      durationMs: elapsed(started, now().getTime()),
      warningCodesJson: warningCodes.length ? json(warningCodes) : null,
    }).where(and(eq(tables.runSteps.organizationId, organizationId), eq(tables.runSteps.id, id))).run();
  }

  function failRun(runId: string, stepId: string, error: unknown) {
    const at = timestamp();
    const detail = {
      code: error instanceof ApiError ? error.code : 'SCRIPT_GENERATION_FAILED',
      message: error instanceof Error ? error.message : '脚本生成失败',
    };
    db.transaction(() => {
      db.update(tables.runSteps).set({ status: 'failed', errorJson: json(detail), finishedAt: at }).where(and(
        eq(tables.runSteps.organizationId, organizationId), eq(tables.runSteps.id, stepId),
      )).run();
      db.update(tables.runSteps).set({ status: 'skipped', errorJson: json({ code: 'UPSTREAM_FAILED' }), finishedAt: at }).where(and(
        eq(tables.runSteps.organizationId, organizationId), eq(tables.runSteps.runId, runId), eq(tables.runSteps.status, 'pending'),
      )).run();
      db.update(tables.runs).set({ status: 'failed', finishedAt: at }).where(and(
        eq(tables.runs.organizationId, organizationId), eq(tables.runs.id, runId),
      )).run();
    });
  }

  function appendVersion(row: typeof tables.contents.$inferSelect, script: ScriptJson, sourceType: 'ai' | 'operator' | 'client_revision' | 'rewrite', changeSummary: string) {
    const at = timestamp();
    const nextVersion = (db.select({ value: sql<number>`coalesce(max(${tables.scriptVersions.versionNo}), 0)` })
      .from(tables.scriptVersions).where(and(
        eq(tables.scriptVersions.organizationId, organizationId), eq(tables.scriptVersions.contentId, row.id),
      )).get()?.value ?? 0) + 1;
    const version = {
      id: crypto.randomUUID(), organizationId, contentId: row.id, versionNo: nextVersion,
      scriptJson: script, sourceType, changeSummary, createdBy: userId, isDemo: row.isDemo, createdAt: at,
    };
    db.insert(tables.scriptVersions).values(version).run();
    const nextStatus = row.status === 'IDEA' ? 'SCRIPTING' as const : row.status;
    const changed = db.update(tables.contents).set({
      currentScriptVersionId: version.id,
      status: nextStatus,
      aiReviewStatus: sourceType === 'ai' ? row.aiReviewStatus : null,
      updatedAt: at,
    }).where(and(
      eq(tables.contents.organizationId, organizationId),
      eq(tables.contents.id, row.id),
      eq(tables.contents.status, row.status),
      row.currentScriptVersionId ? eq(tables.contents.currentScriptVersionId, row.currentScriptVersionId) : sql`${tables.contents.currentScriptVersionId} IS NULL`,
    )).run();
    if (changed.changes !== 1) throw new ApiError(409, 'STALE_SCRIPT_VERSION', '脚本版本已变化，请刷新后重试');
    if (row.status === 'IDEA') {
      db.insert(tables.contentStatusLogs).values({
        id: crypto.randomUUID(), organizationId, contentId: row.id, previousStatus: 'IDEA', newStatus: 'SCRIPTING',
        triggerType: 'system', triggerId: version.id, operatorId: userId,
        reason: '创建首个脚本版本，自动进入脚本中', isDemo: row.isDemo, createdAt: at,
      }).run();
    }
    return version;
  }

  function applyDecision(
    approval: typeof tables.approvals.$inferSelect,
    input: z.infer<typeof approvalDecisionInputSchema>,
    operatorId: string,
  ) {
    const row = db.select().from(tables.contents).where(and(
      eq(tables.contents.organizationId, approval.organizationId), eq(tables.contents.id, approval.contentId),
    )).get();
    if (!row) throw missing();
    const version = db.select().from(tables.scriptVersions).where(and(
      eq(tables.scriptVersions.organizationId, approval.organizationId),
      eq(tables.scriptVersions.contentId, approval.contentId),
      eq(tables.scriptVersions.id, approval.versionId),
    )).get();
    if (!version) throw missing();
    if (approval.status !== 'pending') throw new ApiError(409, 'APPROVAL_FINALIZED', '该审核已经处理，不能重复提交');
    if (row.status !== 'WAITING_APPROVAL') throw new ApiError(409, 'CONTENT_NOT_WAITING_APPROVAL', '内容当前不在待审核状态');
    if (row.currentScriptVersionId !== version.id)
      throw new ApiError(409, 'SCRIPT_VERSION_NOT_CURRENT', '审核版本已不是当前脚本版本');
    const nextStatus = input.status === 'approved' ? 'APPROVED' as const : 'SCRIPTING' as const;
    assertContentTransition(row.status, nextStatus, 'approval');
    const at = timestamp();
    db.transaction(() => {
      const approvalChanged = db.update(tables.approvals).set({
        status: input.status,
        comment: input.comment,
        updatedAt: at,
      }).where(and(
        eq(tables.approvals.organizationId, approval.organizationId),
        eq(tables.approvals.id, approval.id),
        eq(tables.approvals.status, 'pending'),
      )).run();
      if (approvalChanged.changes !== 1) throw new ApiError(409, 'APPROVAL_FINALIZED', '该审核已经处理，不能重复提交');
      const contentChanged = db.update(tables.contents).set({
        status: nextStatus,
        activeApprovedScriptVersionId: input.status === 'approved' ? version.id : null,
        updatedAt: at,
      }).where(and(
        eq(tables.contents.organizationId, approval.organizationId),
        eq(tables.contents.id, row.id),
        eq(tables.contents.status, 'WAITING_APPROVAL'),
      )).run();
      if (contentChanged.changes !== 1) throw new ApiError(409, 'STALE_CONTENT_STATUS', '内容状态已变化，请刷新后重试');
      db.update(tables.approvals).set({ status: 'expired', updatedAt: at }).where(and(
        eq(tables.approvals.organizationId, approval.organizationId),
        eq(tables.approvals.contentId, approval.contentId),
        eq(tables.approvals.status, 'pending'),
      )).run();
      db.insert(tables.contentStatusLogs).values({
        id: crypto.randomUUID(), organizationId: approval.organizationId, contentId: row.id,
        previousStatus: 'WAITING_APPROVAL', newStatus: nextStatus, triggerType: 'approval', triggerId: approval.id,
        operatorId, reason: input.comment || (input.status === 'approved' ? '审核通过' : input.status === 'rejected' ? '审核拒绝' : '审核要求修改'),
        isDemo: row.isDemo, createdAt: at,
      }).run();
      db.insert(tables.auditLogs).values({
        id: crypto.randomUUID(), organizationId: approval.organizationId,
        userId: approval.reviewerType === 'internal_user' ? operatorId : null,
        action: `script_approval.${input.status}`, entityType: 'approval', entityId: approval.id,
        metadataJson: json({ contentId: row.id, versionId: version.id }), isDemo: row.isDemo, createdAt: at,
      }).run();
    });
  }

  return {
    workspace,

    createManual(id: string, input: unknown) {
      const value = createManualScriptSchema.parse(input);
      const row = content(id, true);
      accountFor(row, true);
      brandFor(row, true);
      assertDraftable(row.status);
      db.transaction(() => {
        appendVersion(row, value.scriptJson, value.sourceType, value.changeSummary);
        db.insert(tables.auditLogs).values({
          id: crypto.randomUUID(), organizationId, userId, action: 'script.version_created',
          entityType: 'content', entityId: row.id,
          metadataJson: json({ sourceType: value.sourceType }), isDemo: row.isDemo, createdAt: timestamp(),
        }).run();
      });
      return workspace(row.id);
    },

    async generate(id: string, input: unknown) {
      const value = generateScriptInputSchema.parse(input);
      const row = content(id, true);
      const account = accountFor(row, true);
      const brand = brandFor(row, true);
      assertDraftable(row.status);
      permissions.require('ai.test');
      const generatorSkill = ai.skill('script_generator');
      ai.requireQuota(generatorSkill.pointCost);
      const runId = createRun(row.id);
      let activeStepId = step(runId, 'context_build').id;
      try {
        const contextStarted = startStep(activeStepId, { accountId: account.id, contentId: row.id });
        const context = contexts.build({
          accountId: account.id,
          contentId: row.id,
          focus: [row.title, row.topic, row.angle, row.coreMessage].filter(Boolean).join(' '),
        });
        if (!context.snapshot.memoryIds.length)
          throw new ApiError(409, 'ACTIVE_MEMORY_REQUIRED', '当前账号或品牌没有有效 Active Memory，请先初始化或确认长期记忆');
        finishStep(activeStepId, contextStarted, { snapshotId: context.snapshotId, snapshot: context.snapshot });

        const generatorStep = step(runId, 'script_generator');
        activeStepId = generatorStep.id;
        const generatorInput = {
          content: {
            id: row.id, title: row.title, content_type: row.contentType, content_goal: row.contentGoal,
            topic: row.topic, angle: row.angle, hook_type: row.hookType, hook_text: row.hookText,
            core_message: row.coreMessage, product_text: row.productText, cta_type: row.ctaType,
            local_element: row.localElement, people: row.peopleJson,
          },
          context: context.layers,
          requirements: {
            output_language: 'zh-CN', dynamic_facts_must_have_context_source: true,
            preserve_exact_json_shape: true,
          },
        };
        const generatorStarted = startStep(generatorStep.id, { contentId: row.id, contextSnapshotId: context.snapshotId });
        const generated = await ai.invoke({
          runId, stepId: generatorStep.id, skillCode: 'script_generator', accountId: account.id,
          clientId: row.clientId, input: generatorInput, outputSchema: scriptJsonSchema,
          mockOutput: mockScript(row, brand),
        });
        finishStep(generatorStep.id, generatorStarted, {
          rawOutput: generated.rawOutput, parsed: generated.output, schemaValid: true, mode: generated.mode,
        });

        const deterministic = deterministicQuality(
          row.id,
          generated.output,
          brand,
          account,
          json({
            stable: context.layers.l1StableContext,
            current: context.layers.l2Current,
            memories: context.layers.l3Memories,
          }),
        );
        const qualityStep = step(runId, 'quality_check');
        activeStepId = qualityStep.id;
        const qualityStarted = startStep(qualityStep.id, { contentId: row.id, versionCandidate: generated.output });
        const checked = await ai.invoke({
          runId, stepId: qualityStep.id, skillCode: 'quality_checker', accountId: account.id,
          clientId: row.clientId,
          input: {
            candidates: [{ candidate_id: row.id, script: generated.output }],
            constraints: {
              forbidden_topics: brand.forbiddenTopicsJson,
              forbidden_styles: account.forbiddenStyleJson,
              verified_facts: {
                stable: context.layers.l1StableContext,
                current: context.layers.l2Current,
                memories: context.layers.l3Memories,
              },
              dynamic_fact_source: 'context_l1_l2_l3_only',
            },
            plan_gaps: [],
          },
          outputSchema: qualityOutputSchema,
          mockOutput: { candidates: [{
            ...deterministic,
            issues: deterministic.issues.map((issue) => ({ ...issue, field: issue.field ?? '' })),
          }] },
          validateOutput(output) {
            if (output.candidates.length !== 1 || output.candidates[0].candidate_id !== row.id)
              throw new ApiError(502, 'QUALITY_REFERENCE_INVALID', 'quality_checker 脚本引用不完整或越界');
          },
        });
        const aiQuality = checked.output.candidates[0];
        const qualityIssues = [
          ...deterministic.issues,
          ...aiQuality.issues.filter((issue) => !deterministic.issues.some((item) => item.code === issue.code && item.message === issue.message)),
        ];
        const qualityStatus = qualityIssues.some((issue) => issue.blocking) || aiQuality.status === 'blocked'
          ? 'blocked' as const
          : qualityIssues.length || aiQuality.status === 'warning' ? 'warning' as const : 'passed' as const;
        const warnings = qualityStatus === 'passed' ? [] : ['SCRIPT_QUALITY_ISSUES'];
        finishStep(qualityStep.id, qualityStarted, { status: qualityStatus, issues: qualityIssues }, warnings);
        if (qualityStatus === 'blocked')
          throw new ApiError(422, 'SCRIPT_QUALITY_BLOCKED', '脚本未通过质量门禁，未写入版本库', qualityIssues);

        const persistStep = step(runId, 'persist_script_version');
        activeStepId = persistStep.id;
        const persistStartedAt = timestamp();
        db.transaction(() => {
          db.update(tables.runSteps).set({ status: 'running', inputJson: json({ contentId: row.id }), startedAt: persistStartedAt }).where(and(
            eq(tables.runSteps.organizationId, organizationId), eq(tables.runSteps.id, persistStep.id), eq(tables.runSteps.status, 'pending'),
          )).run();
          const current = content(row.id, true);
          if (current.currentScriptVersionId !== row.currentScriptVersionId || current.status !== row.status)
            throw new ApiError(409, 'STALE_SCRIPT_VERSION', '脚本或内容状态已变化，请刷新后重试');
          const version = appendVersion(current, generated.output, 'ai', value.changeSummary);
          const at = timestamp();
          let quota: typeof tables.organizationAiQuotas.$inferSelect | null = null;
          if (generatorSkill.pointCost > 0) {
            quota = db.select().from(tables.organizationAiQuotas).where(and(
              eq(tables.organizationAiQuotas.organizationId, organizationId),
              lte(tables.organizationAiQuotas.periodStart, at), gt(tables.organizationAiQuotas.periodEnd, at),
            )).orderBy(desc(tables.organizationAiQuotas.periodStart)).get() ?? null;
            if (!quota) throw new ApiError(402, 'AI_QUOTA_EXCEEDED', 'AI Points 额度期不可用');
            const quotaUpdate = db.update(tables.organizationAiQuotas).set({
              usedPoints: sql`${tables.organizationAiQuotas.usedPoints} + ${generatorSkill.pointCost}`,
              updatedAt: at,
            }).where(and(
              eq(tables.organizationAiQuotas.organizationId, organizationId),
              eq(tables.organizationAiQuotas.id, quota.id),
              sql`${tables.organizationAiQuotas.usedPoints} + ${generatorSkill.pointCost} <= ${tables.organizationAiQuotas.quotaPoints}`,
            )).run();
            if (quotaUpdate.changes !== 1) throw new ApiError(402, 'AI_QUOTA_EXCEEDED', 'AI Points 余额不足');
            db.insert(tables.aiPointLedger).values({
              id: crypto.randomUUID(), organizationId, runId, skillCode: 'script_generator',
              points: generatorSkill.pointCost, ledgerType: 'consume',
              reason: 'AI 脚本通过校验并成功写入版本库', isDemo, createdAt: at,
            }).run();
            const generatorUsage = db.select({ id: tables.aiUsageLogs.id }).from(tables.aiUsageLogs).where(and(
              eq(tables.aiUsageLogs.organizationId, organizationId), eq(tables.aiUsageLogs.runId, runId),
              eq(tables.aiUsageLogs.skillCode, 'script_generator'), eq(tables.aiUsageLogs.status, 'completed'),
            )).orderBy(asc(tables.aiUsageLogs.createdAt)).get();
            if (generatorUsage) db.update(tables.aiUsageLogs).set({ billedPoints: generatorSkill.pointCost }).where(and(
              eq(tables.aiUsageLogs.organizationId, organizationId), eq(tables.aiUsageLogs.id, generatorUsage.id),
            )).run();
          }
          db.update(tables.runSteps).set({
            status: 'succeeded', outputJson: json({ versionId: version.id, versionNo: version.versionNo, billedPoints: generatorSkill.pointCost }),
            finishedAt: at, durationMs: elapsed(new Date(persistStartedAt).getTime(), now().getTime()),
          }).where(and(eq(tables.runSteps.organizationId, organizationId), eq(tables.runSteps.id, persistStep.id))).run();
          db.update(tables.runs).set({
            status: warnings.length ? 'completed_with_warnings' : 'completed', finishedAt: at,
          }).where(and(eq(tables.runs.organizationId, organizationId), eq(tables.runs.id, runId))).run();
          db.update(tables.contents).set({ aiReviewStatus: qualityStatus, updatedAt: at }).where(and(
            eq(tables.contents.organizationId, organizationId), eq(tables.contents.id, row.id),
          )).run();
          db.insert(tables.auditLogs).values({
            id: crypto.randomUUID(), organizationId, userId, action: 'script.ai_generated',
            entityType: 'script_version', entityId: version.id,
            metadataJson: json({ contentId: row.id, runId, versionNo: version.versionNo, billedPoints: generatorSkill.pointCost }),
            isDemo, createdAt: at,
          }).run();
        });
        return generateScriptResultSchema.parse({
          workspace: workspace(row.id), runId, contextSnapshotId: context.snapshotId,
          billedPoints: generatorSkill.pointCost, qualityStatus, qualityIssues,
        });
      } catch (error) {
        const runStatus = db.select({ status: tables.runs.status }).from(tables.runs).where(and(
          eq(tables.runs.organizationId, organizationId), eq(tables.runs.id, runId),
        )).get()?.status;
        if (runStatus !== 'completed' && runStatus !== 'completed_with_warnings') failRun(runId, activeStepId, error);
        throw error;
      }
    },

    submitApproval(id: string, input: unknown) {
      const value = submitScriptApprovalSchema.parse(input);
      const row = content(id, true);
      accountFor(row, true);
      brandFor(row, true);
      if (row.status !== 'SCRIPTING' && row.status !== 'APPROVED')
        throw new ApiError(409, 'APPROVAL_SUBMIT_NOT_ALLOWED', '只有脚本中或已批准后产生新草稿的内容可以提交脚本审核');
      const version = scriptVersion(row.id, value.versionId);
      if (row.currentScriptVersionId !== version.id)
        throw new ApiError(409, 'SCRIPT_VERSION_NOT_CURRENT', '只能提交当前脚本版本');
      let reviewerUserId: string | null = null;
      let rawToken: string | null = null;
      let hash: string | null = null;
      let expiresAt: string | null = null;
      if (value.reviewerType === 'internal_user') {
        reviewerUserId = value.reviewerUserId ?? null;
        const reviewer = reviewerUserId ? db.select().from(tables.users).where(and(
          eq(tables.users.organizationId, organizationId), eq(tables.users.id, reviewerUserId), eq(tables.users.status, 'active'),
        )).get() : null;
        if (!reviewer) throw missing();
        if (reviewer.role !== 'owner' && reviewer.role !== 'admin')
          throw new ApiError(409, 'REVIEWER_NOT_ALLOWED', '内部脚本审核人必须是 Owner 或 Admin');
      } else {
        rawToken = tokenSchema.parse(createToken());
        hash = tokenHash(rawToken);
        expiresAt = value.expiresAt ?? new Date(now().getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
        const expiresMs = Date.parse(expiresAt);
        if (expiresMs <= now().getTime() || expiresMs > now().getTime() + 30 * 24 * 60 * 60 * 1000)
          throw new ApiError(400, 'REVIEW_EXPIRY_INVALID', '外部审核有效期必须在当前时间之后且不超过 30 天');
      }
      const approvalId = crypto.randomUUID();
      const at = timestamp();
      db.transaction(() => {
        const current = content(row.id, true);
        if (current.status !== row.status || current.currentScriptVersionId !== version.id)
          throw new ApiError(409, 'STALE_SCRIPT_VERSION', '脚本或内容状态已变化，请刷新后重试');
        assertContentTransition(current.status, 'WAITING_APPROVAL', 'approval');
        db.update(tables.approvals).set({ status: 'expired', updatedAt: at }).where(and(
          eq(tables.approvals.organizationId, organizationId), eq(tables.approvals.contentId, current.id), eq(tables.approvals.status, 'pending'),
        )).run();
        db.insert(tables.approvals).values({
          id: approvalId, organizationId, contentId: current.id, approvalType: 'script', versionId: version.id,
          status: 'pending', reviewerType: value.reviewerType, reviewerUserId,
          reviewTokenHash: hash, expiresAt, comment: '', isDemo: current.isDemo, createdAt: at, updatedAt: at,
        }).run();
        const changed = db.update(tables.contents).set({
          status: 'WAITING_APPROVAL', activeApprovedScriptVersionId: null, updatedAt: at,
        }).where(and(
          eq(tables.contents.organizationId, organizationId), eq(tables.contents.id, current.id), eq(tables.contents.status, current.status),
        )).run();
        if (changed.changes !== 1) throw new ApiError(409, 'STALE_CONTENT_STATUS', '内容状态已变化，请刷新后重试');
        db.insert(tables.contentStatusLogs).values({
          id: crypto.randomUUID(), organizationId, contentId: current.id, previousStatus: current.status,
          newStatus: 'WAITING_APPROVAL', triggerType: 'approval', triggerId: approvalId, operatorId: userId,
          reason: `提交脚本 V${version.versionNo} 审核`, isDemo: current.isDemo, createdAt: at,
        }).run();
        db.insert(tables.auditLogs).values({
          id: crypto.randomUUID(), organizationId, userId, action: 'script_approval.submitted',
          entityType: 'approval', entityId: approvalId,
          metadataJson: json({ contentId: current.id, versionId: version.id, reviewerType: value.reviewerType }),
          isDemo: current.isDemo, createdAt: at,
        }).run();
      });
      return submitApprovalResultSchema.parse({
        workspace: workspace(row.id),
        reviewPath: rawToken ? `/review/${rawToken}` : null,
      });
    },

    decide(approvalId: string, input: unknown) {
      const value = approvalDecisionInputSchema.parse(input);
      permissions.require('master_data.write');
      const approval = db.select().from(tables.approvals).where(and(
        eq(tables.approvals.organizationId, organizationId), eq(tables.approvals.id, z.uuid().parse(approvalId)),
      )).get();
      if (!approval) throw missing();
      if (approval.reviewerType !== 'internal_user')
        throw new ApiError(403, 'REVIEW_CHANNEL_MISMATCH', '外部客户审核只能通过专属 Token 链接提交');
      if (approval.reviewerUserId !== userId && permissions.actor.role !== 'owner')
        throw new ApiError(403, 'PERMISSION_DENIED', '当前成员不是该审核的指定审核人');
      applyDecision(approval, value, userId);
      return workspace(approval.contentId);
    },
  };
}

export function publicScriptReviewService(
  db: Database,
  runtime: { now?: () => Date } = {},
) {
  const now = runtime.now ?? (() => new Date());

  function approvalForToken(token: string) {
    const validToken = tokenSchema.parse(token);
    const approval = db.select().from(tables.approvals).where(and(
      eq(tables.approvals.reviewTokenHash, tokenHash(validToken)),
      eq(tables.approvals.reviewerType, 'external_client'),
      eq(tables.approvals.approvalType, 'script'),
    )).get();
    if (!approval) throw new ApiError(404, 'REVIEW_LINK_NOT_FOUND', '审核链接不存在或已失效');
    if (!approval.expiresAt) throw new ApiError(404, 'REVIEW_LINK_NOT_FOUND', '审核链接不存在或已失效');
    if (approval.status === 'pending' && approval.expiresAt <= now().toISOString()) {
      db.update(tables.approvals).set({ status: 'expired', updatedAt: now().toISOString() }).where(and(
        eq(tables.approvals.organizationId, approval.organizationId), eq(tables.approvals.id, approval.id), eq(tables.approvals.status, 'pending'),
      )).run();
      throw new ApiError(410, 'REVIEW_LINK_EXPIRED', '审核链接已过期');
    }
    if (approval.status === 'expired') throw new ApiError(410, 'REVIEW_LINK_EXPIRED', '审核链接已过期');
    return approval;
  }

  function view(token: string) {
    const approval = approvalForToken(token);
    const content = db.select().from(tables.contents).where(and(
      eq(tables.contents.organizationId, approval.organizationId), eq(tables.contents.id, approval.contentId),
    )).get();
    const version = db.select().from(tables.scriptVersions).where(and(
      eq(tables.scriptVersions.organizationId, approval.organizationId),
      eq(tables.scriptVersions.contentId, approval.contentId),
      eq(tables.scriptVersions.id, approval.versionId),
    )).get();
    if (!content || !version) throw new ApiError(404, 'REVIEW_LINK_NOT_FOUND', '审核链接不存在或已失效');
    const brand = db.select().from(tables.brands).where(and(
      eq(tables.brands.organizationId, approval.organizationId), eq(tables.brands.id, content.brandId),
    )).get();
    if (!brand) throw new ApiError(404, 'REVIEW_LINK_NOT_FOUND', '审核链接不存在或已失效');
    return publicScriptReviewSchema.parse({
      brand: { name: brand.brandName, city: brand.city },
      content: { title: content.title },
      script: { versionNo: version.versionNo, scriptJson: version.scriptJson },
      approval: {
        status: approval.status,
        expiresAt: approval.expiresAt,
        comment: approval.comment,
        updatedAt: approval.updatedAt,
      },
    });
  }

  return {
    view,
    decide(token: string, input: unknown) {
      const value = approvalDecisionInputSchema.parse(input);
      const approval = approvalForToken(token);
      if (approval.status !== 'pending') throw new ApiError(409, 'APPROVAL_FINALIZED', '该审核已经处理，不能重复提交');
      const content = db.select().from(tables.contents).where(and(
        eq(tables.contents.organizationId, approval.organizationId), eq(tables.contents.id, approval.contentId),
      )).get();
      if (!content) throw new ApiError(404, 'REVIEW_LINK_NOT_FOUND', '审核链接不存在或已失效');
      if (content.currentScriptVersionId !== approval.versionId)
        throw new ApiError(409, 'SCRIPT_VERSION_NOT_CURRENT', '审核版本已不是当前脚本版本');
      const at = now().toISOString();
      const nextStatus = value.status === 'approved' ? 'APPROVED' as const : 'SCRIPTING' as const;
      assertContentTransition(content.status, nextStatus, 'approval');
      db.transaction(() => {
        const approvalChanged = db.update(tables.approvals).set({
          status: value.status, comment: value.comment, updatedAt: at,
        }).where(and(
          eq(tables.approvals.organizationId, approval.organizationId),
          eq(tables.approvals.id, approval.id), eq(tables.approvals.status, 'pending'),
        )).run();
        if (approvalChanged.changes !== 1) throw new ApiError(409, 'APPROVAL_FINALIZED', '该审核已经处理，不能重复提交');
        const contentChanged = db.update(tables.contents).set({
          status: nextStatus,
          activeApprovedScriptVersionId: value.status === 'approved' ? approval.versionId : null,
          updatedAt: at,
        }).where(and(
          eq(tables.contents.organizationId, approval.organizationId),
          eq(tables.contents.id, content.id), eq(tables.contents.status, 'WAITING_APPROVAL'),
        )).run();
        if (contentChanged.changes !== 1) throw new ApiError(409, 'STALE_CONTENT_STATUS', '内容状态已变化，请刷新后重试');
        db.update(tables.approvals).set({ status: 'expired', updatedAt: at }).where(and(
          eq(tables.approvals.organizationId, approval.organizationId),
          eq(tables.approvals.contentId, approval.contentId), eq(tables.approvals.status, 'pending'),
        )).run();
        db.insert(tables.contentStatusLogs).values({
          id: crypto.randomUUID(), organizationId: approval.organizationId, contentId: content.id,
          previousStatus: 'WAITING_APPROVAL', newStatus: nextStatus, triggerType: 'approval', triggerId: approval.id,
          operatorId: content.operatorId,
          reason: value.comment || (value.status === 'approved' ? '外部客户审核通过' : value.status === 'rejected' ? '外部客户拒绝脚本' : '外部客户要求修改'),
          isDemo: content.isDemo, createdAt: at,
        }).run();
        db.insert(tables.auditLogs).values({
          id: crypto.randomUUID(), organizationId: approval.organizationId, userId: null,
          action: `script_approval.${value.status}`, entityType: 'approval', entityId: approval.id,
          metadataJson: json({ contentId: content.id, versionId: approval.versionId, channel: 'external_token' }),
          isDemo: content.isDemo, createdAt: at,
        }).run();
      });
      return view(token);
    },
  };
}
