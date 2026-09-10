import assert from 'node:assert/strict';
import { and, eq, inArray, or } from 'drizzle-orm';
import { db } from '../db/client';
import {
  accounts, clients, contentEmbeddings, contents, memories, performanceSnapshots, publishes,
} from '../db/schema';
import { DEMO_IDS } from '../db/seed';
import { masterDataService } from '../lib/master-data/service';
import { memoryService } from '../lib/memory/service';
import { strategyReviewService } from '../lib/strategy-review/service';

const expectedClients = ['仁爱宠物医院', '叶家渔', '德祥楼'];
const fixedNow = new Date('2026-09-10T08:00:00.000Z');

const organizationClients = db.select().from(clients).where(and(
  eq(clients.organizationId, DEMO_IDS.organization), eq(clients.isDemo, true),
)).all();
assert.deepEqual(organizationClients.map((row) => row.clientName).sort((a, b) => a.localeCompare(b, 'zh-CN')),
  [...expectedClients].sort((a, b) => a.localeCompare(b, 'zh-CN')), '演示客户集不完整');

const accountSummaries = [];
for (const client of organizationClients) {
  const account = db.select().from(accounts).where(and(
    eq(accounts.organizationId, DEMO_IDS.organization), eq(accounts.clientId, client.id), eq(accounts.isDemo, true),
  )).get();
  assert(account, `${client.clientName} 缺少 Demo 账号`);
  const histories = db.select().from(contents).where(and(
    eq(contents.organizationId, DEMO_IDS.organization), eq(contents.accountId, account.id), eq(contents.isDemo, true),
    or(eq(contents.status, 'PUBLISHED'), eq(contents.status, 'REVIEWED')),
  )).all();
  assert(histories.length >= 20, `${account.accountName} 历史内容不足20条`);
  const historyIds = histories.map((row) => row.id);
  const accountPublishes = db.select().from(publishes).where(and(
    eq(publishes.organizationId, DEMO_IDS.organization), eq(publishes.isDemo, true), inArray(publishes.contentId, historyIds),
  )).all();
  assert(accountPublishes.length >= 20, `${account.accountName} 缺少Demo发布记录`);
  const accountSnapshots = db.select().from(performanceSnapshots).where(and(
    eq(performanceSnapshots.organizationId, DEMO_IDS.organization), eq(performanceSnapshots.isDemo, true),
    inArray(performanceSnapshots.publishId, accountPublishes.map((row) => row.id)),
  )).all();
  assert(accountSnapshots.length >= 40, `${account.accountName} 缺少多时间点Performance Snapshot`);
  const embeddings = db.select().from(contentEmbeddings).where(and(
    eq(contentEmbeddings.organizationId, DEMO_IDS.organization), eq(contentEmbeddings.accountId, account.id),
    eq(contentEmbeddings.status, 'active'), eq(contentEmbeddings.isDemo, true),
  )).all();
  assert(embeddings.length >= 20, `${account.accountName} 缺少有效Embedding`);
  const anglesByTopic = new Map<string, Set<string>>();
  for (const history of histories) {
    if (!history.topic || !history.angle) continue;
    const angles = anglesByTopic.get(history.topic) ?? new Set<string>();
    angles.add(history.angle);
    anglesByTopic.set(history.topic, angles);
  }
  assert([...anglesByTopic.values()].some((angles) => angles.size > 1), `${account.accountName} 未覆盖同Topic不同Angle`);
  const metrics = strategyReviewService(db, DEMO_IDS.organization, DEMO_IDS.owner, { now: () => fixedNow }).aggregate({
    accountId: account.id, periodStart: '2026-08-01T00:00:00.000Z', periodEnd: '2026-09-01T00:00:00.000Z',
  });
  assert(metrics.metrics.publishedContentCount >= 20 && metrics.metrics.totalViews > 0, `${account.accountName} 程序聚合失败`);
  accountSummaries.push({
    client: client.clientName, account: account.accountName, historicalContents: histories.length,
    publishes: accountPublishes.length, snapshots: accountSnapshots.length, embeddings: embeddings.length,
    aggregateViews: metrics.metrics.totalViews,
  });
}

const oldPrice = db.select().from(memories).where(and(
  eq(memories.organizationId, DEMO_IDS.organization), eq(memories.id, DEMO_IDS.supersededGroupbuyPriceMemory),
)).get();
const activePrice = db.select().from(memories).where(and(
  eq(memories.organizationId, DEMO_IDS.organization), eq(memories.id, DEMO_IDS.activeGroupbuyPriceMemory),
)).get();
assert.equal(oldPrice?.status, 'superseded', '旧Demo团购价必须为superseded');
assert.deepEqual(activePrice && { status: activePrice.status, supersedesMemoryId: activePrice.supersedesMemoryId }, {
  status: 'active', supersedesMemoryId: DEMO_IDS.supersededGroupbuyPriceMemory,
});
for (const sourceType of ['brand_profile', 'confirmed_preference', 'confirmed_performance', 'confirmed_strategy'] as const)
  assert(db.select().from(memories).where(and(
    eq(memories.organizationId, DEMO_IDS.organization), eq(memories.sourceType, sourceType), eq(memories.isDemo, true),
  )).get(), `缺少 ${sourceType} Demo Memory`);

const context = memoryService(db, DEMO_IDS.organization, DEMO_IDS.owner, { now: () => fixedNow }).buildContext({
  accountId: DEMO_IDS.account, focus: '当前团购价和下一周内容策略',
});
assert(!context.snapshot.memoryIds.includes(DEMO_IDS.supersededGroupbuyPriceMemory), 'Context 引用了已替代团购价');
assert(context.snapshot.memoryIds.includes(DEMO_IDS.activeGroupbuyPriceMemory), 'Context 未引用当前团购价');
assert(context.snapshot.estimatedCharacters <= context.snapshot.budgets.characters, 'Context 超出字符预算');

const detail = masterDataService(db, DEMO_IDS.organization, DEMO_IDS.owner).accountDetail(DEMO_IDS.account);
assert(detail.contentStats.implemented && detail.contentStats.published >= 20, '账号真实内容统计未生效');
assert.equal(masterDataService(db, DEMO_IDS.organization, DEMO_IDS.operator).listClients({ page: 1, pageSize: 10 }).total, 3,
  '运营A未被授权访问全部Demo客户');

console.log(JSON.stringify({
  organizationId: DEMO_IDS.organization,
  clients: accountSummaries,
  memory: {
    activeCountInContext: context.snapshot.memoryIds.length,
    supersededPriceExcluded: true,
    characterCount: context.snapshot.estimatedCharacters,
    maxCharacters: context.snapshot.budgets.characters,
  },
}, null, 2));
