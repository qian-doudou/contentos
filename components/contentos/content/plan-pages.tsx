'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { CalendarRange, FilePlus2, Plus } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  contentGoalLabels, contentTypeLabels, monthlyPlanDetailSchema, monthlyPlanListSchema,
} from '@/lib/content/contracts';
import { EmptyData, ErrorData, LoadingData, Tags, useApiData } from '@/components/contentos/master-data/common';
import { ActiveBadge, ContentHeading, periodLabel } from './common';
import { PlanEditorDialog, PlanForm } from './plan-form';

export function PlanListPage() {
  const params = useSearchParams();
  const router = useRouter();
  const query = params.toString();
  const state = useApiData('/api/content-plans?' + query, monthlyPlanListSchema);
  const data = state.data;
  function filter(event: React.SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    const next = new URLSearchParams();
    new FormData(event.currentTarget).forEach((value, key) => {
      if (typeof value === 'string' && value.trim()) next.set(key, value.trim());
    });
    next.set('page', '1');
    router.push('/contents/plans?' + next.toString());
  }
  function page(value: number) {
    const next = new URLSearchParams(query); next.set('page', String(value));
    router.push('/contents/plans?' + next.toString());
  }
  return <div className="space-y-6">
    <ContentHeading title="月度内容计划" description="为每个账号设定月度目标、重点产品和内容类型配比。">
      <Button variant="outline" nativeButton={false} render={<Link href="/contents" />}>内容与脚本</Button>
      {data?.permissions.canWrite && <Button nativeButton={false} render={<Link href="/contents/plans/new" />}><Plus />新建计划</Button>}
    </ContentHeading>
    {state.loading ? <LoadingData /> : state.error ? <ErrorData error={state.error} retry={state.reload} /> : data && <>
      <form className="surface-card grid items-end gap-3 sm:grid-cols-2 xl:grid-cols-[2fr_1fr_1fr_1fr_auto_auto]" key={query} onSubmit={filter}>
        <label htmlFor="plan-filter-account" className="space-y-1.5 text-sm">账号<NativeSelect id="plan-filter-account" className="w-full" name="accountId" defaultValue={params.get('accountId') || ''}><option value="">全部账号</option>{data.options.accounts.map(account => <option key={account.id} value={account.id}>{account.clientName} / {account.accountName}</option>)}</NativeSelect></label>
        <label htmlFor="plan-filter-year" className="space-y-1.5 text-sm">年份<Input id="plan-filter-year" name="year" type="number" min={2000} max={2100} defaultValue={params.get('year') || ''} /></label>
        <label htmlFor="plan-filter-month" className="space-y-1.5 text-sm">月份<NativeSelect id="plan-filter-month" className="w-full" name="month" defaultValue={params.get('month') || ''}><option value="">全部月份</option>{Array.from({ length: 12 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1} 月</option>)}</NativeSelect></label>
        <label htmlFor="plan-filter-status" className="space-y-1.5 text-sm">状态<NativeSelect id="plan-filter-status" className="w-full" name="status" defaultValue={params.get('status') || ''}><option value="">全部状态</option><option value="active">启用</option><option value="inactive">停用</option></NativeSelect></label>
        <input type="hidden" name="pageSize" value={params.get('pageSize') || '10'} /><Button type="submit">查询</Button><Button variant="ghost" type="button" onClick={() => router.push('/contents/plans')}>清空</Button>
      </form>
      <section className="surface-card !p-0">
        <div className="flex items-center justify-between border-b p-5"><h2 className="font-semibold">计划列表</h2><Badge variant="outline">共 {data.total} 个计划</Badge></div>
        {data.items.length ? <Table><TableHeader><TableRow><TableHead>月份</TableHead><TableHead>账号</TableHead><TableHead>核心目标</TableHead><TableHead>创建进度</TableHead><TableHead>状态</TableHead></TableRow></TableHeader><TableBody>{data.items.map(plan => {
          const percentage = plan.plannedContentCount ? Math.min(100, Math.round(plan.createdContentCount / plan.plannedContentCount * 100)) : 0;
          return <TableRow key={plan.id}><TableCell><Link className="font-medium text-cyan-800 hover:underline" href={'/contents/plans/' + plan.id}>{periodLabel(plan.year, plan.month)}</Link></TableCell><TableCell><p>{plan.accountName}</p><p className="mt-1 text-xs text-slate-500">{plan.clientName}</p></TableCell><TableCell>{contentGoalLabels[plan.primaryGoal]}</TableCell><TableCell className="min-w-44"><div className="mb-2 flex justify-between text-xs text-slate-500"><span>{plan.createdContentCount} / {plan.plannedContentCount}</span><span>{percentage}%</span></div><Progress value={percentage} /></TableCell><TableCell><ActiveBadge status={plan.status} demo={plan.isDemo} /></TableCell></TableRow>;
        })}</TableBody></Table> : <EmptyData title="没有匹配的月度计划" description="调整筛选条件，或为已授权账号创建第一份计划。" />}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t p-4"><span className="text-sm text-slate-500">第 {data.page} 页</span><div className="flex gap-2"><Button variant="outline" disabled={data.page <= 1} onClick={() => page(data.page - 1)}>上一页</Button><Button variant="outline" disabled={data.page * data.pageSize >= data.total} onClick={() => page(data.page + 1)}>下一页</Button></div></div>
      </section>
    </>}
  </div>;
}

export function NewPlanPage() {
  const state = useApiData('/api/content-plans?pageSize=1', monthlyPlanListSchema);
  const router = useRouter();
  return <div className="space-y-6"><ContentHeading title="新建月度计划" description="同一账号每个月份只能建立一份计划。"><Button variant="outline" nativeButton={false} render={<Link href="/contents" />}>内容与脚本</Button><Button variant="outline" nativeButton={false} render={<Link href="/contents/plans" />}>返回计划</Button></ContentHeading>
    {state.loading ? <LoadingData /> : state.error ? <ErrorData error={state.error} retry={state.reload} /> : state.data && (
      state.data.permissions.canWrite ? <section className="surface-card"><PlanForm accounts={state.data.options.accounts} onSaved={id => router.push('/contents/plans/' + id + '?created=1')} /></section>
        : <section className="surface-card"><EmptyData title="无创建权限" description="当前身份没有可管理的客户账号。" /></section>
    )}
  </div>;
}

export function PlanDetailPage({ id }: { id: string }) {
  const state = useApiData('/api/content-plans/' + id, monthlyPlanDetailSchema);
  const [notice, setNotice] = useState('');
  if (state.loading) return <LoadingData />;
  if (state.error) return <ErrorData error={state.error} retry={state.reload} />;
  if (!state.data) return null;
  const { plan, account, mixStats } = state.data;
  const gap = Math.max(0, plan.plannedContentCount - plan.createdContentCount);
  return <div className="space-y-6">
    <ContentHeading title={`${periodLabel(plan.year, plan.month)}计划`} description={`${account.clientName} / ${account.brandName} / ${account.accountName}`}>
      <Button variant="outline" nativeButton={false} render={<Link href="/contents/plans" />}>计划列表</Button>
      <Button variant="outline" nativeButton={false} render={<Link href="/contents" />}>内容与脚本</Button>
      {state.data.permissions.canWrite && <PlanEditorDialog initial={plan} accounts={[account]} onSaved={() => { setNotice('计划已保存'); state.reload(); }} />}
    </ContentHeading>
    {notice && <output className="block rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</output>}
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Card><CardHeader><CardTitle className="text-sm text-slate-500">目标数量</CardTitle></CardHeader><CardContent><p className="text-3xl font-semibold">{plan.plannedContentCount}</p></CardContent></Card>
      <Card><CardHeader><CardTitle className="text-sm text-slate-500">已创建数量</CardTitle></CardHeader><CardContent><p className="text-3xl font-semibold">{plan.createdContentCount}</p></CardContent></Card>
      <Card><CardHeader><CardTitle className="text-sm text-slate-500">待补足</CardTitle></CardHeader><CardContent><p className="text-3xl font-semibold">{gap}</p></CardContent></Card>
      <Card><CardHeader><CardTitle className="text-sm text-slate-500">核心目标</CardTitle></CardHeader><CardContent><p className="text-2xl font-semibold">{contentGoalLabels[plan.primaryGoal]}</p></CardContent></Card>
    </section>
    <section className="surface-card !p-0"><div className="flex flex-wrap items-center justify-between gap-3 border-b p-5"><div><h2 className="font-semibold">类型目标与实际</h2><p className="mt-1 text-sm text-slate-500">目标数量由计划总数和百分比确定性计算。</p></div><ActiveBadge status={plan.status} demo={plan.isDemo} /></div>
      {mixStats.length ? <Table><TableHeader><TableRow><TableHead>内容类型</TableHead><TableHead>配比</TableHead><TableHead>目标数</TableHead><TableHead>实际数</TableHead><TableHead>差额</TableHead></TableRow></TableHeader><TableBody>{mixStats.map(row => <TableRow key={row.contentType}><TableCell className="font-medium">{contentTypeLabels[row.contentType]}</TableCell><TableCell>{row.percentage}%</TableCell><TableCell>{row.targetCount}</TableCell><TableCell>{row.actualCount}</TableCell><TableCell>{row.actualCount - row.targetCount}</TableCell></TableRow>)}</TableBody></Table> : <EmptyData title="空计划" description="该计划的目标数量为 0，暂未设置内容类型配比。" />}
    </section>
    <section className="grid gap-4 lg:grid-cols-2"><article className="surface-card"><h2 className="font-semibold">重点产品</h2><div className="mt-4"><Tags values={plan.keyProductsJson} /></div></article><article className="surface-card"><h2 className="font-semibold">活动与节点备注</h2><p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-slate-600">{plan.campaignNotes || '未填写'}</p></article></section>
    <section className="surface-card flex flex-wrap items-center justify-between gap-4"><div><h2 className="font-semibold">计划内容</h2><p className="mt-1 text-sm text-slate-500">查看已归入本计划的内容，或新建一条内容。</p></div><div className="flex gap-2"><Button variant="outline" nativeButton={false} render={<Link href={'/contents?monthlyPlanId=' + plan.id} />}><CalendarRange />查看内容</Button>{state.data.permissions.canWrite && <Button nativeButton={false} render={<Link href={'/contents/new?accountId=' + plan.accountId + '&planId=' + plan.id} />}><FilePlus2 />新建内容</Button>}</div></section>
  </div>;
}
