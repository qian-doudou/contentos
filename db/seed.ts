import { createHash } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { db, sqlite } from './client';
import {
  accounts, appSettings, auditLogs, brands, clientMembers, clients, contentEmbeddings, contents, editVersions, monthlyPlans,
  contentStatusLogs, memories, organizationAiQuotas, organizations, performanceSnapshots, publishes,
  scriptVersions, shootContents, shoots, skillVersions, skills, stores, users,
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
import {
  performanceAnalyzerInputJsonSchema,
  performanceAnalyzerOutputJsonSchema,
  strategyPlannerInputJsonSchema,
  strategyPlannerOutputJsonSchema,
} from '../lib/strategy-review/contracts';
import { DEFAULT_OPS_CONFIG } from '../lib/ops/config';
import { promptImproverInputJsonSchema, promptImproverOutputJsonSchema } from '../lib/evals/contracts';
import { contentSourceHash, weightedTermVector } from '../lib/history/similarity';

export const DEMO_IDS = {
  organization: '0198f744-8e18-7ae2-a780-52a0e20c1931',
  owner: '0198f744-8e18-7ae2-a780-52a0e20c1932',
  operator: '0198f744-8e18-7ae2-a780-52a0e20c1933',
  photographer: '0198f744-8e18-7ae2-a780-52a0e20c1934',
  editor: '0198f744-8e18-7ae2-a780-52a0e20c1935',
  phaseSetting: '0198f744-8e18-7ae2-a780-52a0e20c1936',
  strategyReviewSetting: '0198f744-8e18-7ae2-a780-52a0e20c1938',
  opsSetting: '0198f744-8e18-7ae2-a780-52a0e20c1939',
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
  yejiyuClient: '0198f744-8e18-7ae2-a780-52a0e20c1c01',
  yejiyuBrand: '0198f744-8e18-7ae2-a780-52a0e20c1c02',
  yejiyuStore: '0198f744-8e18-7ae2-a780-52a0e20c1c03',
  yejiyuAccount: '0198f744-8e18-7ae2-a780-52a0e20c1c04',
  petClient: '0198f744-8e18-7ae2-a780-52a0e20c1c11',
  petBrand: '0198f744-8e18-7ae2-a780-52a0e20c1c12',
  petStore: '0198f744-8e18-7ae2-a780-52a0e20c1c13',
  petAccount: '0198f744-8e18-7ae2-a780-52a0e20c1c14',
  confirmedPreferenceMemory: '0198f744-8e18-7ae2-a780-52a0e20c1c21',
  confirmedPerformanceMemory: '0198f744-8e18-7ae2-a780-52a0e20c1c22',
  confirmedStrategyMemory: '0198f744-8e18-7ae2-a780-52a0e20c1c23',
  supersededGroupbuyPriceMemory: '0198f744-8e18-7ae2-a780-52a0e20c1c24',
  activeGroupbuyPriceMemory: '0198f744-8e18-7ae2-a780-52a0e20c1c25',
} as const;

const demoUuid = (series: number, index: number) =>
  `0198f744-8e18-7ae2-a780-${series.toString(16).padStart(4, '0')}${index.toString(16).padStart(8, '0')}`;

const duplicateJudgeV2VersionId = '0198f744-8e18-7ae2-a780-52a0e20c1b14';
const contentPlannerV2VersionId = '0198f744-8e18-7ae2-a780-52a0e20c1b11';
const qualityCheckerV2VersionId = '0198f744-8e18-7ae2-a780-52a0e20c1b18';
const scriptGeneratorV2VersionId = '0198f744-8e18-7ae2-a780-52a0e20c1b12';
const performanceAnalyzerV2VersionId = '0198f744-8e18-7ae2-a780-52a0e20c1b16';
const strategyPlannerV2VersionId = '0198f744-8e18-7ae2-a780-52a0e20c1b17';
const promptImproverSkillId = '0198f744-8e18-7ae2-a780-52a0e20c1a09';
const promptImproverVersionId = '0198f744-8e18-7ae2-a780-52a0e20c1b09';
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

    const promptImprover = {
      id: promptImproverSkillId,
      organizationId: null,
      code: 'prompt_improver',
      name: 'Prompt 改进提案器',
      description: '只生成待评测的 Prompt 草案，不得修改生产 Skill。',
      systemPrompt: '你是 ContentOS Prompt 改进提案器。根据 Bad Case、失败输入、Context、错误输出和人工期望生成最小化修改草案。不得放宽品牌事实、Memory 有效性、Schema 或重复度规则。只返回符合 Output Schema 的 JSON；草案绝不能直接应用生产。',
      userPromptTemplate: '分析以下当前 Skill 与 Bad Case，生成可进行 Diff 和 A/B Eval 的 Prompt 草案：\n{{input_json}}',
      inputSchemaJson: promptImproverInputJsonSchema,
      outputSchemaJson: promptImproverOutputJsonSchema,
      modelProfile: 'strong' as const,
      pointCost: 0,
      enabled: true,
      currentVersion: 1,
      isDemo: false,
      createdAt: now,
      updatedAt: now,
    };
    db.insert(skills).values(promptImprover).onConflictDoNothing().run();
    db.insert(skillVersions).values({
      id: promptImproverVersionId,
      organizationId: null,
      skillId: promptImproverSkillId,
      version: 1,
      systemPrompt: promptImprover.systemPrompt,
      userPromptTemplate: promptImprover.userPromptTemplate,
      inputSchemaJson: promptImprover.inputSchemaJson,
      outputSchemaJson: promptImprover.outputSchemaJson,
      modelProfile: promptImprover.modelProfile,
      pointCost: promptImprover.pointCost,
      changeReason: '阶段十六质量闭环初始版本',
      createdBy: null,
      isDemo: false,
      createdAt: now,
    }).onConflictDoNothing().run();

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

    const performanceAnalyzer = db.select().from(skills).where(and(
      eq(skills.code, 'performance_analyzer'), isNull(skills.organizationId),
    )).get();
    if (performanceAnalyzer?.currentVersion === 1) {
      const v2 = {
        systemPrompt: '你是 ContentOS 表现分析器。所有数值均已由代码聚合，你只能解释输入事实，不得重算、补造或推断不存在的指标。必须区分数据事实、模式解释与样本量限制，只返回符合输出 Schema 的 JSON。',
        userPromptTemplate: '解释以下已冻结的聚合指标、TOP/Bottom 结构化摘要与有效 Memory：\n{{input_json}}',
        inputSchemaJson: performanceAnalyzerInputJsonSchema,
        outputSchemaJson: performanceAnalyzerOutputJsonSchema,
        modelProfile: 'standard' as const,
        pointCost: 2,
      };
      db.update(skills).set({ ...v2, description: '解释代码聚合的内容表现事实并明确样本量限制。', currentVersion: 2, updatedAt: now })
        .where(and(eq(skills.id, performanceAnalyzer.id), eq(skills.currentVersion, 1))).run();
      db.insert(skillVersions).values({ id: performanceAnalyzerV2VersionId, organizationId: null,
        skillId: performanceAnalyzer.id, version: 2, ...v2, changeReason: '接入阶段十四 Compute First 表现复盘协议',
        createdBy: null, isDemo: false, createdAt: now }).onConflictDoNothing().run();
    }

    const strategyPlanner = db.select().from(skills).where(and(
      eq(skills.code, 'strategy_planner'), isNull(skills.organizationId),
    )).get();
    if (strategyPlanner?.currentVersion === 1) {
      const v2 = {
        systemPrompt: '你是 ContentOS 策略规划器。只能基于代码聚合事实、表现分析、当前月度目标和已确认 Memory 给出下一周期建议。recommended_content_mix 使用稳定英文 content_type，百分比合计必须等于 100。只返回符合输出 Schema 的 JSON。',
        userPromptTemplate: '根据已验证的事实与人工确认上下文制定下一周期策略：\n{{input_json}}',
        inputSchemaJson: strategyPlannerInputJsonSchema,
        outputSchemaJson: strategyPlannerOutputJsonSchema,
        modelProfile: 'strong' as const,
        pointCost: 3,
      };
      db.update(skills).set({ ...v2, description: '基于程序指标与已确认记忆生成下一周期结构化策略。', currentVersion: 2, updatedAt: now })
        .where(and(eq(skills.id, strategyPlanner.id), eq(skills.currentVersion, 1))).run();
      db.insert(skillVersions).values({ id: strategyPlannerV2VersionId, organizationId: null,
        skillId: strategyPlanner.id, version: 2, ...v2, changeReason: '接入阶段十四下一周期策略协议',
        createdBy: null, isDemo: false, createdAt: now }).onConflictDoNothing().run();
    }

    const demoQuota = {
        id: DEMO_IDS.aiQuota,
        organizationId: DEMO_IDS.organization,
        periodStart: '2026-01-01T00:00:00.000Z',
        periodEnd: '2027-01-01T00:00:00.000Z',
        quotaPoints: 1000,
        usedPoints: 0,
        isDemo: true,
        createdAt: now,
        updatedAt: now,
      };
    if (options.reset) db.insert(organizationAiQuotas).values(demoQuota).onConflictDoUpdate({
      target: organizationAiQuotas.id,
      set: { quotaPoints: demoQuota.quotaPoints, usedPoints: 0, isDemo: true, updatedAt: now },
      setWhere: and(eq(organizationAiQuotas.organizationId, DEMO_IDS.organization), eq(organizationAiQuotas.isDemo, true)),
    }).run();
    else db.insert(organizationAiQuotas).values(demoQuota).onConflictDoNothing().run();

    db.insert(appSettings)
      .values({
        id: DEMO_IDS.phaseSetting,
        organizationId: DEMO_IDS.organization,
        key: 'product.phase',
        valueJson: JSON.stringify({ phase: 17, label: 'Final Integration' }),
        isSecret: false,
        isDemo: true,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [appSettings.organizationId, appSettings.key],
        set: { valueJson: JSON.stringify({ phase: 17, label: 'Final Integration' }), updatedAt: now },
      })
      .run();

    db.insert(appSettings)
      .values({
        id: DEMO_IDS.strategyReviewSetting,
        organizationId: DEMO_IDS.organization,
        key: 'strategy_review.config',
        valueJson: JSON.stringify({ minimumSampleSize: 5 }),
        isSecret: false,
        isDemo: true,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .run();

    db.insert(appSettings)
      .values({
        id: DEMO_IDS.opsSetting,
        organizationId: DEMO_IDS.organization,
        key: 'ops.config',
        valueJson: JSON.stringify(DEFAULT_OPS_CONFIG),
        isSecret: false,
        isDemo: true,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
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
    const additionalHierarchyDefinitions = [
      {
        ids: { client: DEMO_IDS.yejiyuClient, brand: DEMO_IDS.yejiyuBrand, store: DEMO_IDS.yejiyuStore, account: DEMO_IDS.yejiyuAccount },
        slug: 'yejiyu', clientName: '叶家渔', industry: '餐饮', subIndustry: '本地河鲜', city: '菏泽',
        positioning: '菏泽本地河鲜与家宴菜品牌', products: ['黄河鲤鱼', '现烧河鲜'],
        sellingPoints: ['当日备菜', '明档制作', '本地家宴口味'], accountName: '叶家渔掌柜IP',
        goals: ['本地曝光', '到店转化', '菜品信任'], styles: ['热闹', '真实', '家宴感'], forbidden: ['虚构食材产地', '夸张份量'],
      },
      {
        ids: { client: DEMO_IDS.petClient, brand: DEMO_IDS.petBrand, store: DEMO_IDS.petStore, account: DEMO_IDS.petAccount },
        slug: 'renai-pet', clientName: '仁爱宠物医院', industry: '宠物服务', subIndustry: '宠物医疗', city: '菏泽',
        positioning: '面向菏泽家庭的专业、克制、可理解的宠物医疗科普', products: ['宠物健康检查', '疫苗与驱虫'],
        sellingPoints: ['检查流程透明', '医生科普易懂', '分诊建议克制'], accountName: '仁爱宠物医生IP',
        goals: ['本地曝光', '医生人设', '预约转化'], styles: ['专业', '温和', '通俗'], forbidden: ['过度恐吓', '无依据诊断'],
      },
    ] as const;
    const additionalHierarchies = additionalHierarchyDefinitions.map((definition) => {
      const client = clientSchema.parse({ ...clientDefaults, ...demoMetadata, id: definition.ids.client,
        clientName: definition.clientName, industry: definition.industry, subIndustry: definition.subIndustry,
        cooperationStatus: 'active', monthlyContentTarget: 8, ownerUserId: DEMO_IDS.owner, notes: '明确标记的 ContentOS 演示客户。' });
      const brand = brandSchema.parse({ ...brandDefaults, ...demoMetadata, id: definition.ids.brand, clientId: client.id,
        brandName: definition.clientName, industry: definition.industry, subIndustry: definition.subIndustry,
        city: definition.city, brandPositioning: definition.positioning, targetAudienceJson: [`${definition.city}本地家庭`],
        coreProductsJson: [...definition.products], coreSellingPointsJson: [...definition.sellingPoints],
        brandToneJson: [...definition.styles], forbiddenTopicsJson: [...definition.forbidden] });
      const store = storeSchema.parse({ ...storeDefaults, ...demoMetadata, id: definition.ids.store, brandId: brand.id,
        storeName: `${definition.clientName}（演示门店）`, city: definition.city, district: '牡丹区',
        address: '仅供本地 Demo 展示，非真实生产地址', storeType: '单店' });
      const account = accountSchema.parse({ ...accountDefaults, ...demoMetadata, id: definition.ids.account,
        clientId: client.id, brandId: brand.id, storeId: store.id, accountName: definition.accountName,
        accountType: 'owner_ip', accountGoalJson: [...definition.goals], contentStyleJson: [...definition.styles],
        forbiddenStyleJson: [...definition.forbidden] });
      return { ...definition, client, brand, store, account };
    });
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

    for (const hierarchy of additionalHierarchies) {
      if (options.reset) {
        db.insert(clients).values(hierarchy.client).onConflictDoUpdate({ target: clients.id, set: hierarchy.client,
          setWhere: and(eq(clients.organizationId, hierarchy.client.organizationId), eq(clients.isDemo, true)) }).run();
        db.insert(brands).values(hierarchy.brand).onConflictDoUpdate({ target: brands.id, set: hierarchy.brand,
          setWhere: and(eq(brands.organizationId, hierarchy.brand.organizationId), eq(brands.isDemo, true)) }).run();
        db.insert(stores).values(hierarchy.store).onConflictDoUpdate({ target: stores.id, set: hierarchy.store,
          setWhere: and(eq(stores.organizationId, hierarchy.store.organizationId), eq(stores.isDemo, true)) }).run();
        db.insert(accounts).values(hierarchy.account).onConflictDoUpdate({ target: accounts.id, set: hierarchy.account,
          setWhere: and(eq(accounts.organizationId, hierarchy.account.organizationId), eq(accounts.isDemo, true)) }).run();
      } else {
        db.insert(clients).values(hierarchy.client).onConflictDoNothing().run();
        db.insert(brands).values(hierarchy.brand).onConflictDoNothing().run();
        db.insert(stores).values(hierarchy.store).onConflictDoNothing().run();
        db.insert(accounts).values(hierarchy.account).onConflictDoNothing().run();
      }
    }
    const allDemoHierarchies = [
      {
        slug: 'dexianglou', client: c, brand: b, store: s, account: a,
        product: '手切羊肉', localScene: '菏泽铜锅涮门店', persona: '老板',
      },
      ...additionalHierarchies.map((hierarchy) => ({
        slug: hierarchy.slug,
        client: hierarchy.client,
        brand: hierarchy.brand,
        store: hierarchy.store,
        account: hierarchy.account,
        product: hierarchy.products[0],
        localScene: `${hierarchy.city}${hierarchy.clientName}门店`,
        persona: hierarchy.slug === 'renai-pet' ? '医生' : '掌柜',
      })),
    ];

    for (const membership of [
      { id: DEMO_IDS.operatorMembership, userId: DEMO_IDS.operator },
      { id: DEMO_IDS.viewerMembership, userId: DEMO_IDS.viewer },
      ...additionalHierarchies.flatMap((hierarchy, index) => [
        { id: demoUuid(0x110 + index, 1), userId: DEMO_IDS.operator, clientId: hierarchy.client.id },
        { id: demoUuid(0x110 + index, 2), userId: DEMO_IDS.viewer, clientId: hierarchy.client.id },
      ]),
    ]) {
      const row = {
        ...membership,
        organizationId: DEMO_IDS.organization,
        clientId: 'clientId' in membership ? membership.clientId : DEMO_IDS.client,
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
    for (const [index, hierarchy] of additionalHierarchies.entries()) {
      const additionalPlan = monthlyPlanSchema.parse({
        id: demoUuid(0x120, index + 1), organizationId: DEMO_IDS.organization, accountId: hierarchy.account.id,
        year: 2026, month: 9, primaryGoal: index === 0 ? 'conversion' : 'trust', plannedContentCount: 8,
        campaignNotes: '仅供 ContentOS 本地联调的 Demo 月度计划。', keyProductsJson: [...hierarchy.products],
        contentMixJson: index === 0 ? { product: 25, local: 25, conversion: 25, persona: 25 } : { education: 25, trust: 25, persona: 25, conversion: 25 },
        status: 'active', createdBy: DEMO_IDS.owner, isDemo: true, createdAt: now, updatedAt: now,
      });
      if (options.reset) db.insert(monthlyPlans).values(additionalPlan).onConflictDoUpdate({
        target: monthlyPlans.id, set: additionalPlan,
        setWhere: and(eq(monthlyPlans.organizationId, DEMO_IDS.organization), eq(monthlyPlans.isDemo, true)),
      }).run();
      else db.insert(monthlyPlans).values(additionalPlan).onConflictDoNothing().run();
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

    const historyPatterns = [
      { suffix: '同一主题A', contentType: 'product', contentGoal: 'trust', topic: '招牌产品怎么选', angle: '从专业人的日常选品标准切入', hookType: 'question', hook: '这一份好不好，先看这两处。', message: '用真实细节解释选品标准。' },
      { suffix: '同一主题B', contentType: 'product', contentGoal: 'trust', topic: '招牌产品怎么选', angle: '从专业人的日常选品标准切入', hookType: 'question', hook: '这一份好不好，先看这两处。', message: '用真实细节解释选品标准。' },
      { suffix: '同Topic不同Angle', contentType: 'education', contentGoal: 'trust', topic: '招牌产品怎么选', angle: '从第一次到店的顾客视角讲如何做决定', hookType: 'identity', hook: '第一次来的人，最容易忽略这一点。', message: '同一主题使用顾客视角提供新角度。' },
      { suffix: '高播放人设', contentType: 'persona', contentGoal: 'exposure', topic: '专业人开门前的一天', angle: '跟拍开门前的真实准备', hookType: 'identity', hook: '你看到开门，我已经忙了两小时。', message: '用真实工作流程建立人设信任。' },
      { suffix: '低播放高转化', contentType: 'conversion', contentGoal: 'gmv', topic: '团购适合哪类顾客', angle: '从人数和实际需求解释如何选择', hookType: 'result', hook: '别先看便宜，先看你们几个人。', message: '用适用条件帮助用户做理性团购决策。' },
      { suffix: '表现较差环境', contentType: 'local', contentGoal: 'exposure', topic: '门店环境展示', angle: '纯环境空镜无人物叙事', hookType: 'local', hook: '带你看看今天的门店环境。', message: '展示门店空间与本地感。' },
      { suffix: '顾客问答', contentType: 'customer_case', contentGoal: 'trust', topic: '顾客高频问题', angle: '用一问一答解释真实疑问', hookType: 'question', hook: '这个问题，几乎每天都有人问。', message: '直面疑问并给出克制答复。' },
      { suffix: '制作流程', contentType: 'process', contentGoal: 'trust', topic: '一份服务如何完成', angle: '从准备到交付拆解流程', hookType: 'secret', hook: '看起来简单，后面其实有四道准备。', message: '透明展示流程和质量控制。' },
      { suffix: '本地习惯', contentType: 'local', contentGoal: 'exposure', topic: '菏泽本地用户习惯', angle: '从本地口头语和生活节奏切入', hookType: 'local', hook: '菏泽人遇到这件事，第一反应都很像。', message: '用可核实的本地场景增加亲近感。' },
      { suffix: '常见误区', contentType: 'education', contentGoal: 'followers', topic: '用户常见误区', angle: '对比错误做法与正确做法', hookType: 'mistake', hook: '这个小错误，可能让整个体验变差。', message: '给出可执行的纠错方法。' },
    ] as const;
    for (const [accountIndex, hierarchy] of allDemoHierarchies.entries()) {
      for (let index = 0; index < 20; index += 1) {
        const pattern = historyPatterns[index % historyPatterns.length];
        const day = String(index + 1).padStart(2, '0');
        const publishedAt = `2026-08-${day}T04:00:00.000Z`;
        const editVersionId = demoUuid(0x205 + accountIndex, index + 1);
        const historyRow = contentSchema.parse({
          ...content, id: demoUuid(0x200 + accountIndex, index + 1), clientId: hierarchy.client.id,
          brandId: hierarchy.brand.id, storeId: hierarchy.store.id, accountId: hierarchy.account.id, monthlyPlanId: null,
          title: `${hierarchy.account.accountName}·${pattern.suffix}${Math.floor(index / historyPatterns.length) + 1}`,
          contentType: pattern.contentType, contentGoal: pattern.contentGoal, topic: `${pattern.topic}·${hierarchy.product}`,
          angle: `${pattern.angle}，场景为${hierarchy.localScene}`, hookType: pattern.hookType, hookText: pattern.hook,
          coreMessage: `${pattern.message}本条只使用已确认的${hierarchy.product}信息。`, productText: hierarchy.product,
          ctaType: pattern.contentGoal === 'gmv' ? '查看适用团购' : '关注后续真实记录', localElement: hierarchy.localScene,
          peopleJson: [hierarchy.persona], status: 'PUBLISHED', priority: 'normal', operatorId: DEMO_IDS.operator,
          plannedPublishDate: publishedAt, publishedAt, deadline: null,
          externalId: `demo-${hierarchy.slug}-${index + 1}`,
          importDedupKey: externalDedupKey(`demo-${hierarchy.slug}-${index + 1}`), importBatchId: null,
          currentScriptVersionId: null, activeApprovedScriptVersionId: null, editorId: DEMO_IDS.editor,
          currentEditVersionId: editVersionId, activeApprovedEditVersionId: editVersionId, aiReviewStatus: null,
          createdBy: DEMO_IDS.owner, isDemo: true, createdAt: publishedAt, updatedAt: now,
        });
        if (options.reset) db.insert(contents).values(historyRow).onConflictDoUpdate({
          target: contents.id, set: historyRow,
          setWhere: and(eq(contents.organizationId, DEMO_IDS.organization), eq(contents.isDemo, true)),
        }).run();
        else db.insert(contents).values(historyRow).onConflictDoNothing().run();

        db.insert(editVersions).values({
          id: editVersionId, organizationId: DEMO_IDS.organization, contentId: historyRow.id, versionNo: 1,
          assetUrl: `demo-assets/${hierarchy.slug}/history-${index + 1}.mp4`, assetType: 'local_reference',
          note: '仅供 ContentOS 联调的 Demo 成片引用', createdBy: DEMO_IDS.editor, isDemo: true, createdAt: publishedAt,
        }).onConflictDoNothing().run();

        const publishId = demoUuid(0x210 + accountIndex, index + 1);
        const existingPublish = db.select({ id: publishes.id }).from(publishes).where(and(
          eq(publishes.organizationId, DEMO_IDS.organization), eq(publishes.id, publishId),
        )).get();
        if (!existingPublish) {
          db.update(contents).set({ status: 'READY_TO_PUBLISH', publishedAt: null, updatedAt: now }).where(and(
            eq(contents.organizationId, DEMO_IDS.organization), eq(contents.id, historyRow.id),
          )).run();
          db.insert(publishes).values({
            id: publishId, organizationId: DEMO_IDS.organization, contentId: historyRow.id, platform: 'douyin',
            publishedAt, postUrl: `https://www.douyin.com/video/demo-${hierarchy.slug}-${index + 1}`,
            platformPostId: `demo-${hierarchy.slug}-${index + 1}`, status: 'active', createdBy: DEMO_IDS.owner,
            isDemo: true, createdAt: publishedAt,
          }).run();
          db.update(contents).set({ status: 'PUBLISHED', publishedAt, updatedAt: now }).where(and(
            eq(contents.organizationId, DEMO_IDS.organization), eq(contents.id, historyRow.id),
          )).run();
        }
        const finalViews = index === 3 ? 60_000 : index === 4 ? 1_500 : index === 5 ? 600 : 4_000 + index * 650;
        const finalClicks = index === 4 ? 220 : Math.floor(finalViews * 0.025);
        const finalOrders = index === 4 ? 44 : Math.floor(finalClicks * 0.12);
        const finalGmv = index === 4 ? 5_200 : finalOrders * 96;
        for (const [snapshotIndex, ratio] of [0.45, 1].entries()) {
          const views = Math.floor(finalViews * ratio);
          db.insert(performanceSnapshots).values({
            id: demoUuid(0x230 + accountIndex * 2 + snapshotIndex, index + 1), organizationId: DEMO_IDS.organization,
            publishId, snapshotTime: `2026-08-${day}T${snapshotIndex === 0 ? '12' : '20'}:00:00.000Z`,
            views, likes: Math.floor(views * (index === 5 ? 0.006 : 0.045)), comments: Math.floor(views * 0.006),
            shares: Math.floor(views * 0.004), favorites: Math.floor(views * 0.008), profileVisits: Math.floor(views * 0.018),
            groupbuyClicks: Math.floor(finalClicks * ratio), orders: Math.floor(finalOrders * ratio), gmv: Math.round(finalGmv * ratio * 100) / 100,
            isDemo: true, createdAt: `2026-08-${day}T${snapshotIndex === 0 ? '12' : '20'}:01:00.000Z`,
          }).onConflictDoNothing().run();
        }
        const sourceHash = contentSourceHash(historyRow);
        db.insert(contentEmbeddings).values({
          id: demoUuid(0x250 + accountIndex, index + 1), organizationId: DEMO_IDS.organization,
          accountId: hierarchy.account.id, contentId: historyRow.id, embeddingModel: 'fallback:zh-bigram-v1',
          sourceHash, vectorJson: weightedTermVector([
            historyRow.title, historyRow.topic, historyRow.angle, historyRow.hookText, historyRow.coreMessage,
          ].join('\n')), status: 'active', isDemo: true, createdAt: now, updatedAt: now,
        }).onConflictDoUpdate({ target: contentEmbeddings.id, set: {
          embeddingModel: 'fallback:zh-bigram-v1', sourceHash,
          vectorJson: weightedTermVector([historyRow.title, historyRow.topic, historyRow.angle, historyRow.hookText, historyRow.coreMessage].join('\n')),
          status: 'active', updatedAt: now,
        } }).run();
      }
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

    for (const [hierarchyIndex, hierarchy] of additionalHierarchies.entries()) {
      for (const [memoryIndex, memory] of [
        { scopeType: 'brand' as const, scopeId: hierarchy.brand.id, memoryKey: 'brand.positioning', memoryType: 'brand' as const,
          valueJson: hierarchy.brand.brandPositioning, summary: `品牌定位：${hierarchy.brand.brandPositioning}`, importance: 5, sourceId: hierarchy.brand.id },
        { scopeType: 'brand' as const, scopeId: hierarchy.brand.id, memoryKey: 'brand.core_products', memoryType: 'brand' as const,
          valueJson: hierarchy.brand.coreProductsJson, summary: `核心产品：${hierarchy.brand.coreProductsJson.join('、')}`, importance: 5, sourceId: hierarchy.brand.id },
        { scopeType: 'brand' as const, scopeId: hierarchy.brand.id, memoryKey: 'brand.core_selling_points', memoryType: 'brand' as const,
          valueJson: hierarchy.brand.coreSellingPointsJson, summary: `核心卖点：${hierarchy.brand.coreSellingPointsJson.join('、')}`, importance: 5, sourceId: hierarchy.brand.id },
        { scopeType: 'account' as const, scopeId: hierarchy.account.id, memoryKey: 'account.goals', memoryType: 'preference' as const,
          valueJson: hierarchy.account.accountGoalJson, summary: `账号目标：${hierarchy.account.accountGoalJson.join('、')}`, importance: 4, sourceId: hierarchy.account.id },
        { scopeType: 'account' as const, scopeId: hierarchy.account.id, memoryKey: 'account.content_style', memoryType: 'preference' as const,
          valueJson: hierarchy.account.contentStyleJson, summary: `内容风格：${hierarchy.account.contentStyleJson.join('、')}`, importance: 4, sourceId: hierarchy.account.id },
        { scopeType: 'account' as const, scopeId: hierarchy.account.id, memoryKey: 'account.forbidden_style', memoryType: 'preference' as const,
          valueJson: hierarchy.account.forbiddenStyleJson, summary: `禁用风格：${hierarchy.account.forbiddenStyleJson.join('、')}`, importance: 5, sourceId: hierarchy.account.id },
      ].entries()) {
        db.insert(memories).values(memorySchema.parse({
          ...memory, id: demoUuid(0x270 + hierarchyIndex, memoryIndex + 1), organizationId: DEMO_IDS.organization,
          confidence: 1, sourceType: 'brand_profile', effectiveAt: now, expiresAt: null, status: 'active',
          supersedesMemoryId: null, createdBy: DEMO_IDS.owner, isDemo: true, createdAt: now,
        })).onConflictDoNothing().run();
      }
    }

    const lifecycleMemories = [
      {
        id: DEMO_IDS.supersededGroupbuyPriceMemory, memoryKey: 'campaign.groupbuy_price', memoryType: 'temporary' as const,
        valueJson: { price: 99, currency: 'CNY', demo_only: true }, summary: '旧团购价99元（已替代的Demo信息）',
        importance: 5, confidence: 1, sourceType: 'manual' as const, sourceId: DEMO_IDS.account,
        effectiveAt: '2026-07-01T00:00:00.000Z', status: 'superseded' as const, supersedesMemoryId: null,
      },
      {
        id: DEMO_IDS.activeGroupbuyPriceMemory, memoryKey: 'campaign.groupbuy_price', memoryType: 'temporary' as const,
        valueJson: { price: 88, currency: 'CNY', demo_only: true }, summary: '当前团购价88元（仅供Demo流程验证）',
        importance: 5, confidence: 1, sourceType: 'manual' as const, sourceId: DEMO_IDS.account,
        effectiveAt: '2026-09-01T00:00:00.000Z', status: 'active' as const,
        supersedesMemoryId: DEMO_IDS.supersededGroupbuyPriceMemory,
      },
      {
        id: DEMO_IDS.confirmedPreferenceMemory, memoryKey: 'preference.presentation', memoryType: 'preference' as const,
        valueJson: ['保留现场口语', '先讲真实细节'], summary: '已确认Demo偏好：保留现场口语，先讲真实细节',
        importance: 4, confidence: 1, sourceType: 'confirmed_preference' as const, sourceId: DEMO_IDS.account,
        effectiveAt: '2026-08-01T00:00:00.000Z', status: 'active' as const, supersedesMemoryId: null,
      },
      {
        id: DEMO_IDS.confirmedPerformanceMemory, memoryKey: 'performance.persona_opening', memoryType: 'performance_pattern' as const,
        valueJson: { observation: '人设开门准备类内容播放高', sample_scope: 'demo' },
        summary: '已确认Demo表现规律：真实开门准备人设内容更容易获得播放',
        importance: 4, confidence: 0.8, sourceType: 'confirmed_performance' as const, sourceId: demoUuid(0x200, 4),
        effectiveAt: '2026-09-01T00:00:00.000Z', status: 'active' as const, supersedesMemoryId: null,
      },
      {
        id: DEMO_IDS.confirmedStrategyMemory, memoryKey: 'strategy.next_period', memoryType: 'strategy' as const,
        valueJson: { keep: ['老板人设', '食材细节'], test: ['顾客视角'], demo_only: true },
        summary: '已确认Demo策略：保留老板人设和食材细节，测试顾客视角',
        importance: 5, confidence: 0.85, sourceType: 'confirmed_strategy' as const, sourceId: DEMO_IDS.monthlyPlan,
        effectiveAt: '2026-09-01T00:00:00.000Z', status: 'active' as const, supersedesMemoryId: null,
      },
    ];
    for (const memory of lifecycleMemories) db.insert(memories).values(memorySchema.parse({
      ...memory, organizationId: DEMO_IDS.organization, scopeType: 'account', scopeId: DEMO_IDS.account,
      expiresAt: null, createdBy: DEMO_IDS.owner, isDemo: true, createdAt: now,
    })).onConflictDoNothing().run();

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
