'use client';

import Link from 'next/link';
import { FilePenLine, History, Search, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { contentListSchema, contentStatusLabels } from '@/lib/content/contracts';
import { EmptyData, ErrorData, LoadingData, useApiData } from '@/components/contentos/master-data/common';

const scriptStatuses = ['SCRIPTING', 'WAITING_APPROVAL', 'APPROVED', 'WAITING_SHOOT', 'SHOT', 'EDITING', 'WAITING_REVIEW', 'REVISION', 'READY_TO_PUBLISH', 'PUBLISHED', 'REVIEWED'] as const;

export function ScriptLibraryPage() {
  const state = useApiData('/api/contents?page=1&pageSize=100', contentListSchema);
  const [search, setSearch] = useState('');
  const [accountId, setAccountId] = useState('');
  const items = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (state.data?.items ?? []).filter(item => item.currentScriptVersionId && scriptStatuses.includes(item.status as typeof scriptStatuses[number]))
      .filter(item => !accountId || item.accountId === accountId)
      .filter(item => !query || [item.title, item.topic, item.accountName, item.clientName].some(value => value.toLowerCase().includes(query)));
  }, [accountId, search, state.data?.items]);

  return <div className="space-y-6">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="eyebrow">内容业务 / 脚本</p><h1 className="page-title">脚本库</h1><p className="page-description">所有已经生成或人工修改的脚本，都在对应内容的版本历史里保存。点击一条记录可继续审核、拍摄或修改。</p></div>
      <div className="flex flex-wrap gap-2"><Button variant="outline" nativeButton={false} render={<Link href="/contents" />}><History />内容工作台</Button><Button nativeButton={false} render={<Link href="/scripts/new" />}><Sparkles />脚本生成</Button></div>
    </header>
    <section className="surface-card grid gap-3 sm:grid-cols-[minmax(0,1fr)_260px]">
      <label className="space-y-1.5 text-sm" htmlFor="script-library-search"><span className="font-medium">搜索脚本</span><span className="relative block"><Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-slate-400" /><Input id="script-library-search" className="pl-9" value={search} onChange={event => setSearch(event.target.value)} placeholder="标题、选题、客户或账号" /></span></label>
      <label className="space-y-1.5 text-sm" htmlFor="script-library-account"><span className="font-medium">账号</span><NativeSelect id="script-library-account" value={accountId} onChange={event => setAccountId(event.target.value)}><option value="">全部账号</option>{state.data?.options.accounts.map(account => <option key={account.id} value={account.id}>{account.clientName} · {account.accountName}</option>)}</NativeSelect></label>
    </section>
    {state.loading ? <LoadingData /> : state.error ? <ErrorData error={state.error} retry={state.reload} /> : !state.data ? null : items.length === 0 ? <EmptyData title="还没有找到脚本记录" description="生成脚本后，它会自动出现在这里；打开任意内容详情，也能在“脚本与历史版本”里查看 V1、V2 等全部版本。"><Button nativeButton={false} render={<Link href="/scripts/new" />}><FilePenLine />开始生成脚本</Button></EmptyData> : <section className="surface-card !p-0"><div className="flex items-center justify-between border-b p-5"><div><h2 className="font-semibold">已保存脚本</h2><p className="mt-1 text-sm text-slate-500">共 {items.length} 条内容拥有脚本版本</p></div><Badge variant="outline">SQLite 实时数据</Badge></div><div className="divide-y">{items.map(item => <article className="flex flex-wrap items-center justify-between gap-4 p-5 transition-colors hover:bg-[#fbfbfa]" key={item.id}><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><Link className="truncate font-semibold text-[#37352f] hover:text-cyan-800 hover:underline" href={`/contents/${item.id}#scripts`}>{item.title}</Link><Badge variant="secondary">{contentStatusLabels[item.status]}</Badge>{item.isDemo && <Badge variant="outline">演示</Badge>}</div><p className="mt-2 text-sm text-slate-500">{item.clientName} · {item.accountName} · {item.topic || '未填写选题'}</p><p className="mt-1 text-xs text-slate-400">最近更新：{new Date(item.updatedAt).toLocaleString('zh-CN')}</p></div><div className="flex shrink-0 gap-2"><Button size="sm" variant="outline" nativeButton={false} render={<Link href={`/contents/${item.id}#scripts`} />}>查看版本历史</Button>{item.status === 'SCRIPTING' ? <Button size="sm" nativeButton={false} render={<Link href={`/scripts/new?contentId=${item.id}`} />}>继续生成</Button> : null}</div></article>)}</div></section>}
  </div>;
}
