import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '@/db/schema';
import { brands, organizations, users } from '@/db/schema';
import { ApiError } from '@/lib/api/envelope';
import { masterDataService } from '@/lib/master-data/service';

const ids = {
  organizationA: '0198f744-8e18-7ae2-a780-52a0e20c2931',
  organizationB: '0198f744-8e18-7ae2-a780-52a0e20c2932',
  userA: '0198f744-8e18-7ae2-a780-52a0e20c2933',
  userB: '0198f744-8e18-7ae2-a780-52a0e20c2934',
} as const;

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

beforeEach(() => {
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  for (const file of readdirSync(resolve('drizzle')).filter((name) => name.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(resolve('drizzle', file), 'utf8').replaceAll('--> statement-breakpoint', ''));
  }
  db = drizzle(sqlite, { schema });
  const now = '2026-09-07T01:00:00.000Z';
  db.insert(organizations).values([
    { id: ids.organizationA, name: '组织 A', status: 'active', isDemo: false, createdAt: now, updatedAt: now },
    { id: ids.organizationB, name: '组织 B', status: 'active', isDemo: false, createdAt: now, updatedAt: now },
  ]).run();
  db.insert(users).values([
    { id: ids.userA, organizationId: ids.organizationA, name: '负责人 A', role: 'owner', status: 'active', isDemo: false, createdAt: now, updatedAt: now },
    { id: ids.userB, organizationId: ids.organizationB, name: '负责人 B', role: 'owner', status: 'active', isDemo: false, createdAt: now, updatedAt: now },
  ]).run();
});

afterEach(() => sqlite.close());

describe('master data organization and hierarchy boundaries', () => {
  it('keeps every read and write scoped to the trusted organization', () => {
    const organizationA = masterDataService(db, ids.organizationA, ids.userA);
    const organizationB = masterDataService(db, ids.organizationB, ids.userB);
    const client = organizationA.createClient({ clientName: '客户 A', industry: '餐饮', ownerUserId: ids.userA });
    const brand = organizationA.createBrand({ clientId: client.id, brandName: '品牌 A' });
    const store = organizationA.createStore({ brandId: brand.id, storeName: '门店 A' });
    const account = organizationA.createAccount({
      clientId: client.id, brandId: brand.id, storeId: store.id, accountName: '账号 A',
    });

    expect(organizationA.accountDetail(account.id).client.id).toBe(client.id);
    expectApiError(() => organizationB.clientDetail(client.id), 404, 'NOT_FOUND');
    expectApiError(() => organizationB.accountDetail(account.id), 404, 'NOT_FOUND');
    expectApiError(() => organizationA.listClients({ ownerUserId: ids.userB }), 404, 'NOT_FOUND');

    expect(() => db.insert(brands).values({
      id: crypto.randomUUID(), organizationId: ids.organizationB, clientId: client.id,
      brandName: '越权品牌', industry: '', subIndustry: '', city: '', brandPositioning: '',
      targetAudienceJson: [], coreProductsJson: [], coreSellingPointsJson: [], brandToneJson: [],
      forbiddenTopicsJson: [], status: 'active', isDemo: false,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }).run()).toThrow(/FOREIGN KEY constraint failed/);
  });

  it('rejects mismatched hierarchy IDs and invalid numeric bounds', () => {
    const service = masterDataService(db, ids.organizationA, ids.userA);
    const clientA = service.createClient({ clientName: '客户 A', industry: '餐饮' });
    const clientB = service.createClient({ clientName: '客户 B', industry: '零售' });
    const brandA = service.createBrand({ clientId: clientA.id, brandName: '品牌 A' });
    const storeA = service.createStore({ brandId: brandA.id, storeName: '门店 A' });

    expectApiError(() => service.createAccount({
      clientId: clientB.id, brandId: brandA.id, storeId: storeA.id, accountName: '错层级账号',
    }), 409, 'HIERARCHY_MISMATCH');
    expectApiError(() => service.listAccounts({ clientId: clientB.id, brandId: brandA.id }), 409, 'HIERARCHY_MISMATCH');
    expect(() => service.createClient({ clientName: '负目标', industry: '餐饮', monthlyContentTarget: -1 })).toThrow();
    expect(() => service.createAccount({
      clientId: clientA.id, brandId: brandA.id, storeId: storeA.id, accountName: '负粉丝', followers: -1,
    })).toThrow();
  });

  it('filters and paginates deterministically while inactive records remain stored', () => {
    const service = masterDataService(db, ids.organizationA, ids.userA);
    const created = Array.from({ length: 11 }, (_, index) => service.createClient({
      clientName: `餐饮客户 ${String(index + 1).padStart(2, '0')}`,
      industry: '餐饮', ownerUserId: ids.userA, cooperationStatus: index % 2 ? 'lead' : 'active',
    }));
    service.createClient({ clientName: '零售客户', industry: '零售' });

    const page = service.listClients({ industry: '餐饮', page: 3, pageSize: 5 });
    expect(page.total).toBe(11);
    expect(page.items).toHaveLength(1);
    expect(page.page).toBe(3);
    expect(page.filters.industries).toEqual(['零售', '餐饮']);

    const inactive = service.updateClient(created[0].id, { status: 'inactive' });
    expect(inactive.status).toBe('inactive');
    expect(service.clientDetail(inactive.id).client.status).toBe('inactive');
    expect(service.listClients({ status: 'inactive' }).items.map((item) => item.id)).toContain(inactive.id);
  });
});
