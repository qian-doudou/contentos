'use client';

import { useState } from 'react';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { contentGoals, contentPriorities, contentTypes, hookTypes } from '@/db/constants';
import {
  contentGoalLabels, contentSchema, contentTypeLabels, createContentSchema, hookTypeLabels, priorityLabels,
  updateContentSchema, type Content, type ContentOptions,
} from '@/lib/content/contracts';
import { fetchData } from '@/components/contentos/master-data/common';
import { periodLabel } from './common';

type Props = {
  options: ContentOptions;
  initial?: Content;
  defaults?: { accountId?: string; planId?: string };
  onSaved: (id: string) => void;
};

function listValue(value: FormDataEntryValue | null) {
  return typeof value === 'string' ? value.split(/[\n,，、]/).map(item => item.trim()).filter(Boolean) : [];
}
function dateValue(value: FormDataEntryValue | null) {
  return typeof value === 'string' && value ? new Date(value).toISOString() : null;
}
function textValue(value: FormDataEntryValue | null) {
  return typeof value === 'string' ? value : '';
}

export function ContentForm({ options, initial, defaults, onSaved }: Props) {
  const writableAccounts = options.accounts.filter(item => item.canWrite);
  const initialAccountId = initial?.accountId || defaults?.accountId || writableAccounts[0]?.id || '';
  const [accountId, setAccountId] = useState(initialAccountId);
  const [planId, setPlanId] = useState(initial?.monthlyPlanId || defaults?.planId || '');
  const initialClientId = options.accounts.find(item => item.id === initialAccountId)?.clientId;
  const initialOperators = options.operators.filter(item => initialClientId && item.clientIds.includes(initialClientId));
  const [operatorId, setOperatorId] = useState(initial?.operatorId || initialOperators[0]?.id || '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const selectedAccount = options.accounts.find(item => item.id === accountId);
  const operatorOptions = options.operators.filter(item => selectedAccount && item.clientIds.includes(selectedAccount.clientId));
  const planOptions = options.plans.filter(item => item.accountId === accountId);
  function changeAccount(id: string) {
    const selected = options.accounts.find(item => item.id === id);
    const candidates = options.operators.filter(item => selected && item.clientIds.includes(selected.clientId));
    setAccountId(id); setPlanId(''); setOperatorId(candidates[0]?.id || '');
  }
  async function submit(event: React.SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    setPending(true); setError('');
    const form = new FormData(event.currentTarget);
    try {
      const candidate = {
        accountId,
        monthlyPlanId: planId || null,
        title: textValue(form.get('title')).trim(),
        contentType: textValue(form.get('contentType')),
        contentGoal: textValue(form.get('contentGoal')),
        topic: textValue(form.get('topic')).trim(),
        angle: textValue(form.get('angle')).trim(),
        hookType: textValue(form.get('hookType')),
        hookText: textValue(form.get('hookText')).trim(),
        coreMessage: textValue(form.get('coreMessage')).trim(),
        productText: textValue(form.get('productText')).trim(),
        ctaType: textValue(form.get('ctaType')).trim(),
        localElement: textValue(form.get('localElement')).trim(),
        peopleJson: listValue(form.get('peopleJson')),
        status: textValue(form.get('status')),
        priority: textValue(form.get('priority')),
        operatorId,
        plannedPublishDate: dateValue(form.get('plannedPublishDate')),
        deadline: dateValue(form.get('deadline')),
      };
      const payload = initial ? updateContentSchema.parse(candidate) : createContentSchema.parse(candidate);
      const result = await fetchData('/api/contents' + (initial ? '/' + initial.id : ''), contentSchema, {
        method: initial ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      onSaved(result.id);
    } catch (reason) {
      setError(reason instanceof z.ZodError ? reason.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('；') : reason instanceof Error ? reason.message : '保存失败');
    } finally { setPending(false); }
  }
  return <form className="space-y-6" onSubmit={submit}>
    <fieldset disabled={pending} className="space-y-6">
      <section><h3 className="mb-4 font-semibold">归属与目标</h3><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <label htmlFor="content-account" className="space-y-1.5 text-sm sm:col-span-2">所属账号<span className="text-rose-600"> *</span><NativeSelect id="content-account" className="w-full" required value={accountId} onChange={event => changeAccount(event.target.value)}><option value="">请选择账号</option>{writableAccounts.map(item => <option key={item.id} value={item.id}>{item.clientName} / {item.brandName} / {item.accountName}</option>)}</NativeSelect></label>
        <label htmlFor="content-plan" className="space-y-1.5 text-sm">月度计划<NativeSelect id="content-plan" className="w-full" value={planId} onChange={event => setPlanId(event.target.value)}><option value="">不归入计划</option>{planOptions.map(item => <option key={item.id} value={item.id}>{periodLabel(item.year, item.month)}{item.status === 'inactive' ? '（停用）' : ''}</option>)}</NativeSelect></label>
        <label htmlFor="content-operator" className="space-y-1.5 text-sm">运营负责人<span className="text-rose-600"> *</span><NativeSelect id="content-operator" className="w-full" required value={operatorId} onChange={event => setOperatorId(event.target.value)}><option value="">请选择</option>{operatorOptions.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</NativeSelect></label>
        <label htmlFor="content-title" className="space-y-1.5 text-sm sm:col-span-2">内容标题<span className="text-rose-600"> *</span><Input id="content-title" name="title" required maxLength={160} defaultValue={initial?.title || ''} /></label>
        <label htmlFor="content-type" className="space-y-1.5 text-sm">内容类型<NativeSelect id="content-type" className="w-full" name="contentType" defaultValue={initial?.contentType || 'persona'}>{contentTypes.map(value => <option key={value} value={value}>{contentTypeLabels[value]}</option>)}</NativeSelect></label>
        <label htmlFor="content-goal" className="space-y-1.5 text-sm">内容目标<NativeSelect id="content-goal" className="w-full" name="contentGoal" defaultValue={initial?.contentGoal || 'exposure'}>{contentGoals.map(value => <option key={value} value={value}>{contentGoalLabels[value]}</option>)}</NativeSelect></label>
        <label htmlFor="content-priority" className="space-y-1.5 text-sm">优先级<NativeSelect id="content-priority" className="w-full" name="priority" defaultValue={initial?.priority || 'normal'}>{contentPriorities.map(value => <option key={value} value={value}>{priorityLabels[value]}</option>)}</NativeSelect></label>
        <label htmlFor="content-status" className="space-y-1.5 text-sm">状态<NativeSelect id="content-status" className="w-full" name="status" defaultValue={initial?.status || 'active'}><option value="active">启用</option><option value="inactive">停用</option></NativeSelect></label>
        <label htmlFor="content-publish-date" className="space-y-1.5 text-sm">计划发布日<Input id="content-publish-date" name="plannedPublishDate" type="date" defaultValue={initial?.plannedPublishDate?.slice(0, 10) || ''} /></label>
        <label htmlFor="content-deadline" className="space-y-1.5 text-sm">截止日期<Input id="content-deadline" name="deadline" type="date" defaultValue={initial?.deadline?.slice(0, 10) || ''} /></label>
      </div></section>
      <section className="border-t pt-5"><h3 className="mb-4 font-semibold">策划结构</h3><div className="grid gap-4 sm:grid-cols-2">
        <label htmlFor="content-topic" className="space-y-1.5 text-sm">选题<Input id="content-topic" name="topic" maxLength={300} defaultValue={initial?.topic || ''} /></label>
        <label htmlFor="content-hook-type" className="space-y-1.5 text-sm">钩子类型<NativeSelect id="content-hook-type" className="w-full" name="hookType" defaultValue={initial?.hookType || 'other'}>{hookTypes.map(value => <option key={value} value={value}>{hookTypeLabels[value]}</option>)}</NativeSelect></label>
        {[
          ['angle', '切入角度', initial?.angle], ['hookText', '钩子文案', initial?.hookText],
          ['coreMessage', '核心信息', initial?.coreMessage], ['productText', '产品表达', initial?.productText],
          ['localElement', '本地元素', initial?.localElement],
        ].map(([key, label, value]) => <label htmlFor={`content-${key}`} className="space-y-1.5 text-sm" key={key}>{label}<Textarea id={`content-${key}`} name={key} rows={3} maxLength={5000} defaultValue={value || ''} /></label>)}
        <label htmlFor="content-cta" className="space-y-1.5 text-sm">行动引导类型<Input id="content-cta" name="ctaType" maxLength={300} defaultValue={initial?.ctaType || ''} /></label>
        <label htmlFor="content-people" className="space-y-1.5 text-sm">出镜人物<Textarea id="content-people" name="peopleJson" rows={3} maxLength={30100} placeholder="每行一人，或用逗号分隔" defaultValue={initial?.peopleJson.join('\n') || ''} /></label>
      </div></section>
    </fieldset>
    <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-500">本表单只保存结构化策划字段，不保存脚本正文。</p>
    {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
    <div className="flex justify-end border-t pt-4"><Button disabled={pending || !accountId || !operatorId} size="lg" type="submit">{pending ? '保存中…' : initial ? '保存修改' : '创建内容'}</Button></div>
  </form>;
}

export function ContentEditorDialog({ initial, options, onSaved }: Props) {
  const [open, setOpen] = useState(false);
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger render={<Button variant="outline" />}>编辑内容</DialogTrigger><DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-5xl"><DialogHeader><DialogTitle>编辑内容策划</DialogTitle><DialogDescription>维护内容归属、分类、钩子和发布时间，不在主表保存脚本。</DialogDescription></DialogHeader><ContentForm initial={initial} options={options} onSaved={id => { setOpen(false); onSaved(id); }} /></DialogContent></Dialog>;
}
