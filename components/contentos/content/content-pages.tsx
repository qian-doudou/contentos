'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { LayoutDashboard, List, Plus } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { contentGoals, contentPriorities, contentStatuses, contentTypes } from '@/db/constants';
import {
  contentDetailSchema, contentGoalLabels, contentListSchema, contentStatusLabels, contentTypeLabels, hookTypeLabels,
  priorityLabels,
} from '@/lib/content/contracts';
import { EmptyData, ErrorData, LoadingData, Tags, useApiData } from '@/components/contentos/master-data/common';
import { ContentHeading, ContentNav, formatLocalDate, periodLabel } from './common';
import { ContentEditorDialog, ContentForm } from './content-form';
import { ContentWorkflowPanel } from './workflow-panel';
import { WorkflowBoard, WorkflowStatusBadge } from './workflow-board';

const priorityTone: Record<string, string> = {
  low: 'bg-slate-100 text-slate-600', normal: 'bg-cyan-50 text-cyan-700', high: 'bg-amber-50 text-amber-700', urgent: 'bg-rose-50 text-rose-700',
};

export function ContentListPage() {
  const params = useSearchParams();
  const router = useRouter();
  const query = params.toString();
  const state = useApiData('/api/contents?' + query, contentListSchema);
  const data = state.data;
  const [view, setView] = useState<'kanban' | 'table'>('kanban');
  function filter(event: React.SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    const next = new URLSearchParams();
    new FormData(event.currentTarget).forEach((value, key) => {
      if (typeof value === 'string' && value.trim()) next.set(key, value.trim());
    });
    next.set('page', '1');
    router.push('/contents?' + next.toString());
  }
  function page(value: number) {
    const next = new URLSearchParams(query); next.set('page', String(value));
    router.push('/contents?' + next.toString());
  }
  return <div className="space-y-6">
    <ContentHeading title="内容策划" description="用结构化字段管理选题、角度、钩子、本地元素和发布时间。">
      <Button variant="outline" nativeButton={false} render={<Link href="/contents/import" />}>历史导入</Button>
      {data?.permissions.canWrite && <Button nativeButton={false} render={<Link href="/contents/new" />}><Plus />新建内容</Button>}
    </ContentHeading>
    <ContentNav />
    {state.loading ? <LoadingData /> : state.error ? <ErrorData error={state.error} retry={state.reload} /> : data && <>
      <form className="surface-card grid items-end gap-3 sm:grid-cols-2 xl:grid-cols-8" key={query} onSubmit={filter}>
        <label htmlFor="content-filter-search" className="space-y-1.5 text-sm">搜索<Input id="content-filter-search" name="search" maxLength={160} placeholder="标题或选题" defaultValue={params.get('search') || ''} /></label>
        <label htmlFor="content-filter-account" className="space-y-1.5 text-sm">账号<NativeSelect id="content-filter-account" className="w-full" name="accountId" defaultValue={params.get('accountId') || ''}><option value="">全部账号</option>{data.options.accounts.map(item => <option key={item.id} value={item.id}>{item.clientName} / {item.accountName}</option>)}</NativeSelect></label>
        <label htmlFor="content-filter-type" className="space-y-1.5 text-sm">类型<NativeSelect id="content-filter-type" className="w-full" name="contentType" defaultValue={params.get('contentType') || ''}><option value="">全部类型</option>{contentTypes.map(value => <option key={value} value={value}>{contentTypeLabels[value]}</option>)}</NativeSelect></label>
        <label htmlFor="content-filter-goal" className="space-y-1.5 text-sm">目标<NativeSelect id="content-filter-goal" className="w-full" name="contentGoal" defaultValue={params.get('contentGoal') || ''}><option value="">全部目标</option>{contentGoals.map(value => <option key={value} value={value}>{contentGoalLabels[value]}</option>)}</NativeSelect></label>
        <label htmlFor="content-filter-priority" className="space-y-1.5 text-sm">优先级<NativeSelect id="content-filter-priority" className="w-full" name="priority" defaultValue={params.get('priority') || ''}><option value="">全部级别</option>{contentPriorities.map(value => <option key={value} value={value}>{priorityLabels[value]}</option>)}</NativeSelect></label>
        <label htmlFor="content-filter-status" className="space-y-1.5 text-sm">状态<NativeSelect id="content-filter-status" className="w-full" name="status" defaultValue={params.get('status') || ''}><option value="">全部状态</option>{contentStatuses.map(value => <option key={value} value={value}>{contentStatusLabels[value]}</option>)}</NativeSelect></label>
        {params.get('monthlyPlanId') && <input type="hidden" name="monthlyPlanId" value={params.get('monthlyPlanId') || ''} />}
        <input type="hidden" name="pageSize" value={params.get('pageSize') || '12'} /><Button type="submit">查询</Button><Button variant="ghost" type="button" onClick={() => router.push('/contents')}>清空</Button>
      </form>
      <section className="surface-card !p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b p-5"><div className="flex items-center gap-3"><h2 className="font-semibold">内容工作台</h2><Badge variant="outline">共 {data.total} 条</Badge></div><div className="flex gap-2"><Button size="sm" variant={view === 'kanban' ? 'default' : 'outline'} onClick={() => setView('kanban')}><LayoutDashboard />看板</Button><Button size="sm" variant={view === 'table' ? 'default' : 'outline'} onClick={() => setView('table')}><List />表格</Button></div></div>
        {data.items.length && view === 'kanban' ? <div className="p-4"><WorkflowBoard key={data.items.map(item => `${item.id}:${item.updatedAt}`).join('|')} data={data} onChanged={state.reload} /></div> : data.items.length ? <Table><TableHeader><TableRow><TableHead>内容</TableHead><TableHead>账号 / 月度</TableHead><TableHead>类型 / 目标</TableHead><TableHead>运营</TableHead><TableHead>发布 / 截止</TableHead><TableHead>优先级</TableHead><TableHead>状态</TableHead></TableRow></TableHeader><TableBody>{data.items.map(item => <TableRow key={item.id}>
          <TableCell className="max-w-80"><Link className="font-medium text-cyan-800 hover:underline" href={'/contents/' + item.id}>{item.title}</Link><p className="mt-1 line-clamp-1 text-xs text-slate-500">{item.topic || '选题未填写'}</p></TableCell>
          <TableCell><p>{item.accountName}</p><p className="mt-1 text-xs text-slate-500">{item.planYear && item.planMonth ? periodLabel(item.planYear, item.planMonth) : '未归入月度计划'}</p></TableCell>
          <TableCell><Badge variant="secondary">{contentTypeLabels[item.contentType]}</Badge><span className="ml-2 text-sm text-slate-500">{contentGoalLabels[item.contentGoal]}</span></TableCell>
          <TableCell>{item.operatorName}</TableCell><TableCell className="text-xs"><p>{formatLocalDate(item.plannedPublishDate)}</p><p className="mt-1 text-slate-400">{formatLocalDate(item.deadline)}</p></TableCell>
          <TableCell><Badge variant="secondary" className={priorityTone[item.priority]}>{priorityLabels[item.priority]}</Badge></TableCell><TableCell><div className="flex flex-wrap gap-2"><WorkflowStatusBadge status={item.status} />{item.overdue ? <Badge variant="destructive">已逾期</Badge> : item.dueSoon ? <Badge className="bg-amber-50 text-amber-700">临近截止</Badge> : null}{item.isDemo && <Badge variant="outline">演示</Badge>}</div></TableCell>
        </TableRow>)}</TableBody></Table> : <EmptyData title="没有匹配的内容" description="调整筛选条件，或创建第一条结构化内容策划。" />}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t p-4"><span className="text-sm text-slate-500">第 {data.page} 页</span><div className="flex gap-2"><Button variant="outline" disabled={data.page <= 1} onClick={() => page(data.page - 1)}>上一页</Button><Button variant="outline" disabled={data.page * data.pageSize >= data.total} onClick={() => page(data.page + 1)}>下一页</Button></div></div>
      </section>
    </>}
  </div>;
}

export function NewContentPage() {
  const state = useApiData('/api/contents?pageSize=1', contentListSchema);
  const params = useSearchParams();
  const router = useRouter();
  return <div className="space-y-6"><ContentHeading title="新建内容策划" description="建立结构化内容档案，脚本正文将由后续版本表承载。"><Button variant="outline" nativeButton={false} render={<Link href="/contents" />}>返回内容</Button></ContentHeading><ContentNav />
    {state.loading ? <LoadingData /> : state.error ? <ErrorData error={state.error} retry={state.reload} /> : state.data && (
      state.data.permissions.canWrite ? <section className="surface-card"><ContentForm options={state.data.options} defaults={{ accountId: params.get('accountId') || undefined, planId: params.get('planId') || undefined }} onSaved={id => router.push('/contents/' + id + '?created=1')} /></section>
        : <section className="surface-card"><EmptyData title="无创建权限" description="当前身份没有可管理的客户账号。" /></section>
    )}
  </div>;
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return <div><dt className="text-sm text-slate-500">{label}</dt><dd className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-800">{value || '未填写'}</dd></div>;
}

export function ContentDetailPage({ id }: { id: string }) {
  const state = useApiData('/api/contents/' + id, contentDetailSchema);
  const [notice, setNotice] = useState('');
  if (state.loading) return <LoadingData />;
  if (state.error) return <ErrorData error={state.error} retry={state.reload} />;
  if (!state.data) return null;
  const item = state.data.content;
  return <div className="space-y-6">
    <ContentHeading title={item.title} description={`${item.clientName} / ${item.brandName} / ${item.storeName} / ${item.accountName}`}>
      <Button variant="outline" nativeButton={false} render={<Link href="/contents" />}>内容列表</Button>{state.data.permissions.canWrite && <ContentEditorDialog initial={item} options={state.data.options} onSaved={() => { setNotice('内容已保存'); state.reload(); }} />}
    </ContentHeading><ContentNav />
    {notice && <output className="block rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</output>}
    <section className="surface-card"><div className="flex flex-wrap items-start justify-between gap-4"><div className="flex flex-wrap gap-2"><Badge>{contentTypeLabels[item.contentType]}</Badge><Badge variant="secondary">{contentGoalLabels[item.contentGoal]}</Badge><Badge variant="secondary" className={priorityTone[item.priority]}>{priorityLabels[item.priority]}</Badge>{item.overdue ? <Badge variant="destructive">已逾期</Badge> : item.dueSoon ? <Badge className="bg-amber-50 text-amber-700">临近截止</Badge> : null}</div><div className="flex gap-2"><WorkflowStatusBadge status={item.status} />{item.isDemo && <Badge variant="outline">演示</Badge>}</div></div>
      <dl className="mt-6 grid gap-5 sm:grid-cols-2 xl:grid-cols-4"><Field label="运营负责人" value={item.operatorName} /><Field label="月度计划" value={item.planYear && item.planMonth ? periodLabel(item.planYear, item.planMonth) : '未归入'} /><Field label="计划发布日" value={formatLocalDate(item.plannedPublishDate)} /><Field label="截止日期" value={formatLocalDate(item.deadline)} /></dl>
    </section>
    <section className="grid gap-4 lg:grid-cols-2"><article className="surface-card"><h2 className="text-lg font-semibold">选题与切入</h2><dl className="mt-5 space-y-5"><Field label="选题" value={item.topic} /><Field label="切入角度" value={item.angle} /><Field label="核心信息" value={item.coreMessage} /></dl></article><article className="surface-card"><h2 className="text-lg font-semibold">钩子与转化</h2><dl className="mt-5 space-y-5"><Field label="钩子类型" value={hookTypeLabels[item.hookType]} /><Field label="钩子文案" value={item.hookText} /><Field label="行动引导" value={item.ctaType} /></dl></article></section>
    <section className="grid gap-4 lg:grid-cols-3"><article className="surface-card"><h2 className="font-semibold">产品表达</h2><p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-slate-600">{item.productText || '未填写'}</p></article><article className="surface-card"><h2 className="font-semibold">本地元素</h2><p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-slate-600">{item.localElement || '未填写'}</p></article><article className="surface-card"><h2 className="font-semibold">出镜人物</h2><div className="mt-4"><Tags values={item.peopleJson} /></div></article></section>
    <ContentWorkflowPanel content={item} onChanged={state.reload} />
    <section className="surface-card border-dashed"><h2 className="font-semibold">脚本与剪辑版本</h2><p className="mt-2 text-sm leading-6 text-slate-500">contents 主表不保存脚本正文。当前脚本、已批准脚本、剪辑版本与 AI 审核状态均为空，将在后续阶段通过独立版本表接入。</p></section>
  </div>;
}
