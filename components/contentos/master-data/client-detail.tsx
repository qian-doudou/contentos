'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { clientDetailSchema, clientListSchema, type Hierarchy } from '@/lib/master-data/contracts';
import { BusinessBadge, cooperationLabels, DateText, EmptyData, ErrorData, LoadingData, PageHeading, useApiData } from './common';
import { EditorDialog, MasterDataForm } from './editor';
import { HierarchyView } from './hierarchy';

export function NewClientPage() {
  const state = useApiData('/api/clients?pageSize=1', clientListSchema);
  const router = useRouter();
  return <div className="space-y-6"><PageHeading title="新建客户" description="建立合作档案，再添加品牌、门店和抖音账号。"><Button variant="outline" nativeButton={false} render={<Link href="/clients" />}>返回客户</Button></PageHeading>
    {state.loading ? <LoadingData /> : state.error ? <ErrorData error={state.error} retry={state.reload} /> : state.data && (
      state.data.permissions.canWrite
        ? <section className="surface-card max-w-4xl"><MasterDataForm kind="client" owners={state.data.filters.owners} onSaved={id => router.push('/clients/' + id + '?created=1')} /></section>
        : <section className="surface-card"><EmptyData title="无创建权限" description="当前身份可查看已授权客户，不能创建或修改业务主数据。" /></section>
    )}
  </div>;
}
export function ClientDetailPage({ id }: { id: string }) {
  const state = useApiData('/api/clients/' + id, clientDetailSchema);
  const owners = useApiData('/api/clients?pageSize=1', clientListSchema);
  const [notice, setNotice] = useState('');
  if (state.loading || owners.loading) return <LoadingData />;
  if (state.error) return <ErrorData error={state.error} retry={state.reload} />;
  if (owners.error) return <ErrorData error={owners.error} retry={owners.reload} />;
  if (!state.data || !owners.data) return null;
  const { client, owner } = state.data;
  const hierarchy: Hierarchy = { clients: [client], brands: state.data.brands, stores: state.data.stores, accounts: state.data.accounts, permissions: state.data.permissions };
  const saved = () => { setNotice('档案已保存'); state.reload(); };
  return <div className="space-y-6">
    <PageHeading title={client.clientName} description={[client.industry, client.subIndustry].filter(Boolean).join(' / ')}>
      <Button variant="outline" nativeButton={false} render={<Link href="/clients" />}>客户列表</Button>
      {state.data.permissions.canWrite && <EditorDialog kind="client" initial={client} owners={owners.data.filters.owners} onSaved={saved} />}
    </PageHeading>
    {notice && <output className="block rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</output>}
    <section className="surface-card">
      <div className="mb-5 flex items-center justify-between"><h2 className="text-lg font-semibold">合作概况</h2><BusinessBadge value={client.status} demo={client.isDemo} /></div>
      <dl className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <div><dt className="text-sm text-slate-500">合作状态</dt><dd className="mt-2 font-medium">{cooperationLabels[client.cooperationStatus]}</dd></div>
        <div><dt className="text-sm text-slate-500">合作周期</dt><dd className="mt-2 text-sm"><DateText value={client.contractStart} /> — <DateText value={client.contractEnd} /></dd></div>
        <div><dt className="text-sm text-slate-500">月度内容目标</dt><dd className="mt-2 font-medium">{client.monthlyContentTarget} 条</dd></div>
        <div><dt className="text-sm text-slate-500">负责人</dt><dd className="mt-2 font-medium">{owner?.name || '未分配'}</dd></div>
      </dl>
      <div className="mt-5 border-t pt-4"><p className="text-sm text-slate-500">备注</p><p className="mt-2 whitespace-pre-wrap text-sm">{client.notes || '未填写'}</p></div>
    </section>
    <div className="flex items-center justify-between"><h2 className="text-xl font-semibold">品牌与账号</h2>{state.data.permissions.canWrite && <EditorDialog kind="brand" hierarchy={hierarchy} parent={{ clientId: id }} onSaved={saved} />}</div>
    <HierarchyView data={hierarchy} onSaved={saved} />
  </div>;
}
