import { z } from 'zod';
import {
  badCaseCategories, badCaseSeverities, badCaseStatuses, duplicateLevels,
  evalCaseSourceTypes, evalCaseStatuses, evalExperimentStatuses,
  evalVerdicts, improvementProposalStatuses, modelProfiles, ratingIssueTags,
} from '@/db/constants';

const uuid = z.uuid();
const timestamp = z.iso.datetime({ offset: true });
const score = z.number().int().min(1).max(5);
const shortText = z.string().trim().min(1).max(200);
const prompt = z.string().trim().min(1).max(50_000);

export const ratingFieldsSchema = z.object({
  overallScore: score,
  brandConsistency: score,
  usability: score,
  novelty: score,
  comment: z.string().trim().max(5000).default(''),
  issueTags: z.array(z.enum(ratingIssueTags)).max(10).default([]),
  markedBadCase: z.boolean().default(false),
}).strict();

export const createRatingInputSchema = ratingFieldsSchema.extend({ runId: uuid }).strict();
export const updateRatingInputSchema = ratingFieldsSchema;

export const ratingVersionSchema = ratingFieldsSchema.extend({
  id: uuid,
  organizationId: uuid,
  ratingId: uuid,
  versionNo: z.number().int().positive(),
  ratedBy: uuid,
  ratedAt: timestamp,
  createdAt: timestamp,
});

export const ratingSchema = ratingFieldsSchema.extend({
  id: uuid,
  organizationId: uuid,
  runId: uuid,
  ratedBy: uuid,
  ratedAt: timestamp,
  currentVersion: z.number().int().positive(),
  isDemo: z.boolean(),
  createdAt: timestamp,
  updatedAt: timestamp,
  versions: z.array(ratingVersionSchema).default([]),
});

export const badCaseSchema = z.object({
  id: uuid,
  organizationId: uuid,
  category: z.enum(badCaseCategories),
  severity: z.enum(badCaseSeverities),
  runId: uuid,
  stepCode: z.string().trim().min(1).max(100),
  skillCode: z.string().trim().min(1).max(100),
  skillVersion: z.number().int().positive(),
  inputSnapshot: z.unknown(),
  contextSnapshot: z.unknown(),
  output: z.unknown(),
  expectedBehavior: z.string().max(10_000),
  status: z.enum(badCaseStatuses),
  ruleGenerated: z.boolean(),
  sourceRatingId: uuid.nullable(),
  fingerprint: z.string().min(1).max(500),
  createdBy: uuid,
  isDemo: z.boolean(),
  createdAt: timestamp,
  updatedAt: timestamp,
});

export const badCaseQuerySchema = z.object({
  status: z.enum(badCaseStatuses).optional(),
  skillCode: z.string().trim().min(1).max(100).optional(),
}).strict();

export const updateBadCaseInputSchema = z.object({
  status: z.enum(badCaseStatuses).optional(),
  expectedBehavior: z.string().trim().min(1).max(10_000).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, '至少修改一个字段');

export const improvementProposalOutputSchema = z.object({
  root_cause: z.string().trim().min(1).max(5000),
  change_reason: z.string().trim().min(1).max(5000),
  new_system_prompt: prompt,
  new_user_prompt_template: prompt,
  risks: z.array(z.string().trim().min(1).max(1000)).max(20),
  affected_cases: z.array(uuid).min(1).max(20),
}).strict();

export const promptImproverInputJsonSchema = {
  type: 'object',
  properties: {
    current_skill: {
      type: 'object',
      properties: {
        code: { type: 'string' }, version: { type: 'integer', minimum: 1 },
        system_prompt: { type: 'string' }, user_prompt_template: { type: 'string' },
        input_schema_json: { type: 'string' }, output_schema_json: { type: 'string' },
      },
      required: ['code', 'version', 'system_prompt', 'user_prompt_template', 'input_schema_json', 'output_schema_json'],
      additionalProperties: false,
    },
    bad_cases: {
      type: 'array', items: {
        type: 'object', properties: {
          id: { type: 'string' }, category: { type: 'string' }, severity: { type: 'string' },
          input_snapshot_json: { type: 'string' }, context_snapshot_json: { type: 'string' },
          output_json: { type: 'string' }, expected_behavior: { type: 'string' },
        },
        required: ['id', 'category', 'severity', 'input_snapshot_json', 'context_snapshot_json', 'output_json', 'expected_behavior'],
        additionalProperties: false,
      }, minItems: 1, maxItems: 20,
    },
    constraints: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 20 },
  },
  required: ['current_skill', 'bad_cases', 'constraints'],
  additionalProperties: false,
} as const;

export const promptImproverOutputJsonSchema = {
  type: 'object',
  properties: {
    root_cause: { type: 'string', minLength: 1, maxLength: 5000 },
    change_reason: { type: 'string', minLength: 1, maxLength: 5000 },
    new_system_prompt: { type: 'string', minLength: 1, maxLength: 50000 },
    new_user_prompt_template: { type: 'string', minLength: 1, maxLength: 50000 },
    risks: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 1000 }, maxItems: 20 },
    affected_cases: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 20 },
  },
  required: ['root_cause', 'change_reason', 'new_system_prompt', 'new_user_prompt_template', 'risks', 'affected_cases'],
  additionalProperties: false,
} as const;

export const createProposalInputSchema = z.object({
  badCaseIds: z.array(uuid).min(1).max(20),
}).strict();

export const diffLineSchema = z.object({
  type: z.enum(['context', 'remove', 'add']),
  line: z.string(),
  oldLine: z.number().int().positive().nullable(),
  newLine: z.number().int().positive().nullable(),
});

export const deterministicCaseMetricsSchema = z.object({
  schemaValid: z.boolean(),
  highDuplicateDefaultViolations: z.number().int().nonnegative(),
  invalidDynamicFacts: z.number().int().nonnegative(),
  forbiddenInformationViolations: z.number().int().nonnegative(),
  supersededMemoryUses: z.number().int().nonnegative(),
  brandFactErrors: z.number().int().nonnegative(),
  duplicateLevelMatch: z.boolean().nullable(),
  keyRulesPassed: z.boolean(),
  assertionFailures: z.array(z.string()),
});

export const aggregateEvalMetricsSchema = z.object({
  sampleSize: z.number().int().nonnegative(),
  schemaPassRate: z.number().min(0).max(1),
  highDuplicateDefaultViolations: z.number().int().nonnegative(),
  invalidDynamicFacts: z.number().int().nonnegative(),
  forbiddenInformationViolations: z.number().int().nonnegative(),
  supersededMemoryUses: z.number().int().nonnegative(),
  brandFactErrors: z.number().int().nonnegative(),
  keyRulePassRate: z.number().min(0).max(1),
  averageDurationMs: z.number().nonnegative(),
  averageEstimatedCost: z.number().nonnegative().nullable(),
  unknownCostRuns: z.number().int().nonnegative(),
});

export const evalGateSchema = z.object({
  verdict: z.enum(evalVerdicts),
  canApply: z.boolean(),
  sampleSufficient: z.boolean(),
  sameInputAndContext: z.literal(true),
  sameModelProfile: z.literal(true),
  reasons: z.array(z.string()),
  improvedCaseIds: z.array(uuid),
  regressedCaseIds: z.array(uuid),
});

export const evalExperimentSchema = z.object({
  id: uuid,
  organizationId: uuid,
  proposalId: uuid,
  baselineSkillVersion: z.number().int().positive(),
  modelProfile: z.enum(modelProfiles),
  caseIds: z.array(uuid),
  runIdsA: z.array(uuid),
  runIdsB: z.array(uuid),
  status: z.enum(evalExperimentStatuses),
  verdict: z.enum(evalVerdicts),
  metricsA: aggregateEvalMetricsSchema,
  metricsB: aggregateEvalMetricsSchema,
  comparison: evalGateSchema,
  createdBy: uuid,
  isDemo: z.boolean(),
  createdAt: timestamp,
  completedAt: timestamp.nullable(),
});

export const improvementProposalSchema = z.object({
  id: uuid,
  organizationId: uuid,
  skillId: uuid,
  skillCode: z.string(),
  skillName: z.string(),
  baseSkillVersion: z.number().int().positive(),
  proposalRunId: uuid,
  rootCause: z.string(),
  changeReason: z.string(),
  oldSystemPrompt: z.string(),
  oldUserPromptTemplate: z.string(),
  newSystemPrompt: z.string(),
  newUserPromptTemplate: z.string(),
  risks: z.array(z.string()),
  affectedCases: z.array(uuid),
  status: z.enum(improvementProposalStatuses),
  appliedSkillVersion: z.number().int().positive().nullable(),
  appliedBy: uuid.nullable(),
  appliedAt: timestamp.nullable(),
  createdBy: uuid,
  isDemo: z.boolean(),
  createdAt: timestamp,
  updatedAt: timestamp,
  diff: z.object({ system: z.array(diffLineSchema), user: z.array(diffLineSchema) }),
  latestExperiment: evalExperimentSchema.nullable(),
});

export const evalAssertionsSchema = z.object({
  requiredText: z.array(z.string().min(1).max(500)).max(20).default([]),
  forbiddenText: z.array(z.string().min(1).max(500)).max(20).default([]),
  requireSchemaValid: z.boolean().default(true),
}).strict();

export const createEvalCaseInputSchema = z.object({
  sourceType: z.enum(evalCaseSourceTypes),
  sourceId: uuid.nullable().optional(),
  name: shortText,
  skillCode: z.string().trim().min(1).max(100),
  inputSnapshot: z.record(z.string(), z.unknown()),
  contextSnapshot: z.unknown().default({}),
  expectedBehavior: z.string().trim().min(1).max(10_000),
  expectedDuplicateLevel: z.enum(duplicateLevels).nullable().default(null),
  assertions: evalAssertionsSchema.default({ requiredText: [], forbiddenText: [], requireSchemaValid: true }),
}).strict();

export const evalCaseSchema = z.object({
  id: uuid,
  organizationId: uuid,
  sourceType: z.enum(evalCaseSourceTypes),
  sourceId: uuid.nullable(),
  name: z.string(),
  skillCode: z.string(),
  skillVersion: z.number().int().positive(),
  inputSnapshot: z.record(z.string(), z.unknown()),
  contextSnapshot: z.unknown(),
  expectedBehavior: z.string(),
  expectedDuplicateLevel: z.enum(duplicateLevels).nullable(),
  assertions: evalAssertionsSchema,
  status: z.enum(evalCaseStatuses),
  createdBy: uuid,
  isDemo: z.boolean(),
  createdAt: timestamp,
  updatedAt: timestamp,
});

export const runEvalInputSchema = z.object({
  evalCaseIds: z.array(uuid).min(1).max(20),
}).strict();

export const applyProposalInputSchema = z.object({
  confirm: z.literal('APPLY_EVALUATED_PROMPT'),
}).strict();

const metricGroupSchema = z.object({
  totalRuns: z.number().int().nonnegative(),
  schemaPassRate: z.number().min(0).max(1).nullable(),
  dataSufficient: z.boolean(),
});

export const qualityMetricsSchema = z.object({
  planner: metricGroupSchema.extend({
    highDuplicateDefaultViolations: z.number().int().nonnegative(),
    invalidDynamicFacts: z.number().int().nonnegative(),
  }),
  script: metricGroupSchema.extend({
    forbiddenInformationViolations: z.number().int().nonnegative(),
    supersededMemoryUses: z.number().int().nonnegative(),
    brandFactErrors: z.number().int().nonnegative(),
  }),
  duplicateJudge: metricGroupSchema.extend({
    labeledCases: z.number().int().nonnegative(),
    accuracy: z.number().min(0).max(1).nullable(),
    highRecall: z.number().min(0).max(1).nullable(),
  }),
  computedAt: timestamp,
});

export const evalDashboardDataSchema = z.object({
  ratings: z.array(ratingSchema),
  badCases: z.array(badCaseSchema),
  proposals: z.array(improvementProposalSchema),
  evalCases: z.array(evalCaseSchema),
  metrics: qualityMetricsSchema,
  permissions: z.object({ canRate: z.boolean(), canManage: z.boolean(), canApply: z.boolean() }),
});

export const scanRunsResultSchema = z.object({
  scannedRuns: z.number().int().nonnegative(),
  createdCases: z.number().int().nonnegative(),
});

export type Rating = z.infer<typeof ratingSchema>;
export type BadCase = z.infer<typeof badCaseSchema>;
export type ImprovementProposal = z.infer<typeof improvementProposalSchema>;
export type EvalCase = z.infer<typeof evalCaseSchema>;
export type EvalExperiment = z.infer<typeof evalExperimentSchema>;
export type DeterministicCaseMetrics = z.infer<typeof deterministicCaseMetricsSchema>;
export type AggregateEvalMetrics = z.infer<typeof aggregateEvalMetricsSchema>;
