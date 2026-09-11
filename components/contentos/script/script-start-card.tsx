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
  return <section className="grid gap-6 rounded-2xl border border-cyan-200 bg-white p-6 shadow-sm md:grid-cols-[1fr_minmax(240px,0.7fr)] lg:p-7" aria-labelledby="start-script-title">
    <div><div className="mb-3 flex items-center gap-2 text-sm font-semibold text-cyan-700"><FilePenLine className="size-5" />先把今天要拍的脚本写出来</div><h2 id="start-script-title" className="text-2xl font-semibold">没想好拍什么？让AI给你选。</h2><p className="mt-3 max-w-xl text-base leading-7 text-slate-500">自动参考品牌资料，给你几个选题。选中喜欢的，就能生成口播和分镜。</p><p className="mt-5 flex flex-wrap gap-x-3 gap-y-2 text-sm font-medium text-slate-600"><span>1 选账号</span><span aria-hidden="true">→</span><span>2 挑选题</span><span aria-hidden="true">→</span><span>3 拿到脚本</span></p></div>
    <div className="flex flex-col justify-center gap-3 rounded-xl bg-slate-50 p-4">
      {state.loading ? <output className="text-sm text-slate-500">正在读取可用账号…</output> : state.error ? <><p role="alert" className="text-sm text-rose-700">账号加载失败，请重试。</p><Button variant="outline" onClick={state.reload}>重新加载账号</Button></> : accounts.length ? <><label htmlFor="home-script-account" className="text-sm font-medium">今天给谁写？</label><NativeSelect id="home-script-account" className="h-11 w-full bg-white" value={selected?.id} onChange={(event) => setAccountId(event.target.value)}>{accounts.map((item) => <option value={item.id} key={item.id}>{item.clientName} · {item.accountName}</option>)}</NativeSelect><Button className="h-12 w-full text-base" nativeButton={false} render={<Link href={`/scripts/new?accountId=${selected?.id}`} />}><Sparkles />开始写脚本<ArrowRight /></Button><Link href="/contents" className="text-center text-sm text-slate-500 underline underline-offset-4">已有选题？继续已有内容</Link></> : <><p className="text-sm leading-6 text-slate-600">先添加品牌账号，或请负责人为你分配客户。</p><Button nativeButton={false} render={<Link href="/accounts" />}>添加 / 查看账号<ArrowRight /></Button></>}
    </div>
  </section>;
}
