'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { accountDetailSchema, hierarchySchema } from '@/lib/master-data/contracts';
import { accountTypeLabels, BusinessBadge, ErrorData, LoadingData, PageHeading, Tags, useApiData } from './common';
import { EditorDialog } from './editor';

export function AccountDetailPage({ id }: { id: string }) {
  const state = useApiData('/api/accounts/' + id, accountDetailSchema);
  const hierarchy = useApiData('/api/accounts', hierarchySchema);
  const [notice, setNotice] = useState('');
  if (state.loading || hierarchy.loading) return <LoadingData />;
  if (state.error) return <ErrorData error={state.error} retry={state.reload} />;
  if (hierarchy.error) return <ErrorData error={hierarchy.error} retry={hierarchy.reload} />;
  if (!state.data || !hierarchy.data) return null;
  const { account, client, brand, store, contentStats } = state.data;
  return <div className="space-y-6">
    <PageHeading title={account.accountName} description={`抖音 · ${accountTypeLabels[account.accountType]} · ${store.city || '城市未填写'}`}>
      <Button variant="outline" nativeButton={false} render={<Link href="/accounts" />}>品牌与账号</Button>{state.data.permissions.canWrite && <EditorDialog kind="account" initial={account} hierarchy={hierarchy.data} onSaved={() => { setNotice('账号已保存'); state.reload(); hierarchy.reload(); }} />}
    </PageHeading>
    {notice && <output className="block rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</output>}
    <section className="surface-card space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-slate-500"><Link href={'/clients/' + client.id} className="text-cyan-800 hover:underline">{client.clientName}</Link> / {brand.brandName} / {store.storeName}</p><BusinessBadge value={account.status} demo={account.isDemo} /></div>
      <div className="grid gap-5 sm:grid-cols-[1fr_auto]"><div><h2 className="text-sm text-slate-500">品牌定位</h2><p className="mt-2 text-xl font-semibold">{brand.brandPositioning || '未填写定位'}</p></div><div><p className="text-sm text-slate-500">粉丝数</p><p className="mt-1 text-3xl font-semibold">{account.followers === null ? '未录入' : account.followers.toLocaleString()}</p></div></div>
      <div className="grid gap-5 border-t pt-5 sm:grid-cols-2"><div><p className="mb-3 text-sm text-slate-500">核心产品</p><Tags values={brand.coreProductsJson} /></div><div><p className="mb-3 text-sm text-slate-500">核心卖点</p><Tags values={brand.coreSellingPointsJson} /></div></div>
    </section>
    <section className="grid gap-4 lg:grid-cols-3">{[
      { title: '账号目标', values: account.accountGoalJson }, { title: '内容风格', values: account.contentStyleJson },
      { title: '禁用风格', values: account.forbiddenStyleJson },
    ].map(item => <article className="surface-card" key={item.title}><h2 className="mb-4 font-semibold">{item.title}</h2><Tags values={item.values} /></article>)}</section>
    <section className="surface-card"><h2 className="text-lg font-semibold">内容统计</h2><p className="mt-2 text-sm text-slate-500">后续阶段接入内容与发布记录；当前统计为占位，不代表实际经营数据。</p><div className="mt-5 grid grid-cols-2 gap-4"><div className="rounded-xl bg-slate-50 p-4"><p className="text-sm text-slate-500">内容总量</p><p className="mt-2 text-2xl">{contentStats.total}</p></div><div className="rounded-xl bg-slate-50 p-4"><p className="text-sm text-slate-500">已发布</p><p className="mt-2 text-2xl">{contentStats.published}</p></div></div></section>
  </div>;
}
