import { z } from 'zod';
import {
  aiLedgerTypes,
  aiUsageStatuses,
  modelProfiles,
  priceConfigStatuses,
  runStatuses,
  runTypes,
} from '@/db/constants';
import { runSchema, runStepSchema } from '@/db/validation';
import { jsonSchemaDefinitionSchema } from './json-schema';

const uuid = z.uuid();
const timestamp = z.iso.datetime({ offset: true });
const shortText = z.string().trim().min(1).max(160);
const prompt = z.string().trim().min(1).max(50_000);

export const skillSchema = z.object({
  id: uuid,
  organizationId: uuid.nullable(),
  code: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[a-z][a-z0-9_]*$/),
  name: shortText,
  description: z.string().trim().max(2000),
  systemPrompt: prompt,
  userPromptTemplate: prompt,
  inputSchemaJson: jsonSchemaDefinitionSchema,
  outputSchemaJson: jsonSchemaDefinitionSchema,
  modelProfile: z.enum(modelProfiles),
  pointCost: z.number().int().nonnegative(),
  enabled: z.boolean(),
  currentVersion: z.number().int().positive(),
  isDemo: z.boolean(),
  createdAt: timestamp,
  updatedAt: timestamp,
});

export const skillVersionSchema = z.object({
  id: uuid,
  organizationId: uuid.nullable(),
  skillId: uuid,
  version: z.number().int().positive(),
  systemPrompt: prompt,
  userPromptTemplate: prompt,
  inputSchemaJson: jsonSchemaDefinitionSchema,
  outputSchemaJson: jsonSchemaDefinitionSchema,
  modelProfile: z.enum(modelProfiles),
  pointCost: z.number().int().nonnegative(),
  changeReason: z.string().trim().min(1).max(1000),
  createdBy: uuid.nullable(),
  isDemo: z.boolean(),
  createdAt: timestamp,
});

const editableSkillFields = z.object({
  name: shortText,
  description: z.string().trim().max(2000),
  systemPrompt: prompt,
  userPromptTemplate: prompt,
  inputSchemaJson: jsonSchemaDefinitionSchema,
  outputSchemaJson: jsonSchemaDefinitionSchema,
  modelProfile: z.enum(modelProfiles),
  pointCost: z.number().int().nonnegative().max(1_000_000),
  enabled: z.boolean(),
});
export const updateSkillInputSchema = editableSkillFields
  .partial()
  .extend({
    changeReason: z.string().trim().min(1).max(1000),
  })
  .strict()
  .refine((value) => Object.keys(value).some((key) => key !== 'changeReason'), {
    message: '至少修改一个 Skill 字段',
  });
export const rollbackSkillInputSchema = z
  .object({
    version: z.number().int().positive(),
    changeReason: z.string().trim().min(1).max(1000),
  })
  .strict();
export const skillTestInputSchema = z
  .object({
    input: z.record(z.string(), z.unknown()),
    clientId: uuid.nullable().optional(),
    accountId: uuid.nullable().optional(),
  })
  .strict();

export const aiUsageLogSchema = z.object({
  id: uuid,
  organizationId: uuid,
  runId: uuid,
  runStepId: uuid,
  runType: z.enum(runTypes),
  userId: uuid,
  clientId: uuid.nullable(),
  accountId: uuid.nullable(),
  skillCode: z.string(),
  skillVersion: z.number().int().positive(),
  providerRequestId: z.string().nullable(),
  model: z.string(),
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  estimatedCost: z.number().nonnegative().nullable(),
  billedPoints: z.number().int().nonnegative(),
  attempts: z.number().int().min(1).max(2),
  durationMs: z.number().int().nonnegative(),
  status: z.enum(aiUsageStatuses),
  isDemo: z.boolean(),
  createdAt: timestamp,
});

export const modelPriceConfigSchema = z.object({
  id: uuid,
  model: shortText,
  inputPricePerMillion: z.number().nonnegative().nullable(),
  outputPricePerMillion: z.number().nonnegative().nullable(),
  effectiveAt: timestamp,
  status: z.enum(priceConfigStatuses),
  createdAt: timestamp,
});
export const createModelPriceInputSchema = modelPriceConfigSchema
  .pick({
    model: true,
    inputPricePerMillion: true,
    outputPricePerMillion: true,
    effectiveAt: true,
    status: true,
  })
  .strict();

export const organizationAiQuotaSchema = z
  .object({
    id: uuid,
    organizationId: uuid,
    periodStart: timestamp,
    periodEnd: timestamp,
    quotaPoints: z.number().int().nonnegative(),
    usedPoints: z.number().int().nonnegative(),
    isDemo: z.boolean(),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .refine(
    (value) =>
      value.periodStart < value.periodEnd &&
      value.usedPoints <= value.quotaPoints,
    'AI 额度数据无效',
  );

export const aiPointLedgerSchema = z.object({
  id: uuid,
  organizationId: uuid,
  runId: uuid.nullable(),
  skillCode: z.string(),
  points: z.number().int().positive(),
  ledgerType: z.enum(aiLedgerTypes),
  reason: z.string(),
  isDemo: z.boolean(),
  createdAt: timestamp,
});

export const skillListDataSchema = z.object({
  items: z.array(skillSchema),
  total: z.number().int().nonnegative(),
  permissions: z.object({ canWrite: z.boolean(), canTest: z.boolean() }),
});
export const skillDetailDataSchema = z.object({
  skill: skillSchema,
  versions: z.array(skillVersionSchema),
  permissions: z.object({ canWrite: z.boolean(), canTest: z.boolean() }),
});
export const skillTestResultSchema = z.object({
  marker: z.literal('TEST_RUN'),
  run: runSchema,
  step: runStepSchema,
  renderedPrompt: z.object({ system: z.string(), user: z.string() }),
  rawOutput: z.string(),
  parsedJson: z.unknown(),
  schemaResult: z.object({ valid: z.boolean(), issues: z.array(z.string()) }),
  usage: aiUsageLogSchema,
  mode: z.enum(['mock', 'live']),
  attempts: z.number().int().min(1).max(2),
});

export const aiSettingsDataSchema = z.object({
  provider: z.literal('Alibaba Cloud Model Studio (Bailian)'),
  mode: z.enum(['mock', 'live']),
  models: z.object({
    light: z.string(),
    standard: z.string(),
    strong: z.string(),
  }),
  timeoutMs: z.number().int().positive(),
  retryCount: z.literal(1),
  prices: z.array(modelPriceConfigSchema),
  quota: organizationAiQuotaSchema.nullable(),
  remainingPoints: z.number().int().nonnegative(),
  permissions: z.object({ canWrite: z.boolean() }),
});

export const runListQuerySchema = z
  .object({
    runType: z.enum(runTypes).optional(),
    status: z.enum(runStatuses).optional(),
    page: z.coerce.number().int().min(1).max(100_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();
export const runListItemSchema = runSchema.extend({
  steps: z.array(runStepSchema),
  usage: z.array(aiUsageLogSchema),
});
export const runListDataSchema = z.object({
  items: z.array(runListItemSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});

export type Skill = z.infer<typeof skillSchema>;
export type SkillVersion = z.infer<typeof skillVersionSchema>;
export type SkillListData = z.infer<typeof skillListDataSchema>;
export type SkillDetailData = z.infer<typeof skillDetailDataSchema>;
export type SkillTestResult = z.infer<typeof skillTestResultSchema>;
export type AiSettingsData = z.infer<typeof aiSettingsDataSchema>;
export type RunListData = z.infer<typeof runListDataSchema>;
