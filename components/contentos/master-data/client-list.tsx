'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Plus, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { clientListSchema } from '@/lib/master-data/contracts';
import { BusinessBadge, cooperationLabels, DateText, EmptyData, ErrorData, LoadingData, PageHeading, useApiData } from './common';

export function ClientListPage() {
  const params = useSearchParams();
  const router = useRouter();
  const query = params.toString();
  const state = useApiData('/api/clients?' + query, clientListSchema);
  const data = state.data;
  function applyFilters(event: React.SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    const search = new URLSearchParams();
    new FormData(event.currentTarget).forEach((value, key) => {
      if (typeof value === 'string' && value.trim()) search.set(key, value.trim());
    });
    search.set('page', '1');
    router.push('/clients?' + search.toString());
  }
  function page(number: number) {
    const next = new URLSearchParams(query); next.set('page', String(number));
    router.push('/clients?' + next.toString());
  }
  return <div className="space-y-6">
    <PageHeading title="客户" description="合作档案、内容目标与品牌资产，一处管理。">
      {data?.permissions.canWrite && <Button nativeButton={false} render={<Link href="/clients/new" />} size="lg"><Plus />新建客户</Button>}
    </PageHeading>
    {state.loading ? <LoadingData /> : state.error ? <ErrorData error={state.error} retry={state.reload} /> : data && <>
      <form key={query} onSubmit={applyFilters} className="surface-card grid items-end gap-3 sm:grid-cols-2 xl:grid-cols-[2fr_1fr_1fr_1fr_auto_auto]">
        <label className="space-y-2 text-sm" htmlFor="client-search">搜索<Input id="client-search" name="search" placeholder="客户名称" defaultValue={params.get('search') || ''} maxLength={120} /></label>
        <label className="space-y-2 text-sm">行业<NativeSelect name="industry" className="w-full" defaultValue={params.get('industry') || ''}><option value="">全部行业</option>{data.filters.industries.map(value => <option key={value}>{value}</option>)}</NativeSelect></label>
        <label className="space-y-2 text-sm">负责人<NativeSelect name="ownerUserId" className="w-full" defaultValue={params.get('ownerUserId') || ''}><option value="">全部负责人</option>{data.filters.owners.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}</NativeSelect></label>
        <label className="space-y-2 text-sm">合作状态<NativeSelect name="cooperationStatus" className="w-full" defaultValue={params.get('cooperationStatus') || ''}><option value="">全部状态</option>{Object.entries(cooperationLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</NativeSelect></label>
        <input type="hidden" name="pageSize" value={params.get('pageSize') || '10'} />
        <Button type="submit"><Search />查询</Button><Button variant="ghost" type="button" onClick={() => router.push('/clients')}>清空</Button>
      </form>
      <section className="surface-card !p-0">
        <div className="flex items-center justify-between border-b p-5"><h2 className="font-semibold">客户档案</h2><Badge variant="outline">共 {data.total} 位客户</Badge></div>
        {data.items.length ? <Table><TableHeader><TableRow><TableHead>客户名称</TableHead><TableHead>行业 / 细分</TableHead><TableHead>负责人</TableHead><TableHead>合作状态</TableHead><TableHead>合作周期</TableHead><TableHead>月度目标</TableHead><TableHead>状态</TableHead></TableRow></TableHeader>
          <TableBody>{data.items.map(client => <TableRow key={client.id}>
            <TableCell><Link className="font-medium text-cyan-800 hover:underline" href={'/clients/' + client.id}>{client.clientName}</Link></TableCell>
            <TableCell>{client.industry}<p className="mt-1 text-xs text-slate-500">{client.subIndustry || '未填写细分'}</p></TableCell>
            <TableCell>{data.filters.owners.find(owner => owner.id === client.ownerUserId)?.name || '未分配'}</TableCell>
            <TableCell>{cooperationLabels[client.cooperationStatus]}</TableCell>
            <TableCell className="text-xs"><DateText value={client.contractStart} /> — <DateText value={client.contractEnd} /></TableCell>
            <TableCell>{client.monthlyContentTarget} 条</TableCell><TableCell><BusinessBadge value={client.status} demo={client.isDemo} /></TableCell>
          </TableRow>)}</TableBody></Table> : <EmptyData title="没有匹配的客户" description="调整搜索与筛选条件，或创建第一位客户。" />}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t p-4">
          <label className="flex items-center gap-2 text-sm text-slate-500">每页<NativeSelect aria-label="每页数量" value={String(data.pageSize)} onChange={event => { const next = new URLSearchParams(query); next.set('pageSize', event.target.value); next.set('page', '1'); router.push('/clients?' + next.toString()); }}>{[5, 10, 20, 50].map(size => <option key={size} value={size}>{size}</option>)}</NativeSelect>条</label>
          <div className="flex items-center gap-3 text-sm"><Button variant="outline" disabled={data.page <= 1} onClick={() => page(data.page - 1)}>上一页</Button><span>第 {data.page} 页 / 共 {Math.max(1, Math.ceil(data.total / data.pageSize))} 页</span><Button variant="outline" disabled={data.page * data.pageSize >= data.total} onClick={() => page(data.page + 1)}>下一页</Button></div>
        </div>
      </section>
    </>}
  </div>;
}
