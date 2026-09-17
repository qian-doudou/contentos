'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { ArrowRight, ExternalLink, Flame, LoaderCircle, Search, Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import {
  inspirationSearchDataSchema, inspirationSelectionSchema,
  type InspirationItem, type InspirationSearchData,
} from '@/lib/inspiration/contracts';
import { fetchData } from '@/components/contentos/master-data/common';

const STORAGE_KEY = 'contentos.inspiration.references';

function metric(value: number | null) {
  return value === null ? '—' : new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

export function InspirationPage() {
  const router = useRouter();
  const params = useSearchParams();
  const returnAccountId = params.get('accountId')?.trim() || '';
  const [query, setQuery] = useState('本地餐饮短视频');
  const [publishedWithinDays, setPublishedWithinDays] = useState(30);
  const [limit, setLimit] = useState(12);
  const [result, setResult] = useState<InspirationSearchData>();
  const [selected, setSelected] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  async function search(event: React.SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    if (query.trim().length < 2) { setError('关键词至少需要 2 个字'); return; }
    setPending(true); setError(''); setSelected([]);
    try {
      setResult(await fetchData('/api/inspirations/search', inspirationSearchDataSchema, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: 'youtube', query: query.trim(), publishedWithinDays, limit }),
      }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '公开内容采集失败');
    } finally { setPending(false); }
  }

  function toggle(id: string, checked: boolean) {
    setError('');
    setSelected(current => {
      if (!checked) return current.filter(item => item !== id);
      if (current.length >= 5) { setError('最多选择 5 条参考，避免外部内容压过品牌自身信息'); return current; }
      return [...current, id];
    });
  }

  function useReferences() {
    if (!result) return;
    const items = result.items.filter(item => selected.includes(item.sourceId));
    const parsed = inspirationSelectionSchema.safeParse(items);
    if (!parsed.success) { setError('请先选择 1–5 条参考内容'); return; }
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(parsed.data));
    const writerParams = new URLSearchParams({ inspirations: '1' });
    if (returnAccountId) writerParams.set('accountId', returnAccountId);
    router.push(`/scripts/new?${writerParams}`);
  }

  const directWriterHref = returnAccountId
    ? `/scripts/new?${new URLSearchParams({ accountId: returnAccountId })}`
    : '/scripts/new';

  return <div className="space-y-6">
    <header className="flex flex-wrap items-end justify-between gap-4"><div><p className="eyebrow">AI 工具 / 公开内容参考</p><h1 className="page-title">爆款灵感库</h1><p className="page-description">搜索近期高播放内容，选择值得借鉴的结构和表达，再带入 AI 写脚本。</p></div><Button variant="outline" nativeButton={false} render={<Link href={directWriterHref} />}>直接写脚本<ArrowRight /></Button></header>
    <form className="surface-card grid items-end gap-4 md:grid-cols-[minmax(16rem,1fr)_10rem_9rem_auto]" onSubmit={search}>
      <label className="space-y-1.5 text-sm" htmlFor="inspiration-query">搜索关键词<Input id="inspiration-query" value={query} onChange={event => setQuery(event.target.value)} maxLength={100} placeholder="例：上海探店、宠物医院科普" /></label>
      <label className="space-y-1.5 text-sm" htmlFor="inspiration-range">发布时间<NativeSelect id="inspiration-range" className="w-full" value={String(publishedWithinDays)} onChange={event => setPublishedWithinDays(Number(event.target.value))}><option value="7">最近 7 天</option><option value="30">最近 30 天</option><option value="90">最近 90 天</option><option value="365">最近一年</option></NativeSelect></label>
      <label className="space-y-1.5 text-sm" htmlFor="inspiration-limit">采集数量<NativeSelect id="inspiration-limit" className="w-full" value={String(limit)} onChange={event => setLimit(Number(event.target.value))}><option value="6">6 条</option><option value="12">12 条</option><option value="20">20 条</option></NativeSelect></label>
      <Button type="submit" disabled={pending}>{pending ? <LoaderCircle className="animate-spin" /> : <Search />}{pending ? '采集中…' : '采集爆款'}</Button>
    </form>
    <section className="rounded-xl border border-blue-100 bg-blue-50/60 p-4 text-sm leading-6 text-blue-900"><p className="font-medium">当前来源：YouTube 公共数据</p><p className="mt-1 text-blue-800">读取公开标题、简介和互动指标，不下载视频或绕过登录。抖音、小红书、B站可在取得合规开放接口后接入同一采集器。</p></section>
    {error && <p role="alert" className="rounded-xl bg-rose-50 p-4 text-sm text-rose-700">{error}</p>}
    {result && <>
      <div className={`rounded-xl border p-4 text-sm ${result.mode === 'demo' ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-emerald-200 bg-emerald-50 text-emerald-900'}`}>{result.notice}</div>
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">“{result.query}”参考结果</h2><p className="mt-1 text-sm text-slate-500">热度分用于结果内排序，不代表跨平台绝对排名。</p></div><Badge variant="secondary">已选 {selected.length}/5</Badge></div>
      {result.items.length ? <section className="grid gap-4 lg:grid-cols-2">{result.items.map((item: InspirationItem) => {
        const checked = selected.includes(item.sourceId);
        return <article className={`surface-card flex flex-col gap-4 transition ${checked ? '!border-cyan-300 ring-2 ring-cyan-100' : ''}`} key={item.sourceId}>
          <label htmlFor={`inspiration-${item.sourceId}`} className="flex cursor-pointer items-start gap-3"><Checkbox id={`inspiration-${item.sourceId}`} aria-label={`选择参考：${item.title}`} className="mt-1" checked={checked} onCheckedChange={value => toggle(item.sourceId, Boolean(value))} /><span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2"><Badge className="bg-rose-50 text-rose-700"><Flame />热度 {item.hotScore}</Badge><Badge variant="secondary">YouTube</Badge></span><span className="mt-3 block text-base font-semibold leading-6 text-slate-900">{item.title}</span><span className="mt-1 block text-sm text-slate-500">{item.author}{item.publishedAt ? ` · ${new Date(item.publishedAt).toLocaleDateString('zh-CN')}` : ''}</span></span></label>
          <p className="text-sm leading-6 text-slate-600">{item.excerpt || '该公开内容没有提供简介摘要。'}</p>
          <div className="flex flex-wrap gap-2">{item.hotReasons.map(reason => <Badge variant="outline" key={reason}>{reason}</Badge>)}</div>
          <div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t pt-4"><p className="text-xs text-slate-500">播放 {metric(item.views)} · 点赞 {metric(item.likes)} · 评论 {metric(item.comments)}</p><Button size="sm" variant="outline" nativeButton={false} render={<a aria-label={`查看来源：${item.title}`} href={item.sourceUrl} target="_blank" rel="noreferrer" />}>查看来源<ExternalLink /></Button></div>
        </article>;
      })}</section> : <div className="surface-card text-center text-sm text-slate-500">没有找到符合条件的公开内容，请扩大时间范围或更换关键词。</div>}
      {result.items.length > 0 && <div className="sticky bottom-4 flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-white/95 p-4 shadow-lg backdrop-blur"><p className="text-sm text-slate-600">选择 1–5 条，只提取结构、角度和公开摘要作为灵感。</p><Button disabled={!selected.length} onClick={useReferences}><Sparkles />{selected.length ? `带 ${selected.length} 条参考去写脚本` : '选择参考后去写脚本'}<ArrowRight /></Button></div>}
    </>}
  </div>;
}
