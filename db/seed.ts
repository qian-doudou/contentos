import { and, eq } from 'drizzle-orm';
import { db, sqlite } from './client';
import { accounts, appSettings, auditLogs, brands, clients, organizations, stores, users } from './schema';
import { accountSchema, brandSchema, clientSchema, storeSchema, accountDefaults, brandDefaults, clientDefaults, storeDefaults } from '../lib/master-data/contracts';

export const DEMO_IDS = {
  organization: '0198f744-8e18-7ae2-a780-52a0e20c1931',
  owner: '0198f744-8e18-7ae2-a780-52a0e20c1932',
  operator: '0198f744-8e18-7ae2-a780-52a0e20c1933',
  photographer: '0198f744-8e18-7ae2-a780-52a0e20c1934',
  editor: '0198f744-8e18-7ae2-a780-52a0e20c1935',
  phaseSetting: '0198f744-8e18-7ae2-a780-52a0e20c1936',
  client: '0198f744-8e18-7ae2-a780-52a0e20c1941',
  brand: '0198f744-8e18-7ae2-a780-52a0e20c1942',
  store: '0198f744-8e18-7ae2-a780-52a0e20c1943',
  account: '0198f744-8e18-7ae2-a780-52a0e20c1944',
} as const;

const demoUsers = [
  { id: DEMO_IDS.owner, name: '运营负责人', role: 'owner' as const },
  { id: DEMO_IDS.operator, name: '运营A', role: 'operator' as const },
  { id: DEMO_IDS.photographer, name: '摄影A', role: 'photographer' as const },
  { id: DEMO_IDS.editor, name: '剪辑A', role: 'editor' as const },
];

export function seedDemoData(options: { reset?: boolean } = {}) {
  const now = new Date().toISOString();

  const seedTransaction = sqlite.transaction(() => {
    db.insert(organizations)
      .values({
        id: DEMO_IDS.organization,
        name: '星火本地生活运营有限公司',
        status: 'active',
        isDemo: true,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: organizations.id,
        set: { name: '星火本地生活运营有限公司', status: 'active', isDemo: true, updatedAt: now },
        setWhere: eq(organizations.isDemo, true),
      })
      .run();

    const demoOrganization = db.select({ id: organizations.id }).from(organizations)
      .where(and(eq(organizations.id, DEMO_IDS.organization), eq(organizations.isDemo, true))).get();
    if (!demoOrganization) throw new Error('Demo organization ID is already owned by a non-demo record');

    for (const member of demoUsers) {
      db.insert(users)
        .values({
          ...member,
          organizationId: DEMO_IDS.organization,
          status: 'active',
          isDemo: true,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: users.id,
          set: { name: member.name, role: member.role, status: 'active', isDemo: true, updatedAt: now },
          setWhere: and(eq(users.organizationId, DEMO_IDS.organization), eq(users.isDemo, true)),
        })
        .run();
      const demoMember = db.select({ id: users.id }).from(users)
        .where(and(eq(users.id, member.id), eq(users.organizationId, DEMO_IDS.organization), eq(users.isDemo, true))).get();
      if (!demoMember) throw new Error(`Demo user ID ${member.id} is already owned by another record`);
    }

    db.insert(appSettings)
      .values({
        id: DEMO_IDS.phaseSetting,
        organizationId: DEMO_IDS.organization,
        key: 'product.phase',
        valueJson: JSON.stringify({ phase: 2, label: '业务主数据' }),
        isSecret: false,
        isDemo: true,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [appSettings.organizationId, appSettings.key],
        set: { valueJson: JSON.stringify({ phase: 2, label: '业务主数据' }), updatedAt: now },
      })
      .run();

    const demoMetadata = { organizationId: DEMO_IDS.organization, isDemo: true, createdAt: now, updatedAt: now };
    const c = clientSchema.parse({ ...clientDefaults, ...demoMetadata, id: DEMO_IDS.client,
      clientName: '德祥楼', industry: '餐饮', subIndustry: '铜锅涮羊肉', cooperationStatus: 'active',
      ownerUserId: DEMO_IDS.owner, notes: '演示客户；合作周期与月度目标尚未录入。' });
    const b = brandSchema.parse({ ...brandDefaults, ...demoMetadata, id: DEMO_IDS.brand, clientId: c.id,
      brandName: '德祥楼', industry: '餐饮', subIndustry: '铜锅涮羊肉', city: '菏泽',
      brandPositioning: '鲁西南特色铜锅涮羊肉', coreProductsJson: ['手切羊肉', '铜锅涮'],
      coreSellingPointsJson: ['鲁西南本地羊肉', '现切', '传统铜锅'] });
    const s = storeSchema.parse({ ...storeDefaults, ...demoMetadata, id: DEMO_IDS.store, brandId: b.id,
      storeName: '德祥楼（演示门店）', city: '菏泽' });
    const a = accountSchema.parse({ ...accountDefaults, ...demoMetadata, id: DEMO_IDS.account,
      clientId: c.id, brandId: b.id, storeId: s.id, accountName: '德祥楼老板IP', accountType: 'owner_ip',
      accountGoalJson: ['本地曝光', '老板人设', '团购转化'], contentStyleJson: ['真实', '自然', '本地感'],
      forbiddenStyleJson: ['过度卖惨', '虚假夸张'] });
    if (options.reset) {
      // Restore only known demo IDs in their own organization; never physically delete business records.
      db.insert(clients).values(c).onConflictDoUpdate({ target: clients.id, set: c,
        setWhere: and(eq(clients.organizationId, c.organizationId), eq(clients.isDemo, true)) }).run();
      db.insert(brands).values(b).onConflictDoUpdate({ target: brands.id, set: b,
        setWhere: and(eq(brands.organizationId, b.organizationId), eq(brands.isDemo, true)) }).run();
      db.insert(stores).values(s).onConflictDoUpdate({ target: stores.id, set: s,
        setWhere: and(eq(stores.organizationId, s.organizationId), eq(stores.isDemo, true)) }).run();
      db.insert(accounts).values(a).onConflictDoUpdate({ target: accounts.id, set: a,
        setWhere: and(eq(accounts.organizationId, a.organizationId), eq(accounts.isDemo, true)) }).run();
    } else {
      db.insert(clients).values(c).onConflictDoNothing().run();
      db.insert(brands).values(b).onConflictDoNothing().run();
      db.insert(stores).values(s).onConflictDoNothing().run();
      db.insert(accounts).values(a).onConflictDoNothing().run();
    }

    if (options.reset) {
      db.insert(auditLogs).values({
        id: crypto.randomUUID(),
        organizationId: DEMO_IDS.organization,
        userId: DEMO_IDS.owner,
        action: 'demo.reset',
        entityType: 'organization',
        entityId: DEMO_IDS.organization,
        metadataJson: JSON.stringify({ source: 'local_demo' }),
        isDemo: true,
        createdAt: now,
      }).run();
    }
  });

  seedTransaction();
  return { organizationId: DEMO_IDS.organization, userCount: demoUsers.length, seededAt: now };
}
