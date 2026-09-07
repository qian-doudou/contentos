import { and, asc, count, desc, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { runSteps, runs, users } from '@/db/schema';
import { dashboardDataSchema } from '@/lib/contracts';
import { fail, ok, requestId } from '@/lib/api/envelope';
import { getLlmConfig } from '@/lib/llm/client';
import { currentPermissions } from '@/lib/api/context';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const id = requestId();
  try {
    const permissions = currentPermissions(request);
    const organization = permissions.organization;
    const organizationId = organization.id;
    const canReadOrganizationOverview = permissions.has('team.read');

    const userRows = canReadOrganizationOverview
      ? db.select().from(users).where(eq(users.organizationId, organizationId)).orderBy(asc(users.createdAt)).all()
      : [permissions.actor];
    const runRows = canReadOrganizationOverview
      ? db.select().from(runs).where(eq(runs.organizationId, organizationId)).orderBy(desc(runs.createdAt)).limit(20).all()
      : [];
    const steps = runRows.length
      ? db.select().from(runSteps).where(eq(runSteps.organizationId, organizationId!)).orderBy(asc(runSteps.sequence)).all()
      : [];
    const userCount = canReadOrganizationOverview
      ? db.select({ value: count() }).from(users).where(eq(users.organizationId, organizationId)).get()?.value ?? 0
      : 1;
    const runCount = canReadOrganizationOverview
      ? db.select({ value: count() }).from(runs).where(eq(runs.organizationId, organizationId)).get()?.value ?? 0
      : 0;
    const failedRunCount = canReadOrganizationOverview
      ? db.select({ value: count() }).from(runs).where(and(eq(runs.organizationId, organizationId), eq(runs.status, 'failed'))).get()?.value ?? 0
      : 0;

    const data = dashboardDataSchema.parse({
      organization,
      metrics: {
        organizations: 1,
        users: userCount,
        runs: runCount,
        failedRuns: failedRunCount,
      },
      users: userRows,
      recentRuns: runRows.map((run) => ({ ...run, steps: steps.filter((step) => step.runId === run.id) })),
      system: { database: 'connected', llmMode: getLlmConfig().mode, phase: 5 },
      permissions: {
        canResetDemo: permissions.has('system.dangerous'),
        canReadTeam: permissions.has('team.read'),
      },
      generatedAt: new Date().toISOString(),
    });

    return ok(data, id);
  } catch (error) {
    return fail(error, id);
  }
}
