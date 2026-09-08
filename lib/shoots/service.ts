import {
  and, asc, count, desc, eq, gte, inArray, isNotNull, lte, or, sql,
} from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { alias } from 'drizzle-orm/sqlite-core';
import { z } from 'zod';
import * as tables from '@/db/schema';
import { ApiError } from '@/lib/api/envelope';
import { permissionService, type ShootAccessScope } from '@/lib/auth/permissions';
import { assertContentTransition } from '@/lib/content/workflow';
import {
  addShootContentSchema,
  createShootSchema,
  shootDetailSchema,
  shootListSchema,
  shootQuerySchema,
  shootItemActionSchema,
  updateShootSchema,
  type CreateShootInput,
} from './contracts';
import { deriveShootStatus, shootProgress, type ShootItemStatus } from './workflow';

type Database = BetterSQLite3Database<typeof tables>;
type ShootRow = typeof tables.shoots.$inferSelect;
type ContentRow = typeof tables.contents.$inferSelect;
const missing = () => new ApiError(404, 'NOT_FOUND', '记录不存在或不属于当前组织');
const operatorUsers = alias(tables.users, 'shoot_operator_users');
const photographerUsers = alias(tables.users, 'shoot_photographer_users');

export function shootService(
  db: Database,
  organizationId: string,
  userId: string,
  runtime: { now?: () => Date } = {},
) {
  const permissions = permissionService(db, organizationId, userId);
  const now = runtime.now ?? (() => new Date());
  const timestamp = () => now().toISOString();

  function rawShoot(id: string) {
    const row = db.select().from(tables.shoots).where(and(
      eq(tables.shoots.organizationId, organizationId),
      eq(tables.shoots.id, z.uuid().parse(id)),
    )).get();
    if (!row) throw missing();
    return row;
  }

  function authorizedShoot(id: string) {
    const row = rawShoot(id);
    permissions.requireShootRead(row.clientId, row.photographerId);
    return row;
  }

  function rawContent(id: string) {
    const row = db.select().from(tables.contents).where(and(
      eq(tables.contents.organizationId, organizationId),
      eq(tables.contents.id, z.uuid().parse(id)),
    )).get();
    if (!row) throw missing();
    return row;
  }

  function clientRow(id: string) {
    const row = db.select().from(tables.clients).where(and(
      eq(tables.clients.organizationId, organizationId), eq(tables.clients.id, id),
    )).get();
    if (!row) throw missing();
    return row;
  }

  function storeWithClient(id: string) {
    const row = db.select({ store: tables.stores, clientId: tables.brands.clientId })
      .from(tables.stores)
      .innerJoin(tables.brands, and(
        eq(tables.brands.organizationId, tables.stores.organizationId),
        eq(tables.brands.id, tables.stores.brandId),
      ))
      .where(and(eq(tables.stores.organizationId, organizationId), eq(tables.stores.id, id))).get();
    if (!row) throw missing();
    return row;
  }

  function activeUser(id: string) {
    const row = db.select().from(tables.users).where(and(
      eq(tables.users.organizationId, organizationId), eq(tables.users.id, id), eq(tables.users.status, 'active'),
    )).get();
    if (!row) throw missing();
    return row;
  }

  function validateAssignment(value: CreateShootInput) {
    const client = clientRow(value.clientId);
    const store = storeWithClient(value.storeId);
    if (client.status !== 'active' || store.store.status !== 'active')
      throw new ApiError(409, 'SHOOT_PARENT_INACTIVE', '客户或门店已停用，不能新建拍摄排期');
    if (store.clientId !== client.id)
      throw new ApiError(409, 'HIERARCHY_MISMATCH', '拍摄门店不属于所选客户');
    permissions.requireShootWrite(client.id);
    const operator = activeUser(value.operatorId);
    if (!['owner', 'admin', 'operator'].includes(operator.role) || !permissions.canUserWriteClient(operator.id, client.id))
      throw new ApiError(409, 'OPERATOR_NOT_ALLOWED', '运营负责人必须有权管理该客户');
    const photographer = activeUser(value.photographerId);
    if (photographer.role !== 'photographer')
      throw new ApiError(409, 'PHOTOGRAPHER_NOT_ALLOWED', '拍摄人员必须是有效的 Photographer');
  }

  function writeAudit(action: string, entityType: string, entityId: string, metadata: Record<string, unknown>, isDemo: boolean) {
    db.insert(tables.auditLogs).values({
      id: crypto.randomUUID(), organizationId, userId, action, entityType, entityId,
      metadataJson: JSON.stringify(metadata), isDemo, createdAt: timestamp(),
    }).run();
  }

  function scopeClientIds(scope: ShootAccessScope): string[] | null {
    if (scope.kind === 'organization') return null;
    if (scope.kind === 'clients') return scope.clientIds;
    return db.selectDistinct({ clientId: tables.shoots.clientId }).from(tables.shoots).where(and(
      eq(tables.shoots.organizationId, organizationId),
      eq(tables.shoots.photographerId, scope.photographerId),
    )).all().map((row) => row.clientId);
  }

  function canCreate() {
    if (permissions.actor.role === 'owner' || permissions.actor.role === 'admin') return true;
    return permissions.actor.role === 'operator' && (permissions.writableClientIds()?.length ?? 0) > 0;
  }

  function options(scope = permissions.shootAccessScope()) {
    const clientIds = scopeClientIds(scope);
    const photographerStoreIds = scope.kind === 'photographer'
      ? db.selectDistinct({ storeId: tables.shoots.storeId }).from(tables.shoots).where(and(
        eq(tables.shoots.organizationId, organizationId),
        eq(tables.shoots.photographerId, scope.photographerId),
      )).all().map((row) => row.storeId)
      : null;
    const clientPredicates = [eq(tables.clients.organizationId, organizationId)];
    if (clientIds) clientPredicates.push(clientIds.length ? inArray(tables.clients.id, clientIds) : sql`0 = 1`);
    const clients = db.select({ id: tables.clients.id, name: tables.clients.clientName }).from(tables.clients)
      .where(and(...clientPredicates)).orderBy(asc(tables.clients.clientName), asc(tables.clients.id)).all();
    const visibleClientIds = clients.map((client) => client.id);
    const stores = visibleClientIds.length ? db.select({
      id: tables.stores.id,
      clientId: tables.brands.clientId,
      name: tables.stores.storeName,
      location: tables.stores.address,
    }).from(tables.stores).innerJoin(tables.brands, and(
      eq(tables.brands.organizationId, tables.stores.organizationId),
      eq(tables.brands.id, tables.stores.brandId),
    )).where(and(
      eq(tables.stores.organizationId, organizationId),
      inArray(tables.brands.clientId, visibleClientIds),
      eq(tables.stores.status, 'active'),
    )).orderBy(asc(tables.stores.storeName), asc(tables.stores.id)).all()
      .filter((store) => !photographerStoreIds || photographerStoreIds.includes(store.id)) : [];
    const createAllowed = canCreate();
    const people = createAllowed ? db.select({ id: tables.users.id, name: tables.users.name, role: tables.users.role })
      .from(tables.users).where(and(
        eq(tables.users.organizationId, organizationId), eq(tables.users.status, 'active'),
      )).orderBy(asc(tables.users.name), asc(tables.users.id)).all() : [];
    const writableIds = permissions.writableClientIds();
    return {
      clients: createAllowed && writableIds ? clients.filter((client) => writableIds.includes(client.id)) : clients,
      stores: createAllowed && writableIds ? stores.filter((store) => writableIds.includes(store.clientId)) : stores,
      operators: people.filter((member) => ['owner', 'admin', 'operator'].includes(member.role))
        .map(({ id, name }) => ({
          id, name, clientIds: visibleClientIds.filter((clientId) => permissions.canUserWriteClient(id, clientId)),
        }))
        .filter((member) => member.clientIds.length > 0),
      photographers: people.filter((member) => member.role === 'photographer').map(({ id, name }) => ({ id, name })),
    };
  }

  function listItemQuery(predicates: ReturnType<typeof eq>[]) {
    return db.select({
      shoot: tables.shoots,
      clientName: tables.clients.clientName,
      storeName: tables.stores.storeName,
      operatorName: operatorUsers.name,
      photographerName: photographerUsers.name,
      itemCount: sql<number>`(select count(*) from ${tables.shootContents} sc where sc.organization_id = ${organizationId} and sc.shoot_id = ${tables.shoots.id})`,
      shotCount: sql<number>`(select count(*) from ${tables.shootContents} sc where sc.organization_id = ${organizationId} and sc.shoot_id = ${tables.shoots.id} and sc.shoot_item_status = 'shot')`,
      issueCount: sql<number>`(select count(*) from ${tables.shootContents} sc where sc.organization_id = ${organizationId} and sc.shoot_id = ${tables.shoots.id} and sc.shoot_item_status = 'missing_shots')`,
    }).from(tables.shoots)
      .innerJoin(tables.clients, and(eq(tables.clients.organizationId, tables.shoots.organizationId), eq(tables.clients.id, tables.shoots.clientId)))
      .innerJoin(tables.stores, and(eq(tables.stores.organizationId, tables.shoots.organizationId), eq(tables.stores.id, tables.shoots.storeId)))
      .innerJoin(operatorUsers, and(eq(operatorUsers.organizationId, tables.shoots.organizationId), eq(operatorUsers.id, tables.shoots.operatorId)))
      .innerJoin(photographerUsers, and(eq(photographerUsers.organizationId, tables.shoots.organizationId), eq(photographerUsers.id, tables.shoots.photographerId)))
      .where(and(...predicates));
  }

  function listItem(id: string) {
    const row = listItemQuery([
      eq(tables.shoots.organizationId, organizationId), eq(tables.shoots.id, id),
    ]).get();
    if (!row) throw missing();
    return {
      ...row.shoot,
      clientName: row.clientName,
      storeName: row.storeName,
      operatorName: row.operatorName,
      photographerName: row.photographerName,
      itemCount: Number(row.itemCount),
      shotCount: Number(row.shotCount),
      issueCount: Number(row.issueCount),
    };
  }

  function recomputeShoot(shootId: string, at: string) {
    const statuses = db.select({ status: tables.shootContents.shootItemStatus }).from(tables.shootContents).where(and(
      eq(tables.shootContents.organizationId, organizationId), eq(tables.shootContents.shootId, shootId),
    )).all().map((row) => row.status);
    const status = deriveShootStatus(statuses);
    db.update(tables.shoots).set({ status, updatedAt: at }).where(and(
      eq(tables.shoots.organizationId, organizationId), eq(tables.shoots.id, shootId),
    )).run();
    return status;
  }

  function transitionContent(row: ContentRow, nextStatus: 'WAITING_SHOOT' | 'APPROVED' | 'SHOT', triggerId: string, reason: string, at: string) {
    assertContentTransition(row.status, nextStatus, 'shoot');
    const changed = db.update(tables.contents).set({ status: nextStatus, updatedAt: at }).where(and(
      eq(tables.contents.organizationId, organizationId), eq(tables.contents.id, row.id), eq(tables.contents.status, row.status),
    )).run();
    if (changed.changes !== 1) throw new ApiError(409, 'STALE_CONTENT_STATUS', '内容状态已变化，请刷新后重试');
    db.insert(tables.contentStatusLogs).values({
      id: crypto.randomUUID(), organizationId, contentId: row.id, previousStatus: row.status,
      newStatus: nextStatus, triggerType: 'shoot', triggerId, operatorId: userId,
      reason, isDemo: row.isDemo, createdAt: at,
    }).run();
  }

  function eligibleContents(shoot: ShootRow) {
    if (!permissions.canScheduleShoot(shoot.clientId)) return [];
    const candidates = db.select().from(tables.contents).where(and(
      eq(tables.contents.organizationId, organizationId),
      eq(tables.contents.clientId, shoot.clientId),
      eq(tables.contents.storeId, shoot.storeId),
      isNotNull(tables.contents.activeApprovedScriptVersionId),
      or(eq(tables.contents.status, 'APPROVED'), eq(tables.contents.status, 'WAITING_SHOOT')),
    )).orderBy(asc(tables.contents.title), asc(tables.contents.id)).all();
    if (!candidates.length) return [];
    const ids = candidates.map((content) => content.id);
    const assignments = db.select().from(tables.shootContents).where(and(
      eq(tables.shootContents.organizationId, organizationId), inArray(tables.shootContents.contentId, ids),
    )).all();
    return candidates.flatMap((content) => {
      const related = assignments.filter((item) => item.contentId === content.id);
      const active = related.some((item) => item.shootItemStatus === 'planned' || item.shootItemStatus === 'missing_shots');
      const pendingReschedule = content.status === 'WAITING_SHOOT' && related.some((item) => item.shootItemStatus === 'rescheduled') && !active;
      if (active || (content.status !== 'APPROVED' && !pendingReschedule) || !content.activeApprovedScriptVersionId) return [];
      return [{
        id: content.id, title: content.title, hookText: content.hookText, peopleJson: content.peopleJson,
        productText: content.productText, status: content.status,
        activeApprovedScriptVersionId: content.activeApprovedScriptVersionId, pendingReschedule,
      }];
    });
  }

  function detail(id: string) {
    return db.transaction(() => {
      const shoot = authorizedShoot(id);
      const items = db.select({
        item: tables.shootContents,
        title: tables.contents.title,
        hookText: tables.contents.hookText,
        peopleJson: tables.contents.peopleJson,
        productText: tables.contents.productText,
        contentStatus: tables.contents.status,
        scriptVersionNo: tables.scriptVersions.versionNo,
        approvedScript: tables.scriptVersions.scriptJson,
      }).from(tables.shootContents)
        .innerJoin(tables.contents, and(
          eq(tables.contents.organizationId, tables.shootContents.organizationId),
          eq(tables.contents.id, tables.shootContents.contentId),
        ))
        .innerJoin(tables.scriptVersions, and(
          eq(tables.scriptVersions.organizationId, tables.shootContents.organizationId),
          eq(tables.scriptVersions.contentId, tables.shootContents.contentId),
          eq(tables.scriptVersions.id, tables.shootContents.approvedScriptVersionId),
        ))
        .where(and(
          eq(tables.shootContents.organizationId, organizationId), eq(tables.shootContents.shootId, shoot.id),
        )).orderBy(asc(tables.shootContents.createdAt), asc(tables.shootContents.id)).all();
      return shootDetailSchema.parse({
        shoot: listItem(shoot.id),
        items: items.map((row) => ({ ...row.item, ...row })),
        eligibleContents: eligibleContents(shoot),
        rescheduleTargets: db.select({
          id: tables.shoots.id,
          shootDate: tables.shoots.shootDate,
          startTime: tables.shoots.startTime,
          photographerId: tables.shoots.photographerId,
        }).from(tables.shoots).where(and(
          eq(tables.shoots.organizationId, organizationId),
          eq(tables.shoots.clientId, shoot.clientId),
          eq(tables.shoots.storeId, shoot.storeId),
          eq(tables.shoots.status, 'planned'),
          sql`${tables.shoots.id} <> ${shoot.id}`,
        )).orderBy(asc(tables.shoots.shootDate), asc(tables.shoots.startTime)).all()
          .filter((target) => permissions.actor.role !== 'photographer' || target.photographerId === permissions.actor.id)
          .map((target) => ({ id: target.id, name: `${target.shootDate} ${target.startTime}` })),
        options: options(),
        permissions: {
          canCreate: canCreate(),
          canEdit: shoot.status === 'planned' && permissions.canScheduleShoot(shoot.clientId),
          canSchedule: shoot.status === 'planned' && permissions.canScheduleShoot(shoot.clientId),
          canExecute: permissions.canExecuteShoot(shoot.clientId, shoot.photographerId),
        },
      });
    });
  }

  function shootInput(row: ShootRow): CreateShootInput {
    return {
      clientId: row.clientId, storeId: row.storeId, shootDate: row.shootDate,
      startTime: row.startTime, endTime: row.endTime, operatorId: row.operatorId,
      photographerId: row.photographerId, location: row.location, notes: row.notes,
    };
  }

  return {
    list(input: unknown) {
      const query = shootQuerySchema.parse(input);
      const scope = permissions.shootAccessScope();
      const clientIds = scopeClientIds(scope);
      if (query.clientId) {
        clientRow(query.clientId);
        if (scope.kind === 'clients' && !scope.clientIds.includes(query.clientId))
          throw new ApiError(403, 'PERMISSION_DENIED', '当前身份未被授权访问该客户的拍摄任务');
        if (scope.kind === 'photographer' && !clientIds?.includes(query.clientId))
          throw new ApiError(403, 'PERMISSION_DENIED', '摄影人员只能查看本人的拍摄任务');
      }
      if (query.photographerId) {
        const selected = activeUser(query.photographerId);
        if (selected.role !== 'photographer') throw new ApiError(400, 'PHOTOGRAPHER_NOT_ALLOWED', '所选成员不是摄影角色');
        if (scope.kind === 'photographer' && scope.photographerId !== selected.id)
          throw new ApiError(403, 'PERMISSION_DENIED', '摄影人员只能查看本人的拍摄任务');
      }
      const predicates = [eq(tables.shoots.organizationId, organizationId)];
      if (scope.kind === 'clients') predicates.push(scope.clientIds.length ? inArray(tables.shoots.clientId, scope.clientIds) : sql`0 = 1`);
      if (scope.kind === 'photographer') predicates.push(eq(tables.shoots.photographerId, scope.photographerId));
      if (query.clientId) predicates.push(eq(tables.shoots.clientId, query.clientId));
      if (query.photographerId) predicates.push(eq(tables.shoots.photographerId, query.photographerId));
      if (query.status) predicates.push(eq(tables.shoots.status, query.status));
      if (query.dateFrom) predicates.push(gte(tables.shoots.shootDate, query.dateFrom));
      if (query.dateTo) predicates.push(lte(tables.shoots.shootDate, query.dateTo));
      const rows = listItemQuery(predicates).orderBy(desc(tables.shoots.shootDate), asc(tables.shoots.startTime), asc(tables.shoots.id))
        .limit(query.pageSize).offset((query.page - 1) * query.pageSize).all();
      return shootListSchema.parse({
        items: rows.map((row) => ({
          ...row.shoot, clientName: row.clientName, storeName: row.storeName,
          operatorName: row.operatorName, photographerName: row.photographerName,
          itemCount: Number(row.itemCount), shotCount: Number(row.shotCount), issueCount: Number(row.issueCount),
        })),
        total: db.select({ value: count() }).from(tables.shoots).where(and(...predicates)).get()?.value ?? 0,
        page: query.page, pageSize: query.pageSize, options: options(scope), permissions: { canCreate: canCreate() },
      });
    },

    detail,

    create(input: unknown) {
      const value = createShootSchema.parse(input);
      validateAssignment(value);
      const at = timestamp();
      const row = {
        id: crypto.randomUUID(), organizationId, ...value, status: 'planned' as const,
        isDemo: false, createdAt: at, updatedAt: at,
      };
      db.transaction(() => {
        db.insert(tables.shoots).values(row).run();
        writeAudit('shoot.created', 'shoot', row.id, { clientId: row.clientId, storeId: row.storeId }, false);
      });
      return detail(row.id);
    },

    update(id: string, input: unknown) {
      const value = updateShootSchema.parse(input);
      const current = authorizedShoot(id);
      permissions.requireShootWrite(current.clientId);
      if (current.status !== 'planned')
        throw new ApiError(409, 'SHOOT_ALREADY_EXECUTED', '拍摄已进入执行或终态，不能修改排期资料');
      const merged = createShootSchema.parse({ ...shootInput(current), ...value });
      const itemCount = db.select({ value: count() }).from(tables.shootContents).where(and(
        eq(tables.shootContents.organizationId, organizationId), eq(tables.shootContents.shootId, current.id),
      )).get()?.value ?? 0;
      if (itemCount > 0 && (merged.clientId !== current.clientId || merged.storeId !== current.storeId))
        throw new ApiError(409, 'SHOOT_HIERARCHY_IMMUTABLE', '已加入内容后不能更换客户或门店');
      validateAssignment(merged);
      const at = timestamp();
      db.transaction(() => {
        const changed = db.update(tables.shoots).set({ ...merged, updatedAt: at }).where(and(
          eq(tables.shoots.organizationId, organizationId), eq(tables.shoots.id, current.id),
          eq(tables.shoots.updatedAt, current.updatedAt), eq(tables.shoots.status, 'planned'),
        )).run();
        if (changed.changes !== 1) throw new ApiError(409, 'STALE_SHOOT', '拍摄排期已变化，请刷新后重试');
        writeAudit('shoot.updated', 'shoot', current.id, { fields: Object.keys(value) }, current.isDemo);
      });
      return detail(current.id);
    },

    addContent(shootId: string, input: unknown) {
      const { contentId } = addShootContentSchema.parse(input);
      const shoot = authorizedShoot(shootId);
      permissions.requireShootWrite(shoot.clientId);
      if (shoot.status !== 'planned')
        throw new ApiError(409, 'SHOOT_NOT_SCHEDULABLE', '只能向未执行的拍摄排期加入内容');
      const content = rawContent(contentId);
      permissions.requireShootWrite(content.clientId);
      if (content.clientId !== shoot.clientId || content.storeId !== shoot.storeId)
        throw new ApiError(409, 'SHOOT_CONTENT_HIERARCHY_MISMATCH', '内容必须属于拍摄的客户与门店');
      if (!content.activeApprovedScriptVersionId)
        throw new ApiError(409, 'APPROVED_SCRIPT_REQUIRED', '内容没有活动的已批准脚本，不能排期');
      const existingItems = db.select().from(tables.shootContents).where(and(
        eq(tables.shootContents.organizationId, organizationId), eq(tables.shootContents.contentId, content.id),
      )).all();
      if (existingItems.some((item) => item.shootItemStatus === 'planned' || item.shootItemStatus === 'missing_shots'))
        throw new ApiError(409, 'CONTENT_ALREADY_SCHEDULED', '内容已在有效拍摄排期中');
      if (existingItems.some((item) => item.shootId === shoot.id))
        throw new ApiError(409, 'CONTENT_ALREADY_IN_SHOOT', '该内容已在本次拍摄历史中');
      const pendingReschedule = content.status === 'WAITING_SHOOT' && existingItems.some((item) => item.shootItemStatus === 'rescheduled');
      if (content.status !== 'APPROVED' && !pendingReschedule)
        throw new ApiError(409, 'CONTENT_NOT_APPROVED', '只有 APPROVED 且已绑定批准脚本的内容可以排期');
      const version = db.select({ id: tables.scriptVersions.id }).from(tables.scriptVersions).where(and(
        eq(tables.scriptVersions.organizationId, organizationId),
        eq(tables.scriptVersions.contentId, content.id),
        eq(tables.scriptVersions.id, content.activeApprovedScriptVersionId),
      )).get();
      if (!version) throw new ApiError(409, 'APPROVED_SCRIPT_REQUIRED', '活动批准脚本无效');
      const at = timestamp();
      const itemId = crypto.randomUUID();
      db.transaction(() => {
        db.insert(tables.shootContents).values({
          id: itemId, organizationId, shootId: shoot.id, contentId: content.id,
          approvedScriptVersionId: version.id, shootItemStatus: 'planned', missingShots: '', note: '',
          isDemo: shoot.isDemo && content.isDemo, createdAt: at, updatedAt: at,
        }).run();
        if (content.status === 'APPROVED')
          transitionContent(content, 'WAITING_SHOOT', itemId, `加入 ${shoot.shootDate} 拍摄排期`, at);
        recomputeShoot(shoot.id, at);
        writeAudit('shoot.content_added', 'shoot_content', itemId, { shootId: shoot.id, contentId: content.id, versionId: version.id }, shoot.isDemo);
      });
      return detail(shoot.id);
    },

    actOnItem(shootId: string, itemId: string, input: unknown) {
      const value = shootItemActionSchema.parse(input);
      const shoot = authorizedShoot(shootId);
      if (value.action === 'remove') permissions.requireShootWrite(shoot.clientId);
      else permissions.requireShootExecution(shoot.clientId, shoot.photographerId);
      const item = db.select().from(tables.shootContents).where(and(
        eq(tables.shootContents.organizationId, organizationId),
        eq(tables.shootContents.shootId, shoot.id),
        eq(tables.shootContents.id, z.uuid().parse(itemId)),
      )).get();
      if (!item) throw missing();
      const content = rawContent(item.contentId);
      if (value.action === 'remove' && (shoot.status !== 'planned' || item.shootItemStatus !== 'planned'))
        throw new ApiError(409, 'SHOOT_ITEM_ALREADY_EXECUTED', '只能从尚未执行的拍摄中移除待拍内容');
      if (!['planned', 'missing_shots'].includes(item.shootItemStatus))
        throw new ApiError(409, 'SHOOT_ITEM_FINALIZED', '该 Checklist 项已是终态，不能重复处理');
      let targetShoot: ShootRow | null = null;
      if (value.action === 'rescheduled' && value.newShootId) {
        targetShoot = rawShoot(value.newShootId);
        permissions.requireShootExecution(targetShoot.clientId, targetShoot.photographerId);
        if (targetShoot.id === shoot.id || targetShoot.clientId !== shoot.clientId || targetShoot.storeId !== shoot.storeId)
          throw new ApiError(409, 'RESCHEDULE_TARGET_MISMATCH', '新拍摄必须是同客户、同门店的其他排期');
        if (targetShoot.status !== 'planned')
          throw new ApiError(409, 'RESCHEDULE_TARGET_NOT_PLANNED', '新拍摄必须尚未执行');
        if (db.select({ id: tables.shootContents.id }).from(tables.shootContents).where(and(
          eq(tables.shootContents.organizationId, organizationId), eq(tables.shootContents.shootId, targetShoot.id),
          eq(tables.shootContents.contentId, content.id),
        )).get()) throw new ApiError(409, 'CONTENT_ALREADY_IN_SHOOT', '该内容已存在于新拍摄历史中');
      }
      const at = timestamp();
      const nextStatus: ShootItemStatus = value.action === 'remove' ? 'cancelled' : value.action;
      db.transaction(() => {
        const changed = db.update(tables.shootContents).set({
          shootItemStatus: nextStatus,
          missingShots: nextStatus === 'missing_shots' ? value.missingShots : '',
          note: value.note || (value.action === 'remove' ? '从尚未执行的拍摄中移除' : item.note),
          updatedAt: at,
        }).where(and(
          eq(tables.shootContents.organizationId, organizationId), eq(tables.shootContents.id, item.id),
          eq(tables.shootContents.shootItemStatus, item.shootItemStatus), eq(tables.shootContents.updatedAt, item.updatedAt),
        )).run();
        if (changed.changes !== 1) throw new ApiError(409, 'STALE_SHOOT_ITEM', 'Checklist 已变化，请刷新后重试');
        if (nextStatus === 'shot') {
          transitionContent(content, 'SHOT', item.id, '拍摄 Checklist 已完成', at);
        } else if (nextStatus === 'cancelled') {
          transitionContent(content, 'APPROVED', item.id, value.note || '从拍摄排期中移除', at);
        } else if (nextStatus === 'rescheduled' && targetShoot) {
          const targetItemId = crypto.randomUUID();
          db.insert(tables.shootContents).values({
            id: targetItemId, organizationId, shootId: targetShoot.id, contentId: content.id,
            approvedScriptVersionId: item.approvedScriptVersionId, shootItemStatus: 'planned', missingShots: '',
            note: `由 ${shoot.shootDate} 拍摄改期`, isDemo: item.isDemo && targetShoot.isDemo,
            createdAt: at, updatedAt: at,
          }).run();
          recomputeShoot(targetShoot.id, at);
        }
        recomputeShoot(shoot.id, at);
        writeAudit(`shoot.item_${value.action}`, 'shoot_content', item.id, {
          shootId: shoot.id, contentId: content.id, newShootId: targetShoot?.id ?? null,
        }, item.isDemo);
      });
      return detail(shoot.id);
    },

    progress(shootId: string) {
      const shoot = authorizedShoot(shootId);
      const statuses = db.select({ status: tables.shootContents.shootItemStatus }).from(tables.shootContents).where(and(
        eq(tables.shootContents.organizationId, organizationId), eq(tables.shootContents.shootId, shoot.id),
      )).all().map((row) => row.status);
      return shootProgress(statuses);
    },
  };
}
