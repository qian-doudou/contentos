import { eq } from 'drizzle-orm';
import { db, sqlite } from './client';
import { appSettings, auditLogs, organizations, users } from './schema';

export const DEMO_IDS = {
  organization: '0198f744-8e18-7ae2-a780-52a0e20c1931',
  owner: '0198f744-8e18-7ae2-a780-52a0e20c1932',
  operator: '0198f744-8e18-7ae2-a780-52a0e20c1933',
  photographer: '0198f744-8e18-7ae2-a780-52a0e20c1934',
  editor: '0198f744-8e18-7ae2-a780-52a0e20c1935',
  phaseSetting: '0198f744-8e18-7ae2-a780-52a0e20c1936',
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
    if (options.reset) {
      db.delete(organizations).where(eq(organizations.id, DEMO_IDS.organization)).run();
    }

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
      })
      .run();

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
        })
        .run();
    }

    db.insert(appSettings)
      .values({
        id: DEMO_IDS.phaseSetting,
        organizationId: DEMO_IDS.organization,
        key: 'product.phase',
        valueJson: JSON.stringify({ phase: 1, label: '工程基础' }),
        isSecret: false,
        isDemo: true,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [appSettings.organizationId, appSettings.key],
        set: { valueJson: JSON.stringify({ phase: 1, label: '工程基础' }), updatedAt: now },
      })
      .run();

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

