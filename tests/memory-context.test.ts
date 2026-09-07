import Database from 'better-sqlite3';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '@/db/schema';
import {
  accounts,
  aiPointLedger,
  aiUsageLogs,
  brands,
  clientMembers,
  clients,
  contents,
  contextSnapshots,
  memories,
  monthlyPlans,
  organizations,
  runs,
  stores,
  users,
} from '@/db/schema';
import { ApiError } from '@/lib/api/envelope';
import { CONTEXT_BUDGETS } from '@/lib/memory/context-builder';
import { memoryService } from '@/lib/memory/service';

const ids = {
  organizationA: '0198f744-8e18-7ae2-a780-52a0e20c7a01',
  organizationB: '0198f744-8e18-7ae2-a780-52a0e20c7a02',
  owner: '0198f744-8e18-7ae2-a780-52a0e20c7a03',
  operator: '0198f744-8e18-7ae2-a780-52a0e20c7a04',
  viewer: '0198f744-8e18-7ae2-a780-52a0e20c7a05',
  photographer: '0198f744-8e18-7ae2-a780-52a0e20c7a06',
  ownerB: '0198f744-8e18-7ae2-a780-52a0e20c7a07',
  client: '0198f744-8e18-7ae2-a780-52a0e20c7a11',
  brand: '0198f744-8e18-7ae2-a780-52a0e20c7a12',
  store: '0198f744-8e18-7ae2-a780-52a0e20c7a13',
  account: '0198f744-8e18-7ae2-a780-52a0e20c7a14',
  plan: '0198f744-8e18-7ae2-a780-52a0e20c7a15',
} as const;
const now = '2026-09-08T08:00:00.000Z';

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

function service(userId: string = ids.owner) {
  return memoryService(db, ids.organizationA, userId, {
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
        id: ids.photographer,
        organizationId: ids.organizationA,
        name: '摄影',
        role: 'photographer',
        status: 'active',
        isDemo: false,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: ids.ownerB,
        organizationId: ids.organizationB,
        name: 'B 所有者',
        role: 'owner',
        status: 'active',
        isDemo: false,
        createdAt: now,
        updatedAt: now,
      },
    ])
    .run();
  db.insert(clients)
    .values({
      id: ids.client,
      organizationId: ids.organizationA,
      clientName: '德祥楼',
      industry: '餐饮',
      subIndustry: '铜锅涮羊肉',
      cooperationStatus: 'active',
      contractStart: null,
      contractEnd: null,
      monthlyContentTarget: 8,
      ownerUserId: ids.owner,
      notes: '',
      status: 'active',
      isDemo: false,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  db.insert(brands)
    .values({
      id: ids.brand,
      organizationId: ids.organizationA,
      clientId: ids.client,
      brandName: '德祥楼',
      industry: '餐饮',
      subIndustry: '铜锅涮羊肉',
      city: '菏泽',
      brandPositioning: '鲁西南特色铜锅涮羊肉',
      targetAudienceJson: [],
      coreProductsJson: ['手切羊肉', '铜锅涮'],
      coreSellingPointsJson: ['本地羊肉', '现切'],
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
      id: ids.store,
      organizationId: ids.organizationA,
      brandId: ids.brand,
      storeName: '总店',
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
      id: ids.account,
      organizationId: ids.organizationA,
      clientId: ids.client,
      brandId: ids.brand,
      storeId: ids.store,
      platform: 'douyin',
      accountName: '德祥楼老板IP',
      accountType: 'owner_ip',
      accountGoalJson: ['本地曝光', '团购转化'],
      contentStyleJson: ['真实', '自然'],
      forbiddenStyleJson: ['虚假夸张'],
      followers: null,
      status: 'active',
      isDemo: false,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  db.insert(monthlyPlans)
    .values({
      id: ids.plan,
      organizationId: ids.organizationA,
      accountId: ids.account,
      year: 2026,
      month: 9,
      primaryGoal: 'conversion',
      plannedContentCount: 4,
      campaignNotes: '菏泽本地团购',
      keyProductsJson: ['手切羊肉'],
      contentMixJson: { conversion: 100 },
      status: 'active',
      createdBy: ids.owner,
      isDemo: false,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  db.insert(clientMembers)
    .values([
      {
        id: crypto.randomUUID(),
        organizationId: ids.organizationA,
        clientId: ids.client,
        userId: ids.operator,
        roleOverride: null,
        isDemo: false,
        createdAt: now,
      },
      {
        id: crypto.randomUUID(),
        organizationId: ids.organizationA,
        clientId: ids.client,
        userId: ids.viewer,
        roleOverride: null,
        isDemo: false,
        createdAt: now,
      },
    ])
    .run();
});

afterEach(() => sqlite.close());

describe('long-term memory lifecycle', () => {
  it('initializes traceable profile memories idempotently', () => {
    const first = service().initialize({ accountId: ids.account });
    expect(first.created).toHaveLength(6);
    expect(
      first.created.every(
        (item) => item.sourceType === 'brand_profile' && item.confidence === 1,
      ),
    ).toBe(true);
    expect(first.created.map((item) => item.memoryKey)).toEqual(
      expect.arrayContaining([
        'brand.positioning',
        'brand.core_products',
        'brand.core_selling_points',
        'account.goals',
        'account.content_style',
        'account.forbidden_style',
      ]),
    );
    const second = service().initialize({ accountId: ids.account });
    expect(second.created).toEqual([]);
    expect(second.skippedKeys).toHaveLength(6);
  });

  it('replaces instead of overwriting and excludes old, expired and inactive values from Context', () => {
    const old = service().createOrReplaceManual({
      accountId: ids.account,
      scopeType: 'account',
      memoryKey: 'promotion.group_buy_price',
      memoryType: 'strategy',
      valueJson: { price: 99 },
      summary: '团购价 99 元',
      importance: 5,
      confidence: 1,
    });
    const current = service().createOrReplaceManual({
      accountId: ids.account,
      scopeType: 'account',
      memoryKey: 'promotion.group_buy_price',
      memoryType: 'strategy',
      valueJson: { price: 89 },
      summary: '团购价 89 元',
      importance: 5,
      confidence: 1,
    });
    const expired = service().createOrReplaceManual({
      accountId: ids.account,
      scopeType: 'account',
      memoryKey: 'promotion.expired_offer',
      memoryType: 'temporary',
      valueJson: '旧活动',
      summary: '已过期活动',
      importance: 5,
      confidence: 1,
      effectiveAt: '2026-09-01T00:00:00.000Z',
      expiresAt: '2026-09-07T00:00:00.000Z',
    });
    const inactive = service().createOrReplaceManual({
      accountId: ids.account,
      scopeType: 'account',
      memoryKey: 'preference.inactive',
      memoryType: 'preference',
      valueJson: '不使用',
      summary: '已停用偏好',
      importance: 4,
      confidence: 1,
    });
    service().deactivate(inactive.memory.id, { reason: '不再适用' });

    const oldRow = db
      .select()
      .from(memories)
      .where(eq(memories.id, old.memory.id))
      .get();
    expect(oldRow).toMatchObject({ status: 'superseded' });
    expect(current.memory.supersedesMemoryId).toBe(old.memory.id);
    const result = service().buildContext({
      accountId: ids.account,
      monthlyPlanId: ids.plan,
      focus: '团购价格',
    });
    const memoryIds = result.snapshot.memoryIds;
    expect(memoryIds).toContain(current.memory.id);
    expect(memoryIds).not.toContain(old.memory.id);
    expect(memoryIds).not.toContain(expired.memory.id);
    expect(memoryIds).not.toContain(inactive.memory.id);
    expect(JSON.stringify(result.layers)).toContain('89');
    expect(JSON.stringify(result.layers)).not.toContain('团购价 99 元');
    expect(JSON.stringify(result.layers)).not.toContain('"price":99');
    expect(result.snapshot.planIds).toEqual([ids.plan]);
    expect(
      db
        .select()
        .from(contextSnapshots)
        .where(eq(contextSnapshots.id, result.snapshotId))
        .get()?.contextSnapshotJson,
    ).toMatchObject({ snapshot: { builtAt: now } });
  });

  it('enforces one Active record per key and validates polymorphic organization scope in SQLite', () => {
    const current = service().createOrReplaceManual({
      accountId: ids.account,
      scopeType: 'account',
      memoryKey: 'preference.voice',
      memoryType: 'preference',
      valueJson: '真实',
      summary: '真实口语',
      importance: 4,
      confidence: 1,
    }).memory;
    expect(() =>
      db
        .insert(memories)
        .values({
          ...current,
          id: crypto.randomUUID(),
          supersedesMemoryId: null,
        })
        .run(),
    ).toThrow(/UNIQUE constraint failed/);
    expect(() =>
      db
        .insert(memories)
        .values({
          ...current,
          id: crypto.randomUUID(),
          scopeId: ids.organizationB,
          memoryKey: 'invalid.scope',
          supersedesMemoryId: null,
        })
        .run(),
    ).toThrow(/memory account scope does not belong to organization/);
    const active = db
      .select()
      .from(memories)
      .where(
        and(
          eq(memories.organizationId, ids.organizationA),
          eq(memories.scopeId, ids.account),
          eq(memories.memoryKey, 'preference.voice'),
          eq(memories.status, 'active'),
        ),
      )
      .all();
    expect(active).toHaveLength(1);
  });

  it('uses centralized role and client-scope permissions', () => {
    expect(
      service(ids.viewer).list({ accountId: ids.account }).permissions.canWrite,
    ).toBe(false);
    expectApiError(
      () =>
        service(ids.viewer).createOrReplaceManual({
          accountId: ids.account,
          scopeType: 'account',
          memoryKey: 'viewer.write',
          memoryType: 'preference',
          valueJson: true,
          summary: '越权',
          importance: 3,
          confidence: 1,
        }),
      403,
      'PERMISSION_DENIED',
    );
    expectApiError(
      () => service(ids.viewer).buildContext({ accountId: ids.account }),
      403,
      'PERMISSION_DENIED',
    );
    expectApiError(
      () => service(ids.photographer).list({ accountId: ids.account }),
      403,
      'PERMISSION_DENIED',
    );
    expect(
      service(ids.operator).createOrReplaceManual({
        accountId: ids.account,
        scopeType: 'account',
        memoryKey: 'operator.confirmed',
        memoryType: 'preference',
        valueJson: true,
        summary: '已确认',
        importance: 3,
        confidence: 1,
      }).memory.status,
    ).toBe('active');
    expectApiError(
      () =>
        memoryService(db, ids.organizationB, ids.ownerB).list({
          accountId: ids.account,
        }),
      404,
      'NOT_FOUND',
    );
  });
});

describe('deterministic Context Builder budgets', () => {
  it('caps memories and structured history, records truncation and never adds script text', () => {
    service().initialize({ accountId: ids.account });
    for (let index = 0; index < 25; index++)
      service().createOrReplaceManual({
        accountId: ids.account,
        scopeType: 'account',
        memoryKey: `confirmed.rule_${index}`,
        memoryType: 'content_pattern',
        valueJson: { index },
        summary: `已确认内容规律 ${index}`,
        importance: (index % 5) + 1,
        confidence: 0.9,
      });
    const contentIds: string[] = [];
    for (let index = 0; index < 12; index++) {
      const contentId = crypto.randomUUID();
      contentIds.push(contentId);
      db.insert(contents)
        .values({
          id: contentId,
          organizationId: ids.organizationA,
          clientId: ids.client,
          brandId: ids.brand,
          storeId: ids.store,
          accountId: ids.account,
          monthlyPlanId: ids.plan,
          title: `历史内容 ${index}`,
          contentType: 'conversion',
          contentGoal: 'conversion',
          topic: '菏泽团购',
          angle: '本地真实体验',
          hookType: 'local',
          hookText: '菏泽人吃羊肉',
          coreMessage: '本地羊肉现切',
          productText: '手切羊肉',
          ctaType: '团购',
          localElement: '菏泽',
          peopleJson: ['老板'],
          status: index % 2 ? 'PUBLISHED' : 'REVIEWED',
          priority: 'normal',
          operatorId: ids.operator,
          plannedPublishDate: `2026-08-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
          deadline: null,
          currentScriptVersionId: null,
          activeApprovedScriptVersionId: null,
          currentEditVersionId: null,
          activeApprovedEditVersionId: null,
          aiReviewStatus: null,
          createdBy: ids.owner,
          isDemo: false,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }
    const result = service().buildContext({
      accountId: ids.account,
      monthlyPlanId: ids.plan,
      focus: '菏泽团购',
    });
    expect(result.layers.l1StableContext.length).toBeLessThanOrEqual(
      CONTEXT_BUDGETS.stableItems,
    );
    expect(result.layers.l3Memories.length).toBeLessThanOrEqual(
      CONTEXT_BUDGETS.activeMemories,
    );
    expect(result.layers.l4HistoricalContentSummaries).toHaveLength(
      CONTEXT_BUDGETS.historicalContents,
    );
    expect(result.snapshot.truncations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ layer: 'L3', reason: 'item_limit' }),
        expect.objectContaining({
          layer: 'L4',
          reason: 'item_limit',
          omitted: 2,
        }),
      ]),
    );
    expect(result.snapshot.estimatedCharacters).toBeLessThanOrEqual(
      CONTEXT_BUDGETS.characters,
    );
    expect(result.snapshot.estimatedTokens).toBe(
      Math.ceil(result.snapshot.estimatedCharacters / 4),
    );
    const stableMemoryCount = result.layers.l1StableContext.filter(
      (item) => item.memoryId,
    ).length;
    expect(result.snapshot.memoryIds).toHaveLength(
      stableMemoryCount + result.layers.l3Memories.length,
    );
    expect(result.snapshot.contentIds).toHaveLength(
      result.layers.l4HistoricalContentSummaries.length,
    );
    expect(
      Object.keys(result.layers.l4HistoricalContentSummaries[0]),
    ).not.toContain('script');
    const withTask = service().buildContext({
      accountId: ids.account,
      contentId: contentIds[0],
      monthlyPlanId: ids.plan,
      focus: '团购',
    });
    expect(withTask.layers.l2Current.task?.id).toBe(contentIds[0]);
    expect(withTask.snapshot.contentIds).toContain(contentIds[0]);
    expect(db.select().from(runs).all()).toEqual([]);
    expect(db.select().from(aiUsageLogs).all()).toEqual([]);
    expect(db.select().from(aiPointLedger).all()).toEqual([]);
  });

  it('keeps the total character budget when a stable profile field is oversized', () => {
    db.update(brands)
      .set({ brandPositioning: '长'.repeat(15_000) })
      .where(eq(brands.id, ids.brand))
      .run();
    const result = service().buildContext({
      accountId: ids.account,
      monthlyPlanId: ids.plan,
    });
    expect(result.snapshot.estimatedCharacters).toBeLessThanOrEqual(
      CONTEXT_BUDGETS.characters,
    );
    expect(result.snapshot.truncations).toContainEqual({
      layer: 'L1',
      reason: 'character_budget',
      omitted: 1,
    });
    expect(
      result.layers.l1StableContext.some(
        (item) => item.key === 'brand.positioning',
      ),
    ).toBe(false);
  });
});
