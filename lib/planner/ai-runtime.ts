import { and, desc, eq, gt, isNull, lte, or } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { z } from 'zod';
import * as tables from '@/db/schema';
import { aiUsageLogSchema, skillSchema } from '@/lib/ai/contracts';
import { estimateModelCost } from '@/lib/ai/service';
import { zodFromJsonSchema } from '@/lib/ai/json-schema';
import { ApiError } from '@/lib/api/envelope';
import { permissionService } from '@/lib/auth/permissions';
import { OpenAICompatibleClient, parseJsonOutput, type LlmCompletion } from '@/lib/llm/client';

type Database = BetterSQLite3Database<typeof tables>;
type Skill = z.infer<typeof skillSchema>;

function issues(error: z.ZodError) {
  return error.issues.map((issue) => `${issue.path.join('.') || '输出'}：${issue.message}`);
}

/** Low-level production AI boundary for multi-step Runs. It validates, calls the one
 * OpenAI-compatible client, and records actual usage, but deliberately never bills. */
export function plannerAiRuntime(
  db: Database,
  organizationId: string,
  userId: string,
  runtime: { client?: OpenAICompatibleClient; now?: () => Date } = {},
) {
  const permissions = permissionService(db, organizationId, userId);
  const client = runtime.client ?? new OpenAICompatibleClient();
  const now = runtime.now ?? (() => new Date());
  const timestamp = () => now().toISOString();

  function skill(code: string) {
    const row = db.select().from(tables.skills).where(and(
      eq(tables.skills.code, code),
      or(isNull(tables.skills.organizationId), eq(tables.skills.organizationId, organizationId)),
    )).orderBy(desc(tables.skills.organizationId)).get();
    if (!row) throw new ApiError(404, 'SKILL_NOT_FOUND', `Skill ${code} 不存在`);
    const parsed = skillSchema.parse(row);
    if (!parsed.enabled) throw new ApiError(409, 'SKILL_DISABLED', `Skill ${code} 已停用`);
    return parsed;
  }

  function activeQuota(at = timestamp()) {
    return db.select().from(tables.organizationAiQuotas).where(and(
      eq(tables.organizationAiQuotas.organizationId, organizationId),
      lte(tables.organizationAiQuotas.periodStart, at),
      gt(tables.organizationAiQuotas.periodEnd, at),
    )).orderBy(desc(tables.organizationAiQuotas.periodStart)).get() ?? null;
  }

  function requireQuota(points: number) {
    const quota = activeQuota();
    if (points > 0 && (!quota || quota.quotaPoints - quota.usedPoints < points))
      throw new ApiError(402, 'AI_QUOTA_EXCEEDED', 'AI Points 余额不足');
    return quota;
  }

  function price(model: string, at: string) {
    return db.select().from(tables.modelPriceConfigs).where(and(
      eq(tables.modelPriceConfigs.model, model),
      eq(tables.modelPriceConfigs.status, 'active'),
      lte(tables.modelPriceConfigs.effectiveAt, at),
    )).orderBy(desc(tables.modelPriceConfigs.effectiveAt)).get() ?? null;
  }

  function persistUsage(args: {
    runId: string; stepId: string; skill: Skill; accountId: string; clientId: string;
    completion: LlmCompletion | null; status: 'completed' | 'failed'; durationMs: number;
  }) {
    const createdAt = timestamp();
    const model = args.completion?.model ?? client.publicConfig.models[args.skill.modelProfile];
    const inputTokens = args.completion?.inputTokens ?? null;
    const outputTokens = args.completion?.outputTokens ?? null;
    const row = aiUsageLogSchema.parse({
      id: crypto.randomUUID(), organizationId, runId: args.runId, runStepId: args.stepId,
      runType: 'production', userId, clientId: args.clientId, accountId: args.accountId,
      skillCode: args.skill.code, skillVersion: args.skill.currentVersion,
      providerRequestId: args.completion?.providerRequestId ?? null, model, inputTokens, outputTokens,
      estimatedCost: estimateModelCost(inputTokens, outputTokens, price(model, createdAt)),
      billedPoints: 0, attempts: args.completion?.attempts ?? 1,
      durationMs: args.durationMs, status: args.status,
      isDemo: permissions.organization.isDemo, createdAt,
    });
    db.insert(tables.aiUsageLogs).values(row).run();
    return row;
  }

  async function invoke<T>(args: {
    runId: string;
    stepId: string;
    skillCode: string;
    input: Record<string, unknown>;
    accountId: string;
    clientId: string;
    outputSchema: z.ZodType<T>;
    mockOutput: T;
    validateOutput?: (output: T) => void;
  }) {
    permissions.require('ai.test');
    permissions.requireClientWrite(args.clientId);
    const run = db.select({ id: tables.runs.id }).from(tables.runs).where(and(
      eq(tables.runs.organizationId, organizationId), eq(tables.runs.id, args.runId), eq(tables.runs.runType, 'production'),
    )).get();
    const step = db.select({ id: tables.runSteps.id }).from(tables.runSteps).where(and(
      eq(tables.runSteps.organizationId, organizationId), eq(tables.runSteps.id, args.stepId), eq(tables.runSteps.runId, args.runId),
    )).get();
    if (!run || !step) throw new ApiError(404, 'RUN_STEP_NOT_FOUND', 'Run 或 Run Step 不存在');
    const selectedSkill = skill(args.skillCode);
    const inputResult = zodFromJsonSchema(selectedSkill.inputSchemaJson).safeParse(args.input);
    if (!inputResult.success)
      throw new ApiError(400, 'SKILL_INPUT_INVALID', 'Skill 输入不符合 Schema', issues(inputResult.error));
    const rendered = {
      system: selectedSkill.systemPrompt,
      user: selectedSkill.userPromptTemplate.includes('{{input_json}}')
        ? selectedSkill.userPromptTemplate.replaceAll('{{input_json}}', JSON.stringify(inputResult.data, null, 2))
        : `${selectedSkill.userPromptTemplate}\n\n${JSON.stringify(inputResult.data, null, 2)}`,
    };
    let completion: LlmCompletion | null = null;
    const started = now().getTime();
    try {
      completion = await client.complete({
        tier: selectedSkill.modelProfile,
        messages: [{ role: 'system', content: rendered.system }, { role: 'user', content: rendered.user }],
        // Keep a validated deterministic result available when the configured
        // provider is temporarily unreachable. Permanent 4xx configuration
        // errors still fail and are never hidden by this fallback.
        mockText: JSON.stringify(args.mockOutput),
      });
      const rawParsed = parseJsonOutput(completion.text);
      const generic = zodFromJsonSchema(selectedSkill.outputSchemaJson).safeParse(rawParsed);
      if (!generic.success) throw new ApiError(502, 'LLM_OUTPUT_INVALID', 'LLM 输出不符合 Skill Schema', issues(generic.error));
      const parsed = args.outputSchema.safeParse(generic.data);
      if (!parsed.success) throw new ApiError(502, 'LLM_OUTPUT_INVALID', 'LLM 输出不符合业务 Schema', issues(parsed.error));
      args.validateOutput?.(parsed.data);
      const usage = persistUsage({
        runId: args.runId, stepId: args.stepId, skill: selectedSkill,
        accountId: args.accountId, clientId: args.clientId, completion,
        status: 'completed', durationMs: completion.durationMs,
      });
      return { output: parsed.data, rawOutput: completion.text, rendered, completion, usage, skill: selectedSkill, mode: completion.mode };
    } catch (error) {
      const durationMs = completion?.durationMs ?? Math.max(0, now().getTime() - started);
      persistUsage({
        runId: args.runId, stepId: args.stepId, skill: selectedSkill,
        accountId: args.accountId, clientId: args.clientId, completion,
        status: 'failed', durationMs,
      });
      if (error instanceof ApiError) throw error;
      throw new ApiError(502, 'LLM_CALL_FAILED', error instanceof Error ? error.message : 'LLM 调用失败');
    }
  }

  return { skill, activeQuota, requireQuota, invoke, publicConfig: client.publicConfig };
}
