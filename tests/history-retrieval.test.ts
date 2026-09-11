import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '@/db/schema';
import {
  accounts,
  aiPointLedger,
  aiUsageLogs,
  brands,
  clientMembers,
  clients,
  contentEmbeddings,
  contentImportBatches,
  contents,
  historyRetrievalItems,
  organizations,
  runs,
  skills,
  stores,
  users,
} from '@/db/schema';
import { aiInfrastructureService } from '@/lib/ai/service';
import { ApiError } from '@/lib/api/envelope';
import { contentService } from '@/lib/content/service';
import {
  duplicateJudgeInputJsonSchema,
  duplicateJudgeOutputJsonSchema,
} from '@/lib/history/contracts';
import {
  getEmbeddingConfig,
  OpenAICompatibleEmbeddingClient,
} from '@/lib/history/embedding-client';
import { historyRetrievalService } from '@/lib/history/service';
import { OpenAICompatibleClient, getLlmConfig } from '@/lib/llm/client';

const ids = {
  organization: '0198f744-8e18-7ae2-a780-52a0e20c8a01',
  foreignOrganization: '0198f744-8e18-7ae2-a780-52a0e20c8a02',
  owner: '0198f744-8e18-7ae2-a780-52a0e20c8a03',
  operator: '0198f744-8e18-7ae2-a780-52a0e20c8a04',
  viewer: '0198f744-8e18-7ae2-a780-52a0e20c8a05',
  foreignOwner: '0198f744-8e18-7ae2-a780-52a0e20c8a06',
  client: '0198f744-8e18-7ae2-a780-52a0e20c8a11',
  unassignedClient: '0198f744-8e18-7ae2-a780-52a0e20c8a12',
  foreignClient: '0198f744-8e18-7ae2-a780-52a0e20c8a13',
  brand: '0198f744-8e18-7ae2-a780-52a0e20c8a21',
  unassignedBrand: '0198f744-8e18-7ae2-a780-52a0e20c8a22',
  foreignBrand: '0198f744-8e18-7ae2-a780-52a0e20c8a23',
  store: '0198f744-8e18-7ae2-a780-52a0e20c8a31',
  secondStore: '0198f744-8e18-7ae2-a780-52a0e20c8a32',
  unassignedStore: '0198f744-8e18-7ae2-a780-52a0e20c8a33',
  foreignStore: '0198f744-8e18-7ae2-a780-52a0e20c8a34',
  account: '0198f744-8e18-7ae2-a780-52a0e20c8a41',
  secondAccount: '0198f744-8e18-7ae2-a780-52a0e20c8a42',
  unassignedAccount: '0198f744-8e18-7ae2-a780-52a0e20c8a43',
  foreignAccount: '0198f744-8e18-7ae2-a780-52a0e20c8a44',
  relevant: '0198f744-8e18-7ae2-a780-52a0e20c8a51',
  differentAngle: '0198f744-8e18-7ae2-a780-52a0e20c8a52',
  crossAccount: '0198f744-8e18-7ae2-a780-52a0e20c8a53',
  duplicateSkill: '0198f744-8e18-7ae2-a780-52a0e20c8a61',
  invalidReference: '0198f744-8e18-7ae2-a780-52a0e20c8aff',
} as const;
const now = '2026-09-08T08:00:00.000Z';

let sqlite: Database.Database;
let db: ReturnType<typeof drizzle<typeof schema>>;

function expectApiError(action: () => unknown, status: number, code: string) {
  return Promise.resolve()
    .then(action)
    .then(
      () => {
        throw new Error('Expected ApiError');
      },
      (error: unknown) => {
        expect(error).toBeInstanceOf(ApiError);
        expect(error).toMatchObject({ status, code });
      },
    );
}

function hierarchy(
  organizationId: string,
  clientId: string,
  brandId: string,
  storeId: string,
  accountId: string,
  suffix: string,
) {
  db.insert(clients)
    .values({
      id: clientId,
      organizationId,
      clientName: `客户${suffix}`,
      industry: '餐饮',
      subIndustry: '',
      cooperationStatus: 'active',
      contractStart: null,
      contractEnd: null,
      monthlyContentTarget: 0,
      ownerUserId:
        organizationId === ids.organization ? ids.owner : ids.foreignOwner,
      notes: '',
      status: 'active',
      isDemo: false,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  db.insert(brands)
    .values({
      id: brandId,
      organizationId,
      clientId,
      brandName: `品牌${suffix}`,
      industry: '餐饮',
      subIndustry: '',
      city: '菏泽',
      brandPositioning: '',
      targetAudienceJson: [],
      coreProductsJson: [],
      coreSellingPointsJson: [],
      brandToneJson: [],
      forbiddenTopicsJson: [],
      status: 'active',
      isDemo: false,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  db.insert(stores)
    .values({
      id: storeId,
      organizationId,
      brandId,
      storeName: `门店${suffix}`,
      city: '菏泽',
      district: '',
      address: '',
      storeType: '',
      status: 'active',
      isDemo: false,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  db.insert(accounts)
    .values({
      id: accountId,
      organizationId,
      clientId,
      brandId,
      storeId,
      platform: 'douyin',
      accountName: `账号${suffix}`,
      accountType: 'owner_ip',
      accountGoalJson: [],
      contentStyleJson: [],
      forbiddenStyleJson: [],
      followers: null,
      status: 'active',
      isDemo: false,
      createdAt: now,
      updatedAt: now,
    })
    .run();
}

function addSecondAccount() {
  db.insert(stores)
    .values({
      id: ids.secondStore,
      organizationId: ids.organization,
      brandId: ids.brand,
      storeName: '第二门店',
      city: '菏泽',
      district: '',
      address: '',
      storeType: '',
      status: 'active',
      isDemo: false,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  db.insert(accounts)
    .values({
      id: ids.secondAccount,
      organizationId: ids.organization,
      clientId: ids.client,
      brandId: ids.brand,
      storeId: ids.secondStore,
      platform: 'douyin',
      accountName: '第二账号',
      accountType: 'store',
      accountGoalJson: [],
      contentStyleJson: [],
      forbiddenStyleJson: [],
      followers: null,
      status: 'active',
      isDemo: false,
      createdAt: now,
      updatedAt: now,
    })
    .run();
}

function addContent(
  id: string,
  accountId: string,
  fields: Partial<{
    title: string;
    topic: string;
    angle: string;
    hookText: string;
    coreMessage: string;
  }> = {},
) {
  const account = db
    .select()
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .get()!;
  db.insert(contents)
    .values({
      id,
      organizationId: account.organizationId,
      clientId: account.clientId,
      brandId: account.brandId,
      storeId: account.storeId,
      accountId,
      monthlyPlanId: null,
      title: fields.title ?? '老板教你看手切羊肉新不新鲜',
      contentType: 'education',
      contentGoal: 'trust',
      topic: fields.topic ?? '怎么判断手切羊肉新鲜',
      angle: fields.angle ?? '老板在后厨展示当天现切纹理',
      hookType: 'question',
      hookText: fields.hookText ?? '这盘羊肉是不是当天切的？',
      coreMessage: fields.coreMessage ?? '本地羊肉当天现切更新鲜',
      productText: '',
      ctaType: '',
      localElement: '',
      peopleJson: [],
      status: 'PUBLISHED',
      priority: 'normal',
      operatorId:
        account.organizationId === ids.organization
          ? ids.owner
          : ids.foreignOwner,
      plannedPublishDate: '2026-08-01T00:00:00.000Z',
      publishedAt: '2026-08-01T00:00:00.000Z',
      deadline: null,
      externalId: null,
      importDedupKey: null,
      importBatchId: null,
      currentScriptVersionId: null,
      activeApprovedScriptVersionId: null,
      currentEditVersionId: null,
      activeApprovedEditVersionId: null,
      aiReviewStatus: null,
      createdBy:
        account.organizationId === ids.organization
          ? ids.owner
          : ids.foreignOwner,
      isDemo: false,
      createdAt: now,
      updatedAt: now,
    })
    .run();
}

function createService(
  userId: string = ids.owner,
  llmClient: OpenAICompatibleClient = new OpenAICompatibleClient(
    getLlmConfig({}),
  ),
  embeddingClient = new OpenAICompatibleEmbeddingClient(getEmbeddingConfig({})),
) {
  return historyRetrievalService(db, ids.organization, userId, {
    now: () => new Date(now),
    embeddingClient,
    aiService: aiInfrastructureService(db, ids.organization, userId, {
      client: llmClient,
      now: () => new Date(now),
    }),
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
        id: ids.organization,
        name: '组织 A',
        status: 'active',
        isDemo: false,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: ids.foreignOrganization,
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
        organizationId: ids.organization,
        name: '所有者',
        role: 'owner',
        status: 'active',
        isDemo: false,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: ids.operator,
        organizationId: ids.organization,
        name: '运营',
        role: 'operator',
        status: 'active',
        isDemo: false,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: ids.viewer,
        organizationId: ids.organization,
        name: '查看者',
        role: 'viewer',
        status: 'active',
        isDemo: false,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: ids.foreignOwner,
        organizationId: ids.foreignOrganization,
        name: 'B 所有者',
        role: 'owner',
        status: 'active',
        isDemo: false,
        createdAt: now,
        updatedAt: now,
      },
    ])
    .run();
  hierarchy(
    ids.organization,
    ids.client,
    ids.brand,
    ids.store,
    ids.account,
    'A',
  );
  addSecondAccount();
  hierarchy(
    ids.organization,
    ids.unassignedClient,
    ids.unassignedBrand,
    ids.unassignedStore,
    ids.unassignedAccount,
    '未分配',
  );
  hierarchy(
    ids.foreignOrganization,
    ids.foreignClient,
    ids.foreignBrand,
    ids.foreignStore,
    ids.foreignAccount,
    'B',
  );
  db.insert(clientMembers)
    .values([
      {
        id: crypto.randomUUID(),
        organizationId: ids.organization,
        clientId: ids.client,
        userId: ids.operator,
        roleOverride: null,
        isDemo: false,
        createdAt: now,
      },
      {
        id: crypto.randomUUID(),
        organizationId: ids.organization,
        clientId: ids.client,
        userId: ids.viewer,
        roleOverride: null,
        isDemo: false,
        createdAt: now,
      },
    ])
    .run();
  db.insert(skills)
    .values({
      id: ids.duplicateSkill,
      organizationId: null,
      code: 'duplicate_judge',
      name: '重复度判定',
      description: '',
      systemPrompt: '综合判断，不得仅因 Topic 相同就判重复。',
      userPromptTemplate: '{{input_json}}',
      inputSchemaJson: duplicateJudgeInputJsonSchema,
      outputSchemaJson: duplicateJudgeOutputJsonSchema,
      modelProfile: 'light',
      pointCost: 1,
      enabled: true,
      currentVersion: 2,
      isDemo: false,
      createdAt: now,
      updatedAt: now,
    })
    .run();
});

afterEach(() => sqlite.close());

describe('history import', () => {
  it('requires preview, skips duplicate keys and persists imported content with fallback embeddings', async () => {
    const payload = [
      'account_id,external_id,title,content_type,content_goal,topic,angle,hook_text,core_message,published_at',
      `${ids.account},douyin-1001,老板讲手切羊肉,education,trust,手切羊肉,后厨现切,今天现切,本地羊肉,2026-08-01`,
      `${ids.account},douyin-1001,重复行,education,trust,手切羊肉,另一角度,钩子,核心,2026-08-02`,
    ].join('\n');
    const preview = createService().previewImport({
      format: 'csv',
      dedupStrategy: 'external_id',
      payload,
    });
    expect(preview.batch).toMatchObject({
      totalRows: 2,
      validRows: 1,
      duplicateRows: 1,
      invalidRows: 0,
    });
    expect(preview.canCommit).toBe(true);
    expect(db.select().from(contents).all()).toHaveLength(0);

    const committed = await createService().commitImport({
      batchId: preview.batch.id,
    });
    expect(committed.contentIds).toHaveLength(1);
    expect(committed.embedding).toMatchObject({
      indexed: 1,
      mode: 'fallback',
    });
    expect(db.select().from(contents).get()).toMatchObject({
      status: 'PUBLISHED',
      contentType: 'education',
      contentGoal: 'trust',
      publishedAt: '2026-08-01T00:00:00.000Z',
    });
    expect(db.select().from(contentEmbeddings).get()).toMatchObject({
      status: 'active',
      embeddingModel: 'fallback:zh-bigram-v1',
    });
    expect(db.select().from(contentImportBatches).get()).toMatchObject({
      status: 'committed',
      committedRows: 1,
    });
    await expectApiError(
      () => createService().commitImport({ batchId: preview.batch.id }),
      409,
      'IMPORT_ALREADY_FINALIZED',
    );

    const repeated = createService().previewImport({
      format: 'json',
      dedupStrategy: 'external_id',
      payload: JSON.stringify([
        {
          account_identifier: '账号A',
          external_id: 'douyin-1001',
          title: '再次导入',
        },
      ]),
    });
    expect(repeated.items[0]).toMatchObject({
      status: 'duplicate',
      existingContentId: committed.contentIds[0],
    });
  });

  it('keeps invalid rows in preview and blocks commit without partial writes', async () => {
    const preview = createService().previewImport({
      format: 'json',
      dedupStrategy: 'canonical',
      payload: JSON.stringify([
        { account_id: ids.account, title: '有效行' },
        {
          account_id: ids.account,
          title: '非法枚举',
          content_type: 'unknown',
        },
      ]),
    });
    expect(preview.batch).toMatchObject({ validRows: 1, invalidRows: 1 });
    expect(preview.canCommit).toBe(false);
    await expectApiError(
      () => createService().commitImport({ batchId: preview.batch.id }),
      409,
      'IMPORT_HAS_INVALID_ROWS',
    );
    expect(db.select().from(contents).all()).toHaveLength(0);
  });
});

describe('embedding and retrieval', () => {
  it('recalls semantic rewrites, does not over-penalize a shared topic and never crosses accounts', async () => {
    addContent(ids.relevant, ids.account);
    addContent(ids.differentAngle, ids.account, {
      title: '铜锅涮门店空间展示',
      topic: '怎么判断手切羊肉新鲜',
      angle: '从门店装修和桌椅布局介绍聚餐空间',
      hookText: '一家店能坐多少人？',
      coreMessage: '门店空间适合家庭聚餐',
    });
    addContent(ids.crossAccount, ids.secondAccount);

    const result = await createService().dedupTest({
      accountId: ids.account,
      title: '掌柜现场教你挑当天鲜切羊肉',
      contentType: 'education',
      contentGoal: 'trust',
      topic: '如何分辨现切羊肉是否新鲜',
      angle: '店主在后厨用纹理对比讲解',
      hookText: '当天切的羊肉看这里就知道',
      coreMessage: '本地羊肉当日现切才新鲜',
    });
    expect(result.marker).toBe('TEST_RUN');
    expect(result.embedding.mode).toBe('fallback');
    expect(result.top10[0].contentId).toBe(ids.relevant);
    expect(result.top10.map((item) => item.contentId)).not.toContain(
      ids.crossAccount,
    );
    expect(
      result.top10.find((item) => item.contentId === ids.differentAngle)!
        .ruleScore.combined,
    ).toBeLessThan(0.78);
    expect(result.judgeInputContentIds.length).toBeLessThanOrEqual(5);
    expect(result.run).toMatchObject({
      status: 'completed',
      billedPoints: 0,
      mode: 'mock',
      schemaValid: true,
    });
    expect(db.select().from(aiPointLedger).all()).toHaveLength(0);
    expect(db.select().from(historyRetrievalItems).all()).toHaveLength(2);
    expect(
      db
        .select()
        .from(historyRetrievalItems)
        .all()
        .every(
          (item) =>
            item.retrievalMethod === 'fallback_bigram' &&
            item.sourceHash.length === 64,
        ),
    ).toBe(true);
  });

  it('marks the old vector stale and creates a new source hash after canonical fields change', async () => {
    addContent(ids.relevant, ids.account);
    await createService().syncContentEmbedding(ids.relevant);
    const original = db
      .select()
      .from(contentEmbeddings)
      .where(eq(contentEmbeddings.status, 'active'))
      .get()!;

    contentService(db, ids.organization, ids.owner, {
      now: () => new Date('2026-09-08T09:00:00.000Z'),
    }).updateContent(ids.relevant, {
      hookText: '新的钩子会改变 canonical text',
    });
    expect(
      db
        .select()
        .from(contentEmbeddings)
        .where(eq(contentEmbeddings.id, original.id))
        .get()?.status,
    ).toBe('stale');

    await createService().syncContentEmbedding(ids.relevant);
    const active = db
      .select()
      .from(contentEmbeddings)
      .where(eq(contentEmbeddings.status, 'active'))
      .get()!;
    expect(active.id).not.toBe(original.id);
    expect(active.sourceHash).not.toBe(original.sourceHash);
    expect(
      db
        .select()
        .from(contentEmbeddings)
        .where(eq(contentEmbeddings.contentId, ids.relevant))
        .all(),
    ).toHaveLength(2);
  });

  it('enforces organization and assigned-client scope on the server', async () => {
    await expectApiError(
      () =>
        createService(ids.operator).dedupTest({
          accountId: ids.unassignedAccount,
          title: '越权候选',
        }),
      403,
      'PERMISSION_DENIED',
    );
    await expectApiError(
      () =>
        createService().dedupTest({
          accountId: ids.foreignAccount,
          title: '跨组织候选',
        }),
      404,
      'NOT_FOUND',
    );
    await expectApiError(
      () =>
        createService(ids.viewer).dedupTest({
          accountId: ids.account,
          title: '只读身份候选',
        }),
      403,
      'PERMISSION_DENIED',
    );
    await expectApiError(
      () =>
        createService(ids.viewer).previewImport({
          format: 'json',
          dedupStrategy: 'canonical',
          payload: JSON.stringify([
            { account_id: ids.account, title: '无权导入' },
          ]),
        }),
      403,
      'PERMISSION_DENIED',
    );
  });

  it('rejects LLM content ids outside this Top5 and falls back without billing points', async () => {
    addContent(ids.relevant, ids.account);
    const invalidLlm = new OpenAICompatibleClient(
      {
        mode: 'live',
        baseUrl: 'https://example.test/v1',
        apiKey: 'test-only',
        models: { light: 'test-light', standard: 'test', strong: 'test' },
        timeoutMs: 1_000,
      },
      {
        fetch: async () =>
          Response.json({
            id: 'provider-request',
            model: 'test-light',
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    duplicate_level: 'high',
                    similar_content_ids: [ids.invalidReference],
                    reason: '错误引用',
                    recommended_action: '拒绝',
                    alternative_angles: [],
                  }),
                },
              },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 10 },
          }),
      },
    );
    const result = await createService(ids.owner, invalidLlm).dedupTest({
      accountId: ids.account,
      title: '掌柜教你挑现切羊肉',
      topic: '现切羊肉新鲜度',
    });
    expect(result.fallbackUsed).toBe(true);
    expect(result.fallbackReason).toContain('Top5');
    expect(result.run).toMatchObject({
      status: 'failed',
      billedPoints: 0,
      schemaValid: false,
    });
    expect(db.select().from(runs).get()?.runType).toBe('test');
    expect(db.select().from(aiUsageLogs).get()).toMatchObject({
      runType: 'test',
      status: 'failed',
      billedPoints: 0,
    });
    expect(db.select().from(aiPointLedger).all()).toHaveLength(0);
  });
});

describe('OpenAI-compatible embedding client', () => {
  it('uses deterministic Chinese-friendly fallback without an API key', async () => {
    const client = new OpenAICompatibleEmbeddingClient(getEmbeddingConfig({}));
    const first = await client.embed(['掌柜介绍当天现切羊肉']);
    const second = await client.embed(['老板介绍当天手切羊肉']);
    expect(first.method).toBe('fallback_bigram');
    expect(first.model).toBe('fallback:zh-bigram-v1');
    expect(first.vectors[0]).toEqual(second.vectors[0]);
  });

  it('calls the live compatible endpoint and retries one transient failure', async () => {
    let calls = 0;
    const client = new OpenAICompatibleEmbeddingClient(
      {
        mode: 'live',
        baseUrl: 'https://example.test/v1',
        apiKey: 'test-only',
        model: 'embedding-test',
        timeoutMs: 1_000,
      },
      {
        fetch: async () => {
          calls += 1;
          if (calls === 1) return new Response('{}', { status: 500 });
          return Response.json({
            model: 'embedding-test',
            data: [{ index: 0, embedding: [0.1, 0.2, 0.3] }],
          });
        },
      },
    );
    const result = await client.embed(['测试']);
    expect(result).toMatchObject({
      method: 'embedding',
      model: 'embedding-test',
      attempts: 2,
    });
    expect(calls).toBe(2);
  });

  it('falls back once and skips repeated provider timeouts in the same workflow', async () => {
    const unavailable = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('fetch failed'));
    const client = new OpenAICompatibleEmbeddingClient(
      {
        mode: 'live',
        baseUrl: 'https://unavailable.example.test/v1',
        apiKey: 'test-only',
        model: 'embedding-test',
        timeoutMs: 1_000,
      },
      { fetch: unavailable },
    );
    const first = await client.embed(['第一条候选']);
    const second = await client.embed(['第二条候选']);
    expect(first).toMatchObject({ method: 'fallback_bigram', attempts: 2 });
    expect(second).toMatchObject({ method: 'fallback_bigram', attempts: 1 });
    expect(unavailable).toHaveBeenCalledTimes(2);
  });
});
