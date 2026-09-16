import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNull,
  lte,
  or,
  sql,
} from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { z } from 'zod';
import * as tables from '@/db/schema';
import { permissionService } from '@/lib/auth/permissions';
import { ApiError } from '@/lib/api/envelope';
import { assertNonProductionAiAllowed } from '@/lib/ops/config';
import { sanitizeTraceJson } from '@/lib/ops/trace-safety';
import {
  LlmRequestError,
  OpenAICompatibleClient,
  parseJsonOutput,
  structuredSystemPrompt,
  type LlmCompletion,
} from '@/lib/llm/client';
import {
  aiPointLedgerSchema,
  aiSettingsDataSchema,
  aiUsageLogSchema,
  createModelPriceInputSchema,
  modelPriceConfigSchema,
  organizationAiQuotaSchema,
  rollbackSkillInputSchema,
  runListDataSchema,
  runListQuerySchema,
  skillDetailDataSchema,
  skillListDataSchema,
  skillSchema,
  skillTestInputSchema,
  skillTestResultSchema,
  skillVersionSchema,
  updateSkillInputSchema,
} from './contracts';
import { deterministicMockFromSchema, zodFromJsonSchema } from './json-schema';
import { runSchema, runStepSchema } from '@/db/validation';

type Database = BetterSQLite3Database<typeof tables>;
const missing = () =>
  new ApiError(404, 'NOT_FOUND', '记录不存在或不属于当前组织');

export type RunType = 'production' | 'test' | 'eval';

export function estimateModelCost(
  inputTokens: number | null,
  outputTokens: number | null,
  price: {
    inputPricePerMillion: number | null;
    outputPricePerMillion: number | null;
  } | null,
) {
  if (
    inputTokens === null ||
    outputTokens === null ||
    !price ||
    price.inputPricePerMillion === null ||
    price.outputPricePerMillion === null
  )
    return null;
  return (
    (inputTokens * price.inputPricePerMillion +
      outputTokens * price.outputPricePerMillion) /
    1_000_000
  );
}

function issueMessages(error: z.ZodError) {
  return error.issues.map(
    (issue) => `${issue.path.join('.') || '输出'}: ${issue.message}`,
  );
}

export function aiInfrastructureService(
  db: Database,
  organizationId: string,
  userId: string,
  runtime: { client?: OpenAICompatibleClient; now?: () => Date } = {},
) {
  const permissions = permissionService(db, organizationId, userId);
  const client = runtime.client ?? new OpenAICompatibleClient();
  const now = runtime.now ?? (() => new Date());
  const timestamp = () => now().toISOString();
  const isDemo = permissions.organization.isDemo;
  const audit = (entityType: string, entityId: string, action: string) =>
    db
      .insert(tables.auditLogs)
      .values({
        id: crypto.randomUUID(),
        organizationId,
        userId,
        entityType,
        entityId,
        action,
        metadataJson: JSON.stringify({ source: 'ai_infrastructure' }),
        isDemo,
        createdAt: timestamp(),
      })
      .run();
  const skillScope = (id: string) =>
    and(
      eq(tables.skills.id, z.uuid().parse(id)),
      or(
        isNull(tables.skills.organizationId),
        eq(tables.skills.organizationId, organizationId),
      ),
    );
  const getSkill = (id: string) => {
    const row = db.select().from(tables.skills).where(skillScope(id)).get();
    if (!row) throw missing();
    return skillSchema.parse(row);
  };
  const getSkillByCode = (code: string) => {
    const row = db
      .select()
      .from(tables.skills)
      .where(
        and(
          eq(tables.skills.code, z.string().trim().min(1).max(100).parse(code)),
          or(
            isNull(tables.skills.organizationId),
            eq(tables.skills.organizationId, organizationId),
          ),
        ),
      )
      .orderBy(desc(sql`${tables.skills.organizationId} IS NOT NULL`))
      .get();
    if (!row) throw missing();
    return skillSchema.parse(row);
  };
  const activeQuota = (at = timestamp()) => {
    const row = db
      .select()
      .from(tables.organizationAiQuotas)
      .where(
        and(
          eq(tables.organizationAiQuotas.organizationId, organizationId),
          lte(tables.organizationAiQuotas.periodStart, at),
          sql`${tables.organizationAiQuotas.periodEnd} > ${at}`,
        ),
      )
      .orderBy(desc(tables.organizationAiQuotas.periodStart))
      .get();
    return row ? organizationAiQuotaSchema.parse(row) : null;
  };
  const requireQuota = (points: number) => {
    if (points === 0) return null;
    const quota = activeQuota();
    if (!quota || quota.quotaPoints - quota.usedPoints < points)
      throw new ApiError(402, 'AI_QUOTA_EXCEEDED', 'AI Points 余额不足');
    return quota;
  };
  const effectivePrice = (model: string, at: string) => {
    const row = db
      .select()
      .from(tables.modelPriceConfigs)
      .where(
        and(
          eq(tables.modelPriceConfigs.model, model),
          eq(tables.modelPriceConfigs.status, 'active'),
          lte(tables.modelPriceConfigs.effectiveAt, at),
        ),
      )
      .orderBy(desc(tables.modelPriceConfigs.effectiveAt))
      .get();
    return row ? modelPriceConfigSchema.parse(row) : null;
  };
  const validateScope = (clientId: string | null, accountId: string | null) => {
    let resolvedClientId = clientId;
    if (accountId) {
      const account = db
        .select()
        .from(tables.accounts)
        .where(
          and(
            eq(tables.accounts.organizationId, organizationId),
            eq(tables.accounts.id, accountId),
          ),
        )
        .get();
      if (!account) throw missing();
      if (resolvedClientId && resolvedClientId !== account.clientId)
        throw new ApiError(409, 'HIERARCHY_MISMATCH', '账号不属于所选客户');
      resolvedClientId = account.clientId;
    }
    if (resolvedClientId) {
      const existing = db
        .select({ id: tables.clients.id })
        .from(tables.clients)
        .where(
          and(
            eq(tables.clients.organizationId, organizationId),
            eq(tables.clients.id, resolvedClientId),
          ),
        )
        .get();
      if (!existing) throw missing();
      permissions.requireClientRead(resolvedClientId);
    }
    return { clientId: resolvedClientId, accountId };
  };
  const createRun = (
    runType: RunType,
    skillCode: string,
    subjectId: string | null,
    inputJson: string,
    subjectType = `skill:${skillCode}`,
  ) => {
    const createdAt = timestamp();
    const run = runSchema.parse({
      id: crypto.randomUUID(),
      organizationId,
      runType,
      subjectType,
      subjectId,
      status: 'queued',
      startedAt: null,
      finishedAt: null,
      createdBy: userId,
      isDemo,
      createdAt,
    });
    const step = runStepSchema.parse({
      id: crypto.randomUUID(),
      organizationId,
      runId: run.id,
      sequence: 0,
      stepCode: 'llm.invoke',
      status: 'pending',
      inputJson,
      outputJson: null,
      errorJson: null,
      startedAt: null,
      finishedAt: null,
      durationMs: null,
      warningCodesJson: null,
      isDemo,
    });
    const startedAt = timestamp();
    db.transaction(() => {
      db.insert(tables.runs).values(run).run();
      db.insert(tables.runSteps).values(step).run();
      db.update(tables.runs)
        .set({ status: 'running', startedAt })
        .where(
          and(
            eq(tables.runs.organizationId, organizationId),
            eq(tables.runs.id, run.id),
          ),
        )
        .run();
      db.update(tables.runSteps)
        .set({ status: 'running', startedAt })
        .where(
          and(
            eq(tables.runSteps.organizationId, organizationId),
            eq(tables.runSteps.id, step.id),
          ),
        )
        .run();
    });
    return {
      run: { ...run, status: 'running' as const, startedAt },
      step: { ...step, status: 'running' as const, startedAt },
    };
  };
  const persistUsage = (args: {
    runId: string;
    stepId: string;
    runType: RunType;
    skill: z.infer<typeof skillSchema>;
    scope: { clientId: string | null; accountId: string | null };
    completion: LlmCompletion | null;
    attempts?: number;
    status: 'completed' | 'failed';
    billedPoints: number;
    durationMs: number;
  }) => {
    const model =
      args.completion?.model ??
      client.publicConfig.models[args.skill.modelProfile];
    const inputTokens = args.completion?.inputTokens ?? null;
    const outputTokens = args.completion?.outputTokens ?? null;
    const createdAt = timestamp();
    const row = aiUsageLogSchema.parse({
      id: crypto.randomUUID(),
      organizationId,
      runId: args.runId,
      runStepId: args.stepId,
      runType: args.runType,
      userId,
      clientId: args.scope.clientId,
      accountId: args.scope.accountId,
      skillCode: args.skill.code,
      skillVersion: args.skill.currentVersion,
      providerRequestId: args.completion?.providerRequestId ?? null,
      model,
      inputTokens,
      outputTokens,
      estimatedCost: estimateModelCost(
        inputTokens,
        outputTokens,
        effectivePrice(model, createdAt),
      ),
      billedPoints: args.billedPoints,
      attempts: args.completion?.attempts ?? args.attempts ?? 1,
      durationMs: args.durationMs,
      status: args.status,
      isDemo,
      createdAt,
    });
    db.insert(tables.aiUsageLogs).values(row).run();
    return row;
  };
  const consumePoints = (runId: string, skillCode: string, points: number) => {
    if (points === 0) return;
    const quota = activeQuota();
    if (!quota)
      throw new ApiError(402, 'AI_QUOTA_EXCEEDED', 'AI Points 额度期不可用');
    const update = db
      .update(tables.organizationAiQuotas)
      .set({
        usedPoints: sql`${tables.organizationAiQuotas.usedPoints} + ${points}`,
        updatedAt: timestamp(),
      })
      .where(
        and(
          eq(tables.organizationAiQuotas.organizationId, organizationId),
          eq(tables.organizationAiQuotas.id, quota.id),
          sql`${tables.organizationAiQuotas.usedPoints} + ${points} <= ${tables.organizationAiQuotas.quotaPoints}`,
        ),
      )
      .run();
    if (update.changes !== 1)
      throw new ApiError(402, 'AI_QUOTA_EXCEEDED', 'AI Points 余额不足');
    db.insert(tables.aiPointLedger)
      .values(
        aiPointLedgerSchema.parse({
          id: crypto.randomUUID(),
          organizationId,
          runId,
          skillCode,
          points,
          ledgerType: 'consume',
          reason: '正式 AI 任务成功持久化',
          isDemo,
          createdAt: timestamp(),
        }),
      )
      .run();
  };
  const persistSkillVersion = (
    current: z.infer<typeof skillSchema>,
    changes: Partial<
      Pick<
        z.infer<typeof skillSchema>,
        | 'name'
        | 'description'
        | 'systemPrompt'
        | 'userPromptTemplate'
        | 'inputSchemaJson'
        | 'outputSchemaJson'
        | 'modelProfile'
        | 'pointCost'
        | 'enabled'
      >
    >,
    changeReason: string,
  ) => {
    const updatedAt = timestamp();
    const next = skillSchema.parse({
      ...current,
      ...changes,
      currentVersion: current.currentVersion + 1,
      updatedAt,
    });
    const version = skillVersionSchema.parse({
      id: crypto.randomUUID(),
      organizationId: current.organizationId,
      skillId: current.id,
      version: next.currentVersion,
      systemPrompt: next.systemPrompt,
      userPromptTemplate: next.userPromptTemplate,
      inputSchemaJson: next.inputSchemaJson,
      outputSchemaJson: next.outputSchemaJson,
      modelProfile: next.modelProfile,
      pointCost: next.pointCost,
      changeReason,
      createdBy: userId,
      isDemo: current.isDemo,
      createdAt: updatedAt,
    });
    const update = db
      .update(tables.skills)
      .set(next)
      .where(
        and(
          skillScope(current.id),
          eq(tables.skills.currentVersion, current.currentVersion),
        ),
      )
      .run();
    if (update.changes !== 1)
      throw new ApiError(
        409,
        'STALE_SKILL_VERSION',
        'Skill 版本已变更，请刷新后重试',
      );
    db.insert(tables.skillVersions).values(version).run();
    audit('skill', current.id, 'skill.version_created');
    return next;
  };

  async function execute(args: {
    runType: RunType;
    skillCode: string;
    input: Record<string, unknown>;
    clientId?: string | null;
    accountId?: string | null;
    subjectId?: string | null;
    persistBusinessResult?: (output: unknown) => void;
    mockOutput?: unknown;
    validateOutput?: (output: unknown) => void;
    skillOverride?: z.infer<typeof skillSchema>;
    subjectType?: string;
    traceMetadata?: Record<string, unknown>;
  }) {
    const skill = args.skillOverride ?? getSkillByCode(args.skillCode);
    if (!skill.enabled)
      throw new ApiError(409, 'SKILL_DISABLED', 'Skill 已停用');
    const scope = validateScope(args.clientId ?? null, args.accountId ?? null);
    if (args.runType === 'production') {
      permissions.require('ai.test');
      if (!args.persistBusinessResult)
        throw new ApiError(
          500,
          'PERSISTENCE_CALLBACK_REQUIRED',
          '正式 AI 任务必须提供业务结果持久化操作',
        );
      requireQuota(skill.pointCost);
    } else {
      permissions.require('ai.test');
      assertNonProductionAiAllowed(db, organizationId, permissions.actor.role, args.runType, timestamp());
    }
    const inputResult = zodFromJsonSchema(skill.inputSchemaJson).safeParse(
      args.input,
    );
    if (!inputResult.success)
      throw new ApiError(
        400,
        'SKILL_INPUT_INVALID',
        'Skill 输入不符合 Schema',
        issueMessages(inputResult.error),
      );
    const renderedPrompt = {
      system: structuredSystemPrompt(skill.systemPrompt, skill.outputSchemaJson),
      user: skill.userPromptTemplate.includes('{{input_json}}')
        ? skill.userPromptTemplate.replaceAll(
            '{{input_json}}',
            JSON.stringify(inputResult.data, null, 2),
          )
        : `${skill.userPromptTemplate}\n\n${JSON.stringify(inputResult.data, null, 2)}`,
    };
    const traceInput = JSON.stringify({
      marker: args.runType === 'test' ? 'TEST_RUN' : args.runType.toUpperCase(),
      skillCode: skill.code,
      skillVersion: skill.currentVersion,
      input: inputResult.data,
      renderedPrompt,
      ...(args.traceMetadata ? { metadata: args.traceMetadata } : {}),
    });
    const tracking = createRun(
      args.runType,
      skill.code,
      args.subjectId ?? null,
      traceInput,
      args.subjectType,
    );
    const invokeStarted = now().getTime();
    let completion: LlmCompletion | null = null;
    let invocationFailure: LlmRequestError | null = null;
    let rawOutput = '';
    let parsedJson: unknown = null;
    let issues: string[] = [];
    try {
      completion = await client.complete({
        tier: skill.modelProfile,
        messages: [
          { role: 'system', content: renderedPrompt.system },
          { role: 'user', content: renderedPrompt.user },
        ],
        mockText:
          client.mode === 'mock'
            ? JSON.stringify(
                args.mockOutput ?? deterministicMockFromSchema(
                  skill.outputSchemaJson,
                  `[MOCK:${skill.code}]`,
                ),
              )
            : undefined,
      });
      rawOutput = completion.text;
      try {
        parsedJson = parseJsonOutput(rawOutput);
      } catch (error) {
        issues = [
          error instanceof Error ? error.message : 'LLM 输出不是有效 JSON',
        ];
      }
      if (issues.length === 0) {
        const outputResult = zodFromJsonSchema(
          skill.outputSchemaJson,
        ).safeParse(parsedJson);
        if (!outputResult.success) issues = issueMessages(outputResult.error);
        else {
          parsedJson = outputResult.data;
          try { args.validateOutput?.(parsedJson); }
          catch (error) { issues = [error instanceof Error ? error.message : '业务输出校验失败']; }
        }
      }
    } catch (error) {
      invocationFailure = error instanceof LlmRequestError
        ? error
        : new LlmRequestError(error instanceof Error ? error.message : 'LLM 调用失败', 1, { cause: error });
      issues = [error instanceof Error ? error.message : 'LLM 调用失败'];
    }
    const durationMs =
      completion?.durationMs ?? Math.max(0, now().getTime() - invokeStarted);
    const outputJson = JSON.stringify({
      rawOutput,
      parsedJson,
      schemaResult: { valid: issues.length === 0, issues },
    });
    if (issues.length > 0) {
      const finishedAt = timestamp();
      const failureCode = invocationFailure ? 'LLM_CALL_FAILED' : 'LLM_OUTPUT_INVALID';
      const usage = db.transaction(() => {
        db.update(tables.runs)
          .set({ status: 'failed', finishedAt })
          .where(
            and(
              eq(tables.runs.organizationId, organizationId),
              eq(tables.runs.id, tracking.run.id),
            ),
          )
          .run();
        db.update(tables.runSteps)
          .set({
            status: 'failed',
            outputJson,
            errorJson: JSON.stringify({ code: failureCode, issues }),
            finishedAt,
            durationMs,
          })
          .where(
            and(
              eq(tables.runSteps.organizationId, organizationId),
              eq(tables.runSteps.id, tracking.step.id),
            ),
          )
          .run();
        return persistUsage({
          runId: tracking.run.id,
          stepId: tracking.step.id,
          runType: args.runType,
          skill,
          scope,
          completion,
          attempts: invocationFailure?.attempts,
          status: 'failed',
          billedPoints: 0,
          durationMs,
        });
      });
      return {
        marker:
          args.runType === 'test'
            ? ('TEST_RUN' as const)
            : args.runType.toUpperCase(),
        run: runSchema.parse({ ...tracking.run, status: 'failed', finishedAt }),
        step: runStepSchema.parse({
          ...tracking.step,
          status: 'failed',
          outputJson,
          errorJson: JSON.stringify({ code: failureCode, issues }),
          finishedAt,
          durationMs,
        }),
        renderedPrompt,
        rawOutput,
        parsedJson,
        schemaResult: { valid: false, issues },
        usage,
        mode: client.mode,
        attempts: completion?.attempts ?? invocationFailure?.attempts ?? 1,
      };
    }

    try {
      const finishedAt = timestamp();
      const billedPoints = args.runType === 'production' ? skill.pointCost : 0;
      const usage = db.transaction(() => {
        if (args.runType === 'production') {
          args.persistBusinessResult?.(parsedJson);
          consumePoints(tracking.run.id, skill.code, skill.pointCost);
        }
        db.update(tables.runs)
          .set({ status: 'completed', finishedAt })
          .where(
            and(
              eq(tables.runs.organizationId, organizationId),
              eq(tables.runs.id, tracking.run.id),
            ),
          )
          .run();
        db.update(tables.runSteps)
          .set({ status: 'succeeded', outputJson, finishedAt, durationMs })
          .where(
            and(
              eq(tables.runSteps.organizationId, organizationId),
              eq(tables.runSteps.id, tracking.step.id),
            ),
          )
          .run();
        return persistUsage({
          runId: tracking.run.id,
          stepId: tracking.step.id,
          runType: args.runType,
          skill,
          scope,
          completion,
          status: 'completed',
          billedPoints,
          durationMs,
        });
      });
      return {
        marker:
          args.runType === 'test'
            ? ('TEST_RUN' as const)
            : args.runType.toUpperCase(),
        run: runSchema.parse({
          ...tracking.run,
          status: 'completed',
          finishedAt,
        }),
        step: runStepSchema.parse({
          ...tracking.step,
          status: 'succeeded',
          outputJson,
          finishedAt,
          durationMs,
        }),
        renderedPrompt,
        rawOutput,
        parsedJson,
        schemaResult: { valid: true, issues: [] },
        usage,
        mode: client.mode,
        attempts: completion?.attempts ?? 1,
      };
    } catch (error) {
      const finishedAt = timestamp();
      db.transaction(() => {
        db.update(tables.runs)
          .set({ status: 'failed', finishedAt })
          .where(
            and(
              eq(tables.runs.organizationId, organizationId),
              eq(tables.runs.id, tracking.run.id),
            ),
          )
          .run();
        db.update(tables.runSteps)
          .set({
            status: 'failed',
            outputJson,
            errorJson: JSON.stringify({ code: 'BUSINESS_PERSISTENCE_FAILED' }),
            finishedAt,
            durationMs,
          })
          .where(
            and(
              eq(tables.runSteps.organizationId, organizationId),
              eq(tables.runSteps.id, tracking.step.id),
            ),
          )
          .run();
        persistUsage({
          runId: tracking.run.id,
          stepId: tracking.step.id,
          runType: args.runType,
          skill,
          scope,
          completion,
          status: 'failed',
          billedPoints: 0,
          durationMs,
        });
      });
      throw error;
    }
  }

  return {
    listSkills() {
      permissions.require('skills.read');
      const scoped = db
        .select()
        .from(tables.skills)
        .where(
          or(
            isNull(tables.skills.organizationId),
            eq(tables.skills.organizationId, organizationId),
          ),
        )
        .orderBy(asc(tables.skills.code), desc(sql`${tables.skills.organizationId} IS NOT NULL`))
        .all();
      const byCode = new Map<string, z.infer<typeof skillSchema>>();
      for (const row of scoped) if (!byCode.has(row.code)) byCode.set(row.code, skillSchema.parse(row));
      const items = [...byCode.values()];
      return skillListDataSchema.parse({
        items,
        total: items.length,
        permissions: {
          canWrite: permissions.has('skills.write'),
          canTest: permissions.has('ai.test'),
        },
      });
    },
    skillDetail(id: string) {
      permissions.require('skills.read');
      const skill = getSkill(id);
      const versions = db
        .select()
        .from(tables.skillVersions)
        .where(eq(tables.skillVersions.skillId, skill.id))
        .orderBy(desc(tables.skillVersions.version))
        .all()
        .map((row) => skillVersionSchema.parse(row));
      return skillDetailDataSchema.parse({
        skill,
        versions,
        permissions: {
          canWrite: permissions.has('skills.write'),
          canTest: permissions.has('ai.test'),
        },
      });
    },
    updateSkill(id: string, input: unknown) {
      permissions.require('skills.write');
      const value = updateSkillInputSchema.parse(input);
      return db.transaction(() => {
        const current = getSkill(id);
        if ((value.systemPrompt !== undefined && value.systemPrompt !== current.systemPrompt)
          || (value.userPromptTemplate !== undefined && value.userPromptTemplate !== current.userPromptTemplate))
          throw new ApiError(409, 'PROMPT_CHANGE_REQUIRES_EVAL', '生产 Prompt 只能通过 Bad Case、Diff、Eval/A-B 与人工确认流程变更');
        const { changeReason, ...changes } = value;
        const next = persistSkillVersion(current, changes, changeReason);
        return skillDetailDataSchema.parse({
          skill: next,
          versions: db
            .select()
            .from(tables.skillVersions)
            .where(eq(tables.skillVersions.skillId, current.id))
            .orderBy(desc(tables.skillVersions.version))
            .all(),
          permissions: { canWrite: true, canTest: permissions.has('ai.test') },
        });
      });
    },
    rollbackSkill(id: string, input: unknown) {
      permissions.require('skills.write');
      rollbackSkillInputSchema.parse(input);
      getSkill(id);
      throw new ApiError(
        409,
        'PROMPT_CHANGE_REQUIRES_EVAL',
        '历史 Prompt 回滚也必须先生成改进草案，并通过 Diff、Eval/A-B 与人工确认',
      );
    },
    async testSkill(id: string, input: unknown) {
      permissions.require('ai.test');
      const skill = getSkill(id);
      const value = skillTestInputSchema.parse(input);
      const result = await execute({
        runType: 'test',
        skillCode: skill.code,
        input: value.input,
        clientId: value.clientId,
        accountId: value.accountId,
        subjectId: skill.id,
      });
      return skillTestResultSchema.parse(result);
    },
    executeProduction(input: {
      skillCode: string;
      data: Record<string, unknown>;
      subjectId?: string | null;
      clientId?: string | null;
      accountId?: string | null;
      persistBusinessResult: (output: unknown) => void;
    }) {
      return execute({
        runType: 'production',
        skillCode: input.skillCode,
        input: input.data,
        subjectId: input.subjectId,
        clientId: input.clientId,
        accountId: input.accountId,
        persistBusinessResult: input.persistBusinessResult,
      });
    },
    executeTest(input: {
      skillCode: string;
      data: Record<string, unknown>;
      subjectId?: string | null;
      clientId?: string | null;
      accountId?: string | null;
      mockOutput?: unknown;
      validateOutput?: (output: unknown) => void;
    }) {
      return execute({
        runType: 'test',
        skillCode: input.skillCode,
        input: input.data,
        subjectId: input.subjectId,
        clientId: input.clientId,
        accountId: input.accountId,
        mockOutput: input.mockOutput,
        validateOutput: input.validateOutput,
      });
    },
    executeEval(input: {
      skillCode: string;
      data: Record<string, unknown>;
      subjectId?: string | null;
      mockOutput?: unknown;
    }) {
      return execute({
        runType: 'eval',
        skillCode: input.skillCode,
        input: input.data,
        subjectId: input.subjectId,
        mockOutput: input.mockOutput,
      });
    },
    executeEvalVariant(input: {
      skillId: string;
      version: number;
      systemPrompt: string;
      userPromptTemplate: string;
      inputSchemaJson: Record<string, unknown>;
      outputSchemaJson: Record<string, unknown>;
      modelProfile: 'light' | 'standard' | 'strong';
      pointCost: number;
      data: Record<string, unknown>;
      subjectId: string;
      variant: 'a' | 'b';
      contextSnapshot: unknown;
      mockOutput?: unknown;
    }) {
      const current = getSkill(input.skillId);
      const frozenSkill = skillSchema.parse({
        ...current,
        systemPrompt: input.systemPrompt,
        userPromptTemplate: input.userPromptTemplate,
        inputSchemaJson: input.inputSchemaJson,
        outputSchemaJson: input.outputSchemaJson,
        modelProfile: input.modelProfile,
        pointCost: input.pointCost,
        currentVersion: input.version,
      });
      return execute({
        runType: 'eval',
        skillCode: current.code,
        input: input.data,
        subjectId: input.subjectId,
        mockOutput: input.mockOutput,
        skillOverride: frozenSkill,
        subjectType: `eval_ab:${input.variant}`,
        traceMetadata: {
          variant: input.variant.toUpperCase(),
          frozenSkillVersion: input.version,
          contextSnapshot: input.contextSnapshot,
        },
      });
    },
    settings() {
      permissions.require('ai.settings');
      const prices = db
        .select()
        .from(tables.modelPriceConfigs)
        .orderBy(
          asc(tables.modelPriceConfigs.model),
          desc(tables.modelPriceConfigs.effectiveAt),
        )
        .all()
        .map((row) => modelPriceConfigSchema.parse(row));
      const quota = activeQuota();
      return aiSettingsDataSchema.parse({
        ...client.publicConfig,
        prices,
        quota,
        remainingPoints: quota ? quota.quotaPoints - quota.usedPoints : 0,
        permissions: { canWrite: permissions.has('ai.settings') },
      });
    },
    createPrice(input: unknown) {
      permissions.require('ai.settings');
      const value = createModelPriceInputSchema.parse(input);
      return db.transaction(() => {
        const row = modelPriceConfigSchema.parse({
          id: crypto.randomUUID(),
          ...value,
          createdAt: timestamp(),
        });
        db.insert(tables.modelPriceConfigs).values(row).run();
        audit('model_price_config', row.id, 'model_price_config.created');
        return row;
      });
    },
    listRuns(input: unknown) {
      permissions.require('runs.read');
      const query = runListQuerySchema.parse(input);
      const predicates = [eq(tables.runs.organizationId, organizationId)];
      if (query.runType)
        predicates.push(eq(tables.runs.runType, query.runType));
      if (query.status) predicates.push(eq(tables.runs.status, query.status));
      const rows = db
        .select()
        .from(tables.runs)
        .where(and(...predicates))
        .orderBy(desc(tables.runs.createdAt))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize)
        .all();
      const ids = rows.map((row) => row.id);
      const steps = ids.length
        ? db
            .select()
            .from(tables.runSteps)
            .where(
              and(
                eq(tables.runSteps.organizationId, organizationId),
                inArray(tables.runSteps.runId, ids),
              ),
            )
            .orderBy(asc(tables.runSteps.sequence))
            .all()
        : [];
      const usage = ids.length
        ? db
            .select()
            .from(tables.aiUsageLogs)
            .where(
              and(
                eq(tables.aiUsageLogs.organizationId, organizationId),
                inArray(tables.aiUsageLogs.runId, ids),
              ),
            )
            .all()
        : [];
      return runListDataSchema.parse({
        items: rows.map((run) => ({
          ...run,
          steps: steps.filter((step) => step.runId === run.id).map((step) => ({
            ...step,
            inputJson: sanitizeTraceJson(step.inputJson),
            outputJson: sanitizeTraceJson(step.outputJson),
            errorJson: sanitizeTraceJson(step.errorJson),
          })),
          usage: usage.filter((item) => item.runId === run.id),
        })),
        total:
          db
            .select({ value: count() })
            .from(tables.runs)
            .where(and(...predicates))
            .get()?.value ?? 0,
        page: query.page,
        pageSize: query.pageSize,
      });
    },
  };
}
