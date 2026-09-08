'use client';

import { useState } from 'react';
import { CheckCircle2, Clock3, FileText, RotateCcw, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { fetchData, RequestError, useApiData } from '@/components/contentos/master-data/common';
import {
  approvalStatusLabels,
  publicScriptReviewSchema,
  type PublicScriptReview,
} from '@/lib/scripts/contracts';

const statusTone: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-700',
  approved: 'bg-emerald-50 text-emerald-700',
  changes_requested: 'bg-cyan-50 text-cyan-700',
  rejected: 'bg-rose-50 text-rose-700',
  expired: 'bg-slate-100 text-slate-600',
};

export function PublicScriptReviewPage({ token }: { token: string }) {
  const endpoint = `/api/review/${encodeURIComponent(token)}`;
  const state = useApiData(endpoint, publicScriptReviewSchema);
  const [comment, setComment] = useState('');
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<PublicScriptReview | null>(null);
  const [error, setError] = useState('');
  const data = result ?? state.data;

  async function decide(status: 'approved' | 'changes_requested' | 'rejected') {
    setPending(true);
    setError('');
    try {
      setResult(await fetchData(endpoint, publicScriptReviewSchema, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, comment: comment.trim() }),
      }));
    } catch (reason) {
      setError(reason instanceof RequestError ? `${reason.message}（${reason.code}）` : reason instanceof Error ? reason.message : '提交失败');
    } finally {
      setPending(false);
    }
  }

  if (state.loading) return <div className="mx-auto max-w-3xl space-y-4"><div className="h-10 animate-pulse rounded-xl bg-slate-200" /><div className="h-96 animate-pulse rounded-xl bg-white" /></div>;
  if (state.error) return <div className="mx-auto max-w-xl rounded-2xl border bg-white p-8 text-center shadow-sm"><XCircle className="mx-auto size-10 text-rose-500" /><h1 className="mt-4 text-xl font-semibold">无法打开审核链接</h1><p className="mt-2 text-sm text-slate-500">{state.error.message}</p>{state.error instanceof RequestError && state.error.requestId && <p className="mt-3 text-xs text-slate-400">请求编号：{state.error.requestId}</p>}</div>;
  if (!data) return null;
  const script = data.script.scriptJson;
  return <div className="mx-auto max-w-4xl space-y-6">
    <header className="rounded-2xl bg-[#101c2c] p-6 text-white shadow-sm sm:p-8">
      <p className="text-xs font-semibold tracking-[0.18em] text-cyan-300">CONTENTOS · 客户脚本审核</p>
      <div className="mt-4 flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-2xl font-semibold sm:text-3xl">{data.content.title}</h1><p className="mt-2 text-sm text-slate-300">{data.brand.name}{data.brand.city ? ` · ${data.brand.city}` : ''} · 脚本 V{data.script.versionNo}</p></div><Badge className={statusTone[data.approval.status]}>{approvalStatusLabels[data.approval.status]}</Badge></div>
      <p className="mt-5 flex items-center gap-2 text-xs text-slate-400"><Clock3 className="size-4" />链接有效期至 {new Date(data.approval.expiresAt).toLocaleString('zh-CN')}</p>
    </header>

    <section className="rounded-2xl border bg-white p-6 shadow-sm sm:p-8">
      <div className="flex items-center gap-2"><FileText className="size-5 text-cyan-700" /><h2 className="text-lg font-semibold">{script.title}</h2></div>
      <dl className="mt-6 space-y-6">
        <div><dt className="text-xs font-semibold tracking-wide text-slate-400">开场钩子</dt><dd className="mt-2 whitespace-pre-wrap text-base leading-7 text-slate-800">{script.hook}</dd></div>
        <div><dt className="text-xs font-semibold tracking-wide text-slate-400">口播正文</dt><dd className="mt-2 whitespace-pre-wrap rounded-xl bg-slate-50 p-4 text-base leading-8 text-slate-800">{script.spoken_script}</dd></div>
        <div><dt className="text-xs font-semibold tracking-wide text-slate-400">分镜</dt><dd className="mt-3 space-y-3">{script.shots.length ? script.shots.map((shot, index) => <article className="rounded-xl border p-4" key={index}><p className="mb-2 text-sm font-semibold">镜头 {index + 1}</p>{Object.entries(shot).map(([key, value]) => <p className="mt-1 text-sm leading-6 text-slate-600" key={key}><span className="font-medium text-slate-800">{key}：</span>{typeof value === 'string' ? value : JSON.stringify(value)}</p>)}</article>) : <p className="text-sm text-slate-500">未配置分镜</p>}</dd></div>
        <div className="grid gap-5 sm:grid-cols-2"><div><dt className="text-xs font-semibold tracking-wide text-slate-400">产品植入</dt><dd className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{script.product_integration || '无'}</dd></div><div><dt className="text-xs font-semibold tracking-wide text-slate-400">行动引导</dt><dd className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{script.cta || '无'}</dd></div></div>
        <div><dt className="text-xs font-semibold tracking-wide text-slate-400">话题标签</dt><dd className="mt-2 flex flex-wrap gap-2">{script.hashtags.length ? script.hashtags.map((tag) => <Badge variant="secondary" key={tag}>{tag}</Badge>) : <span className="text-sm text-slate-500">无</span>}</dd></div>
      </dl>
    </section>

    {data.approval.status === 'pending' ? <section className="rounded-2xl border bg-white p-6 shadow-sm sm:p-8"><h2 className="text-lg font-semibold">审核意见</h2><p className="mt-1 text-sm text-slate-500">意见将与本次版本一起留档；提交后不可重复处理。</p><Textarea className="mt-4" rows={4} maxLength={3000} value={comment} onChange={(event) => setComment(event.target.value)} placeholder="通过时可留空；要求修改或拒绝时请说明原因" disabled={pending} />{error && <p role="alert" className="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}<div className="mt-5 flex flex-wrap gap-3"><Button disabled={pending} onClick={() => void decide('approved')}><CheckCircle2 />{pending ? '提交中…' : '批准脚本'}</Button><Button disabled={pending || !comment.trim()} variant="outline" onClick={() => void decide('changes_requested')}><RotateCcw />要求修改</Button><Button disabled={pending || !comment.trim()} variant="destructive" onClick={() => void decide('rejected')}><XCircle />拒绝</Button></div></section> : <section className="rounded-2xl border bg-white p-6 text-center shadow-sm"><CheckCircle2 className="mx-auto size-9 text-emerald-600" /><h2 className="mt-3 font-semibold">本次审核已完成</h2><p className="mt-2 text-sm text-slate-500">{data.approval.comment || '未填写审核意见'}</p></section>}
    <footer className="pb-6 text-center text-xs text-slate-400">此链接仅展示绑定的脚本版本，不提供其他客户或内容入口。</footer>
  </div>;
}
