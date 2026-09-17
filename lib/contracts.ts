import { z } from 'zod';
import { organizationSchema, runSchema, runStepSchema, userSchema } from '@/db/validation';
import { personalWorkbenchSchema } from '@/lib/ops/contracts';
import { workspaceAccessSchema } from '@/lib/auth/contracts';

export const apiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
});

export const dashboardDataSchema = z.object({
  organization: organizationSchema.nullable(),
  metrics: z.object({
    organizations: z.number().int().nonnegative(),
    users: z.number().int().nonnegative(),
    runs: z.number().int().nonnegative(),
    failedRuns: z.number().int().nonnegative(),
  }),
  users: z.array(userSchema),
  recentRuns: z.array(runSchema.extend({ steps: z.array(runStepSchema) })),
  workbench: personalWorkbenchSchema,
  system: z.object({
    database: z.literal('connected'),
    llmMode: z.enum(['mock', 'live']),
    phase: z.number().int().positive(),
  }),
  permissions: z.object({
    canResetDemo: z.boolean(),
    canReadTeam: z.boolean(),
    canReadRuns: z.boolean(),
    workspaceAccess: workspaceAccessSchema,
  }),
  generatedAt: z.iso.datetime({ offset: true }),
});

export const dashboardResponseSchema = z.object({
  success: z.literal(true),
  data: dashboardDataSchema,
  error: z.null(),
  request_id: z.uuid(),
});

export const devResetInputSchema = z.object({ confirm: z.literal('RESET_DEMO') }).strict();

export const devResetDataSchema = z.object({
  organizationId: z.uuid(),
  userCount: z.number().int().nonnegative(),
  seededAt: z.iso.datetime({ offset: true }),
});

export type DashboardData = z.infer<typeof dashboardDataSchema>;
export type DashboardRun = DashboardData['recentRuns'][number];
