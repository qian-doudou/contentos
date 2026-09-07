import { and, desc, eq, gt, inArray, isNull, lte, ne, or } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as tables from '@/db/schema';
import { ApiError } from '@/lib/api/envelope';
import { permissionService } from '@/lib/auth/permissions';
import {
  contextBuildInputSchema,
  contextBuildResultSchema,
  contextLayersSchema,
  contextSnapshotSchema,
  historicalContentSummarySchema,
  type ContextBuildResult,
} from './contracts';

type Database = BetterSQLite3Database<typeof tables>;

export const CONTEXT_BUDGETS = {
  stableItems: 6,
  activeMemories: 20,
  historicalContents: 10,
  characters: 12_000,
} as const;

const SYSTEM_RULES = [
  '仅使用已确认、未过期且未被替代的长期记忆。',
  '业务枚举、状态、日期、配额与公式均由代码决定。',
  '历史内容仅提供结构化摘要，不包含完整脚本。',
] as const;

const missing = () =>
  new ApiError(404, 'NOT_FOUND', '记录不存在或不属于当前组织');
const serializedLength = (value: unknown) => JSON.stringify(value).length;

function terms(value: string) {
  const normalized = value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  const latin = value.toLocaleLowerCase().match(/[a-z0-9]{2,}/g) ?? [];
  const han = Array.from(normalized).filter((char) =>
    /\p{Script=Han}/u.test(char),
  );
  const bigrams = han.slice(0, -1).map((char, index) => char + han[index + 1]);
  return [...new Set([...latin, ...bigrams])].slice(0, 100);
}

function relevance(candidate: string, focusTerms: string[]) {
  const value = candidate.toLocaleLowerCase();
  return focusTerms.reduce(
    (score, term) => score + (value.includes(term) ? 1 : 0),
    0,
  );
}

function historicalSummary(
  row: typeof tables.contents.$inferSelect,
  score: number,
) {
  return historicalContentSummarySchema.parse({
    id: row.id,
    title: row.title,
    contentType: row.contentType,
    contentGoal: row.contentGoal,
    topic: row.topic,
    angle: row.angle,
    hookType: row.hookType,
    hookText: row.hookText,
    coreMessage: row.coreMessage,
    productText: row.productText,
    ctaType: row.ctaType,
    localElement: row.localElement,
    status: row.status,
    priority: row.priority,
    plannedPublishDate: row.plannedPublishDate,
    relevance: score,
  });
}

/** The single deterministic production context assembly boundary. It never calls an LLM. */
export function contextBuilder(
  db: Database,
  organizationId: string,
  userId: string,
  options: { now?: () => Date } = {},
) {
  const permissions = permissionService(db, organizationId, userId);
  const now = options.now ?? (() => new Date());

  return {
    build(input: unknown): ContextBuildResult {
      permissions.require('context.build');
      const value = contextBuildInputSchema.parse(input);
      const account = db
        .select()
        .from(tables.accounts)
        .where(
          and(
            eq(tables.accounts.organizationId, organizationId),
            eq(tables.accounts.id, value.accountId),
          ),
        )
        .get();
      if (!account) throw missing();
      permissions.requireClientWrite(account.clientId);
      const brand = db
        .select()
        .from(tables.brands)
        .where(
          and(
            eq(tables.brands.organizationId, organizationId),
            eq(tables.brands.id, account.brandId),
          ),
        )
        .get();
      if (!brand) throw missing();

      const task = value.contentId
        ? db
            .select()
            .from(tables.contents)
            .where(
              and(
                eq(tables.contents.organizationId, organizationId),
                eq(tables.contents.id, value.contentId),
                eq(tables.contents.accountId, account.id),
              ),
            )
            .get()
        : undefined;
      if (value.contentId && !task) throw missing();
      const selectedPlanId =
        value.monthlyPlanId ?? task?.monthlyPlanId ?? undefined;
      const plan = selectedPlanId
        ? db
            .select()
            .from(tables.monthlyPlans)
            .where(
              and(
                eq(tables.monthlyPlans.organizationId, organizationId),
                eq(tables.monthlyPlans.id, selectedPlanId),
                eq(tables.monthlyPlans.accountId, account.id),
              ),
            )
            .get()
        : undefined;
      if (selectedPlanId && !plan) throw missing();
      if (
        value.monthlyPlanId &&
        task?.monthlyPlanId &&
        value.monthlyPlanId !== task.monthlyPlanId
      )
        throw new ApiError(
          409,
          'CONTEXT_PLAN_MISMATCH',
          '当前任务与月度计划不匹配',
        );

      const stableDefinitions = [
        {
          key: 'brand.positioning',
          scopeType: 'brand' as const,
          scopeId: brand.id,
          value: brand.brandPositioning,
        },
        {
          key: 'brand.core_products',
          scopeType: 'brand' as const,
          scopeId: brand.id,
          value: brand.coreProductsJson,
        },
        {
          key: 'brand.core_selling_points',
          scopeType: 'brand' as const,
          scopeId: brand.id,
          value: brand.coreSellingPointsJson,
        },
        {
          key: 'account.goals',
          scopeType: 'account' as const,
          scopeId: account.id,
          value: account.accountGoalJson,
        },
        {
          key: 'account.content_style',
          scopeType: 'account' as const,
          scopeId: account.id,
          value: account.contentStyleJson,
        },
        {
          key: 'account.forbidden_style',
          scopeType: 'account' as const,
          scopeId: account.id,
          value: account.forbiddenStyleJson,
        },
      ];
      const builtAt = now().toISOString();
      const taskSummary = task ? historicalSummary(task, 0) : null;
      const taskWithoutRelevance = taskSummary
        ? (({ relevance: _, ...rest }) => rest)(taskSummary)
        : null;
      const currentPlan = plan
        ? {
            id: plan.id,
            year: plan.year,
            month: plan.month,
            primaryGoal: plan.primaryGoal,
            plannedContentCount: plan.plannedContentCount,
            campaignNotes: plan.campaignNotes,
            keyProductsJson: plan.keyProductsJson,
            contentMixJson: plan.contentMixJson,
          }
        : null;
      const currentLayer = {
        plan: null as typeof currentPlan,
        task: null as typeof taskWithoutRelevance,
      };
      let currentCharacterOmitted = 0;
      if (taskWithoutRelevance) {
        const candidate = {
          l0SystemRules: [...SYSTEM_RULES],
          l1StableContext: [],
          l2Current: { ...currentLayer, task: taskWithoutRelevance },
          l3Memories: [],
          l4HistoricalContentSummaries: [],
        };
        if (serializedLength(candidate) <= CONTEXT_BUDGETS.characters)
          currentLayer.task = taskWithoutRelevance;
        else currentCharacterOmitted++;
      }
      if (currentPlan) {
        const candidate = {
          l0SystemRules: [...SYSTEM_RULES],
          l1StableContext: [],
          l2Current: { ...currentLayer, plan: currentPlan },
          l3Memories: [],
          l4HistoricalContentSummaries: [],
        };
        if (serializedLength(candidate) <= CONTEXT_BUDGETS.characters)
          currentLayer.plan = currentPlan;
        else currentCharacterOmitted++;
      }
      const focusText = [
        value.focus,
        task
          ? [
              task.title,
              task.topic,
              task.angle,
              task.coreMessage,
              task.productText,
              task.localElement,
            ].join(' ')
          : '',
        plan ? [plan.campaignNotes, ...plan.keyProductsJson].join(' ') : '',
      ].join(' ');
      const focusTerms = terms(focusText);

      const scopePredicate = or(
        and(
          eq(tables.memories.scopeType, 'brand'),
          eq(tables.memories.scopeId, brand.id),
        ),
        and(
          eq(tables.memories.scopeType, 'account'),
          eq(tables.memories.scopeId, account.id),
        ),
      )!;
      const memoryRows = db
        .select()
        .from(tables.memories)
        .where(
          and(
            eq(tables.memories.organizationId, organizationId),
            eq(tables.memories.status, 'active'),
            lte(tables.memories.effectiveAt, builtAt),
            or(
              isNull(tables.memories.expiresAt),
              gt(tables.memories.expiresAt, builtAt),
            ),
            scopePredicate,
          ),
        )
        .all()
        .map((row) => ({
          id: row.id,
          scopeType: row.scopeType,
          memoryKey: row.memoryKey,
          memoryType: row.memoryType,
          summary: row.summary,
          value: row.valueJson,
          importance: row.importance,
          confidence: row.confidence,
          sourceType: row.sourceType,
          sourceId: row.sourceId,
          relevance: relevance(
            [row.memoryKey, row.summary, JSON.stringify(row.valueJson)].join(
              ' ',
            ),
            focusTerms,
          ),
        }))
        .sort(
          (a, b) =>
            b.importance * 10 +
              b.relevance -
              (a.importance * 10 + a.relevance) || a.id.localeCompare(b.id),
        );
      const historicalMemoryIdentities = new Set(
        db
          .select({
            scopeType: tables.memories.scopeType,
            scopeId: tables.memories.scopeId,
            memoryKey: tables.memories.memoryKey,
          })
          .from(tables.memories)
          .where(
            and(
              eq(tables.memories.organizationId, organizationId),
              scopePredicate,
            ),
          )
          .all()
          .map((row) => `${row.scopeType}:${row.scopeId}:${row.memoryKey}`),
      );
      const stableCandidates: Array<{
        key: string;
        scopeType: 'brand' | 'account';
        value: unknown;
        memoryId: string | null;
      }> = [];
      for (const definition of stableDefinitions) {
        const identity = `${definition.scopeType}:${definition.scopeId}:${definition.key}`;
        const activeMemory = memoryRows.find(
          (item) =>
            item.scopeType === definition.scopeType &&
            item.memoryKey === definition.key,
        );
        if (activeMemory) {
          stableCandidates.push({
            key: definition.key,
            scopeType: definition.scopeType,
            value: activeMemory.value,
            memoryId: activeMemory.id,
          });
          continue;
        }
        if (historicalMemoryIdentities.has(identity)) continue;
        const hasValue =
          (typeof definition.value !== 'string' ||
            definition.value.trim().length > 0) &&
          (!Array.isArray(definition.value) || definition.value.length > 0);
        if (hasValue)
          stableCandidates.push({
            key: definition.key,
            scopeType: definition.scopeType,
            value: definition.value,
            memoryId: null,
          });
      }
      const stableByCount = stableCandidates.slice(
        0,
        CONTEXT_BUDGETS.stableItems,
      );
      const stable: typeof stableCandidates = [];
      for (const item of stableByCount) {
        const candidate = {
          l0SystemRules: [...SYSTEM_RULES],
          l1StableContext: [...stable, item],
          l2Current: currentLayer,
          l3Memories: [],
          l4HistoricalContentSummaries: [],
        };
        if (serializedLength(candidate) <= CONTEXT_BUDGETS.characters)
          stable.push(item);
      }
      const stableCharacterOmitted = stableByCount.length - stable.length;
      const stableKeys = new Set(
        stableDefinitions.map((item) => `${item.scopeType}:${item.key}`),
      );
      const contextMemoryRows = memoryRows.filter(
        (item) => !stableKeys.has(`${item.scopeType}:${item.memoryKey}`),
      );

      const historicalPredicates = [
        eq(tables.contents.organizationId, organizationId),
        eq(tables.contents.accountId, account.id),
        inArray(tables.contents.status, ['PUBLISHED', 'REVIEWED']),
      ];
      if (task) historicalPredicates.push(ne(tables.contents.id, task.id));
      const historicalRows = db
        .select()
        .from(tables.contents)
        .where(and(...historicalPredicates))
        .orderBy(desc(tables.contents.createdAt), desc(tables.contents.id))
        .all()
        .map((row) =>
          historicalSummary(
            row,
            relevance(
              [
                row.title,
                row.topic,
                row.angle,
                row.coreMessage,
                row.productText,
                row.localElement,
              ].join(' '),
              focusTerms,
            ),
          ),
        )
        .sort(
          (a, b) =>
            b.relevance - a.relevance ||
            (b.plannedPublishDate ?? '').localeCompare(
              a.plannedPublishDate ?? '',
            ) ||
            a.id.localeCompare(b.id),
        );

      const truncations: Array<{
        layer: 'L1' | 'L2' | 'L3' | 'L4';
        reason: 'item_limit' | 'character_budget';
        omitted: number;
      }> = [];
      if (currentCharacterOmitted)
        truncations.push({
          layer: 'L2',
          reason: 'character_budget',
          omitted: currentCharacterOmitted,
        });
      if (stableCandidates.length > stableByCount.length)
        truncations.push({
          layer: 'L1',
          reason: 'item_limit',
          omitted: stableCandidates.length - stableByCount.length,
        });
      if (stableCharacterOmitted)
        truncations.push({
          layer: 'L1',
          reason: 'character_budget',
          omitted: stableCharacterOmitted,
        });
      if (contextMemoryRows.length > CONTEXT_BUDGETS.activeMemories)
        truncations.push({
          layer: 'L3',
          reason: 'item_limit',
          omitted: contextMemoryRows.length - CONTEXT_BUDGETS.activeMemories,
        });
      if (historicalRows.length > CONTEXT_BUDGETS.historicalContents)
        truncations.push({
          layer: 'L4',
          reason: 'item_limit',
          omitted: historicalRows.length - CONTEXT_BUDGETS.historicalContents,
        });

      const selectedMemories: typeof contextMemoryRows = [];
      const selectedHistory: typeof historicalRows = [];
      const base = {
        l0SystemRules: [...SYSTEM_RULES],
        l1StableContext: stable,
        l2Current: currentLayer,
      };
      for (const item of contextMemoryRows.slice(
        0,
        CONTEXT_BUDGETS.activeMemories,
      )) {
        const candidate = {
          ...base,
          l3Memories: [...selectedMemories, item],
          l4HistoricalContentSummaries: selectedHistory,
        };
        if (serializedLength(candidate) <= CONTEXT_BUDGETS.characters)
          selectedMemories.push(item);
      }
      const memoryCharacterOmitted =
        Math.min(contextMemoryRows.length, CONTEXT_BUDGETS.activeMemories) -
        selectedMemories.length;
      if (memoryCharacterOmitted)
        truncations.push({
          layer: 'L3',
          reason: 'character_budget',
          omitted: memoryCharacterOmitted,
        });
      for (const item of historicalRows.slice(
        0,
        CONTEXT_BUDGETS.historicalContents,
      )) {
        const candidate = {
          ...base,
          l3Memories: selectedMemories,
          l4HistoricalContentSummaries: [...selectedHistory, item],
        };
        if (serializedLength(candidate) <= CONTEXT_BUDGETS.characters)
          selectedHistory.push(item);
      }
      const historyCharacterOmitted =
        Math.min(historicalRows.length, CONTEXT_BUDGETS.historicalContents) -
        selectedHistory.length;
      if (historyCharacterOmitted)
        truncations.push({
          layer: 'L4',
          reason: 'character_budget',
          omitted: historyCharacterOmitted,
        });

      const layers = contextLayersSchema.parse({
        ...base,
        l3Memories: selectedMemories,
        l4HistoricalContentSummaries: selectedHistory,
      });
      const estimatedCharacters = serializedLength(layers);
      const snapshot = contextSnapshotSchema.parse({
        memoryIds: [
          ...stable.flatMap((item) => (item.memoryId ? [item.memoryId] : [])),
          ...selectedMemories.map((item) => item.id),
        ],
        contentIds: [
          ...(currentLayer.task && task ? [task.id] : []),
          ...selectedHistory.map((item) => item.id),
        ],
        planIds: currentLayer.plan && plan ? [plan.id] : [],
        truncations,
        estimatedCharacters,
        estimatedTokens: Math.ceil(estimatedCharacters / 4),
        builtAt,
        budgets: CONTEXT_BUDGETS,
      });
      const snapshotId = crypto.randomUUID();
      return db.transaction(() => {
        db.insert(tables.contextSnapshots)
          .values({
            id: snapshotId,
            organizationId,
            accountId: account.id,
            contentId: task?.id ?? null,
            monthlyPlanId: plan?.id ?? null,
            contextSnapshotJson: { layers, snapshot },
            createdBy: userId,
            isDemo: account.isDemo,
            createdAt: builtAt,
          })
          .run();
        return contextBuildResultSchema.parse({
          snapshotId,
          account: {
            id: account.id,
            name: account.accountName,
            brandId: brand.id,
            brandName: brand.brandName,
            clientId: account.clientId,
          },
          layers,
          snapshot,
        });
      });
    },
  };
}
