import { describe, expect, it } from 'vitest';
import { clientMemberSchema, organizationSchema, runSchema, runStepSchema, userSchema } from '@/db/validation';
import { devResetInputSchema } from '@/lib/contracts';
import { accountSchema, clientSchema } from '@/lib/master-data/contracts';
import {
  createContentSchema, createMonthlyPlanSchema, transitionContentInputSchema, updateContentSchema,
} from '@/lib/content/contracts';

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
      status: 'queued',
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

  it('validates all phase-three roles and client membership overrides', () => {
    for (const role of ['owner', 'admin', 'operator', 'photographer', 'editor', 'viewer'] as const)
      expect(userSchema.parse({ ...base, name: role, role, status: 'active', updatedAt: base.createdAt }).role).toBe(role);
    expect(clientMemberSchema.parse({
      ...base, clientId: base.id, userId: base.id, roleOverride: 'viewer',
    }).roleOverride).toBe('viewer');
    expect(() => clientMemberSchema.parse({ ...base, clientId: base.id, userId: base.id, roleOverride: 'root' })).toThrow();
  });

  it('validates phase-four mix totals, empty plans and stable content enums', () => {
    expect(createMonthlyPlanSchema.parse({
      accountId: base.id, year: 2026, month: 9, primaryGoal: 'exposure', plannedContentCount: 0,
    }).contentMixJson).toEqual({});
    expect(createMonthlyPlanSchema.parse({
      accountId: base.id, year: 2026, month: 9, primaryGoal: 'exposure', plannedContentCount: 0,
      contentMixJson: { persona: 50, product: 50 },
    }).contentMixJson).toEqual({ persona: 50, product: 50 });
    expect(() => createMonthlyPlanSchema.parse({
      accountId: base.id, year: 2026, month: 9, primaryGoal: 'exposure', plannedContentCount: 8,
      contentMixJson: { persona: 60, product: 30 },
    })).toThrow();
    expect(() => createMonthlyPlanSchema.parse({
      accountId: base.id, year: 2026, month: 9, primaryGoal: 'exposure', plannedContentCount: -1,
      contentMixJson: {},
    })).toThrow();

    const valid = {
      accountId: base.id, title: '老板 IP', contentType: 'persona', contentGoal: 'exposure', operatorId: base.id,
      hookType: 'local', priority: 'high', peopleJson: ['老板'],
    };
    expect(createContentSchema.parse(valid)).toMatchObject({ contentType: 'persona', hookType: 'local', priority: 'high' });
    expect(() => createContentSchema.parse({ ...valid, contentType: 'advertorial' })).toThrow();
    expect(() => createContentSchema.parse({ ...valid, contentGoal: 'sales' })).toThrow();
    expect(() => createContentSchema.parse({ ...valid, hookType: 'viral' })).toThrow();
    expect(() => createContentSchema.parse({ ...valid, priority: 'critical' })).toThrow();
    expect(() => createContentSchema.parse({ ...valid, script: '不允许写入主表' })).toThrow();
    expect(() => createContentSchema.parse({ ...valid, status: 'SCRIPTING' })).toThrow();
    expect(() => updateContentSchema.parse({ status: 'SCRIPTING' })).toThrow();
    expect(transitionContentInputSchema.parse({ newStatus: 'SCRIPTING', reason: '开始编写脚本' })).toEqual({
      newStatus: 'SCRIPTING', reason: '开始编写脚本',
    });
    expect(() => transitionContentInputSchema.parse({ newStatus: 'DONE', reason: '跳过流程' })).toThrow();
    expect(() => transitionContentInputSchema.parse({ newStatus: 'SCRIPTING', reason: '' })).toThrow();
  });
});
