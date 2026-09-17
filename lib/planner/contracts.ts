import { z } from 'zod';
import { contentGoals, contentTypes, duplicateLevels, hookTypes } from '@/db/constants';
import { creativeBriefSchema } from '@/lib/creative/contracts';
import { historyRetrievalItemSchema } from '@/lib/history/contracts';

const uuid = z.uuid();
const timestamp = z.iso.datetime({ offset: true });
const text = (max: number) => z.string().trim().min(1).max(max);

export const plannerInputSchema = z.object({
  accountId: uuid,
  plannedCount: z.coerce.number().int().min(1).max(20),
  shootDate: z.iso.date().nullable().optional(),
  primaryGoal: z.enum(contentGoals),
  specialRequirements: z.string().trim().max(2000).nullable().optional(),
}).strict().transform((value) => ({
  ...value,
  shootDate: value.shootDate ?? null,
  specialRequirements: value.specialRequirements || null,
}));

export const plannerItemSchema = z.object({
  title: text(160),
  content_type: z.enum(contentTypes),
  content_goal: z.enum(contentGoals),
  topic: text(300),
  angle: text(2000),
  hook_type: z.enum(hookTypes),
  hook_idea: text(2000),
  core_message: text(3000),
  recommended_reason: text(2000),
}).strict();

export const plannerOutputSchema = z.object({
  planning_summary: text(3000),
  items: z.array(plannerItemSchema).min(1).max(20),
}).strict();

export const plannerSkillInputJsonSchema = {
  type: 'object',
  properties: {
    request: {
      type: 'object',
      properties: {
        account_id: { type: 'string', minLength: 1, maxLength: 100 },
        planned_count: { type: 'integer', minimum: 1, maximum: 20 },
        shoot_date: { type: 'string', maxLength: 10 },
        primary_goal: { type: 'string', enum: [...contentGoals] },
        special_requirements: { type: 'string', maxLength: 2000 },
      },
      required: ['account_id', 'planned_count', 'shoot_date', 'primary_goal', 'special_requirements'],
      additionalProperties: false,
    },
    context: { type: 'object', properties: {}, additionalProperties: true },
    plan_gaps: { type: 'array', items: { type: 'object', properties: {}, additionalProperties: true }, maxItems: 20 },
    replacement: { type: 'object', properties: {}, additionalProperties: true },
  },
  required: ['request', 'context', 'plan_gaps', 'replacement'],
  additionalProperties: false,
} as const;

export const plannerSkillOutputJsonSchema = {
  type: 'object',
  properties: {
    planning_summary: { type: 'string', minLength: 1, maxLength: 3000 },
    items: {
      type: 'array', minItems: 1, maxItems: 20,
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', minLength: 1, maxLength: 160 },
          content_type: { type: 'string', enum: [...contentTypes] },
          content_goal: { type: 'string', enum: [...contentGoals] },
          topic: { type: 'string', minLength: 1, maxLength: 300 },
          angle: { type: 'string', minLength: 1, maxLength: 2000 },
          hook_type: { type: 'string', enum: [...hookTypes] },
          hook_idea: { type: 'string', minLength: 1, maxLength: 2000 },
          core_message: { type: 'string', minLength: 1, maxLength: 3000 },
          recommended_reason: { type: 'string', minLength: 1, maxLength: 2000 },
        },
        required: ['title', 'content_type', 'content_goal', 'topic', 'angle', 'hook_type', 'hook_idea', 'core_message', 'recommended_reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['planning_summary', 'items'],
  additionalProperties: false,
} as const;

export const qualityIssueSchema = z.object({
  code: z.enum(['forbidden_topic', 'forbidden_style', 'unverified_dynamic_fact', 'invalid_enum', 'plan_conflict']),
  message: text(1000),
  field: z.string().trim().max(100).nullable(),
  blocking: z.boolean(),
}).strict();

export const qualityCandidateResultSchema = z.object({
  candidate_id: uuid,
  status: z.enum(['passed', 'warning', 'blocked']),
  issues: z.array(qualityIssueSchema).max(20),
}).strict();

export const qualityOutputSchema = z.object({
  candidates: z.array(qualityCandidateResultSchema).max(20),
}).strict();

export const qualitySkillInputJsonSchema = {
  type: 'object',
  properties: {
    candidates: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'object', properties: {}, additionalProperties: true } },
    constraints: { type: 'object', properties: {}, additionalProperties: true },
    plan_gaps: { type: 'array', items: { type: 'object', properties: {}, additionalProperties: true }, maxItems: 20 },
  },
  required: ['candidates', 'constraints', 'plan_gaps'],
  additionalProperties: false,
} as const;

export const qualitySkillOutputJsonSchema = {
  type: 'object',
  properties: {
    candidates: {
      type: 'array', maxItems: 20,
      items: {
        type: 'object',
        properties: {
          candidate_id: { type: 'string', minLength: 1, maxLength: 100 },
          status: { type: 'string', enum: ['passed', 'warning', 'blocked'] },
          issues: {
            type: 'array', maxItems: 20,
            items: {
              type: 'object',
              properties: {
                code: { type: 'string', enum: ['forbidden_topic', 'forbidden_style', 'unverified_dynamic_fact', 'invalid_enum', 'plan_conflict'] },
                message: { type: 'string', minLength: 1, maxLength: 1000 },
                field: { type: 'string', maxLength: 100 },
                blocking: { type: 'boolean' },
              },
              required: ['code', 'message', 'field', 'blocking'], additionalProperties: false,
            },
          },
        },
        required: ['candidate_id', 'status', 'issues'], additionalProperties: false,
      },
    },
  },
  required: ['candidates'], additionalProperties: false,
} as const;

export const plannerGapSchema = z.object({
  contentType: z.enum(contentTypes),
  percentage: z.number().min(0).max(100),
  targetCount: z.number().int().nonnegative(),
  actualCount: z.number().int().nonnegative(),
  gap: z.number().int().nonnegative(),
});

export const plannerAccountSchema = z.object({
  id: uuid, accountName: z.string(), clientId: uuid, clientName: z.string(), canWrite: z.boolean(),
  currentPlan: z.object({ id: uuid, year: z.number().int(), month: z.number().int(), primaryGoal: z.enum(contentGoals), plannedContentCount: z.number().int().nonnegative() }).nullable(),
  gaps: z.array(plannerGapSchema),
});

export const plannerPageDataSchema = z.object({
  accounts: z.array(plannerAccountSchema),
  remainingPoints: z.number().int().nonnegative(),
  plannerPointCost: z.number().int().nonnegative().nullable(),
  scriptPointCost: z.number().int().nonnegative().nullable(),
  mode: z.enum(['mock', 'live']),
  permissions: z.object({ canPlan: z.boolean() }),
});

export const similarContentSchema = historyRetrievalItemSchema.pick({
  contentId: true, title: true, topic: true, angle: true, similarity: true, ruleScore: true,
});

export const plannerCandidateViewSchema = z.object({
  id: uuid,
  sequence: z.number().int().nonnegative(),
  revision: z.number().int().positive(),
  title: z.string(),
  contentType: z.enum(contentTypes),
  contentGoal: z.enum(contentGoals),
  topic: z.string(),
  angle: z.string(),
  hookType: z.enum(hookTypes),
  hookIdea: z.string(),
  coreMessage: z.string(),
  creativeBrief: creativeBriefSchema,
  recommendedReason: z.string(),
  duplicateLevel: z.enum(duplicateLevels),
  similarContents: z.array(similarContentSchema).max(10),
  duplicateReason: z.string(),
  alternativeAngles: z.array(z.string()),
  qualityStatus: z.enum(['passed', 'warning', 'blocked']),
  qualityIssues: z.array(qualityIssueSchema),
  selectable: z.boolean(),
  status: z.enum(['active', 'replaced', 'persisted', 'dismissed']),
  persistedContentId: uuid.nullable(),
});

export const plannerSessionViewSchema = z.object({
  id: uuid, runId: uuid, accountId: uuid, accountName: z.string(), monthlyPlanId: uuid.nullable(),
  contextSnapshotId: uuid.nullable(), plannedCount: z.number().int().min(1).max(20), shootDate: z.iso.date().nullable(),
  primaryGoal: z.enum(contentGoals), specialRequirements: z.string().nullable(), planningSummary: z.string(),
  status: z.enum(['generating', 'awaiting_selection', 'completed', 'failed']), plannerSkillVersion: z.number().int().positive(),
  plannerPointCost: z.number().int().nonnegative(), selectedCount: z.number().int().nonnegative(), completedAt: timestamp.nullable(),
  createdAt: timestamp, updatedAt: timestamp, candidates: z.array(plannerCandidateViewSchema), gaps: z.array(plannerGapSchema),
  run: z.object({
    status: z.enum(['queued', 'running', 'completed', 'completed_with_warnings', 'manual_review_required', 'failed', 'cancelled']),
    fallbackUsed: z.boolean(),
  }),
});

export const persistPlannerSelectionSchema = z.object({
  candidateIds: z.array(uuid).min(1).max(20),
  candidateOverrides: z.array(z.object({ candidateId: uuid, creativeBrief: creativeBriefSchema }).strict()).max(20).default([]),
}).strict().superRefine((value, context) => {
  if (new Set(value.candidateIds).size !== value.candidateIds.length)
    context.addIssue({ code: 'custom', path: ['candidateIds'], message: 'candidateIds 不能重复' });
  const overrideIds = value.candidateOverrides.map(item => item.candidateId);
  if (new Set(overrideIds).size !== overrideIds.length)
    context.addIssue({ code: 'custom', path: ['candidateOverrides'], message: '同一候选只能提交一组创意调整' });
  if (overrideIds.some(id => !value.candidateIds.includes(id)))
    context.addIssue({ code: 'custom', path: ['candidateOverrides'], message: '只能调整本次选中的候选' });
});
export const persistPlannerResultSchema = z.object({ session: plannerSessionViewSchema, contentIds: z.array(uuid), billedPoints: z.number().int().nonnegative() });
export const reanglePlannerCandidateSchema = z.object({ alternativeAngle: z.string().trim().min(1).max(500).nullable().optional() }).strict();

export type PlannerInput = z.infer<typeof plannerInputSchema>;
export type PlannerOutput = z.infer<typeof plannerOutputSchema>;
export type PlannerItem = z.infer<typeof plannerItemSchema>;
export type QualityIssue = z.infer<typeof qualityIssueSchema>;
export type PlannerPageData = z.infer<typeof plannerPageDataSchema>;
export type PlannerSessionView = z.infer<typeof plannerSessionViewSchema>;
