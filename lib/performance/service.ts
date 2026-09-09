import { createHash } from 'node:crypto';
import { and, asc, count, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { z } from 'zod';
import * as tables from '@/db/schema';
import { ApiError } from '@/lib/api/envelope';
import { permissionService } from '@/lib/auth/permissions';
import {
  analyticsContentResultSchema,
  analyticsQuerySchema,
  createPerformanceSnapshotSchema,
  createPublishSchema,
  performanceImportBatchSchema,
  performanceImportCommitInputSchema,
  performanceImportCommitResultSchema,
  performanceImportPreviewInputSchema,
  performanceImportPreviewItemSchema,
  performanceImportPreviewSchema,
  performanceSnapshotViewSchema,
  publishResultSchema,
  publishSchema,
  contentPerformanceSchema,
  type CreatePerformanceSnapshot,
  type PerformanceImportPreviewItem,
} from './contracts';

type Database = BetterSQLite3Database<typeof tables>;
type PreviewPayload = { headers: string[]; items: PerformanceImportPreviewItem[] };
const MAX_IMPORT_ROWS = 500;
const missing = () => new ApiError(404, 'NOT_FOUND', '记录不存在或不属于当前组织');

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function safeRatio(numerator: number | null, denominator: number | null, multiplier = 1) {
  if (numerator === null || denominator === null || denominator === 0) return null;
  const value = numerator / denominator * multiplier;
  return Number.isFinite(value) ? value : null;
}

export function calculateDerivedMetrics(snapshot: CreatePerformanceSnapshot) {
  const engagementParts = [snapshot.likes, snapshot.comments, snapshot.shares, snapshot.favorites];
  const engagement = engagementParts.some(value => value === null)
    ? null
    : engagementParts.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  return {
    engagementRate: safeRatio(engagement, snapshot.views),
    groupbuyCtr: safeRatio(snapshot.groupbuyClicks, snapshot.views),
    orderConversionRate: safeRatio(snapshot.orders, snapshot.groupbuyClicks),
    gmvPer1000Views: safeRatio(snapshot.gmv, snapshot.views, 1000),
  };
}

function parseCsv(payload: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < payload.length; index += 1) {
    const character = payload[index];
    if (quoted) {
      if (character === '"' && payload[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else cell += character;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === ',') {
      row.push(cell);
      cell = '';
    } else if (character === '\n') {
      row.push(cell.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      cell = '';
    } else cell += character;
  }
  if (quoted) throw new ApiError(400, 'CSV_INVALID', 'CSV 存在未闭合的引号');
  if (cell.length || row.length) {
    row.push(cell.replace(/\r$/, ''));
    rows.push(row);
  }
  if (rows.length < 2) throw new ApiError(400, 'CSV_EMPTY', 'CSV 必须包含表头和至少一行数据');
  const headers = rows[0].map((value, index) => (index === 0 ? value.replace(/^\uFEFF/, '') : value).trim());
  if (headers.some(header => !header)) throw new ApiError(400, 'CSV_HEADER_EMPTY', 'CSV 表头不能为空');
  if (new Set(headers).size !== headers.length) throw new ApiError(400, 'CSV_HEADERS_DUPLICATED', 'CSV 表头不能重复');
  const records = rows.slice(1).filter(values => values.some(value => value.trim())).map(values =>
    Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])),
  );
  if (!records.length) throw new ApiError(400, 'CSV_EMPTY', 'CSV 没有数据行');
  if (records.length > MAX_IMPORT_ROWS)
    throw new ApiError(413, 'IMPORT_TOO_MANY_ROWS', `单次最多预览 ${MAX_IMPORT_ROWS} 行`);
  return { headers, records };
}

function parseTimestamp(value: string) {
  const date = new Date(value.trim());
  if (!value.trim() || Number.isNaN(date.getTime())) throw new Error('snapshot_time 不是有效时间');
  return date.toISOString();
}

function parseMetric(value: string | undefined, field: string, integer: boolean) {
  if (value === undefined || value.trim() === '') return null;
  const parsed = Number(value.trim());
  if (!Number.isFinite(parsed)) throw new Error(`${field} 必须是有效数字`);
  if (parsed < 0) throw new Error(`${field} 不得小于 0`);
  if (integer && !Number.isInteger(parsed)) throw new Error(`${field} 必须是整数`);
  return parsed;
}

export function performanceService(
  db: Database,
  organizationId: string,
  userId: string,
  runtime: { now?: () => Date } = {},
) {
  const validOrganizationId = z.uuid().parse(organizationId);
  const validUserId = z.uuid().parse(userId);
  const permissions = permissionService(db, validOrganizationId, validUserId);
  const now = runtime.now ?? (() => new Date());
  const timestamp = () => now().toISOString();
  const audit = (entityType: string, entityId: string, action: string) => db.insert(tables.auditLogs).values({
    id: crypto.randomUUID(), organizationId: validOrganizationId, userId: validUserId,
    entityType, entityId, action, metadataJson: JSON.stringify({ source: 'publish_performance' }),
    isDemo: false, createdAt: timestamp(),
  }).run();
  const contentById = (id: string, write = false) => {
    const row = db.select().from(tables.contents).where(and(
      eq(tables.contents.organizationId, validOrganizationId), eq(tables.contents.id, z.uuid().parse(id)),
    )).get();
    if (!row) throw missing();
    if (write) permissions.requireClientWrite(row.clientId);
    else permissions.requireClientRead(row.clientId);
    return row;
  };
  const publishById = (id: string, write = false) => {
    const publish = db.select().from(tables.publishes).where(and(
      eq(tables.publishes.organizationId, validOrganizationId), eq(tables.publishes.id, z.uuid().parse(id)),
    )).get();
    if (!publish) throw missing();
    const content = contentById(publish.contentId, write);
    return { publish: publishSchema.parse(publish), content };
  };
  const snapshotView = (row: typeof tables.performanceSnapshots.$inferSelect) => {
    const metrics = createPerformanceSnapshotSchema.parse({
      snapshotTime: row.snapshotTime, views: row.views, likes: row.likes, comments: row.comments,
      shares: row.shares, favorites: row.favorites, profileVisits: row.profileVisits,
      groupbuyClicks: row.groupbuyClicks, orders: row.orders, gmv: row.gmv,
    });
    return performanceSnapshotViewSchema.parse({ ...row, derived: calculateDerivedMetrics(metrics) });
  };
  const batchView = (row: typeof tables.performanceImportBatches.$inferSelect) => {
    const { previewJson: _preview, ...safe } = performanceImportBatchSchema.parse(row);
    return safe;
  };

  return {
    createPublish(contentId: string, input: unknown) {
      const value = createPublishSchema.parse(input);
      return db.transaction(() => {
        const content = contentById(contentId, true);
        if (content.status !== 'READY_TO_PUBLISH')
          throw new ApiError(409, 'PUBLISH_STATUS_INVALID', '只有待发布内容可以创建发布记录');
        if (!content.activeApprovedEditVersionId)
          throw new ApiError(409, 'APPROVED_EDIT_REQUIRED', '发布前必须存在活动的已批准成片版本');
        const approvedEdit = db.select({ id: tables.editVersions.id }).from(tables.editVersions).where(and(
          eq(tables.editVersions.organizationId, validOrganizationId),
          eq(tables.editVersions.contentId, content.id),
          eq(tables.editVersions.id, content.activeApprovedEditVersionId),
        )).get();
        if (!approvedEdit) throw new ApiError(409, 'APPROVED_EDIT_INVALID', '活动批准成片不属于当前内容');
        if (db.select({ id: tables.publishes.id }).from(tables.publishes).where(and(
          eq(tables.publishes.organizationId, validOrganizationId),
          eq(tables.publishes.contentId, content.id), eq(tables.publishes.status, 'active'),
        )).get()) throw new ApiError(409, 'ACTIVE_PUBLISH_EXISTS', '该内容已存在有效发布记录');
        if (value.platformPostId && db.select({ id: tables.publishes.id }).from(tables.publishes).where(and(
          eq(tables.publishes.organizationId, validOrganizationId), eq(tables.publishes.platform, value.platform),
          eq(tables.publishes.platformPostId, value.platformPostId),
        )).get()) throw new ApiError(409, 'PLATFORM_POST_ID_EXISTS', '该平台作品 ID 已存在');
        const at = timestamp();
        const publish = publishSchema.parse({
          id: crypto.randomUUID(), organizationId: validOrganizationId, contentId: content.id,
          ...value, status: 'active', createdBy: validUserId, isDemo: false, createdAt: at,
        });
        db.insert(tables.publishes).values(publish).run();
        const updated = db.update(tables.contents).set({
          status: 'PUBLISHED', publishedAt: value.publishedAt, updatedAt: at,
        }).where(and(
          eq(tables.contents.organizationId, validOrganizationId), eq(tables.contents.id, content.id),
          eq(tables.contents.status, 'READY_TO_PUBLISH'),
          eq(tables.contents.activeApprovedEditVersionId, content.activeApprovedEditVersionId),
        )).run();
        if (updated.changes !== 1) throw new ApiError(409, 'CONTENT_STATE_CHANGED', '内容状态已变化，请刷新后重试');
        db.insert(tables.contentStatusLogs).values({
          id: crypto.randomUUID(), organizationId: validOrganizationId, contentId: content.id,
          previousStatus: 'READY_TO_PUBLISH', newStatus: 'PUBLISHED', triggerType: 'publish',
          triggerId: publish.id, operatorId: validUserId, reason: `已人工登记${value.platform === 'douyin' ? '抖音' : value.platform}发布记录`,
          isDemo: false, createdAt: at,
        }).run();
        audit('publish', publish.id, 'publish.created');
        return publishResultSchema.parse({ publish, content: { id: content.id, status: 'PUBLISHED', publishedAt: value.publishedAt } });
      });
    },

    contentPerformance(contentId: string) {
      return db.transaction(() => {
        const content = contentById(contentId);
        const publish = db.select().from(tables.publishes).where(and(
          eq(tables.publishes.organizationId, validOrganizationId), eq(tables.publishes.contentId, content.id),
          eq(tables.publishes.status, 'active'),
        )).get();
        const snapshots = publish ? db.select().from(tables.performanceSnapshots).where(and(
          eq(tables.performanceSnapshots.organizationId, validOrganizationId),
          eq(tables.performanceSnapshots.publishId, publish.id),
        )).orderBy(desc(tables.performanceSnapshots.snapshotTime), desc(tables.performanceSnapshots.id)).all().map(snapshotView) : [];
        return contentPerformanceSchema.parse({
          content: { id: content.id, title: content.title, status: content.status },
          publish: publish ? publishSchema.parse(publish) : null,
          snapshots,
          permissions: {
            canPublish: permissions.canWriteClient(content.clientId) && content.status === 'READY_TO_PUBLISH' && Boolean(content.activeApprovedEditVersionId),
            canWritePerformance: permissions.canWriteClient(content.clientId) && Boolean(publish),
          },
        });
      });
    },

    addSnapshot(publishId: string, input: unknown) {
      const value = createPerformanceSnapshotSchema.parse(input);
      return db.transaction(() => {
        const { publish } = publishById(publishId, true);
        if (publish.status !== 'active') throw new ApiError(409, 'PUBLISH_INACTIVE', '停用的发布记录不能新增数据快照');
        if (db.select({ id: tables.performanceSnapshots.id }).from(tables.performanceSnapshots).where(and(
          eq(tables.performanceSnapshots.organizationId, validOrganizationId),
          eq(tables.performanceSnapshots.publishId, publish.id),
          eq(tables.performanceSnapshots.snapshotTime, value.snapshotTime),
        )).get()) throw new ApiError(409, 'SNAPSHOT_TIME_EXISTS', '该发布时间点的数据快照已存在');
        const row = {
          id: crypto.randomUUID(), organizationId: validOrganizationId, publishId: publish.id,
          ...value, isDemo: false, createdAt: timestamp(),
        };
        db.insert(tables.performanceSnapshots).values(row).run();
        audit('performance_snapshot', row.id, 'performance_snapshot.created');
        return snapshotView(row);
      });
    },

    listAnalytics(input: unknown) {
      const query = analyticsQuerySchema.parse(input);
      const readableClientIds = permissions.readableClientIds();
      const accountPredicates = [eq(tables.accounts.organizationId, validOrganizationId)];
      if (readableClientIds)
        accountPredicates.push(readableClientIds.length ? inArray(tables.accounts.clientId, readableClientIds) : sql`0 = 1`);
      const options = db.select({
        id: tables.accounts.id, accountName: tables.accounts.accountName, clientName: tables.clients.clientName,
      }).from(tables.accounts).innerJoin(tables.clients, and(
        eq(tables.clients.organizationId, validOrganizationId), eq(tables.clients.id, tables.accounts.clientId),
      )).where(and(...accountPredicates)).orderBy(asc(tables.clients.clientName), asc(tables.accounts.accountName)).all();
      if (query.accountId && !options.some(option => option.id === query.accountId)) {
        const exists = db.select({ id: tables.accounts.id, clientId: tables.accounts.clientId }).from(tables.accounts).where(and(
          eq(tables.accounts.organizationId, validOrganizationId), eq(tables.accounts.id, query.accountId),
        )).get();
        if (!exists) throw missing();
        permissions.requireClientRead(exists.clientId);
      }
      const predicates = [
        eq(tables.performanceSnapshots.organizationId, validOrganizationId),
        eq(tables.publishes.organizationId, validOrganizationId),
        eq(tables.publishes.status, 'active' as const),
        eq(tables.contents.organizationId, validOrganizationId),
      ];
      if (readableClientIds)
        predicates.push(readableClientIds.length ? inArray(tables.contents.clientId, readableClientIds) : sql`0 = 1`);
      if (query.accountId) predicates.push(eq(tables.contents.accountId, query.accountId));
      if (query.from) predicates.push(gte(tables.performanceSnapshots.snapshotTime, query.from));
      if (query.to) predicates.push(lte(tables.performanceSnapshots.snapshotTime, query.to));
      if (query.contentType) predicates.push(eq(tables.contents.contentType, query.contentType));
      if (query.hookType) predicates.push(eq(tables.contents.hookType, query.hookType));
      if (query.contentGoal) predicates.push(eq(tables.contents.contentGoal, query.contentGoal));
      const base = db.select({
        snapshot: tables.performanceSnapshots,
        publish: tables.publishes,
        content: {
          id: tables.contents.id, title: tables.contents.title, contentType: tables.contents.contentType,
          contentGoal: tables.contents.contentGoal, hookType: tables.contents.hookType,
        },
        account: { id: tables.accounts.id, accountName: tables.accounts.accountName, clientName: tables.clients.clientName },
      }).from(tables.performanceSnapshots)
        .innerJoin(tables.publishes, and(
          eq(tables.publishes.organizationId, tables.performanceSnapshots.organizationId),
          eq(tables.publishes.id, tables.performanceSnapshots.publishId),
        ))
        .innerJoin(tables.contents, and(
          eq(tables.contents.organizationId, tables.publishes.organizationId),
          eq(tables.contents.id, tables.publishes.contentId),
        ))
        .innerJoin(tables.accounts, and(
          eq(tables.accounts.organizationId, tables.contents.organizationId),
          eq(tables.accounts.id, tables.contents.accountId),
        ))
        .innerJoin(tables.clients, and(
          eq(tables.clients.organizationId, tables.contents.organizationId),
          eq(tables.clients.id, tables.contents.clientId),
        )).where(and(...predicates));
      const items = base.orderBy(desc(tables.performanceSnapshots.snapshotTime), asc(tables.performanceSnapshots.id))
        .limit(query.pageSize).offset((query.page - 1) * query.pageSize).all().map(row => ({
          ...row, snapshot: snapshotView(row.snapshot), publish: publishSchema.parse(row.publish),
        }));
      const total = db.select({ value: count() }).from(tables.performanceSnapshots)
        .innerJoin(tables.publishes, and(
          eq(tables.publishes.organizationId, tables.performanceSnapshots.organizationId),
          eq(tables.publishes.id, tables.performanceSnapshots.publishId),
        ))
        .innerJoin(tables.contents, and(
          eq(tables.contents.organizationId, tables.publishes.organizationId),
          eq(tables.contents.id, tables.publishes.contentId),
        )).where(and(...predicates)).get()?.value ?? 0;
      return analyticsContentResultSchema.parse({
        items, total, page: query.page, pageSize: query.pageSize, options: { accounts: options },
        permissions: { canImport: options.some(option => permissions.canWriteClient(
          db.select({ clientId: tables.accounts.clientId }).from(tables.accounts).where(and(
            eq(tables.accounts.organizationId, validOrganizationId), eq(tables.accounts.id, option.id),
          )).get()!.clientId,
        )) },
      });
    },

    previewImport(input: unknown) {
      const value = performanceImportPreviewInputSchema.parse(input);
      const parsed = parseCsv(value.payload);
      const mappedHeaders = Object.values(value.mapping).filter((header): header is string => Boolean(header));
      const missingHeaders = mappedHeaders.filter(header => !parsed.headers.includes(header));
      if (missingHeaders.length) throw new ApiError(400, 'MAPPING_HEADER_NOT_FOUND', '字段映射引用了不存在的表头', missingHeaders);
      const seen = new Set<string>();
      const items = parsed.records.map((raw, index): PerformanceImportPreviewItem => {
        const invalid = (issues: string[], partial: Partial<PerformanceImportPreviewItem> = {}) => performanceImportPreviewItemSchema.parse({
          rowNumber: index + 1, status: 'invalid', publishId: null, platformPostId: null,
          contentId: null, contentTitle: null, accountName: null, snapshot: null, issues, ...partial,
        });
        try {
          const publishIdValue = value.mapping.publishId ? raw[value.mapping.publishId]?.trim() : '';
          const platformPostIdValue = value.mapping.platformPostId ? raw[value.mapping.platformPostId]?.trim() : '';
          if (!publishIdValue && !platformPostIdValue) return invalid(['发布记录标识不能为空']);
          if (publishIdValue && !z.uuid().safeParse(publishIdValue).success) return invalid(['publish_id 不是有效 UUID']);
          const byId = publishIdValue ? db.select().from(tables.publishes).where(and(
            eq(tables.publishes.organizationId, validOrganizationId), eq(tables.publishes.id, publishIdValue),
          )).get() : null;
          const byPlatform = platformPostIdValue ? db.select().from(tables.publishes).where(and(
            eq(tables.publishes.organizationId, validOrganizationId), eq(tables.publishes.platform, 'douyin'),
            eq(tables.publishes.platformPostId, platformPostIdValue),
          )).get() : null;
          if (publishIdValue && platformPostIdValue && byId?.id !== byPlatform?.id)
            return invalid(['publish_id 与 platform_post_id 未指向同一发布记录']);
          const publish = byId ?? byPlatform;
          if (!publish) return invalid(['发布记录不存在或不属于当前组织']);
          if (publish.status !== 'active') return invalid(['发布记录已停用']);
          const content = db.select().from(tables.contents).where(and(
            eq(tables.contents.organizationId, validOrganizationId), eq(tables.contents.id, publish.contentId),
          )).get();
          if (!content) return invalid(['发布记录对应内容不存在']);
          permissions.requireClientWrite(content.clientId);
          const account = db.select({ accountName: tables.accounts.accountName }).from(tables.accounts).where(and(
            eq(tables.accounts.organizationId, validOrganizationId), eq(tables.accounts.id, content.accountId),
          )).get();
          if (!account) return invalid(['发布记录对应账号不存在']);
          const snapshot = createPerformanceSnapshotSchema.parse({
            snapshotTime: parseTimestamp(raw[value.mapping.snapshotTime] ?? ''),
            views: parseMetric(value.mapping.views ? raw[value.mapping.views] : undefined, 'views', true),
            likes: parseMetric(value.mapping.likes ? raw[value.mapping.likes] : undefined, 'likes', true),
            comments: parseMetric(value.mapping.comments ? raw[value.mapping.comments] : undefined, 'comments', true),
            shares: parseMetric(value.mapping.shares ? raw[value.mapping.shares] : undefined, 'shares', true),
            favorites: parseMetric(value.mapping.favorites ? raw[value.mapping.favorites] : undefined, 'favorites', true),
            profileVisits: parseMetric(value.mapping.profileVisits ? raw[value.mapping.profileVisits] : undefined, 'profile_visits', true),
            groupbuyClicks: parseMetric(value.mapping.groupbuyClicks ? raw[value.mapping.groupbuyClicks] : undefined, 'groupbuy_clicks', true),
            orders: parseMetric(value.mapping.orders ? raw[value.mapping.orders] : undefined, 'orders', true),
            gmv: parseMetric(value.mapping.gmv ? raw[value.mapping.gmv] : undefined, 'gmv', false),
          });
          const identity = `${publish.id}:${snapshot.snapshotTime}`;
          const partial = {
            publishId: publish.id, platformPostId: publish.platformPostId, contentId: content.id,
            contentTitle: content.title, accountName: account.accountName, snapshot,
          };
          const existing = db.select({ id: tables.performanceSnapshots.id }).from(tables.performanceSnapshots).where(and(
            eq(tables.performanceSnapshots.organizationId, validOrganizationId),
            eq(tables.performanceSnapshots.publishId, publish.id),
            eq(tables.performanceSnapshots.snapshotTime, snapshot.snapshotTime),
          )).get();
          if (existing) return performanceImportPreviewItemSchema.parse({
            rowNumber: index + 1, status: 'duplicate', ...partial, issues: ['数据库中已存在相同发布与快照时间，将跳过'],
          });
          if (seen.has(identity)) return performanceImportPreviewItemSchema.parse({
            rowNumber: index + 1, status: 'duplicate', ...partial, issues: ['本次 CSV 中发布与快照时间重复，将跳过'],
          });
          seen.add(identity);
          return performanceImportPreviewItemSchema.parse({ rowNumber: index + 1, status: 'valid', ...partial, issues: [] });
        } catch (error) {
          if (error instanceof ApiError) throw error;
          if (error instanceof z.ZodError)
            return invalid(error.issues.map(issue => `${issue.path.join('.') || '记录'}：${issue.message}`));
          return invalid([error instanceof Error ? error.message : '记录校验失败']);
        }
      });
      const counts = {
        totalRows: items.length,
        validRows: items.filter(item => item.status === 'valid').length,
        duplicateRows: items.filter(item => item.status === 'duplicate').length,
        invalidRows: items.filter(item => item.status === 'invalid').length,
      };
      const at = timestamp();
      const batch = performanceImportBatchSchema.parse({
        id: crypto.randomUUID(), organizationId: validOrganizationId,
        sourceHash: sha256(`${JSON.stringify(value.mapping)}|${value.payload}`), mappingJson: value.mapping,
        previewJson: { headers: parsed.headers, items } satisfies PreviewPayload,
        status: 'previewed', ...counts, committedRows: 0, createdBy: validUserId, isDemo: false,
        committedAt: null, createdAt: at, updatedAt: at,
      });
      return db.transaction(() => {
        db.insert(tables.performanceImportBatches).values(batch).run();
        audit('performance_import_batch', batch.id, 'performance_import.previewed');
        return performanceImportPreviewSchema.parse({
          batch: batchView(batch), items, headers: parsed.headers,
          canCommit: counts.invalidRows === 0 && counts.validRows > 0,
        });
      });
    },

    commitImport(input: unknown) {
      const { batchId } = performanceImportCommitInputSchema.parse(input);
      const batch = db.select().from(tables.performanceImportBatches).where(and(
        eq(tables.performanceImportBatches.organizationId, validOrganizationId),
        eq(tables.performanceImportBatches.id, batchId),
      )).get();
      if (!batch) throw missing();
      if (batch.status !== 'previewed') throw new ApiError(409, 'IMPORT_ALREADY_FINALIZED', '该预览批次已处理');
      if (batch.invalidRows > 0) throw new ApiError(409, 'IMPORT_HAS_INVALID_ROWS', '请修正无效行后重新预览');
      const preview = z.object({
        headers: z.array(z.string()), items: z.array(performanceImportPreviewItemSchema).max(MAX_IMPORT_ROWS),
      }).parse(batch.previewJson) as PreviewPayload;
      const validItems = preview.items.filter(item => item.status === 'valid');
      if (!validItems.length) throw new ApiError(409, 'IMPORT_NOTHING_TO_COMMIT', '没有可写入的新数据快照');
      return db.transaction(() => {
        const snapshotIds: string[] = [];
        for (const item of validItems) {
          if (!item.publishId || !item.snapshot) throw new Error('预览记录缺少发布或快照数据');
          const { publish } = publishById(item.publishId, true);
          if (publish.status !== 'active') continue;
          const existing = db.select({ id: tables.performanceSnapshots.id }).from(tables.performanceSnapshots).where(and(
            eq(tables.performanceSnapshots.organizationId, validOrganizationId),
            eq(tables.performanceSnapshots.publishId, publish.id),
            eq(tables.performanceSnapshots.snapshotTime, item.snapshot.snapshotTime),
          )).get();
          if (existing) continue;
          const row = {
            id: crypto.randomUUID(), organizationId: validOrganizationId, publishId: publish.id,
            ...item.snapshot, isDemo: false, createdAt: timestamp(),
          };
          db.insert(tables.performanceSnapshots).values(row).run();
          audit('performance_snapshot', row.id, 'performance_snapshot.imported');
          snapshotIds.push(row.id);
        }
        const at = timestamp();
        db.update(tables.performanceImportBatches).set({
          status: 'committed', committedRows: snapshotIds.length, committedAt: at, updatedAt: at,
        }).where(and(
          eq(tables.performanceImportBatches.organizationId, validOrganizationId),
          eq(tables.performanceImportBatches.id, batch.id), eq(tables.performanceImportBatches.status, 'previewed'),
        )).run();
        audit('performance_import_batch', batch.id, 'performance_import.committed');
        const committed = db.select().from(tables.performanceImportBatches).where(and(
          eq(tables.performanceImportBatches.organizationId, validOrganizationId),
          eq(tables.performanceImportBatches.id, batch.id),
        )).get()!;
        return performanceImportCommitResultSchema.parse({ batch: batchView(committed), snapshotIds });
      });
    },
  };
}
