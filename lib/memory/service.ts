import { and, count, desc, eq, or } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as tables from '@/db/schema';
import { ApiError } from '@/lib/api/envelope';
import { permissionService } from '@/lib/auth/permissions';
import {
  createManualMemorySchema,
  deactivateMemorySchema,
  initializeMemoriesSchema,
  memoryAccountQuerySchema,
  memoryInitializationResultSchema,
  memoryListSchema,
  memoryMutationSchema,
  memorySchema,
} from './contracts';
import { contextBuilder } from './context-builder';

type Database = BetterSQLite3Database<typeof tables>;
type MemoryType = typeof tables.memories.$inferInsert.memoryType;

const missing = () =>
  new ApiError(404, 'NOT_FOUND', '记录不存在或不属于当前组织');

export function memoryService(
  db: Database,
  organizationId: string,
  userId: string,
  options: { now?: () => Date } = {},
) {
  const permissions = permissionService(db, organizationId, userId);
  const now = options.now ?? (() => new Date());

  const account = (id: string) => {
    const row = db
      .select()
      .from(tables.accounts)
      .where(
        and(
          eq(tables.accounts.organizationId, organizationId),
          eq(tables.accounts.id, id),
        ),
      )
      .get();
    if (!row) throw missing();
    return row;
  };
  const brand = (id: string) => {
    const row = db
      .select()
      .from(tables.brands)
      .where(
        and(
          eq(tables.brands.organizationId, organizationId),
          eq(tables.brands.id, id),
        ),
      )
      .get();
    if (!row) throw missing();
    return row;
  };
  const findMemory = (id: string) => {
    const row = db
      .select()
      .from(tables.memories)
      .where(
        and(
          eq(tables.memories.organizationId, organizationId),
          eq(tables.memories.id, id),
        ),
      )
      .get();
    if (!row) throw missing();
    return memorySchema.parse(row);
  };
  const memoryClientId = (row: typeof tables.memories.$inferSelect) => {
    if (row.scopeType === 'account') return account(row.scopeId).clientId;
    return brand(row.scopeId).clientId;
  };
  const audit = (
    entityId: string,
    action: string,
    metadata: Record<string, unknown>,
  ) => {
    db.insert(tables.auditLogs)
      .values({
        id: crypto.randomUUID(),
        organizationId,
        userId,
        entityType: 'memory',
        entityId,
        action,
        metadataJson: JSON.stringify(metadata),
        isDemo: false,
        createdAt: now().toISOString(),
      })
      .run();
  };
  const replace = (input: {
    scopeType: 'brand' | 'account';
    scopeId: string;
    memoryKey: string;
    memoryType: MemoryType;
    valueJson: unknown;
    summary: string;
    importance: number;
    confidence: number;
    sourceType: typeof tables.memories.$inferInsert.sourceType;
    sourceId: string | null;
    effectiveAt: string;
    expiresAt: string | null;
    isDemo: boolean;
  }) => {
    const previous = db
      .select()
      .from(tables.memories)
      .where(
        and(
          eq(tables.memories.organizationId, organizationId),
          eq(tables.memories.scopeType, input.scopeType),
          eq(tables.memories.scopeId, input.scopeId),
          eq(tables.memories.memoryKey, input.memoryKey),
          eq(tables.memories.status, 'active'),
        ),
      )
      .get();
    if (previous)
      db.update(tables.memories)
        .set({ status: 'superseded' })
        .where(
          and(
            eq(tables.memories.organizationId, organizationId),
            eq(tables.memories.id, previous.id),
            eq(tables.memories.status, 'active'),
          ),
        )
        .run();
    const row = memorySchema.parse({
      id: crypto.randomUUID(),
      organizationId,
      ...input,
      status: 'active',
      supersedesMemoryId: previous?.id ?? null,
      createdBy: userId,
      createdAt: now().toISOString(),
    });
    db.insert(tables.memories).values(row).run();
    audit(row.id, previous ? 'memory.replaced' : 'memory.created', {
      memoryKey: row.memoryKey,
      scopeType: row.scopeType,
      scopeId: row.scopeId,
      replacedMemoryId: previous?.id ?? null,
      sourceType: row.sourceType,
    });
    return memoryMutationSchema.parse({
      memory: row,
      replacedMemoryId: previous?.id ?? null,
    });
  };

  return {
    list(input: unknown) {
      permissions.require('memory.read');
      const query = memoryAccountQuerySchema.parse(input);
      const target = account(query.accountId);
      permissions.requireClientRead(target.clientId);
      const parentBrand = brand(target.brandId);
      const predicates = [
        eq(tables.memories.organizationId, organizationId),
        or(
          and(
            eq(tables.memories.scopeType, 'brand'),
            eq(tables.memories.scopeId, parentBrand.id),
          ),
          and(
            eq(tables.memories.scopeType, 'account'),
            eq(tables.memories.scopeId, target.id),
          ),
        )!,
      ];
      if (query.status)
        predicates.push(eq(tables.memories.status, query.status));
      return db.transaction(() =>
        memoryListSchema.parse({
          account: {
            id: target.id,
            name: target.accountName,
            brandId: parentBrand.id,
            brandName: parentBrand.brandName,
            clientId: target.clientId,
          },
          items: db
            .select()
            .from(tables.memories)
            .where(and(...predicates))
            .orderBy(desc(tables.memories.createdAt), desc(tables.memories.id))
            .limit(query.pageSize)
            .offset((query.page - 1) * query.pageSize)
            .all(),
          total:
            db
              .select({ value: count() })
              .from(tables.memories)
              .where(and(...predicates))
              .get()?.value ?? 0,
          page: query.page,
          pageSize: query.pageSize,
          permissions: {
            canWrite:
              permissions.has('memory.write') &&
              permissions.canWriteClient(target.clientId),
            canBuildContext:
              permissions.has('context.build') &&
              permissions.canWriteClient(target.clientId),
          },
        }),
      );
    },

    createOrReplaceManual(input: unknown) {
      permissions.require('memory.write');
      const value = createManualMemorySchema.parse(input);
      const target = account(value.accountId);
      permissions.requireClientWrite(target.clientId);
      const effectiveAt = value.effectiveAt
        ? new Date(value.effectiveAt).toISOString()
        : now().toISOString();
      const expiresAt = value.expiresAt
        ? new Date(value.expiresAt).toISOString()
        : null;
      if (expiresAt && effectiveAt >= expiresAt)
        throw new ApiError(
          400,
          'INVALID_MEMORY_PERIOD',
          '失效时间必须晚于生效时间',
        );
      return db.transaction(() =>
        replace({
          scopeType: value.scopeType,
          scopeId: value.scopeType === 'brand' ? target.brandId : target.id,
          memoryKey: value.memoryKey,
          memoryType: value.memoryType,
          valueJson: value.valueJson,
          summary: value.summary,
          importance: value.importance,
          confidence: value.confidence,
          sourceType: 'manual',
          sourceId: userId,
          effectiveAt,
          expiresAt,
          isDemo: target.isDemo,
        }),
      );
    },

    initialize(input: unknown) {
      permissions.require('memory.write');
      const value = initializeMemoriesSchema.parse(input);
      const target = account(value.accountId);
      permissions.requireClientWrite(target.clientId);
      const parentBrand = brand(target.brandId);
      const definitionCandidates: Array<{
        scopeType: 'brand' | 'account';
        scopeId: string;
        memoryKey: string;
        memoryType: MemoryType;
        valueJson: unknown;
        summary: string;
        sourceId: string;
        importance: number;
      }> = [
        {
          scopeType: 'brand',
          scopeId: parentBrand.id,
          memoryKey: 'brand.positioning',
          memoryType: 'brand',
          valueJson: parentBrand.brandPositioning,
          summary: `品牌定位：${parentBrand.brandPositioning}`,
          sourceId: parentBrand.id,
          importance: 5,
        },
        {
          scopeType: 'brand',
          scopeId: parentBrand.id,
          memoryKey: 'brand.core_products',
          memoryType: 'brand',
          valueJson: parentBrand.coreProductsJson,
          summary: `核心产品：${parentBrand.coreProductsJson.join('、')}`,
          sourceId: parentBrand.id,
          importance: 5,
        },
        {
          scopeType: 'brand',
          scopeId: parentBrand.id,
          memoryKey: 'brand.core_selling_points',
          memoryType: 'brand',
          valueJson: parentBrand.coreSellingPointsJson,
          summary: `核心卖点：${parentBrand.coreSellingPointsJson.join('、')}`,
          sourceId: parentBrand.id,
          importance: 5,
        },
        {
          scopeType: 'account',
          scopeId: target.id,
          memoryKey: 'account.goals',
          memoryType: 'preference',
          valueJson: target.accountGoalJson,
          summary: `账号目标：${target.accountGoalJson.join('、')}`,
          sourceId: target.id,
          importance: 4,
        },
        {
          scopeType: 'account',
          scopeId: target.id,
          memoryKey: 'account.content_style',
          memoryType: 'preference',
          valueJson: target.contentStyleJson,
          summary: `内容风格：${target.contentStyleJson.join('、')}`,
          sourceId: target.id,
          importance: 4,
        },
        {
          scopeType: 'account',
          scopeId: target.id,
          memoryKey: 'account.forbidden_style',
          memoryType: 'preference',
          valueJson: target.forbiddenStyleJson,
          summary: `禁用风格：${target.forbiddenStyleJson.join('、')}`,
          sourceId: target.id,
          importance: 5,
        },
      ];
      const definitions = definitionCandidates
        .filter(
          (item) =>
            typeof item.valueJson !== 'string' ||
            item.valueJson.trim().length > 0,
        )
        .filter(
          (item) => !Array.isArray(item.valueJson) || item.valueJson.length > 0,
        );
      return db.transaction(() => {
        const created = [];
        const skippedKeys: string[] = [];
        for (const definition of definitions) {
          const current = db
            .select()
            .from(tables.memories)
            .where(
              and(
                eq(tables.memories.organizationId, organizationId),
                eq(tables.memories.scopeType, definition.scopeType),
                eq(tables.memories.scopeId, definition.scopeId),
                eq(tables.memories.memoryKey, definition.memoryKey),
                eq(tables.memories.status, 'active'),
              ),
            )
            .get();
          if (
            current &&
            current.sourceType === 'brand_profile' &&
            JSON.stringify(current.valueJson) ===
              JSON.stringify(definition.valueJson)
          ) {
            skippedKeys.push(definition.memoryKey);
            continue;
          }
          created.push(
            replace({
              ...definition,
              confidence: 1,
              sourceType: 'brand_profile',
              effectiveAt: now().toISOString(),
              expiresAt: null,
              isDemo: target.isDemo,
            }).memory,
          );
        }
        return memoryInitializationResultSchema.parse({ created, skippedKeys });
      });
    },

    deactivate(id: string, input: unknown) {
      permissions.require('memory.write');
      const value = deactivateMemorySchema.parse(input);
      return db.transaction(() => {
        const row = findMemory(id);
        permissions.requireClientWrite(memoryClientId(row));
        if (row.status !== 'active')
          throw new ApiError(
            409,
            'MEMORY_NOT_ACTIVE',
            '只能停用当前 Active 记忆',
          );
        const result = db
          .update(tables.memories)
          .set({ status: 'inactive' })
          .where(
            and(
              eq(tables.memories.organizationId, organizationId),
              eq(tables.memories.id, row.id),
              eq(tables.memories.status, 'active'),
            ),
          )
          .run();
        if (result.changes !== 1)
          throw new ApiError(
            409,
            'STALE_MEMORY',
            '记忆状态已变更，请刷新后重试',
          );
        audit(row.id, 'memory.deactivated', {
          reason: value.reason,
          memoryKey: row.memoryKey,
        });
        return memorySchema.parse({ ...row, status: 'inactive' });
      });
    },

    buildContext(input: unknown) {
      return contextBuilder(db, organizationId, userId, { now }).build(input);
    },
  };
}
