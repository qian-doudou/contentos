import { and, asc, count, desc, eq, gte, inArray, lte, ne, or, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { z } from 'zod';
import * as tables from '@/db/schema';
import { contentTypes } from '@/db/constants';
import { permissionService } from '@/lib/auth/permissions';
import { ApiError } from '@/lib/api/envelope';
import {
  accountOptionSchema, contentDetailSchema, contentListItemSchema, contentListSchema, contentOptionsSchema,
  contentHistorySchema, contentQuerySchema, contentSchema, contentStatusHistoryItemSchema, contentStatusLogSchema,
  contentTransitionResultSchema, createContentSchema, createMonthlyPlanSchema, monthlyPlanDetailSchema,
  monthlyPlanListItemSchema, monthlyPlanListSchema, monthlyPlanSchema, operatorOptionSchema, planOptionSchema,
  planQuerySchema, transitionContentInputSchema, updateContentSchema, updateMonthlyPlanSchema,
} from './contracts';
import { assertContentTransition, deadlineFlags } from './workflow';

type Database = BetterSQLite3Database<typeof tables>;
const missing = () => new ApiError(404, 'NOT_FOUND', '记录不存在或不属于当前组织');

export function calculateMixStats(
  plannedContentCount: number,
  mix: Partial<Record<(typeof contentTypes)[number], number>>,
  actual: Partial<Record<(typeof contentTypes)[number], number>> = {},
) {
  const configured = contentTypes.filter(type => (mix[type] ?? 0) > 0);
  const rows = configured.map((contentType, order) => {
    const percentage = mix[contentType] ?? 0;
    const exact = plannedContentCount * percentage / 100;
    return { contentType, percentage, targetCount: Math.floor(exact), remainder: exact - Math.floor(exact), order };
  });
  let remaining = plannedContentCount - rows.reduce((sum, row) => sum + row.targetCount, 0);
  for (const row of [...rows].sort((a, b) => b.remainder - a.remainder || a.order - b.order)) {
    if (remaining <= 0) break;
    row.targetCount += 1;
    remaining -= 1;
  }
  const configuredSet = new Set(configured);
  return [
    ...rows.map(({ remainder: _remainder, order: _order, ...row }) => ({ ...row, actualCount: actual[row.contentType] ?? 0 })),
    ...contentTypes.filter(type => !configuredSet.has(type) && (actual[type] ?? 0) > 0)
      .map(contentType => ({ contentType, percentage: 0, targetCount: 0, actualCount: actual[contentType] ?? 0 })),
  ];
}

export function contentService(
  db: Database,
  organizationId: string,
  userId: string,
  runtime: { now?: () => Date } = {},
) {
  const permissions = permissionService(db, organizationId, userId);
  const now = runtime.now ?? (() => new Date());
  const audit = (entityType: string, entityId: string, action: string) => db.insert(tables.auditLogs).values({
    id: crypto.randomUUID(), organizationId, userId, entityType, entityId, action,
    metadataJson: JSON.stringify({ source: 'content_model' }), isDemo: false, createdAt: now().toISOString(),
  }).run();
  const metadata = () => {
    const timestamp = now().toISOString();
    return { id: crypto.randomUUID(), organizationId, isDemo: false, createdAt: timestamp, updatedAt: timestamp };
  };
  const account = (id: string, authorize = true) => {
    const row = db.select().from(tables.accounts).where(and(
      eq(tables.accounts.organizationId, organizationId), eq(tables.accounts.id, z.uuid().parse(id)),
    )).get();
    if (!row) throw missing();
    if (authorize) permissions.requireClientRead(row.clientId);
    return row;
  };
  const plan = (id: string, authorize = true) => {
    const row = db.select().from(tables.monthlyPlans).where(and(
      eq(tables.monthlyPlans.organizationId, organizationId), eq(tables.monthlyPlans.id, z.uuid().parse(id)),
    )).get();
    if (!row) throw missing();
    if (authorize) permissions.requireClientRead(account(row.accountId, false).clientId);
    return monthlyPlanSchema.parse(row);
  };
  const brand = (id: string) => {
    const row = db.select().from(tables.brands).where(and(
      eq(tables.brands.organizationId, organizationId), eq(tables.brands.id, z.uuid().parse(id)),
    )).get();
    if (!row) throw missing();
    permissions.requireClientRead(row.clientId);
    return row;
  };
  const store = (id: string) => {
    const row = db.select().from(tables.stores).where(and(
      eq(tables.stores.organizationId, organizationId), eq(tables.stores.id, z.uuid().parse(id)),
    )).get();
    if (!row) throw missing();
    const parent = db.select().from(tables.brands).where(and(
      eq(tables.brands.organizationId, organizationId), eq(tables.brands.id, row.brandId),
    )).get();
    if (!parent) throw missing();
    permissions.requireClientRead(parent.clientId);
    return row;
  };
  const content = (id: string, authorize = true) => {
    const row = db.select().from(tables.contents).where(and(
      eq(tables.contents.organizationId, organizationId), eq(tables.contents.id, z.uuid().parse(id)),
    )).get();
    if (!row) throw missing();
    if (authorize) permissions.requireClientRead(row.clientId);
    return contentSchema.parse(row);
  };
  const accountOptions = () => {
    const readableClientIds = permissions.readableClientIds();
    const predicates = [eq(tables.accounts.organizationId, organizationId)];
    if (readableClientIds)
      predicates.push(readableClientIds.length ? inArray(tables.accounts.clientId, readableClientIds) : sql`0 = 1`);
    return db.select({
      id: tables.accounts.id,
      clientId: tables.accounts.clientId,
      brandId: tables.accounts.brandId,
      storeId: tables.accounts.storeId,
      accountName: tables.accounts.accountName,
      clientName: tables.clients.clientName,
      brandName: tables.brands.brandName,
      storeName: tables.stores.storeName,
    }).from(tables.accounts)
      .innerJoin(tables.clients, and(eq(tables.clients.organizationId, organizationId), eq(tables.clients.id, tables.accounts.clientId)))
      .innerJoin(tables.brands, and(eq(tables.brands.organizationId, organizationId), eq(tables.brands.id, tables.accounts.brandId)))
      .innerJoin(tables.stores, and(eq(tables.stores.organizationId, organizationId), eq(tables.stores.id, tables.accounts.storeId)))
      .where(and(...predicates)).orderBy(asc(tables.clients.clientName), asc(tables.accounts.accountName)).all()
      .map(row => accountOptionSchema.parse({ ...row, canWrite: permissions.canWriteClient(row.clientId) }));
  };
  const operatorOptions = (clientIds: string[]) => db.select().from(tables.users).where(and(
    eq(tables.users.organizationId, organizationId), eq(tables.users.status, 'active'),
  )).orderBy(asc(tables.users.name)).all().flatMap(member => {
    const writableIds = clientIds.filter(clientId => permissions.canUserWriteClient(member.id, clientId));
    return writableIds.length ? [operatorOptionSchema.parse({ id: member.id, name: member.name, clientIds: writableIds })] : [];
  });
  const contentOptions = () => {
    const accounts = accountOptions();
    const accountIds = accounts.map(item => item.id);
    const clientIds = [...new Set(accounts.map(item => item.clientId))];
    const plans = accountIds.length ? db.select({
      id: tables.monthlyPlans.id, accountId: tables.monthlyPlans.accountId, year: tables.monthlyPlans.year,
      month: tables.monthlyPlans.month, status: tables.monthlyPlans.status,
    }).from(tables.monthlyPlans).where(and(
      eq(tables.monthlyPlans.organizationId, organizationId), inArray(tables.monthlyPlans.accountId, accountIds),
    )).orderBy(desc(tables.monthlyPlans.year), desc(tables.monthlyPlans.month)).all() : [];
    return contentOptionsSchema.parse({ accounts, operators: operatorOptions(clientIds), plans: plans.map(row => planOptionSchema.parse(row)) });
  };
  const accountOption = (id: string) => {
    const option = accountOptions().find(item => item.id === id);
    if (!option) throw missing();
    return option;
  };
  const ensurePlanAccount = (planId: string | null, accountId: string) => {
    if (!planId) return null;
    const row = plan(planId, false);
    if (row.accountId !== accountId)
      throw new ApiError(409, 'PLAN_ACCOUNT_MISMATCH', '月度计划与内容账号不一致');
    return row;
  };
  const validateOperator = (operatorId: string, clientId: string) => {
    const member = db.select().from(tables.users).where(and(
      eq(tables.users.organizationId, organizationId), eq(tables.users.id, operatorId), eq(tables.users.status, 'active'),
    )).get();
    if (!member) throw new ApiError(404, 'OPERATOR_NOT_FOUND', '运营人员不存在、不属于当前组织或已停用');
    if (!permissions.canUserWriteClient(member.id, clientId))
      throw new ApiError(409, 'OPERATOR_NOT_ASSIGNED', '运营人员未被授权管理该客户');
  };
  const ensureUniquePlan = (value: { accountId: string; year: number; month: number }, excludeId?: string) => {
    const predicates = [
      eq(tables.monthlyPlans.organizationId, organizationId), eq(tables.monthlyPlans.accountId, value.accountId),
      eq(tables.monthlyPlans.year, value.year), eq(tables.monthlyPlans.month, value.month),
    ];
    if (excludeId) predicates.push(ne(tables.monthlyPlans.id, excludeId));
    if (db.select({ id: tables.monthlyPlans.id }).from(tables.monthlyPlans).where(and(...predicates)).get())
      throw new ApiError(409, 'PLAN_PERIOD_CONFLICT', '该账号的月度计划已存在');
  };
  const enrichPlan = (row: ReturnType<typeof plan>, option: ReturnType<typeof accountOption>) => monthlyPlanListItemSchema.parse({
    ...row,
    accountName: option.accountName,
    clientId: option.clientId,
    clientName: option.clientName,
    createdContentCount: db.select({ value: count() }).from(tables.contents).where(and(
      eq(tables.contents.organizationId, organizationId), eq(tables.contents.monthlyPlanId, row.id),
    )).get()?.value ?? 0,
  });
  const enrichContent = (row: ReturnType<typeof content>, options: ReturnType<typeof contentOptions>) => {
    const accountItem = options.accounts.find(item => item.id === row.accountId);
    const operatorItem = options.operators.find(item => item.id === row.operatorId);
    const planItem = row.monthlyPlanId ? options.plans.find(item => item.id === row.monthlyPlanId) : null;
    if (!accountItem) throw missing();
    const operatorName = operatorItem?.name ?? db.select({ name: tables.users.name }).from(tables.users).where(and(
      eq(tables.users.organizationId, organizationId), eq(tables.users.id, row.operatorId),
    )).get()?.name;
    if (!operatorName) throw missing();
    return contentListItemSchema.parse({
      ...row, accountName: accountItem.accountName, clientName: accountItem.clientName,
      brandName: accountItem.brandName, storeName: accountItem.storeName, operatorName,
      planYear: planItem?.year ?? null, planMonth: planItem?.month ?? null,
      ...deadlineFlags(row.deadline, row.status, now()),
    });
  };
  const enrichStatusLog = (row: z.infer<typeof contentStatusLogSchema>) => {
    const operatorName = db.select({ name: tables.users.name }).from(tables.users).where(and(
      eq(tables.users.organizationId, organizationId), eq(tables.users.id, row.operatorId),
    )).get()?.name;
    if (!operatorName) throw missing();
    return contentStatusHistoryItemSchema.parse({ ...row, operatorName });
  };
  const canonicalDates = <T extends { plannedPublishDate?: string | null; deadline?: string | null }>(value: T): T => ({
    ...value,
    ...(value.plannedPublishDate ? { plannedPublishDate: new Date(value.plannedPublishDate).toISOString() } : {}),
    ...(value.deadline ? { deadline: new Date(value.deadline).toISOString() } : {}),
  });

  return {
    listPlans(input: unknown) {
      const query = planQuerySchema.parse(input);
      const options = accountOptions();
      const accountIds = options.map(item => item.id);
      if (query.accountId) account(query.accountId);
      const predicates = [eq(tables.monthlyPlans.organizationId, organizationId)];
      predicates.push(accountIds.length ? inArray(tables.monthlyPlans.accountId, accountIds) : sql`0 = 1`);
      if (query.accountId) predicates.push(eq(tables.monthlyPlans.accountId, query.accountId));
      if (query.year) predicates.push(eq(tables.monthlyPlans.year, query.year));
      if (query.month) predicates.push(eq(tables.monthlyPlans.month, query.month));
      if (query.status) predicates.push(eq(tables.monthlyPlans.status, query.status));
      return db.transaction(() => monthlyPlanListSchema.parse({
        items: db.select().from(tables.monthlyPlans).where(and(...predicates))
          .orderBy(desc(tables.monthlyPlans.year), desc(tables.monthlyPlans.month), asc(tables.monthlyPlans.id))
          .limit(query.pageSize).offset((query.page - 1) * query.pageSize).all()
          .map(row => enrichPlan(monthlyPlanSchema.parse(row), options.find(item => item.id === row.accountId)!)),
        total: db.select({ value: count() }).from(tables.monthlyPlans).where(and(...predicates)).get()?.value ?? 0,
        page: query.page,
        pageSize: query.pageSize,
        options: { accounts: options },
        permissions: { canWrite: options.some(item => item.canWrite) },
      }));
    },
    planDetail(id: string) {
      return db.transaction(() => {
        const row = plan(id);
        const option = accountOption(row.accountId);
        const actualRows = db.select({ contentType: tables.contents.contentType, value: count() }).from(tables.contents).where(and(
          eq(tables.contents.organizationId, organizationId), eq(tables.contents.monthlyPlanId, row.id),
        )).groupBy(tables.contents.contentType).all();
        const actual = Object.fromEntries(actualRows.map(item => [item.contentType, item.value]));
        return monthlyPlanDetailSchema.parse({
          plan: enrichPlan(row, option), account: option,
          mixStats: calculateMixStats(row.plannedContentCount, row.contentMixJson, actual),
          permissions: { canWrite: permissions.canWriteClient(option.clientId) },
        });
      });
    },
    createPlan(input: unknown) {
      const value = createMonthlyPlanSchema.parse(input);
      return db.transaction(() => {
        const targetAccount = account(value.accountId, false);
        permissions.requireClientWrite(targetAccount.clientId);
        ensureUniquePlan(value);
        const row = monthlyPlanSchema.parse({ ...value, ...metadata(), createdBy: userId });
        db.insert(tables.monthlyPlans).values(row).run();
        audit('monthly_plan', row.id, 'monthly_plan.created');
        return row;
      });
    },
    updatePlan(id: string, input: unknown) {
      const value = updateMonthlyPlanSchema.parse(input);
      return db.transaction(() => {
        const current = plan(id);
        const targetAccount = account(current.accountId, false);
        permissions.requireClientWrite(targetAccount.clientId);
        if (value.accountId && value.accountId !== current.accountId)
          throw new ApiError(409, 'PARENT_IMMUTABLE', '月度计划创建后不可更换所属账号');
        const row = monthlyPlanSchema.parse({ ...current, ...value, accountId: current.accountId, updatedAt: new Date().toISOString() });
        ensureUniquePlan(row, id);
        db.update(tables.monthlyPlans).set(row).where(and(
          eq(tables.monthlyPlans.organizationId, organizationId), eq(tables.monthlyPlans.id, id),
        )).run();
        audit('monthly_plan', row.id, 'monthly_plan.updated');
        return row;
      });
    },
    listContents(input: unknown) {
      const query = contentQuerySchema.parse(input);
      const options = contentOptions();
      const readableClientIds = [...new Set(options.accounts.map(item => item.clientId))];
      if (query.clientId) {
        const row = db.select().from(tables.clients).where(and(
          eq(tables.clients.organizationId, organizationId), eq(tables.clients.id, query.clientId),
        )).get();
        if (!row) throw missing();
        permissions.requireClientRead(row.id);
      }
      const selectedAccount = query.accountId ? account(query.accountId) : null;
      const selectedBrand = query.brandId ? brand(query.brandId) : null;
      const selectedStore = query.storeId ? store(query.storeId) : null;
      const selectedPlan = query.monthlyPlanId ? plan(query.monthlyPlanId) : null;
      if (selectedAccount && selectedBrand && selectedAccount.brandId !== selectedBrand.id)
        throw new ApiError(409, 'HIERARCHY_MISMATCH', '所选品牌不属于所选账号');
      if (selectedAccount && selectedStore && selectedAccount.storeId !== selectedStore.id)
        throw new ApiError(409, 'HIERARCHY_MISMATCH', '所选门店不属于所选账号');
      if (selectedPlan && selectedAccount && selectedPlan.accountId !== selectedAccount.id)
        throw new ApiError(409, 'PLAN_ACCOUNT_MISMATCH', '所选月度计划不属于所选账号');
      if (query.operatorId && !db.select({ id: tables.users.id }).from(tables.users).where(and(
        eq(tables.users.organizationId, organizationId), eq(tables.users.id, query.operatorId),
      )).get()) throw missing();
      const predicates = [eq(tables.contents.organizationId, organizationId)];
      predicates.push(readableClientIds.length ? inArray(tables.contents.clientId, readableClientIds) : sql`0 = 1`);
      if (query.search) predicates.push(or(
        sql`instr(lower(${tables.contents.title}), lower(${query.search})) > 0`,
        sql`instr(lower(${tables.contents.topic}), lower(${query.search})) > 0`,
      )!);
      if (query.clientId) predicates.push(eq(tables.contents.clientId, query.clientId));
      if (query.brandId) predicates.push(eq(tables.contents.brandId, query.brandId));
      if (query.storeId) predicates.push(eq(tables.contents.storeId, query.storeId));
      if (query.accountId) predicates.push(eq(tables.contents.accountId, query.accountId));
      if (query.monthlyPlanId) predicates.push(eq(tables.contents.monthlyPlanId, query.monthlyPlanId));
      if (query.contentType) predicates.push(eq(tables.contents.contentType, query.contentType));
      if (query.contentGoal) predicates.push(eq(tables.contents.contentGoal, query.contentGoal));
      if (query.priority) predicates.push(eq(tables.contents.priority, query.priority));
      if (query.operatorId) predicates.push(eq(tables.contents.operatorId, query.operatorId));
      if (query.status) predicates.push(eq(tables.contents.status, query.status));
      if (query.plannedFrom) predicates.push(gte(tables.contents.plannedPublishDate, query.plannedFrom));
      if (query.plannedTo) predicates.push(lte(tables.contents.plannedPublishDate, query.plannedTo));
      return db.transaction(() => contentListSchema.parse({
        items: db.select().from(tables.contents).where(and(...predicates))
          .orderBy(desc(tables.contents.plannedPublishDate), desc(tables.contents.createdAt), asc(tables.contents.id))
          .limit(query.pageSize).offset((query.page - 1) * query.pageSize).all()
          .map(row => enrichContent(contentSchema.parse(row), options)),
        total: db.select({ value: count() }).from(tables.contents).where(and(...predicates)).get()?.value ?? 0,
        page: query.page,
        pageSize: query.pageSize,
        options,
        permissions: { canWrite: options.accounts.some(item => item.canWrite) },
      }));
    },
    contentDetail(id: string) {
      return db.transaction(() => {
        const row = content(id);
        const options = contentOptions();
        return contentDetailSchema.parse({
          content: enrichContent(row, options), options,
          permissions: { canWrite: permissions.canWriteClient(row.clientId) },
        });
      });
    },
    createContent(input: unknown) {
      const value = canonicalDates(createContentSchema.parse(input));
      return db.transaction(() => {
        const targetAccount = account(value.accountId, false);
        permissions.requireClientWrite(targetAccount.clientId);
        ensurePlanAccount(value.monthlyPlanId, value.accountId);
        validateOperator(value.operatorId, targetAccount.clientId);
        const row = contentSchema.parse({
          ...value,
          ...metadata(),
          status: 'IDEA',
          clientId: targetAccount.clientId,
          brandId: targetAccount.brandId,
          storeId: targetAccount.storeId,
          currentScriptVersionId: null,
          activeApprovedScriptVersionId: null,
          currentEditVersionId: null,
          activeApprovedEditVersionId: null,
          aiReviewStatus: null,
          publishedAt: null,
          externalId: null,
          importDedupKey: null,
          importBatchId: null,
          createdBy: userId,
        });
        db.insert(tables.contents).values(row).run();
        audit('content', row.id, 'content.created');
        return row;
      });
    },
    updateContent(id: string, input: unknown) {
      const value = canonicalDates(updateContentSchema.parse(input));
      return db.transaction(() => {
        const current = content(id);
        permissions.requireClientWrite(current.clientId);
        const targetAccount = value.accountId ? account(value.accountId, false) : account(current.accountId, false);
        permissions.requireClientWrite(targetAccount.clientId);
        const monthlyPlanId = value.monthlyPlanId === undefined ? current.monthlyPlanId : value.monthlyPlanId;
        ensurePlanAccount(monthlyPlanId, targetAccount.id);
        const operatorId = value.operatorId ?? current.operatorId;
        validateOperator(operatorId, targetAccount.clientId);
        const row = contentSchema.parse({
          ...current,
          ...value,
          accountId: targetAccount.id,
          clientId: targetAccount.clientId,
          brandId: targetAccount.brandId,
          storeId: targetAccount.storeId,
          monthlyPlanId,
          operatorId,
          updatedAt: now().toISOString(),
        });
        db.update(tables.contents).set(row).where(and(
          eq(tables.contents.organizationId, organizationId), eq(tables.contents.id, id),
        )).run();
        const embeddingFields = ['accountId', 'title', 'topic', 'angle', 'hookText', 'coreMessage'] as const;
        if (embeddingFields.some(field => row[field] !== current[field])) {
          db.update(tables.contentEmbeddings).set({
            status: 'stale', updatedAt: row.updatedAt,
          }).where(and(
            eq(tables.contentEmbeddings.organizationId, organizationId),
            eq(tables.contentEmbeddings.contentId, id),
            eq(tables.contentEmbeddings.status, 'active'),
          )).run();
        }
        audit('content', row.id, 'content.updated');
        return row;
      });
    },
    transitionContent(id: string, input: unknown) {
      const value = transitionContentInputSchema.parse(input);
      return db.transaction(() => {
        const current = content(id);
        permissions.requireClientWrite(current.clientId);
        assertContentTransition(current.status, value.newStatus, 'manual');
        const timestamp = now().toISOString();
        const update = db.update(tables.contents).set({ status: value.newStatus, updatedAt: timestamp }).where(and(
          eq(tables.contents.organizationId, organizationId),
          eq(tables.contents.id, current.id),
          eq(tables.contents.status, current.status),
        )).run();
        if (update.changes !== 1)
          throw new ApiError(409, 'STALE_CONTENT_STATUS', '内容状态已变更，请刷新后重试');
        const log = contentStatusLogSchema.parse({
          id: crypto.randomUUID(), organizationId, contentId: current.id,
          previousStatus: current.status, newStatus: value.newStatus, triggerType: 'manual', triggerId: null,
          operatorId: userId, reason: value.reason, isDemo: current.isDemo, createdAt: timestamp,
        });
        db.insert(tables.contentStatusLogs).values(log).run();
        audit('content', current.id, 'content.status_transitioned');
        const updated = contentSchema.parse({ ...current, status: value.newStatus, updatedAt: timestamp });
        return contentTransitionResultSchema.parse({
          content: enrichContent(updated, contentOptions()),
          log: enrichStatusLog(log),
        });
      });
    },
    contentHistory(id: string) {
      return db.transaction(() => {
        const current = content(id);
        const items = db.select().from(tables.contentStatusLogs).where(and(
          eq(tables.contentStatusLogs.organizationId, organizationId),
          eq(tables.contentStatusLogs.contentId, current.id),
        )).orderBy(desc(tables.contentStatusLogs.createdAt), desc(sql`rowid`)).all()
          .map(row => enrichStatusLog(contentStatusLogSchema.parse(row)));
        return contentHistorySchema.parse({
          contentId: current.id,
          currentStatus: current.status,
          items,
          permissions: { canWrite: permissions.canWriteClient(current.clientId) },
        });
      });
    },
  };
}
