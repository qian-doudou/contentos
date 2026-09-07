'use client';

import Link from 'next/link';
import { Building2, MapPin, Plus } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { hierarchySchema, type Hierarchy } from '@/lib/master-data/contracts';
import { accountTypeLabels, BusinessBadge, EmptyData, ErrorData, LoadingData, PageHeading, Tags, useApiData } from './common';
import { EditorDialog } from './editor';

export function HierarchyView({ data, onSaved }: { data: Hierarchy; onSaved: () => void }) {
  return <div className="space-y-5">{data.clients.map(client => {
    const brands = data.brands.filter(b => b.clientId === client.id);
    return <section className="surface-card space-y-5" key={client.id}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
        <div className="flex items-center gap-3"><Building2 className="size-5 text-cyan-700" /><Link href={'/clients/' + client.id} className="font-semibold text-cyan-900 hover:underline">{client.clientName}</Link><BusinessBadge value={client.status} /></div>
        <EditorDialog kind="brand" hierarchy={data} parent={{ clientId: client.id }} onSaved={onSaved} />
      </div>
      {!brands.length && <EmptyData title="尚未添加品牌" description="为客户创建品牌后，可继续添加门店和账号。" />}
      {brands.map(brand => {
        const stores = data.stores.filter(s => s.brandId === brand.id);
        return <details open className="rounded-xl border bg-slate-50/50 p-4" key={brand.id}>
          <summary className="cursor-pointer font-semibold">{brand.brandName}<span className="ml-3 text-sm font-normal text-slate-500">{brand.city || '城市未填写'} · {stores.length} 家门店</span></summary>
          <div className="mt-4 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3"><div className="space-y-2"><BusinessBadge value={brand.status} demo={brand.isDemo} /><p className="text-sm text-slate-600">{brand.brandPositioning || '品牌定位未填写'}</p><Tags values={brand.coreProductsJson} /></div><div className="flex flex-wrap gap-2"><EditorDialog kind="brand" initial={brand} hierarchy={data} onSaved={onSaved} /><EditorDialog kind="store" hierarchy={data} parent={{ brandId: brand.id, clientId: client.id }} onSaved={onSaved} /></div></div>
            {!stores.length && <EmptyData title="尚未添加门店" description="门店将承接账号与后续拍摄任务。" />}
            {stores.map(store => {
              const accounts = data.accounts.filter(a => a.storeId === store.id && a.brandId === brand.id && a.clientId === client.id);
              return <div className="overflow-hidden rounded-xl border bg-white" key={store.id}>
                <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
                  <div><p className="flex items-center gap-2 font-medium"><MapPin className="size-4 text-slate-400" />{store.storeName}</p><p className="mt-1 text-xs text-slate-500">{[store.city, store.district, store.address].filter(Boolean).join(' · ') || '地址未填写'}</p><div className="mt-2"><BusinessBadge value={store.status} demo={store.isDemo} /></div></div>
                  <div className="flex flex-wrap gap-2"><EditorDialog kind="store" initial={store} hierarchy={data} onSaved={onSaved} /><EditorDialog kind="account" hierarchy={data} parent={{ clientId: client.id, brandId: brand.id, storeId: store.id }} onSaved={onSaved} /></div>
                </div>
                {accounts.length ? <Table><TableHeader><TableRow><TableHead>抖音账号</TableHead><TableHead>类型</TableHead><TableHead>粉丝数</TableHead><TableHead>状态</TableHead></TableRow></TableHeader><TableBody>{accounts.map(account => <TableRow key={account.id}>
                  <TableCell><Link className="font-medium text-cyan-800 hover:underline" href={'/accounts/' + account.id}>{account.accountName}</Link></TableCell><TableCell>{accountTypeLabels[account.accountType]}</TableCell><TableCell>{account.followers === null ? '未录入' : account.followers.toLocaleString()}</TableCell><TableCell><BusinessBadge value={account.status} demo={account.isDemo} /></TableCell>
                </TableRow>)}</TableBody></Table> : <EmptyData title="尚未添加账号" description="添加此门店运营的抖音账号。" />}
              </div>;
            })}
          </div>
        </details>;
      })}
    </section>;
  })}</div>;
}
export function AccountsPage() {
  const state = useApiData('/api/accounts', hierarchySchema);
  const [notice, setNotice] = useState('');
  const saved = () => { setNotice('业务档案已保存'); state.reload(); };
  return <div className="space-y-6">
    <PageHeading title="品牌与账号" description="客户 → 品牌 → 门店 → 账号，沿业务归属查看全部资产。">
      <Button variant="outline" nativeButton={false} render={<Link href="/clients/new" />}><Plus />新建客户</Button>
      {state.data && <EditorDialog kind="account" hierarchy={state.data} onSaved={saved} />}
    </PageHeading>
    {notice && <output className="block rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</output>}
    {state.loading ? <LoadingData /> : state.error ? <ErrorData error={state.error} retry={state.reload} /> : state.data && (
      state.data.clients.length ? <HierarchyView data={state.data} onSaved={saved} /> : <div className="surface-card"><EmptyData title="尚无业务资产" description="先创建客户，再完善品牌、门店与账号。" /></div>
    )}
  </div>;
}
