import { describe, expect, it } from 'vitest';
import { organizationSchema, runSchema, runStepSchema } from '@/db/validation';
import { devResetInputSchema } from '@/lib/contracts';

const base = {
  id: '0198f744-8e18-7ae2-a780-52a0e20c1931',
  organizationId: '0198f744-8e18-7ae2-a780-52a0e20c1931',
  isDemo: true,
  createdAt: '2026-09-07T01:00:00.000Z',
};

describe('business schemas', () => {
  it('accepts the demo organization and rejects array-index ids', () => {
    expect(organizationSchema.parse({
      id: base.id,
      name: '星火本地生活运营有限公司',
      status: 'active',
      isDemo: true,
      createdAt: base.createdAt,
      updatedAt: base.createdAt,
    }).isDemo).toBe(true);
    expect(() => organizationSchema.parse({ id: '0' })).toThrow();
  });

  it('validates run and step enums consistently', () => {
    const run = runSchema.parse({
      ...base,
      runType: 'eval',
      subjectType: 'script',
      subjectId: null,
      status: 'pending',
      startedAt: null,
      finishedAt: null,
      createdBy: null,
    });
    expect(run.runType).toBe('eval');
    expect(() => runStepSchema.parse({ ...base, runId: base.id, sequence: -1 })).toThrow();
  });

  it('requires explicit demo reset confirmation', () => {
    expect(devResetInputSchema.parse({ confirm: 'RESET_DEMO' })).toEqual({ confirm: 'RESET_DEMO' });
    expect(() => devResetInputSchema.parse({ confirm: 'yes' })).toThrow();
  });
});

