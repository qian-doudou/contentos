import { z } from 'zod';
import {
  organizationStatuses,
  runStatuses,
  runStepStatuses,
  runTypes,
  userRoles,
  userStatuses,
} from './constants';

const uuidSchema = z.uuid();
const isoDateSchema = z.iso.datetime({ offset: true });
const nullableIsoDateSchema = isoDateSchema.nullable();

export const organizationSchema = z.object({
  id: uuidSchema,
  name: z.string().trim().min(1).max(120),
  status: z.enum(organizationStatuses),
  isDemo: z.boolean(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});

export const userSchema = z.object({
  id: uuidSchema,
  organizationId: uuidSchema,
  name: z.string().trim().min(1).max(80),
  role: z.enum(userRoles),
  status: z.enum(userStatuses),
  isDemo: z.boolean(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});

export const appSettingSchema = z.object({
  id: uuidSchema,
  organizationId: uuidSchema,
  key: z.string().trim().min(1).max(100),
  valueJson: z.string(),
  isSecret: z.boolean(),
  isDemo: z.boolean(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});

export const runSchema = z.object({
  id: uuidSchema,
  organizationId: uuidSchema,
  runType: z.enum(runTypes),
  subjectType: z.string().trim().min(1).max(100),
  subjectId: z.string().trim().min(1).max(120).nullable(),
  status: z.enum(runStatuses),
  startedAt: nullableIsoDateSchema,
  finishedAt: nullableIsoDateSchema,
  createdBy: uuidSchema.nullable(),
  isDemo: z.boolean(),
  createdAt: isoDateSchema,
});

export const runStepSchema = z.object({
  id: uuidSchema,
  organizationId: uuidSchema,
  runId: uuidSchema,
  sequence: z.number().int().nonnegative(),
  stepCode: z.string().trim().min(1).max(100),
  status: z.enum(runStepStatuses),
  inputJson: z.string().nullable(),
  outputJson: z.string().nullable(),
  errorJson: z.string().nullable(),
  startedAt: nullableIsoDateSchema,
  finishedAt: nullableIsoDateSchema,
  durationMs: z.number().int().nonnegative().nullable(),
  warningCodesJson: z.string().nullable(),
  isDemo: z.boolean(),
});

export const auditLogSchema = z.object({
  id: uuidSchema,
  organizationId: uuidSchema,
  userId: uuidSchema.nullable(),
  action: z.string().trim().min(1).max(120),
  entityType: z.string().trim().min(1).max(100),
  entityId: z.string().trim().min(1).max(120).nullable(),
  metadataJson: z.string().nullable(),
  isDemo: z.boolean(),
  createdAt: isoDateSchema,
});

export type Organization = z.infer<typeof organizationSchema>;
export type User = z.infer<typeof userSchema>;
export type Run = z.infer<typeof runSchema>;
export type RunStep = z.infer<typeof runStepSchema>;

