'use client';

import Link from 'next/link';
import { useState } from 'react';
import { z } from 'zod';
import { Bot, CheckCircle2, ClipboardCheck, Copy, ExternalLink, FilePlus2, History, RotateCcw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { EmptyData, fetchData, RequestError, useApiData } from '@/components/contentos/master-data/common';
import { memoryInitializationResultSchema } from '@/lib/memory/contracts';
import {
  approvalReviewerTypeLabels,
  approvalStatusLabels,
  createManualScriptSchema,
  generateScriptResultSchema,
  scriptSourceTypeLabels,
  scriptWorkspaceSchema,
  submitApprovalResultSchema,
  type ScriptJson,
  type ScriptWorkspace,
} from '@/lib/scripts/contracts';

const approvalTone: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-700', approved: 'bg-emerald-50 text-emerald-700',
  changes_requested: 'bg-cyan-50 text-cyan-700', rejected: 'bg-rose-50 text-rose-700', expired: 'bg-slate-100 text-slate-500',
};

function errorMessage(reason: unknown) {
  if (reason instanceof z.ZodError) return reason.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('；');
  if (reason instanceof RequestError) return `${reason.message}（${reason.code}）`;
  return reason instanceof Error ? reason.message : '操作失败';
}

function formText(form: FormData, name: string, fallback = '') {
  const value = form.get(name);
  return typeof value === 'string' ? value : fallback;
}

function ScriptBody({ script }: { script: ScriptJson }) {
  const [copyNotice, setCopyNotice] = useState('');
  async function copySpoken() {
    try { await navigator.clipboard.writeText(script.spoken_script); setCopyNotice('口播已复制'); }
    catch { setCopyNotice('自动复制失败，请长按或选中口播正文复制。'); }
  }
  return <dl className="space-y-4 text-sm">
    <div><dt className="text-xs font-medium text-slate-400">开场钩子</dt><dd className="mt-1 whitespace-pre-wrap leading-6 text-slate-700">{script.hook}</dd></div>
    <div><dt className="flex items-center justify-between gap-3 text-xs font-medium text-slate-400">口播正文<Button size="sm" variant="outline" onClick={() => void copySpoken()}><Copy />复制口播</Button></dt><dd className="mt-2"><p className="whitespace-pre-wrap rounded-lg bg-slate-50 p-4 text-base leading-8 text-slate-700">{script.spoken_script}</p>{copyNotice && <output className="mt-2 block text-xs text-cyan-800">{copyNotice}</output>}</dd></div>
    <div><dt className="text-xs font-medium text-slate-400">分镜</dt><dd className="mt-2 grid gap-2 sm:grid-cols-2">{script.shots.length ? script.shots.map((shot, index) => <div className="rounded-lg border p-3" key={JSON.stringify(shot)}><p className="font-medium">镜头 {index + 1}</p>{Object.entries(shot).map(([key, value]) => <p className="mt-1 text-xs leading-5 text-slate-500" key={key}><span className="text-slate-700">{key}：</span>{typeof value === 'string' ? value : JSON.stringify(value)}</p>)}</div>) : <p className="text-slate-500">未配置分镜</p>}</dd></div>
    <div className="grid gap-4 sm:grid-cols-2"><div><dt className="text-xs font-medium text-slate-400">产品植入</dt><dd className="mt-1 whitespace-pre-wrap leading-6 text-slate-700">{script.product_integration || '无'}</dd></div><div><dt className="text-xs font-medium text-slate-400">行动引导</dt><dd className="mt-1 whitespace-pre-wrap leading-6 text-slate-700">{script.cta || '无'}</dd></div></div>
    <div><dt className="text-xs font-medium text-slate-400">话题标签</dt><dd className="mt-2 flex flex-wrap gap-2">{script.hashtags.length ? script.hashtags.map((tag) => <Badge variant="secondary" key={tag}>{tag}</Badge>) : <span className="text-slate-500">无</span>}</dd></div>
  </dl>;
}

function ManualScriptDialog({ data, onSaved }: { data: ScriptWorkspace; onSaved: (message: string) => void }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const current = data.versions.find((version) => version.isCurrent);
  async function submit(event: React.SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    setPending(true); setError('');
    try {
      const form = new FormData(event.currentTarget);
      const shots = JSON.parse(formText(form, 'shots', '[]')) as unknown;
      const payload = createManualScriptSchema.parse({
        sourceType: formText(form, 'sourceType', 'operator'),
        changeSummary: formText(form, 'changeSummary').trim() || '运营修改脚本',
        scriptJson: {
          title: formText(form, 'title').trim(),
          hook: formText(form, 'hook').trim(),
          spoken_script: formText(form, 'spokenScript').trim(),
          shots,
          product_integration: formText(form, 'productIntegration').trim(),
          cta: formText(form, 'cta').trim(),
          hashtags: formText(form, 'hashtags').split(/[\n,，、]/).map((item) => item.trim()).filter(Boolean),
        },
      });
      await fetchData(`/api/contents/${data.content.id}/scripts`, scriptWorkspaceSchema, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      setOpen(false);
      onSaved(current ? `已基于 V${current.versionNo} 创建新版本，旧版本完整保留` : '已创建首个人工脚本版本');
    } catch (reason) { setError(errorMessage(reason)); } finally { setPending(false); }
  }
  const initial = current?.scriptJson;
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger render={<Button variant="outline" />}><FilePlus2 />{current ? '修改脚本' : '自己写脚本'}</DialogTrigger>
    <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl">
      <DialogHeader><DialogTitle>{current ? `基于 V${current.versionNo} 创建新版本` : '创建人工脚本'}</DialogTitle><DialogDescription>保存会新增不可变版本，不会覆盖历史；已批准版本在新草稿提交审核前仍保持有效。</DialogDescription></DialogHeader>
      <form className="space-y-4" key={current?.id || 'new'} onSubmit={submit}>
        <fieldset className="grid gap-4 sm:grid-cols-2" disabled={pending}>
          <label htmlFor="manual-script-title" className="space-y-1.5 text-sm sm:col-span-2">脚本标题<Input id="manual-script-title" name="title" required maxLength={160} defaultValue={initial?.title || data.content.title} /></label>
          <label htmlFor="manual-script-hook" className="space-y-1.5 text-sm sm:col-span-2">开场钩子<Textarea id="manual-script-hook" name="hook" required maxLength={2000} rows={3} defaultValue={initial?.hook || ''} /></label>
          <label htmlFor="manual-script-spoken" className="space-y-1.5 text-sm sm:col-span-2">口播正文<Textarea id="manual-script-spoken" name="spokenScript" required maxLength={20000} rows={10} defaultValue={initial?.spoken_script || ''} /></label>
          <details className="rounded-xl border p-4 sm:col-span-2"><summary className="cursor-pointer text-sm text-slate-600">分镜、标签及修改说明（选填）</summary><div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label htmlFor="manual-script-source" className="space-y-1.5 text-sm">修改来源<NativeSelect id="manual-script-source" className="w-full" name="sourceType" defaultValue="operator"><option value="operator">运营修改</option><option value="client_revision">客户修改</option><option value="rewrite">人工改写</option></NativeSelect></label>
          <label htmlFor="manual-script-summary" className="space-y-1.5 text-sm">修改说明<Input id="manual-script-summary" name="changeSummary" maxLength={1000} placeholder="不填则记录为运营修改脚本" /></label>
          <label htmlFor="manual-script-shots" className="space-y-1.5 text-sm sm:col-span-2">分镜 JSON 数组<Textarea id="manual-script-shots" className="font-mono text-xs" name="shots" rows={8} defaultValue={JSON.stringify(initial?.shots || [], null, 2)} /></label>
          <label htmlFor="manual-script-product" className="space-y-1.5 text-sm">产品植入<Textarea id="manual-script-product" name="productIntegration" maxLength={5000} rows={4} defaultValue={initial?.product_integration || ''} /></label>
          <label htmlFor="manual-script-cta" className="space-y-1.5 text-sm">行动引导<Textarea id="manual-script-cta" name="cta" maxLength={2000} rows={4} defaultValue={initial?.cta || ''} /></label>
          <label htmlFor="manual-script-hashtags" className="space-y-1.5 text-sm sm:col-span-2">话题标签<Textarea id="manual-script-hashtags" name="hashtags" maxLength={5000} rows={3} placeholder="每行一个" defaultValue={initial?.hashtags.join('\n') || ''} /></label>
          </div></details>
        </fieldset>
        {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
        <div className="flex justify-end border-t pt-4"><Button type="submit" disabled={pending}>{pending ? '保存中…' : '创建新版本'}</Button></div>
      </form>
    </DialogContent>
  </Dialog>;
}

export function ScriptApprovalPanel({ contentId, onContentChanged }: { contentId: string; onContentChanged: () => void }) {
  const state = useApiData(`/api/contents/${contentId}/scripts`, scriptWorkspaceSchema);
  const [pending, setPending] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [needsMemory, setNeedsMemory] = useState(false);
  const [reviewPath, setReviewPath] = useState('');
  const [reviewCopyNotice, setReviewCopyNotice] = useState('');
  const [comments, setComments] = useState<Record<string, string>>({});

  function refreshed(notice: string) {
    setMessage(notice); setError(''); state.reload(); onContentChanged();
  }

  async function generate() {
    setPending('generate'); setMessage(''); setError(''); setNeedsMemory(false);
    try {
      const result = await fetchData(`/api/contents/${contentId}/scripts/generate`, generateScriptResultSchema, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
      });
      refreshed(`脚本 V${result.workspace.versions[0].versionNo} 已保存，消耗 ${result.billedPoints} 积分。可以复制口播，或修改后发给客户审核。`);
    } catch (reason) { setError(errorMessage(reason)); setNeedsMemory(reason instanceof RequestError && reason.code === 'ACTIVE_MEMORY_REQUIRED'); } finally { setPending(''); }
  }

  async function initializeMemory() {
    if (!state.data) return;
    setPending('memory'); setError('');
    try {
      await fetchData('/api/memories/initialize', memoryInitializationResultSchema, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accountId: state.data.content.accountId }),
      });
      setNeedsMemory(false); refreshed('品牌资料已确认。现在可以点击“AI 生成脚本”。');
    } catch (reason) { setError(errorMessage(reason)); } finally { setPending(''); }
  }

  async function submitExternal(versionId: string) {
    setPending('submit'); setMessage(''); setError(''); setReviewPath(''); setReviewCopyNotice('');
    try {
      const result = await fetchData(`/api/contents/${contentId}/approvals`, submitApprovalResultSchema, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ versionId, reviewerType: 'external_client' }),
      });
      setReviewPath(result.reviewPath || '');
      refreshed('脚本已提交外部客户审核，当前活动批准版本已清空');
    } catch (reason) { setError(errorMessage(reason)); } finally { setPending(''); }
  }

  async function copyReviewLink() {
    if (!reviewPath) return;
    try {
      await navigator.clipboard.writeText(new URL(reviewPath, window.location.origin).toString());
      setReviewCopyNotice('审核链接已复制，现在可以发给客户。');
    } catch {
      setReviewCopyNotice('自动复制失败，请长按或选中下方链接复制。');
    }
  }

  async function decide(approvalId: string, status: 'approved' | 'changes_requested' | 'rejected') {
    setPending(approvalId); setMessage(''); setError('');
    try {
      await fetchData(`/api/approvals/${approvalId}/decision`, scriptWorkspaceSchema, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, comment: comments[approvalId]?.trim() || '' }),
      });
      refreshed(status === 'approved' ? '脚本已批准并设为活动拍摄版本' : '审核已退回，内容重新进入脚本中');
    } catch (reason) { setError(errorMessage(reason)); } finally { setPending(''); }
  }

  return <section id="scripts" className="surface-card scroll-mt-20">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-lg font-semibold">你的脚本</h2><p className="mt-1 text-sm text-slate-500">先读口播，不满意可以修改；确认后发给客户审核。旧版本会保留。</p></div>{state.data && <div className="flex flex-wrap gap-2"><Badge variant="outline">{state.data.mode === 'mock' ? '演示生成' : '千问已配置'}</Badge><Badge variant="outline">余额 {state.data.remainingPoints} 积分</Badge></div>}</div>
    {state.loading ? <div className="mt-5 h-40 animate-pulse rounded-xl bg-slate-100" /> : state.error ? <div role="alert" className="mt-5 rounded-xl bg-rose-50 p-4 text-sm text-rose-800">{state.error.message}<Button className="ml-3" size="sm" variant="outline" onClick={state.reload}>重试</Button></div> : state.data && <>
      {state.data.permissions.canWrite && ['IDEA', 'SCRIPTING', 'APPROVED'].includes(state.data.content.status) && <div className="mt-5 flex flex-wrap gap-2"><Button disabled={!!pending || state.data.generatorPointCost === null || state.data.remainingPoints < (state.data.generatorPointCost ?? 0)} onClick={() => void generate()}><Bot />{pending === 'generate' ? '生成中…' : `AI 生成脚本${state.data.generatorPointCost === null ? '' : ` · ${state.data.generatorPointCost} 积分`}`}</Button><ManualScriptDialog data={state.data} onSaved={refreshed} />{state.data.content.currentScriptVersionId && ['SCRIPTING', 'APPROVED'].includes(state.data.content.status) && <Button variant="outline" disabled={!!pending} onClick={() => void submitExternal(state.data!.content.currentScriptVersionId!)}><ExternalLink />发给客户审核</Button>}</div>}
      {message && <output className="mt-4 block rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{message}</output>}
      {reviewPath && <div className="mt-3 rounded-lg border border-cyan-200 bg-cyan-50 p-3 text-sm text-cyan-900"><div className="flex flex-wrap items-center justify-between gap-3"><p className="font-medium">审核链接仅本次返回，请立即复制并发给客户：</p><Button size="sm" variant="outline" onClick={() => void copyReviewLink()}><Copy />复制审核链接</Button></div><Link className="mt-2 inline-flex items-center gap-1 break-all underline" href={reviewPath} target="_blank">{typeof window === 'undefined' ? reviewPath : window.location.origin + reviewPath}<ExternalLink className="size-3" /></Link>{reviewCopyNotice && <output aria-live="polite" className="mt-2 block text-xs">{reviewCopyNotice}</output>}</div>}
      {error && <p role="alert" className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
      {needsMemory && <div className="mt-3 space-y-2 text-sm"><p className="text-slate-600">首次生成需要确认品牌资料。系统会将已有定位、产品和账号风格记入品牌记忆。</p><Button variant="outline" disabled={!!pending} onClick={() => void initializeMemory()}>确认已有品牌资料并继续</Button></div>}
      <div className="mt-6 grid gap-5 xl:grid-cols-[1.5fr_1fr]">
        <div><div className="mb-3 flex items-center justify-between"><h3 className="flex items-center gap-2 font-semibold"><History className="size-4" />脚本与历史版本</h3><Badge variant="outline">{state.data.versions.length} 版</Badge></div>{state.data.versions.length ? <div className="space-y-4">{state.data.versions.map((version) => <article className="rounded-xl border p-4" key={version.id}><div className="mb-4 flex flex-wrap items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><h4 className="font-semibold">V{version.versionNo} · {version.scriptJson.title}</h4>{version.isCurrent && <Badge>当前草稿</Badge>}{version.isActiveApproved && <Badge className="bg-emerald-50 text-emerald-700">活动已批准</Badge>}</div><p className="mt-1 text-xs text-slate-500">{scriptSourceTypeLabels[version.sourceType]} · {version.creatorName} · {new Date(version.createdAt).toLocaleString('zh-CN')}</p><p className="mt-2 text-sm text-slate-600">{version.changeSummary}</p></div></div><ScriptBody script={version.scriptJson} /></article>)}</div> : <EmptyData title="还没有脚本版本" description="点击上方“AI 生成脚本”，已有品牌资料和选题会自动带入，不需要再填表。也可以自己写。" />}</div>
        <div><div className="mb-3 flex items-center justify-between"><h3 className="flex items-center gap-2 font-semibold"><ClipboardCheck className="size-4" />审核记录</h3><Badge variant="outline">{state.data.approvals.length} 条</Badge></div>{state.data.approvals.length ? <div className="space-y-3">{state.data.approvals.map((approval) => <article className="rounded-xl border p-4" key={approval.id}><div className="flex items-center justify-between gap-2"><p className="font-medium">脚本 V{approval.versionNo}</p><Badge className={approvalTone[approval.status]}>{approvalStatusLabels[approval.status]}</Badge></div><p className="mt-2 text-xs text-slate-500">{approvalReviewerTypeLabels[approval.reviewerType]}{approval.reviewerName ? ` · ${approval.reviewerName}` : ''}</p>{approval.expiresAt && <p className="mt-1 text-xs text-slate-500">有效期至 {new Date(approval.expiresAt).toLocaleString('zh-CN')}</p>}{approval.comment && <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{approval.comment}</p>}{approval.status === 'pending' && approval.reviewerType === 'internal_user' && state.data!.permissions.canReview && <div className="mt-3 space-y-2"><Input maxLength={3000} value={comments[approval.id] || ''} onChange={(event) => setComments((value) => ({ ...value, [approval.id]: event.target.value }))} placeholder="审核意见（退回或拒绝时必填）" /><div className="flex flex-wrap gap-2"><Button size="sm" disabled={pending === approval.id} onClick={() => void decide(approval.id, 'approved')}><CheckCircle2 />批准</Button><Button size="sm" variant="outline" disabled={pending === approval.id || !comments[approval.id]?.trim()} onClick={() => void decide(approval.id, 'changes_requested')}><RotateCcw />要求修改</Button></div></div>}</article>)}</div> : <EmptyData title="暂无审核记录" description="当前脚本提交后会生成不可变审核记录和专属客户链接。" />}</div>
      </div>
    </>}
  </section>;
}
