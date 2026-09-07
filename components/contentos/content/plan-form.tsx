'use client';

import { useState } from 'react';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { contentGoals, contentTypes } from '@/db/constants';
import {
  contentGoalLabels, contentTypeLabels, createMonthlyPlanSchema, monthlyPlanSchema, updateMonthlyPlanSchema,
  type MonthlyPlan,
} from '@/lib/content/contracts';
import { fetchData } from '@/components/contentos/master-data/common';

type AccountOption = { id: string; accountName: string; clientName: string; canWrite: boolean };
type Props = {
  accounts: AccountOption[];
  initial?: MonthlyPlan;
  onSaved: (id: string) => void;
};

function listValue(value: FormDataEntryValue | null) {
  return typeof value === 'string' ? value.split(/[\n,，、]/).map(item => item.trim()).filter(Boolean) : [];
}
function textValue(value: FormDataEntryValue | null) {
  return typeof value === 'string' ? value : '';
}

export function PlanForm({ accounts, initial, onSaved }: Props) {
  const writableAccounts = accounts.filter(account => account.canWrite);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [mix, setMix] = useState<Partial<Record<(typeof contentTypes)[number], number>>>(initial?.contentMixJson ?? {});
  const mixTotal = Object.values(mix).reduce((sum, value) => sum + (value ?? 0), 0);
  async function submit(event: React.SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    setPending(true); setError('');
    const form = new FormData(event.currentTarget);
    try {
      const candidate = {
        accountId: initial?.accountId ?? textValue(form.get('accountId')),
        year: Number(textValue(form.get('year'))),
        month: Number(textValue(form.get('month'))),
        primaryGoal: textValue(form.get('primaryGoal')),
        plannedContentCount: Number(textValue(form.get('plannedContentCount'))),
        campaignNotes: textValue(form.get('campaignNotes')).trim(),
        keyProductsJson: listValue(form.get('keyProductsJson')),
        contentMixJson: Object.fromEntries(Object.entries(mix).filter(([, value]) => value !== undefined && value > 0)),
        status: textValue(form.get('status')),
      };
      const payload = initial ? updateMonthlyPlanSchema.parse(candidate) : createMonthlyPlanSchema.parse(candidate);
      const result = await fetchData('/api/content-plans' + (initial ? '/' + initial.id : ''), monthlyPlanSchema, {
        method: initial ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      onSaved(result.id);
    } catch (reason) {
      setError(reason instanceof z.ZodError ? reason.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('；') : reason instanceof Error ? reason.message : '保存失败');
    } finally { setPending(false); }
  }
  const now = new Date();
  return <form className="space-y-6" onSubmit={submit}>
    <fieldset disabled={pending} className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <label htmlFor="plan-account" className="space-y-1.5 text-sm sm:col-span-2">所属账号<span className="text-rose-600"> *</span><NativeSelect id="plan-account" className="w-full" name="accountId" required disabled={!!initial} defaultValue={initial?.accountId || ''}><option value="">请选择账号</option>{writableAccounts.map(account => <option key={account.id} value={account.id}>{account.clientName} / {account.accountName}</option>)}</NativeSelect></label>
        <label htmlFor="plan-year" className="space-y-1.5 text-sm">年份<span className="text-rose-600"> *</span><Input id="plan-year" name="year" type="number" min={2000} max={2100} step={1} required defaultValue={initial?.year ?? now.getFullYear()} /></label>
        <label htmlFor="plan-month" className="space-y-1.5 text-sm">月份<span className="text-rose-600"> *</span><NativeSelect id="plan-month" className="w-full" name="month" required defaultValue={String(initial?.month ?? now.getMonth() + 1)}>{Array.from({ length: 12 }, (_, index) => <option value={index + 1} key={index + 1}>{index + 1} 月</option>)}</NativeSelect></label>
        <label htmlFor="plan-goal" className="space-y-1.5 text-sm">核心目标<span className="text-rose-600"> *</span><NativeSelect id="plan-goal" className="w-full" name="primaryGoal" defaultValue={initial?.primaryGoal || 'exposure'}>{contentGoals.map(goal => <option value={goal} key={goal}>{contentGoalLabels[goal]}</option>)}</NativeSelect></label>
        <label htmlFor="plan-count" className="space-y-1.5 text-sm">计划内容数<span className="text-rose-600"> *</span><Input id="plan-count" name="plannedContentCount" type="number" min={0} step={1} required defaultValue={initial?.plannedContentCount ?? 0} /></label>
        <label htmlFor="plan-status" className="space-y-1.5 text-sm">状态<NativeSelect id="plan-status" className="w-full" name="status" defaultValue={initial?.status || 'active'}><option value="active">启用</option><option value="inactive">停用</option></NativeSelect></label>
        <label htmlFor="plan-products" className="space-y-1.5 text-sm sm:col-span-2">重点产品<Textarea id="plan-products" name="keyProductsJson" rows={3} maxLength={30100} placeholder="每行一项，或用逗号分隔" defaultValue={initial?.keyProductsJson.join('\n') || ''} /></label>
        <label htmlFor="plan-campaign" className="space-y-1.5 text-sm sm:col-span-2 lg:col-span-4">活动与节点备注<Textarea id="plan-campaign" name="campaignNotes" rows={3} maxLength={5000} defaultValue={initial?.campaignNotes || ''} /></label>
      </div>
      <section className="rounded-xl border bg-slate-50/70 p-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-medium">内容配比</h3><p className="mt-1 text-sm text-slate-500">有计划数量时合计必须为 100%；数量为 0 时可全部留空。</p></div><span className={mixTotal === 100 || mixTotal === 0 ? 'text-sm font-semibold text-emerald-700' : 'text-sm font-semibold text-rose-700'}>当前合计 {mixTotal}%</span></div>
        <div className="grid gap-3 sm:grid-cols-3">{contentTypes.map(type => <label htmlFor={`mix-${type}`} className="space-y-1.5 text-sm" key={type}>{contentTypeLabels[type]}<div className="relative"><Input id={`mix-${type}`} aria-label={`${contentTypeLabels[type]}百分比`} className="pr-8" type="number" min={0} max={100} step={1} value={mix[type] ?? 0} onChange={event => setMix(current => ({ ...current, [type]: Number(event.target.value) }))} /><span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">%</span></div></label>)}</div>
      </section>
    </fieldset>
    {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
    <div className="flex justify-end border-t pt-4"><Button disabled={pending || writableAccounts.length === 0} size="lg" type="submit">{pending ? '保存中…' : initial ? '保存修改' : '创建月度计划'}</Button></div>
  </form>;
}

export function PlanEditorDialog({ initial, accounts, onSaved }: Props) {
  const [open, setOpen] = useState(false);
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger render={<Button variant="outline" />}>编辑计划</DialogTrigger><DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl"><DialogHeader><DialogTitle>编辑月度计划</DialogTitle><DialogDescription>调整目标、配比和运营节点；所属账号创建后不可更换。</DialogDescription></DialogHeader><PlanForm initial={initial} accounts={accounts} onSaved={id => { setOpen(false); onSaved(id); }} /></DialogContent></Dialog>;
}
