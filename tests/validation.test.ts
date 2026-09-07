import { describe, expect, it } from 'vitest';
import { organizationSchema, runSchema, runStepSchema } from '@/db/validation';
import { devResetInputSchema } from '@/lib/contracts';
import { accountSchema, clientSchema } from '@/lib/master-data/contracts';

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

  it('validates phase-two objects with the same enums and numeric bounds as SQLite', () => {
    expect(() => clientSchema.parse({
      ...base, updatedAt: base.createdAt, clientName: '客户', industry: '餐饮', subIndustry: '',
      cooperationStatus: 'active', contractStart: null, contractEnd: null, monthlyContentTarget: -1,
      ownerUserId: null, notes: '', status: 'active',
    })).toThrow();
    expect(() => accountSchema.parse({
      ...base, updatedAt: base.createdAt, clientId: base.id, brandId: base.id, storeId: base.id,
      platform: 'kuaishou', accountName: '账号', accountType: 'owner_ip', accountGoalJson: [],
      contentStyleJson: [], forbiddenStyleJson: [], followers: 0, status: 'active',
    })).toThrow();
  });
});
