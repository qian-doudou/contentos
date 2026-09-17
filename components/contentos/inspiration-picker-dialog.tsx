'use client';

import { useState } from 'react';
import { Check, ExternalLink, Flame, LoaderCircle, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { fetchData } from '@/components/contentos/master-data/common';
import {
  inspirationSearchDataSchema, inspirationSelectionSchema,
  type InspirationItem, type InspirationSearchData,
} from '@/lib/inspiration/contracts';

function metric(value: number | null) {
  return value === null ? '—' : new Intl.NumberFormat('zh-CN', {
    notation: 'compact', maximumFractionDigits: 1,
  }).format(value);
}

function itemKey(item: InspirationItem) {
  return `${item.platform}:${item.sourceId}`;
}

export function InspirationPickerDialog({
  value,
  onChange,
  defaultQuery = '本地生活短视频',
}: {
  value: InspirationItem[];
  onChange: (items: InspirationItem[]) => void;
  defaultQuery?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(defaultQuery);
  const [publishedWithinDays, setPublishedWithinDays] = useState(30);
  const [limit, setLimit] = useState(12);
  const [result, setResult] = useState<InspirationSearchData>();
  const [draft, setDraft] = useState<InspirationItem[]>(value);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  function changeOpen(next: boolean) {
    setOpen(next);
    if (next) {
      setDraft(value);
      setError('');
      if (!query.trim() && defaultQuery.trim()) setQuery(defaultQuery);
    }
  }

  async function search(event: React.SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    if (query.trim().length < 2) { setError('关键词至少需要 2 个字'); return; }
    setPending(true); setError('');
    try {
      setResult(await fetchData('/api/inspirations/search', inspirationSearchDataSchema, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: 'youtube', query: query.trim(), publishedWithinDays, limit }),
      }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '公开内容采集失败');
    } finally { setPending(false); }
  }

  function toggle(item: InspirationItem, checked: boolean) {
    setError('');
    setDraft(current => {
      const key = itemKey(item);
      if (!checked) return current.filter(candidate => itemKey(candidate) !== key);
      if (current.some(candidate => itemKey(candidate) === key)) return current;
      if (current.length >= 5) { setError('最多选择 5 条参考'); return current; }
      return [...current, item];
    });
  }

  function apply() {
    if (!draft.length) { onChange([]); setOpen(false); return; }
    const parsed = inspirationSelectionSchema.safeParse(draft);
    if (!parsed.success) { setError('参考内容格式异常，请重新选择'); return; }
    onChange(parsed.data);
    setOpen(false);
  }

  return <Dialog open={open} onOpenChange={changeOpen}>
    <DialogTrigger render={<Button type="button" variant={value.length ? 'outline' : 'default'} />}>
      <Search />{value.length ? '重新选择爆款参考' : '搜索并选择爆款参考'}
    </DialogTrigger>
    <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-5xl">
      <DialogHeader>
        <DialogTitle>选择爆款参考</DialogTitle>
        <DialogDescription>搜索公开内容并选择 1–5 条。AI 只借鉴选题角度、开场和节奏，品牌事实仍以账号资料为准。</DialogDescription>
      </DialogHeader>
      <form className="grid items-end gap-3 rounded-xl border bg-slate-50/70 p-4 md:grid-cols-[minmax(14rem,1fr)_9rem_8rem_auto]" onSubmit={search}>
        <label className="space-y-1.5 text-sm" htmlFor="picker-query">搜索关键词<Input id="picker-query" value={query} maxLength={100} onChange={event => setQuery(event.target.value)} placeholder="例：上海探店、宠物医院科普" /></label>
        <label className="space-y-1.5 text-sm" htmlFor="picker-range">发布时间<NativeSelect id="picker-range" className="w-full" value={String(publishedWithinDays)} onChange={event => setPublishedWithinDays(Number(event.target.value))}><option value="7">最近 7 天</option><option value="30">最近 30 天</option><option value="90">最近 90 天</option><option value="365">最近一年</option></NativeSelect></label>
        <label className="space-y-1.5 text-sm" htmlFor="picker-limit">结果数量<NativeSelect id="picker-limit" className="w-full" value={String(limit)} onChange={event => setLimit(Number(event.target.value))}><option value="6">6 条</option><option value="12">12 条</option><option value="20">20 条</option></NativeSelect></label>
        <Button type="submit" disabled={pending}>{pending ? <LoaderCircle className="animate-spin" /> : <Search />}{pending ? '搜索中…' : '搜索'}</Button>
      </form>
      {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
      {result && <div className={`rounded-lg border p-3 text-sm ${result.mode === 'demo' ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-emerald-200 bg-emerald-50 text-emerald-900'}`}>{result.notice}</div>}
      <div className="flex items-center justify-between gap-3"><p className="text-sm font-medium">搜索结果</p><Badge variant="secondary">已选 {draft.length}/5</Badge></div>
      {!result ? <div className="rounded-xl border border-dashed p-8 text-center text-sm text-slate-500">输入与当前账号相关的关键词开始搜索。</div> : result.items.length ? <div className="grid gap-3 md:grid-cols-2">{result.items.map(item => {
        const checked = draft.some(candidate => itemKey(candidate) === itemKey(item));
        return <article key={itemKey(item)} className={`rounded-xl border p-4 ${checked ? 'border-cyan-300 bg-cyan-50/40 ring-1 ring-cyan-200' : 'bg-white'}`}>
          <label htmlFor={`picker-${item.sourceId}`} className="flex cursor-pointer items-start gap-3"><Checkbox id={`picker-${item.sourceId}`} aria-label={`选择参考：${item.title}`} className="mt-1" checked={checked} onCheckedChange={next => toggle(item, Boolean(next))} /><span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2"><Badge className="bg-rose-50 text-rose-700"><Flame />热度 {item.hotScore}</Badge><span className="text-xs text-slate-500">{item.author}</span></span><span className="mt-2 line-clamp-2 block font-medium leading-6">{item.title}</span></span></label>
          <p className="mt-3 line-clamp-3 text-sm leading-6 text-slate-600">{item.excerpt || '该公开内容没有提供简介摘要。'}</p>
          <div className="mt-3 flex items-center justify-between gap-3 border-t pt-3"><span className="text-xs text-slate-500">播放 {metric(item.views)} · 赞 {metric(item.likes)} · 评论 {metric(item.comments)}</span><Button type="button" size="sm" variant="ghost" nativeButton={false} render={<a aria-label={`查看来源：${item.title}`} href={item.sourceUrl} target="_blank" rel="noreferrer" />}>来源<ExternalLink /></Button></div>
        </article>;
      })}</div> : <div className="rounded-xl border border-dashed p-8 text-center text-sm text-slate-500">没有找到结果，请扩大时间范围或更换关键词。</div>}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => setOpen(false)}>取消</Button>
        {draft.length > 0 && <Button type="button" variant="ghost" onClick={() => setDraft([])}>清空选择</Button>}
        <Button type="button" onClick={apply}><Check />{draft.length ? `确认选择 ${draft.length} 条` : '不使用参考'}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
