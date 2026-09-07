import { and, asc, count, desc, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { organizations, runSteps, runs, users } from '@/db/schema';
import { dashboardDataSchema } from '@/lib/contracts';
import { fail, ok, requestId } from '@/lib/api/envelope';
import { getLlmConfig } from '@/lib/llm/client';
import { currentMasterData } from '@/lib/api/context';

export const runtime = 'nodejs';

export async function GET() {
  const id = requestId();
  try {
    const organization = currentMasterData().organization;
    const organizationId = organization?.id;

    const userRows = organizationId
      ? db.select().from(users).where(eq(users.organizationId, organizationId)).orderBy(asc(users.createdAt)).all()
      : [];
    const runRows = organizationId
      ? db.select().from(runs).where(eq(runs.organizationId, organizationId)).orderBy(desc(runs.createdAt)).limit(20).all()
      : [];
    const steps = runRows.length
      ? db.select().from(runSteps).where(eq(runSteps.organizationId, organizationId!)).orderBy(asc(runSteps.sequence)).all()
      : [];

    const organizationCount = db.select({ value: count() }).from(organizations).where(eq(organizations.id, organization.id)).get()?.value ?? 0;
    const userCount = organizationId
      ? db.select({ value: count() }).from(users).where(eq(users.organizationId, organizationId)).get()?.value ?? 0
      : 0;
    const runCount = organizationId
      ? db.select({ value: count() }).from(runs).where(eq(runs.organizationId, organizationId)).get()?.value ?? 0
      : 0;
    const failedRunCount = organizationId
      ? db.select({ value: count() }).from(runs).where(and(eq(runs.organizationId, organizationId), eq(runs.status, 'failed'))).get()?.value ?? 0
      : 0;

    const data = dashboardDataSchema.parse({
      organization,
      metrics: { organizations: organizationCount, users: userCount, runs: runCount, failedRuns: failedRunCount },
      users: userRows,
      recentRuns: runRows.map((run) => ({ ...run, steps: steps.filter((step) => step.runId === run.id) })),
      system: { database: 'connected', llmMode: getLlmConfig().mode, phase: 2 },
      generatedAt: new Date().toISOString(),
    });

    return ok(data, id);
  } catch (error) {
    return fail(error, id);
  }
}
