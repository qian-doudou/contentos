import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '@/db/schema';
import {
  aiPointLedger,
  aiUsageLogs,
  auditLogs,
  modelPriceConfigs,
  organizationAiQuotas,
  organizations,
  runs,
  skillVersions,
  skills,
  users,
} from '@/db/schema';
import { ApiError } from '@/lib/api/envelope';
import { aiInfrastructureService, estimateModelCost } from '@/lib/ai/service';
import { getLlmConfig, OpenAICompatibleClient } from '@/lib/llm/client';

const ids = {
  organizationA: '0198f744-8e18-7ae2-a780-52a0e20c6a01',
  organizationB: '0198f744-8e18-7ae2-a780-52a0e20c6a02',
  owner: '0198f744-8e18-7ae2-a780-52a0e20c6a03',
  operator: '0198f744-8e18-7ae2-a780-52a0e20c6a04',
  viewer: '0198f744-8e18-7ae2-a780-52a0e20c6a05',
  ownerB: '0198f744-8e18-7ae2-a780-52a0e20c6a06',
  skill: '0198f744-8e18-7ae2-a780-52a0e20c6a07',
  version: '0198f744-8e18-7ae2-a780-52a0e20c6a08',
  quota: '0198f744-8e18-7ae2-a780-52a0e20c6a09',
} as const;

const now = '2026-09-08T01:00:00.000Z';
const inputSchema = {
  type: 'object' as const,
  properties: { brief: { type: 'string' as const, minLength: 1 } },
  required: ['brief'],
  additionalProperties: false,
};
const outputSchema = {
  type: 'object' as const,
  properties: {
    result: { type: 'string' as const, minLength: 1 },
    warnings: { type: 'array' as const, items: { type: 'string' as const } },
  },
  required: ['result', 'warnings'],
  additionalProperties: false,
};

let sqlite: Database.Database;
let db: ReturnType<typeof drizzle<typeof schema>>;

function expectApiError(action: () => unknown, status: number, code: string) {
  try {
    action();
    throw new Error('Expected ApiError');
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status, code });
  }
}

function mockClient() {
  return new OpenAICompatibleClient(getLlmConfig({ LLM_API_KEY: '' }));
}

function liveClient(options: { output?: unknown; status?: number } = {}) {
  const request = vi.fn<typeof fetch>().mockImplementation(async () =>
    Response.json(
      {
        id: 'provider-id',
        model: 'qwen-live',
        choices: [
          {
            message: {
              content: JSON.stringify(
                options.output ?? { result: '已完成', warnings: [] },
              ),
            },
          },
        ],
        usage: { prompt_tokens: 1000, completion_tokens: 500 },
      },
      {
        status: options.status ?? 200,
        headers: { 'x-request-id': 'req-live-1' },
      },
    ),
  );
  return {
    request,
    client: new OpenAICompatibleClient(
      getLlmConfig({ LLM_API_KEY: 'test-key' }),
      { fetch: request },
    ),
  };
}

function service(userId: string = ids.owner, client = mockClient()) {
  return aiInfrastructureService(db, ids.organizationA, userId, {
    client,
    now: () => new Date(now),
  });
}

beforeEach(() => {
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  for (const file of readdirSync(resolve('drizzle'))
    .filter((name) => name.endsWith('.sql'))
    .sort())
    sqlite.exec(
      readFileSync(resolve('drizzle', file), 'utf8').replaceAll(
        '--> statement-breakpoint',
        '',
      ),
    );
  db = drizzle(sqlite, { schema });
  db.insert(organizations)
    .values([
      {
        id: ids.organizationA,
        name: '组织 A',
        status: 'active',
        isDemo: false,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: ids.organizationB,
        name: '组织 B',
        status: 'active',
        isDemo: false,
        createdAt: now,
        updatedAt: now,
      },
    ])
    .run();
  db.insert(users)
    .values([
      {
        id: ids.owner,
        organizationId: ids.organizationA,
        name: '所有者',
        role: 'owner',
        status: 'active',
        isDemo: false,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: ids.operator,
        organizationId: ids.organizationA,
        name: '运营',
        role: 'operator',
        status: 'active',
        isDemo: false,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: ids.viewer,
        organizationId: ids.organizationA,
        name: '查看者',
        role: 'viewer',
        status: 'active',
        isDemo: false,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: ids.ownerB,
        organizationId: ids.organizationB,
        name: '所有者 B',
        role: 'owner',
        status: 'active',
        isDemo: false,
        createdAt: now,
        updatedAt: now,
      },
    ])
    .run();
  db.insert(skills)
    .values({
      id: ids.skill,
      organizationId: null,
      code: 'quality_checker',
      name: '质量检查',
      description: '测试',
      systemPrompt: '只返回 JSON',
      userPromptTemplate: '输入 {{input_json}}',
      inputSchemaJson: inputSchema,
      outputSchemaJson: outputSchema,
      modelProfile: 'light',
      pointCost: 2,
      enabled: true,
      currentVersion: 1,
      isDemo: false,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  db.insert(skillVersions)
    .values({
      id: ids.version,
      organizationId: null,
      skillId: ids.skill,
      version: 1,
      systemPrompt: '只返回 JSON',
      userPromptTemplate: '输入 {{input_json}}',
      inputSchemaJson: inputSchema,
      outputSchemaJson: outputSchema,
      modelProfile: 'light',
      pointCost: 2,
      changeReason: '初始版本',
      createdBy: null,
      isDemo: false,
      createdAt: now,
    })
    .run();
  db.insert(organizationAiQuotas)
    .values({
      id: ids.quota,
      organizationId: ids.organizationA,
      periodStart: '2026-01-01T00:00:00.000Z',
      periodEnd: '2027-01-01T00:00:00.000Z',
      quotaPoints: 10,
      usedPoints: 0,
      isDemo: false,
      createdAt: now,
      updatedAt: now,
    })
    .run();
});

afterEach(() => {
  vi.restoreAllMocks();
  sqlite.close();
});

describe('Skill version infrastructure', () => {
  it('creates immutable snapshots and rolls back by creating another version', () => {
    const api = service();
    const v2 = api.updateSkill(ids.skill, {
      systemPrompt: 'v2 prompt',
      changeReason: '改进约束',
    });
    expect(v2.skill).toMatchObject({
      currentVersion: 2,
      systemPrompt: 'v2 prompt',
    });
    const v3 = api.rollbackSkill(ids.skill, {
      version: 1,
      changeReason: '回到稳定快照',
    });
    expect(v3.skill).toMatchObject({
      currentVersion: 3,
      systemPrompt: '只返回 JSON',
    });
    expect(v3.versions.map((version) => version.version)).toEqual([3, 2, 1]);
    expect(db.select().from(skillVersions).all()).toHaveLength(3);
  });

  it('enforces centralized permissions and organization isolation', () => {
    expect(service(ids.operator).listSkills().total).toBe(1);
    expectApiError(
      () => service(ids.viewer).listSkills(),
      403,
      'PERMISSION_DENIED',
    );
    expectApiError(
      () =>
        service(ids.viewer).updateSkill(ids.skill, {
          name: '越权',
          changeReason: '越权',
        }),
      403,
      'PERMISSION_DENIED',
    );
    const foreignSkill = '0198f744-8e18-7ae2-a780-52a0e20c6b01';
    db.insert(skills)
      .values({
        id: foreignSkill,
        organizationId: ids.organizationB,
        code: 'private_skill',
        name: 'B Skill',
        description: '',
        systemPrompt: 'system',
        userPromptTemplate: '{{input_json}}',
        inputSchemaJson: inputSchema,
        outputSchemaJson: outputSchema,
        modelProfile: 'light',
        pointCost: 1,
        enabled: true,
        currentVersion: 1,
        isDemo: false,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    expectApiError(() => service().skillDetail(foreignSkill), 404, 'NOT_FOUND');
  });
});

describe('Run, usage, pricing and Points', () => {
  it('runs deterministic Mock as Test Run without Points or guessed cost', async () => {
    const result = await service().testSkill(ids.skill, {
      input: { brief: '检查链路' },
    });
    expect(result).toMatchObject({
      marker: 'TEST_RUN',
      mode: 'mock',
      schemaResult: { valid: true },
      usage: {
        runType: 'test',
        estimatedCost: null,
        billedPoints: 0,
        inputTokens: null,
        outputTokens: null,
      },
    });
    expect(result.renderedPrompt.user).toContain('检查链路');
    expect(db.select().from(aiPointLedger).all()).toEqual([]);
    expect(db.select().from(organizationAiQuotas).get()?.usedPoints).toBe(0);
    expect(db.select().from(runs).get()?.status).toBe('completed');
  });

  it('records live provider metadata and calculates only configured effective prices', async () => {
    const live = liveClient();
    const unknown = await service(ids.owner, live.client).testSkill(ids.skill, {
      input: { brief: '未配价' },
    });
    expect(unknown.usage).toMatchObject({
      providerRequestId: 'req-live-1',
      model: 'qwen-live',
      inputTokens: 1000,
      outputTokens: 500,
      estimatedCost: null,
    });
    db.insert(modelPriceConfigs)
      .values({
        id: '0198f744-8e18-7ae2-a780-52a0e20c6b02',
        model: 'qwen-live',
        inputPricePerMillion: 2,
        outputPricePerMillion: 4,
        effectiveAt: '2026-01-01T00:00:00.000Z',
        status: 'active',
        createdAt: now,
      })
      .run();
    const priced = await service(ids.owner, live.client).testSkill(ids.skill, {
      input: { brief: '已配价' },
    });
    expect(priced.usage.estimatedCost).toBe(0.004);
    expect(
      estimateModelCost(1000, 500, {
        inputPricePerMillion: 2,
        outputPricePerMillion: 4,
      }),
    ).toBe(0.004);
    expect(db.select().from(aiPointLedger).all()).toEqual([]);
  });

  it('checks quota before invoking the model', async () => {
    db.update(organizationAiQuotas)
      .set({ usedPoints: 10 })
      .where(eq(organizationAiQuotas.id, ids.quota))
      .run();
    const live = liveClient();
    await expect(
      service(ids.owner, live.client).executeProduction({
        skillCode: 'quality_checker',
        data: { brief: '额度不足' },
        persistBusinessResult: () => undefined,
      }),
    ).rejects.toMatchObject({ status: 402, code: 'AI_QUOTA_EXCEEDED' });
    expect(live.request).not.toHaveBeenCalled();
    expect(db.select().from(runs).all()).toEqual([]);
  });

  it('bills a production Run only inside the successful business persistence transaction', async () => {
    let persisted = false;
    const result = await service().executeProduction({
      skillCode: 'quality_checker',
      data: { brief: '正式任务' },
      persistBusinessResult: () => {
        db.insert(auditLogs)
          .values({
            id: '0198f744-8e18-7ae2-a780-52a0e20c6b03',
            organizationId: ids.organizationA,
            userId: ids.owner,
            action: 'business.persisted',
            entityType: 'test',
            entityId: null,
            metadataJson: null,
            isDemo: false,
            createdAt: now,
          })
          .run();
        persisted = true;
      },
    });
    expect(persisted).toBe(true);
    expect(result.run.runType).toBe('production');
    expect(result.usage.billedPoints).toBe(2);
    expect(db.select().from(organizationAiQuotas).get()?.usedPoints).toBe(2);
    expect(db.select().from(aiPointLedger).get()).toMatchObject({
      ledgerType: 'consume',
      points: 2,
      runId: result.run.id,
    });
  });

  it('keeps real usage but rolls back business data and Points when persistence fails', async () => {
    db.insert(modelPriceConfigs)
      .values({
        id: '0198f744-8e18-7ae2-a780-52a0e20c6b04',
        model: 'qwen-live',
        inputPricePerMillion: 2,
        outputPricePerMillion: 4,
        effectiveAt: '2026-01-01T00:00:00.000Z',
        status: 'active',
        createdAt: now,
      })
      .run();
    const live = liveClient();
    await expect(
      service(ids.owner, live.client).executeProduction({
        skillCode: 'quality_checker',
        data: { brief: '持久化失败' },
        persistBusinessResult: () => {
          db.insert(auditLogs)
            .values({
              id: '0198f744-8e18-7ae2-a780-52a0e20c6b05',
              organizationId: ids.organizationA,
              userId: ids.owner,
              action: 'must.rollback',
              entityType: 'test',
              entityId: null,
              metadataJson: null,
              isDemo: false,
              createdAt: now,
            })
            .run();
          throw new Error('forced persistence failure');
        },
      }),
    ).rejects.toThrow('forced persistence failure');
    expect(
      db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'must.rollback'))
        .all(),
    ).toEqual([]);
    expect(db.select().from(organizationAiQuotas).get()?.usedPoints).toBe(0);
    expect(db.select().from(aiPointLedger).all()).toEqual([]);
    expect(db.select().from(aiUsageLogs).get()).toMatchObject({
      status: 'failed',
      billedPoints: 0,
      inputTokens: 1000,
      outputTokens: 500,
      estimatedCost: 0.004,
    });
    expect(db.select().from(runs).get()?.status).toBe('failed');
  });

  it('does not bill Eval runs and records invalid structured output as failed', async () => {
    const evalResult = await service().executeEval({
      skillCode: 'quality_checker',
      data: { brief: 'Eval' },
    });
    expect(evalResult).toMatchObject({
      marker: 'EVAL',
      usage: { runType: 'eval', billedPoints: 0 },
    });
    const invalid = liveClient({ output: { result: 42 } });
    const testResult = await service(ids.owner, invalid.client).testSkill(
      ids.skill,
      { input: { brief: '无效输出' } },
    );
    expect(testResult).toMatchObject({
      marker: 'TEST_RUN',
      run: { status: 'failed' },
      schemaResult: { valid: false },
      usage: { billedPoints: 0, status: 'failed' },
    });
    expect(db.select().from(aiPointLedger).all()).toEqual([]);
  });
});
