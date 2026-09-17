'use client';

import { useState } from 'react';
import { CheckCircle2, Clock3, ExternalLink, FileText, Film, RotateCcw, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { fetchData, RequestError, useApiData } from '@/components/contentos/master-data/common';
import { ConfirmationDialog } from '@/components/contentos/confirmation-dialog';
import { editAssetTypeLabels } from '@/lib/edits/contracts';
import { publicReviewSchema, type PublicReview } from '@/lib/reviews/contracts';
import { approvalStatusLabels } from '@/lib/scripts/contracts';

const statusTone: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-700', approved: 'bg-emerald-50 text-emerald-700',
  changes_requested: 'bg-cyan-50 text-cyan-700', rejected: 'bg-rose-50 text-rose-700', expired: 'bg-slate-100 text-slate-600',
};

function shotEntries(shots: Array<Record<string, unknown>>) {
  const occurrences = new Map<string, number>();
  return shots.map((shot) => {
    const signature = JSON.stringify(shot);
    const occurrence = (occurrences.get(signature) ?? 0) + 1;
    occurrences.set(signature, occurrence);
    return { key: `${signature}:${occurrence}`, shot };
  });
}

function ReviewArtifact({ data }: { data: PublicReview }) {
  if ('script' in data) {
    const script = data.script.scriptJson;
    return <section className="rounded-2xl border bg-white p-6 shadow-sm sm:p-8">
      <div className="flex items-center gap-2"><FileText className="size-5 text-cyan-700" /><h2 className="text-lg font-semibold">{script.title}</h2></div>
      <dl className="mt-6 space-y-6">
        <div><dt className="text-xs font-semibold tracking-wide text-slate-400">开场钩子</dt><dd className="mt-2 whitespace-pre-wrap text-base leading-7 text-slate-800">{script.hook}</dd></div>
        <div><dt className="text-xs font-semibold tracking-wide text-slate-400">口播正文</dt><dd className="mt-2 whitespace-pre-wrap rounded-xl bg-slate-50 p-4 text-base leading-8 text-slate-800">{script.spoken_script}</dd></div>
        <div><dt className="text-xs font-semibold tracking-wide text-slate-400">分镜</dt><dd className="mt-3 space-y-3">{script.shots.length ? shotEntries(script.shots).map(({ key: shotKey, shot }, shotIndex) => <article className="rounded-xl border p-4" key={shotKey}><p className="mb-2 text-sm font-semibold">镜头 {shotIndex + 1}</p>{Object.entries(shot).map(([key, value]) => <p className="mt-1 text-sm leading-6 text-slate-600" key={key}><span className="font-medium text-slate-800">{key}：</span>{typeof value === 'string' ? value : JSON.stringify(value)}</p>)}</article>) : <p className="text-sm text-slate-500">未配置分镜</p>}</dd></div>
        <div className="grid gap-5 sm:grid-cols-2"><div><dt className="text-xs font-semibold tracking-wide text-slate-400">产品植入</dt><dd className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{script.product_integration || '无'}</dd></div><div><dt className="text-xs font-semibold tracking-wide text-slate-400">行动引导</dt><dd className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{script.cta || '无'}</dd></div></div>
        <div><dt className="text-xs font-semibold tracking-wide text-slate-400">话题标签</dt><dd className="mt-2 flex flex-wrap gap-2">{script.hashtags.length ? script.hashtags.map((tag) => <Badge variant="secondary" key={tag}>{tag}</Badge>) : <span className="text-sm text-slate-500">无</span>}</dd></div>
      </dl>
    </section>;
  }
  return <section className="rounded-2xl border bg-white p-6 shadow-sm sm:p-8">
    <div className="flex items-center gap-2"><Film className="size-5 text-cyan-700" /><h2 className="text-lg font-semibold">成片 V{data.edit.versionNo}</h2></div>
    <div className="mt-6 rounded-xl border bg-slate-50 p-5"><p className="text-xs font-semibold tracking-wide text-slate-400">成片素材 · {editAssetTypeLabels[data.edit.assetType]}</p>{data.edit.assetType === 'url'
      ? <a className="mt-3 inline-flex items-center gap-2 break-all text-base font-medium text-cyan-800 underline" href={data.edit.assetUrl} target="_blank" rel="noreferrer">打开成片链接<ExternalLink className="size-4" /></a>
      : <p className="mt-3 break-all font-mono text-sm text-slate-800">{data.edit.assetUrl}</p>}</div>
    <div className="mt-5"><p className="text-xs font-semibold tracking-wide text-slate-400">版本备注</p><p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-slate-700">{data.edit.note || '无备注'}</p></div>
  </section>;
}

export function PublicReviewPage({ token }: { token: string }) {
  const endpoint = `/api/review/${encodeURIComponent(token)}`;
  const state = useApiData(endpoint, publicReviewSchema);
  const [comment, setComment] = useState('');
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<PublicReview | null>(null);
  const [error, setError] = useState('');
  const [confirmation, setConfirmation] = useState<'approved' | 'changes_requested' | 'rejected' | null>(null);
  const data = result ?? state.data;

  async function decide(status: 'approved' | 'changes_requested' | 'rejected') {
    setPending(true); setError('');
    try {
      setResult(await fetchData(endpoint, publicReviewSchema, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, comment: comment.trim() }),
      }));
    } catch (reason) {
      setError(reason instanceof RequestError ? `${reason.message}（${reason.code}）` : reason instanceof Error ? reason.message : '提交失败');
    } finally { setPending(false); }
  }

  if (state.loading) return <div className="mx-auto max-w-3xl space-y-4"><div className="h-10 animate-pulse rounded-xl bg-slate-200" /><div className="h-96 animate-pulse rounded-xl bg-white" /></div>;
  if (state.error) return <div className="mx-auto max-w-xl rounded-2xl border bg-white p-8 text-center shadow-sm"><XCircle className="mx-auto size-10 text-rose-500" /><h1 className="mt-4 text-xl font-semibold">无法打开审核链接</h1><p className="mt-2 text-sm text-slate-500">{state.error.message}</p>{state.error instanceof RequestError && state.error.requestId && <p className="mt-3 text-xs text-slate-400">请求编号：{state.error.requestId}</p>}</div>;
  if (!data) return null;
  const isScript = 'script' in data;
  const artifactLabel = isScript ? '脚本' : '成片';
  const confirmationCopy = confirmation ? {
    approved: {
      title: `确认批准${artifactLabel}？`,
      description: `确认后该${artifactLabel}会设为活动批准版本，内容进入下一流程；本审核链接不能再次处理。`,
      confirmLabel: `确认批准${artifactLabel}`,
      destructive: false,
    },
    changes_requested: {
      title: `确认要求修改${artifactLabel}？`,
      description: `确认后内容会退回修改，本次意见将留档；本审核链接不能再次处理。`,
      confirmLabel: '确认要求修改',
      destructive: false,
    },
    rejected: {
      title: `确认拒绝${artifactLabel}？`,
      description: `确认后本次审核会记为拒绝，内容退回修改；该结果不能通过本链接撤销。`,
      confirmLabel: `确认拒绝${artifactLabel}`,
      destructive: true,
    },
  }[confirmation] : null;
  async function confirmDecision() {
    if (!confirmation) return;
    await decide(confirmation);
    setConfirmation(null);
  }
  return <div className="mx-auto max-w-4xl space-y-6">
    <header className="rounded-2xl bg-[#101c2c] p-6 text-white shadow-sm sm:p-8"><p className="text-xs font-semibold tracking-[0.18em] text-cyan-300">CONTENTOS · 客户{isScript ? '脚本' : '成片'}审核</p><div className="mt-4 flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-2xl font-semibold sm:text-3xl">{data.content.title}</h1><p className="mt-2 text-sm text-slate-300">{data.brand.name}{data.brand.city ? ` · ${data.brand.city}` : ''} · {isScript ? `脚本 V${data.script.versionNo}` : `成片 V${data.edit.versionNo}`}</p></div><Badge className={statusTone[data.approval.status]}>{approvalStatusLabels[data.approval.status]}</Badge></div><p className="mt-5 flex items-center gap-2 text-xs text-slate-400"><Clock3 className="size-4" />链接有效期至 {new Date(data.approval.expiresAt).toLocaleString('zh-CN')}</p></header>
    <ReviewArtifact data={data} />
    {data.approval.status === 'pending' ? <section className="rounded-2xl border bg-white p-6 shadow-sm sm:p-8"><h2 className="text-lg font-semibold">审核意见</h2><p className="mt-1 text-sm text-slate-500">意见将与本次具体版本一起留档；提交后不可重复处理。</p><Textarea className="mt-4" rows={4} maxLength={3000} value={comment} onChange={(event) => setComment(event.target.value)} placeholder="通过时可留空；要求修改或拒绝时请说明原因" disabled={pending} />{error && <p role="alert" className="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}<div className="mt-5 flex flex-wrap gap-3"><Button disabled={pending} onClick={() => setConfirmation('approved')}><CheckCircle2 />{pending ? '提交中…' : `批准${artifactLabel}`}</Button><Button disabled={pending || !comment.trim()} variant="outline" onClick={() => setConfirmation('changes_requested')}><RotateCcw />要求修改</Button><Button disabled={pending || !comment.trim()} variant="destructive" onClick={() => setConfirmation('rejected')}><XCircle />拒绝</Button></div></section>
      : <section className="rounded-2xl border bg-white p-6 text-center shadow-sm"><CheckCircle2 className="mx-auto size-9 text-emerald-600" /><h2 className="mt-3 font-semibold">本次审核已完成</h2><p className="mt-2 text-sm text-slate-500">{data.approval.comment || '未填写审核意见'}</p></section>}
    {confirmationCopy && <ConfirmationDialog open={Boolean(confirmation)} onOpenChange={(open) => { if (!open && !pending) setConfirmation(null); }} title={confirmationCopy.title} description={confirmationCopy.description} confirmLabel={confirmationCopy.confirmLabel} destructive={confirmationCopy.destructive} pending={pending} onConfirm={() => void confirmDecision()} />}
    <footer className="pb-6 text-center text-xs text-slate-400">此链接仅展示绑定的{isScript ? '脚本' : '成片'}版本，不提供其他客户或内容入口。</footer>
  </div>;
}

// Keep the historical export name so existing imports remain source-compatible.
export const PublicScriptReviewPage = PublicReviewPage;
