'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ArrowRight, FilePenLine, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { plannerPageDataSchema } from '@/lib/planner/contracts';
import { useApiData } from '../master-data/common';

export function ScriptStartCard() {
  const state = useApiData('/api/ai/planner', plannerPageDataSchema);
  const [accountId, setAccountId] = useState('');
  const accounts = state.data?.accounts.filter((item) => item.canWrite) ?? [];
  const selected = accounts.find((item) => item.id === accountId) ?? accounts[0];
  return <section className="grid gap-6 rounded-lg border border-[#e9e9e7] bg-white p-6 md:grid-cols-[1fr_minmax(250px,0.62fr)]" aria-labelledby="start-script-title">
    <div><div className="mb-4 flex items-center gap-2 text-sm font-medium text-[#787774]"><span className="grid size-7 place-items-center rounded-md bg-[#f1f1ef] text-[#37352f]"><FilePenLine className="size-4" /></span>快速开始</div><h2 id="start-script-title" className="text-2xl font-bold tracking-[-0.03em] text-[#37352f]">没想好拍什么？让 AI 给你选。</h2><p className="mt-3 max-w-xl text-base leading-7 text-[#787774]">品牌资料会自动带入。你只需要挑一个方向，再选你最想拍的选题。</p><p className="mt-5 flex flex-wrap gap-x-3 gap-y-2 text-sm text-[#787774]"><span>1. 选账号</span><span aria-hidden="true">→</span><span>2. 挑选题</span><span aria-hidden="true">→</span><span>3. 拿到脚本</span></p></div>
    <div className="flex flex-col justify-center gap-3 rounded-md border border-[#e9e9e7] bg-[#f7f7f5] p-4">
      {state.loading ? <output className="text-sm text-[#787774]">正在读取可用账号…</output> : state.error ? <><p role="alert" className="text-sm text-rose-700">账号加载失败，请重试。</p><Button variant="outline" onClick={state.reload}>重新加载账号</Button></> : accounts.length ? <><label htmlFor="home-script-account" className="text-sm font-medium text-[#37352f]">今天给谁生成？</label><NativeSelect id="home-script-account" className="h-10 w-full bg-white" value={selected?.id} onChange={(event) => setAccountId(event.target.value)}>{accounts.map((item) => <option value={item.id} key={item.id}>{item.clientName} · {item.accountName}</option>)}</NativeSelect><Button className="h-10 w-full" nativeButton={false} render={<Link href={`/scripts/new?accountId=${selected?.id}`} />}><Sparkles />开始生成脚本<ArrowRight /></Button><Link href="/contents" className="text-center text-sm text-[#787774] underline underline-offset-4">已有选题？继续已有内容</Link></> : <><p className="text-sm leading-6 text-[#787774]">先进入客户详情添加品牌、门店和账号，或请负责人分配客户。</p><Button nativeButton={false} render={<Link href="/clients" />}>前往客户管理<ArrowRight /></Button></>}
    </div>
  </section>;
}
