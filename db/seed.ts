import { createHash } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { db, sqlite } from './client';
import {
  accounts, appSettings, auditLogs, brands, clientMembers, clients, contents, monthlyPlans,
  contentStatusLogs, memories, organizationAiQuotas, organizations, scriptVersions, shootContents, shoots,
  skillVersions, skills, stores, users,
} from './schema';
import { accountSchema, brandSchema, clientSchema, storeSchema, accountDefaults, brandDefaults, clientDefaults, storeDefaults } from '../lib/master-data/contracts';
import { contentSchema, monthlyPlanSchema } from '../lib/content/contracts';
import { memorySchema } from '../lib/memory/contracts';
import { duplicateJudgeInputJsonSchema, duplicateJudgeOutputJsonSchema } from '../lib/history/contracts';
import {
  plannerSkillInputJsonSchema, plannerSkillOutputJsonSchema,
  qualitySkillInputJsonSchema, qualitySkillOutputJsonSchema,
} from '../lib/planner/contracts';
import { scriptGeneratorInputJsonSchema, scriptJsonOutputJsonSchema } from '../lib/scripts/contracts';

export const DEMO_IDS = {
  organization: '0198f744-8e18-7ae2-a780-52a0e20c1931',
  owner: '0198f744-8e18-7ae2-a780-52a0e20c1932',
  operator: '0198f744-8e18-7ae2-a780-52a0e20c1933',
  photographer: '0198f744-8e18-7ae2-a780-52a0e20c1934',
  editor: '0198f744-8e18-7ae2-a780-52a0e20c1935',
  phaseSetting: '0198f744-8e18-7ae2-a780-52a0e20c1936',
  viewer: '0198f744-8e18-7ae2-a780-52a0e20c1937',
  client: '0198f744-8e18-7ae2-a780-52a0e20c1941',
  brand: '0198f744-8e18-7ae2-a780-52a0e20c1942',
  store: '0198f744-8e18-7ae2-a780-52a0e20c1943',
  account: '0198f744-8e18-7ae2-a780-52a0e20c1944',
  operatorMembership: '0198f744-8e18-7ae2-a780-52a0e20c1951',
  viewerMembership: '0198f744-8e18-7ae2-a780-52a0e20c1952',
  monthlyPlan: '0198f744-8e18-7ae2-a780-52a0e20c1961',
  content: '0198f744-8e18-7ae2-a780-52a0e20c1962',
  aiQuota: '0198f744-8e18-7ae2-a780-52a0e20c1971',
  brandPositioningMemory: '0198f744-8e18-7ae2-a780-52a0e20c1981',
  brandProductsMemory: '0198f744-8e18-7ae2-a780-52a0e20c1982',
  brandSellingPointsMemory: '0198f744-8e18-7ae2-a780-52a0e20c1983',
  accountGoalsMemory: '0198f744-8e18-7ae2-a780-52a0e20c1984',
  accountContentStyleMemory: '0198f744-8e18-7ae2-a780-52a0e20c1985',
  accountForbiddenStyleMemory: '0198f744-8e18-7ae2-a780-52a0e20c1986',
  historyContentFreshness: '0198f744-8e18-7ae2-a780-52a0e20c1963',
  historyContentLocal: '0198f744-8e18-7ae2-a780-52a0e20c1964',
  historyContentOffer: '0198f744-8e18-7ae2-a780-52a0e20c1965',
  shootContent: '0198f744-8e18-7ae2-a780-52a0e20c1966',
  approvedScript: '0198f744-8e18-7ae2-a780-52a0e20c19a1',
  shoot: '0198f744-8e18-7ae2-a780-52a0e20c19a2',
  shootItem: '0198f744-8e18-7ae2-a780-52a0e20c19a3',
  shootStatusLog: '0198f744-8e18-7ae2-a780-52a0e20c19a4',
  editContent: '0198f744-8e18-7ae2-a780-52a0e20c19b1',
  editApprovedScript: '0198f744-8e18-7ae2-a780-52a0e20c19b2',
  editShoot: '0198f744-8e18-7ae2-a780-52a0e20c19b3',
  editShootItem: '0198f744-8e18-7ae2-a780-52a0e20c19b4',
  editScheduledLog: '0198f744-8e18-7ae2-a780-52a0e20c19b5',
  editShotLog: '0198f744-8e18-7ae2-a780-52a0e20c19b6',
} as const;

const duplicateJudgeV2VersionId = '0198f744-8e18-7ae2-a780-52a0e20c1b14';
const contentPlannerV2VersionId = '0198f744-8e18-7ae2-a780-52a0e20c1b11';
const qualityCheckerV2VersionId = '0198f744-8e18-7ae2-a780-52a0e20c1b18';
const scriptGeneratorV2VersionId = '0198f744-8e18-7ae2-a780-52a0e20c1b12';
const externalDedupKey = (value: string) =>
  `external_id:${createHash('sha256').update(value.trim().toLocaleLowerCase()).digest('hex')}`;

const systemSkillSeeds = [
  {
    id: '0198f744-8e18-7ae2-a780-52a0e20c1a01',
    versionId: '0198f744-8e18-7ae2-a780-52a0e20c1b01',
    code: 'content_planner',
    name: '内容策划器',
    description: '为后续月度内容策划提供版本化 Skill 容器。',
    modelProfile: 'standard' as const,
    pointCost: 2,
  },
  {
    id: '0198f744-8e18-7ae2-a780-52a0e20c1a02',
    versionId: '0198f744-8e18-7ae2-a780-52a0e20c1b02',
    code: 'script_generator',
    name: '脚本生成器',
    description: '为后续脚本生成任务提供统一调用入口。',
    modelProfile: 'strong' as const,
    pointCost: 3,
  },
  {
    id: '0198f744-8e18-7ae2-a780-52a0e20c1a03',
    versionId: '0198f744-8e18-7ae2-a780-52a0e20c1b03',
    code: 'script_rewriter',
    name: '脚本改写器',
    description: '为后续按审核意见改写脚本提供基础能力。',
    modelProfile: 'standard' as const,
    pointCost: 2,
  },
  {
    id: '0198f744-8e18-7ae2-a780-52a0e20c1a04',
    versionId: '0198f744-8e18-7ae2-a780-52a0e20c1b04',
    code: 'duplicate_judge',
    name: '重复度判定',
    description: '为后续历史内容去重提供判定容器。',
    modelProfile: 'light' as const,
    pointCost: 1,
  },
  {
    id: '0198f744-8e18-7ae2-a780-52a0e20c1a05',
    versionId: '0198f744-8e18-7ae2-a780-52a0e20c1b05',
    code: 'memory_candidate_extractor',
    name: '记忆候选提取',
    description: '为后续长期记忆候选项提取提供基础能力。',
    modelProfile: 'light' as const,
    pointCost: 1,
  },
  {
    id: '0198f744-8e18-7ae2-a780-52a0e20c1a06',
    versionId: '0198f744-8e18-7ae2-a780-52a0e20c1b06',
    code: 'performance_analyzer',
    name: '表现分析器',
    description: '为后续内容表现复盘提供统一 Skill 定义。',
    modelProfile: 'standard' as const,
    pointCost: 2,
  },
  {
    id: '0198f744-8e18-7ae2-a780-52a0e20c1a07',
    versionId: '0198f744-8e18-7ae2-a780-52a0e20c1b07',
    code: 'strategy_planner',
    name: '策略规划器',
    description: '为后续下一周期运营策略提供版本化能力。',
    modelProfile: 'strong' as const,
    pointCost: 3,
  },
  {
    id: '0198f744-8e18-7ae2-a780-52a0e20c1a08',
    versionId: '0198f744-8e18-7ae2-a780-52a0e20c1b08',
    code: 'quality_checker',
    name: '质量检查器',
    description: '为后续结构、风险与质量检查提供基础能力。',
    modelProfile: 'light' as const,
    pointCost: 1,
  },
] as const;

const skillInputSchema = {
  type: 'object' as const,
  properties: {
    brief: { type: 'string' as const, minLength: 1, maxLength: 2000 },
  },
  required: ['brief'],
  additionalProperties: false,
};
const skillOutputSchema = {
  type: 'object' as const,
  properties: {
    result: { type: 'string' as const, minLength: 1, maxLength: 5000 },
    warnings: {
      type: 'array' as const,
      items: { type: 'string' as const },
      maxItems: 20,
    },
  },
  required: ['result', 'warnings'],
  additionalProperties: false,
};

const demoUsers = [
  { id: DEMO_IDS.owner, name: '运营负责人', role: 'owner' as const },
  { id: DEMO_IDS.operator, name: '运营A', role: 'operator' as const },
  { id: DEMO_IDS.photographer, name: '摄影A', role: 'photographer' as const },
  { id: DEMO_IDS.editor, name: '剪辑A', role: 'editor' as const },
  { id: DEMO_IDS.viewer, name: '查看者', role: 'viewer' as const },
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

    for (const definition of systemSkillSeeds) {
      const skill = {
        id: definition.id,
        organizationId: null,
        code: definition.code,
        name: definition.name,
        description: definition.description,
        systemPrompt: `你是 ContentOS 的${definition.name}基础设施测试 Skill。只返回符合输出 Schema 的 JSON，不执行任何业务写入。`,
        userPromptTemplate: '请处理以下测试输入：\n{{input_json}}',
        inputSchemaJson: skillInputSchema,
        outputSchemaJson: skillOutputSchema,
        modelProfile: definition.modelProfile,
        pointCost: definition.pointCost,
        enabled: true,
        currentVersion: 1,
        isDemo: false,
        createdAt: now,
        updatedAt: now,
      };
      db.insert(skills).values(skill).onConflictDoNothing().run();
      db.insert(skillVersions)
        .values({
          id: definition.versionId,
          organizationId: null,
          skillId: definition.id,
          version: 1,
          systemPrompt: skill.systemPrompt,
          userPromptTemplate: skill.userPromptTemplate,
          inputSchemaJson: skill.inputSchemaJson,
          outputSchemaJson: skill.outputSchemaJson,
          modelProfile: skill.modelProfile,
          pointCost: skill.pointCost,
          changeReason: '系统初始版本',
          createdBy: null,
          isDemo: false,
          createdAt: now,
        })
        .onConflictDoNothing()
        .run();
    }

    const duplicateJudge = db.select().from(skills).where(and(
      eq(skills.code, 'duplicate_judge'), isNull(skills.organizationId),
    )).get();
    if (duplicateJudge?.currentVersion === 1) {
      const v2 = {
        systemPrompt: '你是 ContentOS 重复度判定器。必须综合 Topic、Angle、Hook、Core Message 与语义相似度；不得仅因 Topic 相同就判重复。similar_content_ids 只能引用输入候选。只返回符合输出 Schema 的 JSON。',
        userPromptTemplate: '判断候选内容与本次检索到的历史内容是否重复：\n{{input_json}}',
        inputSchemaJson: duplicateJudgeInputJsonSchema,
        outputSchemaJson: duplicateJudgeOutputJsonSchema,
        modelProfile: 'light' as const,
        pointCost: 1,
      };
      db.update(skills).set({
        ...v2,
        description: '综合历史召回、结构化规则与语义结果判断内容重复度。',
        currentVersion: 2,
        updatedAt: now,
      }).where(and(eq(skills.id, duplicateJudge.id), eq(skills.currentVersion, 1))).run();
      db.insert(skillVersions).values({
        id: duplicateJudgeV2VersionId,
        organizationId: null,
        skillId: duplicateJudge.id,
        version: 2,
        ...v2,
        changeReason: '接入阶段八历史内容去重协议',
        createdBy: null,
        isDemo: false,
        createdAt: now,
      }).onConflictDoNothing().run();
    }

    const contentPlanner = db.select().from(skills).where(and(
      eq(skills.code, 'content_planner'), isNull(skills.organizationId),
    )).get();
    if (contentPlanner?.currentVersion === 1) {
      const v2 = {
        systemPrompt: '你是 ContentOS AI Content Planner。只能使用输入 Context 中已经确认且仍有效的品牌、账号、产品、价格与活动事实；Context 没有价格时严禁生成具体价格。严格使用稳定英文枚举，只返回符合输出 Schema 的 JSON。每个候选必须在 Angle、Hook 或 Core Message 上有清晰差异。',
        userPromptTemplate: '根据当前账号 Context、月度计划缺口和本次简要请求生成候选。用户不会重复填写已有品牌资料：\n{{input_json}}',
        inputSchemaJson: plannerSkillInputJsonSchema,
        outputSchemaJson: plannerSkillOutputJsonSchema,
        modelProfile: 'standard' as const,
        pointCost: 2,
      };
      db.update(skills).set({ ...v2, description: '使用已确认 Context 与计划缺口生成结构化内容候选。', currentVersion: 2, updatedAt: now })
        .where(and(eq(skills.id, contentPlanner.id), eq(skills.currentVersion, 1))).run();
      db.insert(skillVersions).values({ id: contentPlannerV2VersionId, organizationId: null,
        skillId: contentPlanner.id, version: 2, ...v2, changeReason: '接入阶段九 AI Content Planner 协议',
        createdBy: null, isDemo: false, createdAt: now }).onConflictDoNothing().run();
    }

    const scriptGenerator = db.select().from(skills).where(and(
      eq(skills.code, 'script_generator'), isNull(skills.organizationId),
    )).get();
    if (scriptGenerator?.currentVersion === 1) {
      const v2 = {
        systemPrompt: '你是 ContentOS 短视频脚本生成器。只能使用输入 Context 中已确认且仍有效的事实；Context 没有价格或活动时严禁自行生成具体价格或优惠。输出必须适合真实本地生活拍摄，避免夸张承诺，并严格返回符合输出 Schema 的 JSON。',
        userPromptTemplate: '根据结构化 Content 与分层 Context 生成可拍摄脚本。不得要求用户重复输入已有品牌或账号资料：\n{{input_json}}',
        inputSchemaJson: scriptGeneratorInputJsonSchema,
        outputSchemaJson: scriptJsonOutputJsonSchema,
        modelProfile: 'strong' as const,
        pointCost: 3,
      };
      db.update(skills).set({
        ...v2,
        description: '使用当前 Content、有效 Memory 与统一 Context 生成结构化短视频脚本。',
        currentVersion: 2,
        updatedAt: now,
      }).where(and(eq(skills.id, scriptGenerator.id), eq(skills.currentVersion, 1))).run();
      db.insert(skillVersions).values({
        id: scriptGeneratorV2VersionId,
        organizationId: null,
        skillId: scriptGenerator.id,
        version: 2,
        ...v2,
        changeReason: '接入阶段十脚本生成与审核闭环协议',
        createdBy: null,
        isDemo: false,
        createdAt: now,
      }).onConflictDoNothing().run();
    }

    const qualityChecker = db.select().from(skills).where(and(
      eq(skills.code, 'quality_checker'), isNull(skills.organizationId),
    )).get();
    if (qualityChecker?.currentVersion === 1) {
      const v2 = {
        systemPrompt: '你是 ContentOS 内容质量检查器。检查禁用主题与风格、动态事实来源、结构化枚举和月度计划严重冲突。不得修改候选，也不得放行无来源价格或活动事实。只返回符合输出 Schema 的 JSON，candidate_id 只能引用输入候选。',
        userPromptTemplate: '检查以下候选与确定性约束：\n{{input_json}}',
        inputSchemaJson: qualitySkillInputJsonSchema,
        outputSchemaJson: qualitySkillOutputJsonSchema,
        modelProfile: 'light' as const,
        pointCost: 1,
      };
      db.update(skills).set({ ...v2, description: '检查 Planner 候选的事实来源、禁用项、枚举与计划冲突。', currentVersion: 2, updatedAt: now })
        .where(and(eq(skills.id, qualityChecker.id), eq(skills.currentVersion, 1))).run();
      db.insert(skillVersions).values({ id: qualityCheckerV2VersionId, organizationId: null,
        skillId: qualityChecker.id, version: 2, ...v2, changeReason: '接入阶段九 Planner 质量门禁协议',
        createdBy: null, isDemo: false, createdAt: now }).onConflictDoNothing().run();
    }

    db.insert(organizationAiQuotas)
      .values({
        id: DEMO_IDS.aiQuota,
        organizationId: DEMO_IDS.organization,
        periodStart: '2026-01-01T00:00:00.000Z',
        periodEnd: '2027-01-01T00:00:00.000Z',
        quotaPoints: 1000,
        usedPoints: 0,
        isDemo: true,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .run();

    db.insert(appSettings)
      .values({
        id: DEMO_IDS.phaseSetting,
        organizationId: DEMO_IDS.organization,
        key: 'product.phase',
        valueJson: JSON.stringify({ phase: 12, label: 'Edit Review' }),
        isSecret: false,
        isDemo: true,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [appSettings.organizationId, appSettings.key],
        set: { valueJson: JSON.stringify({ phase: 12, label: 'Edit Review' }), updatedAt: now },
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

    for (const membership of [
      { id: DEMO_IDS.operatorMembership, userId: DEMO_IDS.operator },
      { id: DEMO_IDS.viewerMembership, userId: DEMO_IDS.viewer },
    ]) {
      const row = {
        ...membership,
        organizationId: DEMO_IDS.organization,
        clientId: DEMO_IDS.client,
        roleOverride: null,
        isDemo: true,
        createdAt: now,
      };
      db.insert(clientMembers).values(row).onConflictDoUpdate({
        target: clientMembers.id,
        set: { roleOverride: null, isDemo: true },
        setWhere: and(eq(clientMembers.organizationId, DEMO_IDS.organization), eq(clientMembers.isDemo, true)),
      }).run();
      const demoMembership = db.select({ id: clientMembers.id }).from(clientMembers).where(and(
        eq(clientMembers.id, membership.id),
        eq(clientMembers.organizationId, DEMO_IDS.organization),
        eq(clientMembers.isDemo, true),
      )).get();
      if (!demoMembership) throw new Error(`Demo membership ID ${membership.id} is already owned by another record`);
    }

    const plan = monthlyPlanSchema.parse({
      id: DEMO_IDS.monthlyPlan,
      organizationId: DEMO_IDS.organization,
      accountId: DEMO_IDS.account,
      year: 2026,
      month: 9,
      primaryGoal: 'exposure',
      plannedContentCount: 8,
      campaignNotes: '围绕菏泽本地食客做老板人设与门店真实感内容。',
      keyProductsJson: ['手切羊肉', '铜锅涮'],
      contentMixJson: { persona: 25, product: 25, local: 25, conversion: 25 },
      status: 'active',
      createdBy: DEMO_IDS.owner,
      isDemo: true,
      createdAt: now,
      updatedAt: now,
    });
    const content = contentSchema.parse({
      id: DEMO_IDS.content,
      organizationId: DEMO_IDS.organization,
      clientId: DEMO_IDS.client,
      brandId: DEMO_IDS.brand,
      storeId: DEMO_IDS.store,
      accountId: DEMO_IDS.account,
      monthlyPlanId: DEMO_IDS.monthlyPlan,
      title: '老板带你认识鲁西南铜锅涮',
      contentType: 'persona',
      contentGoal: 'exposure',
      topic: '为什么菏泽人爱吃铜锅涮',
      angle: '从老板的日常视角介绍本地饮食习惯',
      hookType: 'local',
      hookText: '菏泽人吃铜锅，先看的不是锅。',
      coreMessage: '本地羊肉现切，用传统铜锅涮出真实风味。',
      productText: '手切羊肉、铜锅涮',
      ctaType: '到店团购',
      localElement: '菏泽本地口音与鲁西南饮食习惯',
      peopleJson: ['老板'],
      status: 'IDEA',
      priority: 'high',
      operatorId: DEMO_IDS.operator,
      plannedPublishDate: '2026-09-15T00:00:00.000Z',
      publishedAt: null,
      deadline: '2026-09-12T00:00:00.000Z',
      externalId: null,
      importDedupKey: null,
      importBatchId: null,
      currentScriptVersionId: null,
      activeApprovedScriptVersionId: null,
      editorId: null,
      currentEditVersionId: null,
      activeApprovedEditVersionId: null,
      aiReviewStatus: null,
      createdBy: DEMO_IDS.owner,
      isDemo: true,
      createdAt: now,
      updatedAt: now,
    });
    if (options.reset) {
      const existingDemoContent = db.select({ status: contents.status }).from(contents).where(and(
        eq(contents.id, content.id), eq(contents.organizationId, content.organizationId), eq(contents.isDemo, true),
      )).get();
      const resetContent = existingDemoContent ? { ...content, status: existingDemoContent.status } : content;
      db.insert(monthlyPlans).values(plan).onConflictDoUpdate({
        target: monthlyPlans.id, set: plan,
        setWhere: and(eq(monthlyPlans.organizationId, plan.organizationId), eq(monthlyPlans.isDemo, true)),
      }).run();
      db.insert(contents).values(resetContent).onConflictDoUpdate({
        target: contents.id, set: resetContent,
        setWhere: and(eq(contents.organizationId, content.organizationId), eq(contents.isDemo, true)),
      }).run();
    } else {
      db.insert(monthlyPlans).values(plan).onConflictDoNothing().run();
      db.insert(contents).values(content).onConflictDoNothing().run();
    }

    const historicalContents = [
      {
        id: DEMO_IDS.historyContentFreshness,
        externalId: 'demo-history-fresh',
        title: '老板教你看手切羊肉新不新鲜',
        contentType: 'education' as const,
        contentGoal: 'trust' as const,
        topic: '怎么判断手切羊肉是否新鲜',
        angle: '老板在后厨展示当天现切羊肉的纹理与颜色',
        hookType: 'local' as const,
        hookText: '这盘羊肉是不是当天切的，看这两处。',
        coreMessage: '鲁西南本地羊肉当天现切，用真实细节建立信任。',
        publishedAt: '2026-07-18T04:00:00.000Z',
      },
      {
        id: DEMO_IDS.historyContentLocal,
        externalId: 'demo-history-local',
        title: '同样是铜锅涮，菏泽人先涮哪一盘',
        contentType: 'local' as const,
        contentGoal: 'exposure' as const,
        topic: '铜锅涮的本地吃法',
        angle: '从菏泽本地食客的点单顺序切入',
        hookType: 'local' as const,
        hookText: '菏泽人吃铜锅，第一盘真不是你想的那个。',
        coreMessage: '用本地饮食习惯呈现传统铜锅涮的真实体验。',
        publishedAt: '2026-08-02T04:00:00.000Z',
      },
      {
        id: DEMO_IDS.historyContentOffer,
        externalId: 'demo-history-offer',
        title: '两个人吃铜锅怎么点更合适',
        contentType: 'conversion' as const,
        contentGoal: 'conversion' as const,
        topic: '双人铜锅点单方案',
        angle: '从客人预算和菜量搭配解释团购选择',
        hookType: 'local' as const,
        hookText: '两个人别盲目点一桌，这样搭配刚好。',
        coreMessage: '根据人数与食量选择套餐，避免夸大价格优势。',
        publishedAt: '2026-08-20T04:00:00.000Z',
      },
    ];
    for (const item of historicalContents) {
      const row = contentSchema.parse({
        ...content,
        ...item,
        monthlyPlanId: null,
        productText: '',
        ctaType: '',
        localElement: '菏泽本地口音与鲁西南饮食习惯',
        peopleJson: ['老板'],
        status: 'PUBLISHED',
        priority: 'normal',
        operatorId: DEMO_IDS.operator,
        plannedPublishDate: item.publishedAt,
        externalId: item.externalId,
        importDedupKey: externalDedupKey(item.externalId),
        importBatchId: null,
        createdAt: item.publishedAt,
        updatedAt: now,
      });
      db.insert(contents).values(row).onConflictDoNothing().run();
      db.update(contents).set({
        externalId: item.externalId,
        importDedupKey: externalDedupKey(item.externalId),
        plannedPublishDate: item.publishedAt,
        publishedAt: item.publishedAt,
        updatedAt: now,
      }).where(and(
        eq(contents.id, item.id),
        eq(contents.organizationId, DEMO_IDS.organization),
        eq(contents.isDemo, true),
      )).run();
    }

    const scheduledContent = contentSchema.parse({
      ...content,
      id: DEMO_IDS.shootContent,
      title: '老板带你看手切羊肉的纹理',
      contentType: 'product',
      contentGoal: 'trust',
      topic: '手切羊肉如何判断状态',
      angle: '老板在门店备菜区展示现切细节',
      hookType: 'question',
      hookText: '这盘羊肉好不好，先看纹理。',
      coreMessage: '用真实现切过程呈现食材状态。',
      productText: '手切羊肉',
      ctaType: '到店了解',
      localElement: '菏泽本地口音',
      peopleJson: ['老板'],
      status: 'APPROVED',
      priority: 'high',
      plannedPublishDate: '2026-09-13T00:00:00.000Z',
      deadline: '2026-09-11T12:00:00.000Z',
      currentScriptVersionId: DEMO_IDS.approvedScript,
      activeApprovedScriptVersionId: DEMO_IDS.approvedScript,
      createdAt: now,
      updatedAt: now,
    });
    const existingScheduledContent = db.select({ id: contents.id, isDemo: contents.isDemo }).from(contents)
      .where(and(eq(contents.organizationId, DEMO_IDS.organization), eq(contents.id, DEMO_IDS.shootContent))).get();
    if (existingScheduledContent && !existingScheduledContent.isDemo)
      throw new Error('Demo shoot content ID is already owned by a non-demo record');
    db.insert(contents).values(scheduledContent).onConflictDoNothing().run();
    db.insert(scriptVersions).values({
      id: DEMO_IDS.approvedScript,
      organizationId: DEMO_IDS.organization,
      contentId: DEMO_IDS.shootContent,
      versionNo: 1,
      scriptJson: {
        title: '老板带你看手切羊肉的纹理',
        hook: '这盘羊肉好不好，先看纹理。',
        spoken_script: '今天不讲夸张的话，就在备菜区看一盘手切羊肉的纹理、肥瘦和现切过程。',
        shots: [
          { scene: '门店备菜区', visual: '老板端起手切羊肉，镜头推近', spoken_line: '先看这一盘的纹理。' },
          { scene: '切肉台', visual: '现切过程和刀工特写', spoken_line: '再看它是怎么切出来的。' },
          { scene: '用餐区', visual: '铜锅沸腾与下锅画面', spoken_line: '最后下铜锅看口感。' },
        ],
        product_integration: '手切羊肉与传统铜锅',
        cta: '到店可以先看现切再点单。',
        hashtags: ['#菏泽美食', '#手切羊肉', '#德祥楼'],
      },
      sourceType: 'operator',
      changeSummary: '拍摄管理阶段的已批准演示脚本',
      createdBy: DEMO_IDS.operator,
      isDemo: true,
      createdAt: now,
    }).onConflictDoNothing().run();
    db.insert(shoots).values({
      id: DEMO_IDS.shoot,
      organizationId: DEMO_IDS.organization,
      clientId: DEMO_IDS.client,
      storeId: DEMO_IDS.store,
      shootDate: '2026-09-10',
      startTime: '09:30',
      endTime: '11:30',
      operatorId: DEMO_IDS.operator,
      photographerId: DEMO_IDS.photographer,
      location: '德祥楼（演示门店）备菜区',
      notes: '先拍食材和切肉台，营业前完成环境空镜。',
      status: 'planned',
      isDemo: true,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoNothing().run();
    const existingShootItem = db.select({ id: shootContents.id }).from(shootContents).where(and(
      eq(shootContents.organizationId, DEMO_IDS.organization), eq(shootContents.id, DEMO_IDS.shootItem),
    )).get();
    if (!existingShootItem) {
      const currentScheduledContent = db.select().from(contents).where(and(
        eq(contents.organizationId, DEMO_IDS.organization), eq(contents.id, DEMO_IDS.shootContent),
      )).get();
      if (!currentScheduledContent || currentScheduledContent.status !== 'APPROVED' || currentScheduledContent.activeApprovedScriptVersionId !== DEMO_IDS.approvedScript)
        throw new Error('Demo shoot content is not ready for initial scheduling');
      db.insert(shootContents).values({
        id: DEMO_IDS.shootItem,
        organizationId: DEMO_IDS.organization,
        shootId: DEMO_IDS.shoot,
        contentId: DEMO_IDS.shootContent,
        approvedScriptVersionId: DEMO_IDS.approvedScript,
        shootItemStatus: 'planned',
        missingShots: '',
        note: '',
        isDemo: true,
        createdAt: now,
        updatedAt: now,
      }).run();
      db.update(contents).set({ status: 'WAITING_SHOOT', updatedAt: now }).where(and(
        eq(contents.organizationId, DEMO_IDS.organization), eq(contents.id, DEMO_IDS.shootContent), eq(contents.status, 'APPROVED'),
      )).run();
      db.insert(contentStatusLogs).values({
        id: DEMO_IDS.shootStatusLog,
        organizationId: DEMO_IDS.organization,
        contentId: DEMO_IDS.shootContent,
        previousStatus: 'APPROVED',
        newStatus: 'WAITING_SHOOT',
        triggerType: 'shoot',
        triggerId: DEMO_IDS.shootItem,
        operatorId: DEMO_IDS.operator,
        reason: '加入 2026-09-10 拍摄排期',
        isDemo: true,
        createdAt: now,
      }).run();
    }

    const editDemoContent = contentSchema.parse({
      ...content,
      id: DEMO_IDS.editContent,
      title: '老板带你看传统铜锅怎么开锅',
      contentType: 'process',
      contentGoal: 'trust',
      topic: '传统铜锅开锅过程',
      angle: '从拍摄完成的门店实拍素材展示操作细节',
      hookType: 'identity',
      hookText: '一口铜锅开锅前，老板先做这一步。',
      coreMessage: '用真实开锅过程展示传统铜锅的门店日常。',
      productText: '传统铜锅、手切羊肉',
      ctaType: '到店体验',
      peopleJson: ['老板'],
      status: 'APPROVED',
      editorId: DEMO_IDS.editor,
      plannedPublishDate: '2026-09-16T00:00:00.000Z',
      deadline: '2026-09-14T12:00:00.000Z',
      currentScriptVersionId: DEMO_IDS.editApprovedScript,
      activeApprovedScriptVersionId: DEMO_IDS.editApprovedScript,
      createdAt: now,
      updatedAt: now,
    });
    const existingEditDemoContent = db.select({ id: contents.id, isDemo: contents.isDemo }).from(contents).where(and(
      eq(contents.organizationId, DEMO_IDS.organization), eq(contents.id, DEMO_IDS.editContent),
    )).get();
    if (existingEditDemoContent && !existingEditDemoContent.isDemo)
      throw new Error('Demo edit content ID is already owned by a non-demo record');
    db.insert(contents).values(editDemoContent).onConflictDoNothing().run();
    db.insert(scriptVersions).values({
      id: DEMO_IDS.editApprovedScript,
      organizationId: DEMO_IDS.organization,
      contentId: DEMO_IDS.editContent,
      versionNo: 1,
      scriptJson: {
        title: editDemoContent.title,
        hook: editDemoContent.hookText,
        spoken_script: '今天让你看看我们开铜锅的日常步骤，从加水、点火到下第一盘手切羊肉。',
        shots: [
          { scene: '门店餐桌', visual: '铜锅与炭火特写', spoken_line: '开锅先把这一步做对。' },
          { scene: '用餐区', visual: '老板加水点火', spoken_line: '水量和火候都是日常经验。' },
          { scene: '桌面', visual: '手切羊肉下锅', spoken_line: '锅开了再下第一盘羊肉。' },
        ],
        product_integration: '传统铜锅与手切羊肉的真实实拍',
        cta: '到店体验传统铜锅涎。',
        hashtags: ['#菏泽美食', '#铜锅涎', '#德祥楼'],
      },
      sourceType: 'operator',
      changeSummary: '剪辑审核阶段的已批准拍摄脚本',
      createdBy: DEMO_IDS.operator,
      isDemo: true,
      createdAt: now,
    }).onConflictDoNothing().run();
    db.insert(shoots).values({
      id: DEMO_IDS.editShoot,
      organizationId: DEMO_IDS.organization,
      clientId: DEMO_IDS.client,
      storeId: DEMO_IDS.store,
      shootDate: '2026-09-08',
      startTime: '14:00',
      endTime: '16:00',
      operatorId: DEMO_IDS.operator,
      photographerId: DEMO_IDS.photographer,
      location: '德祥楼（演示门店）用餐区',
      notes: '已完成铜锅开锅与手切羊肉素材拍摄。',
      status: 'planned',
      isDemo: true,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoNothing().run();
    const existingEditShootItem = db.select({ id: shootContents.id }).from(shootContents).where(and(
      eq(shootContents.organizationId, DEMO_IDS.organization), eq(shootContents.id, DEMO_IDS.editShootItem),
    )).get();
    if (!existingEditShootItem) {
      const currentEditContent = db.select().from(contents).where(and(
        eq(contents.organizationId, DEMO_IDS.organization), eq(contents.id, DEMO_IDS.editContent),
      )).get();
      if (!currentEditContent || currentEditContent.status !== 'APPROVED'
        || currentEditContent.activeApprovedScriptVersionId !== DEMO_IDS.editApprovedScript)
        throw new Error('Demo edit content is not ready for its completed shoot');
      db.insert(shootContents).values({
        id: DEMO_IDS.editShootItem, organizationId: DEMO_IDS.organization, shootId: DEMO_IDS.editShoot,
        contentId: DEMO_IDS.editContent, approvedScriptVersionId: DEMO_IDS.editApprovedScript,
        shootItemStatus: 'planned', missingShots: '', note: '全部分镜已拍摄', isDemo: true,
        createdAt: now, updatedAt: now,
      }).run();
      db.update(contents).set({ status: 'WAITING_SHOOT', updatedAt: now }).where(and(
        eq(contents.organizationId, DEMO_IDS.organization), eq(contents.id, DEMO_IDS.editContent), eq(contents.status, 'APPROVED'),
      )).run();
      db.insert(contentStatusLogs).values({
        id: DEMO_IDS.editScheduledLog, organizationId: DEMO_IDS.organization, contentId: DEMO_IDS.editContent,
        previousStatus: 'APPROVED', newStatus: 'WAITING_SHOOT', triggerType: 'shoot', triggerId: DEMO_IDS.editShootItem,
        operatorId: DEMO_IDS.operator, reason: '加入剪辑阶段演示拍摄', isDemo: true, createdAt: now,
      }).run();
      db.update(shootContents).set({ shootItemStatus: 'shot', updatedAt: now }).where(and(
        eq(shootContents.organizationId, DEMO_IDS.organization), eq(shootContents.id, DEMO_IDS.editShootItem),
      )).run();
      db.update(contents).set({ status: 'SHOT', updatedAt: now }).where(and(
        eq(contents.organizationId, DEMO_IDS.organization), eq(contents.id, DEMO_IDS.editContent), eq(contents.status, 'WAITING_SHOOT'),
      )).run();
      db.insert(contentStatusLogs).values({
        id: DEMO_IDS.editShotLog, organizationId: DEMO_IDS.organization, contentId: DEMO_IDS.editContent,
        previousStatus: 'WAITING_SHOOT', newStatus: 'SHOT', triggerType: 'shoot', triggerId: DEMO_IDS.editShootItem,
        operatorId: DEMO_IDS.photographer, reason: '拍摄 Checklist 已完成', isDemo: true, createdAt: now,
      }).run();
      db.update(shoots).set({ status: 'completed', updatedAt: now }).where(and(
        eq(shoots.organizationId, DEMO_IDS.organization), eq(shoots.id, DEMO_IDS.editShoot),
      )).run();
    }

    for (const memory of [
      { id: DEMO_IDS.brandPositioningMemory, scopeType: 'brand' as const, scopeId: b.id, memoryKey: 'brand.positioning', memoryType: 'brand' as const, valueJson: b.brandPositioning, summary: `品牌定位：${b.brandPositioning}`, importance: 5, sourceId: b.id },
      { id: DEMO_IDS.brandProductsMemory, scopeType: 'brand' as const, scopeId: b.id, memoryKey: 'brand.core_products', memoryType: 'brand' as const, valueJson: b.coreProductsJson, summary: `核心产品：${b.coreProductsJson.join('、')}`, importance: 5, sourceId: b.id },
      { id: DEMO_IDS.brandSellingPointsMemory, scopeType: 'brand' as const, scopeId: b.id, memoryKey: 'brand.core_selling_points', memoryType: 'brand' as const, valueJson: b.coreSellingPointsJson, summary: `核心卖点：${b.coreSellingPointsJson.join('、')}`, importance: 5, sourceId: b.id },
      { id: DEMO_IDS.accountGoalsMemory, scopeType: 'account' as const, scopeId: a.id, memoryKey: 'account.goals', memoryType: 'preference' as const, valueJson: a.accountGoalJson, summary: `账号目标：${a.accountGoalJson.join('、')}`, importance: 4, sourceId: a.id },
      { id: DEMO_IDS.accountContentStyleMemory, scopeType: 'account' as const, scopeId: a.id, memoryKey: 'account.content_style', memoryType: 'preference' as const, valueJson: a.contentStyleJson, summary: `内容风格：${a.contentStyleJson.join('、')}`, importance: 4, sourceId: a.id },
      { id: DEMO_IDS.accountForbiddenStyleMemory, scopeType: 'account' as const, scopeId: a.id, memoryKey: 'account.forbidden_style', memoryType: 'preference' as const, valueJson: a.forbiddenStyleJson, summary: `禁用风格：${a.forbiddenStyleJson.join('、')}`, importance: 5, sourceId: a.id },
    ]) {
      db.insert(memories).values(memorySchema.parse({
        ...memory,
        organizationId: DEMO_IDS.organization,
        confidence: 1,
        sourceType: 'brand_profile',
        effectiveAt: now,
        expiresAt: null,
        status: 'active',
        supersedesMemoryId: null,
        createdBy: DEMO_IDS.owner,
        isDemo: true,
        createdAt: now,
      })).onConflictDoNothing().run();
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
