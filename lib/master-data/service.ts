import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { z } from 'zod';
import * as tables from '@/db/schema';
import { ApiError } from '@/lib/api/envelope';
import { permissionService } from '@/lib/auth/permissions';
import {
  accountDetailSchema, accountQuerySchema, accountSchema, brandSchema, clientDetailSchema, clientListSchema,
  clientQuerySchema, clientSchema, createAccountSchema, createBrandSchema, createClientSchema, createStoreSchema,
  hierarchySchema, storeSchema, updateAccountSchema, updateBrandSchema, updateClientSchema, updateStoreSchema,
} from './contracts';

type Database = BetterSQLite3Database<typeof tables>;
const { clients, brands, stores, accounts, users, auditLogs } = tables;
const missing = () => new ApiError(404, 'NOT_FOUND', '记录不存在或不属于当前组织');

// Only call with a trusted server context. Never derive these IDs from the request body or headers.
export function masterDataService(db: Database, organizationId: string, userId: string) {
  const permissions = permissionService(db, organizationId, userId);
  const organization = permissions.organization;
  const access = { canWrite: permissions.canWriteMasterData };

  const client = (id: string, authorize = true) => {
    const row = db.select().from(clients).where(and(eq(clients.organizationId, organizationId), eq(clients.id, z.uuid().parse(id)))).get();
    if (!row) throw missing();
    if (authorize) permissions.requireClientRead(row.id);
    return clientSchema.parse(row);
  };
  const brand = (id: string, authorize = true) => {
    const row = db.select().from(brands).where(and(eq(brands.organizationId, organizationId), eq(brands.id, z.uuid().parse(id)))).get();
    if (!row) throw missing();
    if (authorize) permissions.requireClientRead(row.clientId);
    return brandSchema.parse(row);
  };
  const store = (id: string, authorize = true) => {
    const row = db.select().from(stores).where(and(eq(stores.organizationId, organizationId), eq(stores.id, z.uuid().parse(id)))).get();
    if (!row) throw missing();
    if (authorize) permissions.requireClientRead(brand(row.brandId, false).clientId);
    return storeSchema.parse(row);
  };
  const account = (id: string, authorize = true) => {
    const row = db.select().from(accounts).where(and(eq(accounts.organizationId, organizationId), eq(accounts.id, z.uuid().parse(id)))).get();
    if (!row) throw missing();
    if (authorize) permissions.requireClientRead(row.clientId);
    return accountSchema.parse(row);
  };
  const validateOwner = (id: string | null) => {
    if (id && !db.select().from(users).where(and(eq(users.organizationId, organizationId), eq(users.id, id))).get()) throw missing();
  };
  const validateHierarchy = (value: { clientId: string; brandId: string; storeId: string }) => {
    client(value.clientId);
    const b = brand(value.brandId);
    const s = store(value.storeId);
    if (b.clientId !== value.clientId || s.brandId !== value.brandId)
      throw new ApiError(409, 'HIERARCHY_MISMATCH', '客户、品牌和门店必须属于同一条业务层级');
  };
  const metadata = () => {
    const now = new Date().toISOString();
    return { id: crypto.randomUUID(), organizationId, isDemo: false, createdAt: now, updatedAt: now };
  };
  const audit = (entityType: string, entityId: string, action: string) => {
    db.insert(auditLogs).values({
      id: crypto.randomUUID(), organizationId, userId, entityType, entityId, action,
      metadataJson: JSON.stringify({ source: 'master_data' }), isDemo: false, createdAt: new Date().toISOString(),
    }).run();
  };
  const canonicalDates = <T extends { contractStart?: string | null; contractEnd?: string | null }>(value: T): T => ({
    ...value,
    ...(value.contractStart ? { contractStart: new Date(value.contractStart).toISOString() } : {}),
    ...(value.contractEnd ? { contractEnd: new Date(value.contractEnd).toISOString() } : {}),
  });

  return {
    organization,
    listClients(input: unknown) {
      const query = clientQuerySchema.parse(input);
      if (query.ownerUserId) validateOwner(query.ownerUserId);
      const readableClientIds = permissions.readableClientIds();
      const predicates = [eq(clients.organizationId, organizationId)];
      if (readableClientIds) predicates.push(readableClientIds.length ? inArray(clients.id, readableClientIds) : sql`0 = 1`);
      // instr treats SQL wildcard characters literally; all values remain bound parameters.
      if (query.search) predicates.push(sql`instr(lower(${clients.clientName}), lower(${query.search})) > 0`);
      if (query.industry) predicates.push(eq(clients.industry, query.industry));
      if (query.ownerUserId) predicates.push(eq(clients.ownerUserId, query.ownerUserId));
      if (query.cooperationStatus) predicates.push(eq(clients.cooperationStatus, query.cooperationStatus));
      if (query.status) predicates.push(eq(clients.status, query.status));
      return db.transaction(() => {
        const visiblePredicates = [eq(clients.organizationId, organizationId)];
        if (readableClientIds) visiblePredicates.push(readableClientIds.length ? inArray(clients.id, readableClientIds) : sql`0 = 1`);
        const visibleClients = db.select({ industry: clients.industry, ownerUserId: clients.ownerUserId }).from(clients)
          .where(and(...visiblePredicates)).all();
        const ownerIds = [...new Set(visibleClients.flatMap(row => row.ownerUserId ? [row.ownerUserId] : []))];
        return clientListSchema.parse({
          items: db.select().from(clients).where(and(...predicates)).orderBy(desc(clients.createdAt), asc(clients.id))
            .limit(query.pageSize).offset((query.page - 1) * query.pageSize).all(),
          total: db.select({ value: count() }).from(clients).where(and(...predicates)).get()?.value ?? 0,
          page: query.page, pageSize: query.pageSize,
          filters: {
            industries: [...new Set(visibleClients.map(row => row.industry))].sort(),
            owners: readableClientIds === null
              ? db.select().from(users).where(eq(users.organizationId, organizationId)).orderBy(asc(users.name)).all()
              : ownerIds.length ? db.select().from(users).where(and(
                eq(users.organizationId, organizationId), inArray(users.id, ownerIds),
              )).orderBy(asc(users.name)).all() : [],
          },
          permissions: access,
        });
      });
    },
    clientDetail(id: string) {
      return db.transaction(() => {
        const row = client(id);
        const bs = db.select().from(brands).where(and(eq(brands.organizationId, organizationId), eq(brands.clientId, id))).all();
        return clientDetailSchema.parse({
          client: row,
          owner: row.ownerUserId ? db.select().from(users).where(and(eq(users.organizationId, organizationId), eq(users.id, row.ownerUserId))).get() ?? null : null,
          brands: bs,
          stores: bs.length ? db.select().from(stores).where(and(eq(stores.organizationId, organizationId), inArray(stores.brandId, bs.map(b => b.id)))).all() : [],
          accounts: db.select().from(accounts).where(and(eq(accounts.organizationId, organizationId), eq(accounts.clientId, id))).all(),
          permissions: access,
        });
      });
    },
    createClient(input: unknown) {
      permissions.require('master_data.write');
      const value = canonicalDates(createClientSchema.parse(input));
      return db.transaction(() => {
        validateOwner(value.ownerUserId);
        const row = clientSchema.parse({ ...value, ...metadata() });
        db.insert(clients).values(row).run();
        audit('client', row.id, 'client.created');
        return row;
      });
    },
    updateClient(id: string, input: unknown) {
      permissions.require('master_data.write');
      const value = canonicalDates(updateClientSchema.parse(input));
      return db.transaction(() => {
        const row = clientSchema.parse({ ...client(id), ...value, updatedAt: new Date().toISOString() });
        validateOwner(row.ownerUserId);
        db.update(clients).set(row).where(and(eq(clients.organizationId, organizationId), eq(clients.id, id))).run();
        audit('client', id, 'client.updated');
        return row;
      });
    },
    createBrand(input: unknown) {
      permissions.require('master_data.write');
      const value = createBrandSchema.parse(input);
      return db.transaction(() => {
        client(value.clientId);
        const row = brandSchema.parse({ ...value, ...metadata() });
        db.insert(brands).values(row).run();
        audit('brand', row.id, 'brand.created');
        return row;
      });
    },
    updateBrand(id: string, input: unknown) {
      permissions.require('master_data.write');
      const value = updateBrandSchema.parse(input);
      return db.transaction(() => {
        const current = brand(id);
        if (value.clientId && value.clientId !== current.clientId)
          throw new ApiError(409, 'PARENT_IMMUTABLE', '品牌创建后不可更换所属客户');
        client(current.clientId);
        const row = brandSchema.parse({ ...current, ...value, updatedAt: new Date().toISOString() });
        db.update(brands).set(row).where(and(eq(brands.organizationId, organizationId), eq(brands.id, id))).run();
        audit('brand', id, 'brand.updated');
        return row;
      });
    },
    createStore(input: unknown) {
      permissions.require('master_data.write');
      const value = createStoreSchema.parse(input);
      return db.transaction(() => {
        brand(value.brandId);
        const row = storeSchema.parse({ ...value, ...metadata() });
        db.insert(stores).values(row).run();
        audit('store', row.id, 'store.created');
        return row;
      });
    },
    updateStore(id: string, input: unknown) {
      permissions.require('master_data.write');
      const value = updateStoreSchema.parse(input);
      return db.transaction(() => {
        const current = store(id);
        if (value.brandId && value.brandId !== current.brandId)
          throw new ApiError(409, 'PARENT_IMMUTABLE', '门店创建后不可更换所属品牌');
        brand(current.brandId);
        const row = storeSchema.parse({ ...current, ...value, updatedAt: new Date().toISOString() });
        db.update(stores).set(row).where(and(eq(stores.organizationId, organizationId), eq(stores.id, id))).run();
        audit('store', id, 'store.updated');
        return row;
      });
    },
    listAccounts(input: unknown) {
      const query = accountQuerySchema.parse(input);
      const readableClientIds = permissions.readableClientIds();
      const selectedClient = query.clientId ? client(query.clientId) : null;
      const selectedBrand = query.brandId ? brand(query.brandId) : null;
      const selectedStore = query.storeId ? store(query.storeId) : null;
      if (selectedClient && selectedBrand && selectedBrand.clientId !== selectedClient.id)
        throw new ApiError(409, 'HIERARCHY_MISMATCH', '所选品牌不属于所选客户');
      if (selectedBrand && selectedStore && selectedStore.brandId !== selectedBrand.id)
        throw new ApiError(409, 'HIERARCHY_MISMATCH', '所选门店不属于所选品牌');
      if (selectedClient && selectedStore) {
        const parentBrand = selectedBrand ?? brand(selectedStore.brandId);
        if (parentBrand.clientId !== selectedClient.id)
          throw new ApiError(409, 'HIERARCHY_MISMATCH', '所选门店不属于所选客户');
      }
      const predicates = [eq(accounts.organizationId, organizationId)];
      if (readableClientIds) predicates.push(readableClientIds.length ? inArray(accounts.clientId, readableClientIds) : sql`0 = 1`);
      if (query.clientId) predicates.push(eq(accounts.clientId, query.clientId));
      if (query.brandId) predicates.push(eq(accounts.brandId, query.brandId));
      if (query.storeId) predicates.push(eq(accounts.storeId, query.storeId));
      if (query.status) predicates.push(eq(accounts.status, query.status));
      // Include empty parents so users can progressively create the hierarchy.
      return db.transaction(() => {
        const visibleClients = readableClientIds === null
          ? db.select().from(clients).where(eq(clients.organizationId, organizationId)).orderBy(asc(clients.clientName)).all()
          : readableClientIds.length
            ? db.select().from(clients).where(and(eq(clients.organizationId, organizationId), inArray(clients.id, readableClientIds))).orderBy(asc(clients.clientName)).all()
            : [];
        const clientIds = visibleClients.map(row => row.id);
        const visibleBrands = clientIds.length ? db.select().from(brands).where(and(
          eq(brands.organizationId, organizationId), inArray(brands.clientId, clientIds),
        )).orderBy(asc(brands.brandName)).all() : [];
        const brandIds = visibleBrands.map(row => row.id);
        return hierarchySchema.parse({
          clients: visibleClients,
          brands: visibleBrands,
          stores: brandIds.length ? db.select().from(stores).where(and(
            eq(stores.organizationId, organizationId), inArray(stores.brandId, brandIds),
          )).orderBy(asc(stores.storeName)).all() : [],
          accounts: db.select().from(accounts).where(and(...predicates)).orderBy(asc(accounts.accountName)).all(),
          permissions: access,
        });
      });
    },
    accountDetail(id: string) {
      return db.transaction(() => {
        const row = account(id);
        const contentStats = db.select({
          total: count(),
          published: sql<number>`sum(case when ${tables.contents.status} in ('PUBLISHED', 'REVIEWED') then 1 else 0 end)`,
        }).from(tables.contents).where(and(
          eq(tables.contents.organizationId, organizationId),
          eq(tables.contents.accountId, row.id),
        )).get();
        return accountDetailSchema.parse({
          account: row, client: client(row.clientId), brand: brand(row.brandId), store: store(row.storeId),
          contentStats: {
            total: contentStats?.total ?? 0,
            published: contentStats?.published ?? 0,
            implemented: true,
          },
          permissions: access,
        });
      });
    },
    createAccount(input: unknown) {
      permissions.require('master_data.write');
      const value = createAccountSchema.parse(input);
      return db.transaction(() => {
        validateHierarchy(value);
        const row = accountSchema.parse({ ...value, ...metadata() });
        db.insert(accounts).values(row).run();
        audit('account', row.id, 'account.created');
        return row;
      });
    },
    updateAccount(id: string, input: unknown) {
      permissions.require('master_data.write');
      const value = updateAccountSchema.parse(input);
      return db.transaction(() => {
        const row = accountSchema.parse({ ...account(id), ...value, updatedAt: new Date().toISOString() });
        validateHierarchy(row);
        db.update(accounts).set(row).where(and(eq(accounts.organizationId, organizationId), eq(accounts.id, id))).run();
        audit('account', id, 'account.updated');
        return row;
      });
    },
  };
}
