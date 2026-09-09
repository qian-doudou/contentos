'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import {
  ArrowLeft, CheckCircle2, Clock3, ExternalLink, Film, History, Play,
  Copy, RotateCcw, Send, UserRound,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import {
  EmptyData, ErrorData, fetchData, LoadingData, RequestError, useApiData,
} from '@/components/contentos/master-data/common';
import { contentStatusLabels } from '@/lib/content/contracts';
import {
  editAssetTypeLabels, editTaskListSchema, editWorkspaceSchema, submitEditVersionResultSchema,
  type EditWorkspace,
} from '@/lib/edits/contracts';
import { approvalStatusLabels, approvalReviewerTypeLabels } from '@/lib/scripts/contracts';

const statusTone: Record<string, string> = {
  SHOT: 'bg-sky-50 text-sky-700', EDITING: 'bg-blue-50 text-blue-700', WAITING_REVIEW: 'bg-amber-50 text-amber-800',
  REVISION: 'bg-rose-50 text-rose-700', READY_TO_PUBLISH: 'bg-emerald-50 text-emerald-700',
};
const approvalTone: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-700', approved: 'bg-emerald-50 text-emerald-700',
  changes_requested: 'bg-cyan-50 text-cyan-700', rejected: 'bg-rose-50 text-rose-700', expired: 'bg-slate-100 text-slate-600',
};

function errorText(reason: unknown) {
  return reason instanceof RequestError
    ? `${reason.message}${reason.requestId ? `（请求编号 ${reason.requestId}）` : ''}`
    : reason instanceof Error ? reason.message : '操作失败';
}

function formText(form: FormData, key: string) {
  const value = form.get(key);
  return typeof value === 'string' ? value : '';
}

function EditHeading({ title, description, children }: { title: string; description: string; children?: React.ReactNode }) {
  return <header className="flex flex-wrap items-end justify-between gap-4"><div><p className="eyebrow">剪辑审核</p><h1 className="page-title">{title}</h1><p className="page-description">{description}</p></div><div className="flex flex-wrap gap-2">{children}</div></header>;
}

function EditStatusBadge({ status }: { status: keyof typeof contentStatusLabels }) {
  return <Badge className={statusTone[status]}>{contentStatusLabels[status]}</Badge>;
}

function ReviewSubmissionDialog({ data, mode, onSaved }: {
  data: EditWorkspace;
  mode: 'version' | 'resubmit';
  onSaved: (result: { workspace: EditWorkspace; reviewPath: string | null }, notice: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [reviewerType, setReviewerType] = useState<'internal_user' | 'external_client'>('external_client');
  const current = data.versions.find((item) => item.id === data.content.currentEditVersionId);

  async function submit(event: React.SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault(); setPending(true); setError('');
    try {
      const form = new FormData(event.currentTarget);
      const expiresAt = formText(form, 'expiresAt');
      const reviewerUserId = formText(form, 'reviewerUserId');
      const reviewer = {
        reviewerType,
        reviewerUserId: reviewerType === 'internal_user' ? reviewerUserId || null : null,
        expiresAt: reviewerType === 'external_client' && expiresAt ? new Date(expiresAt).toISOString() : null,
      };
      const endpoint = `/api/contents/${data.content.id}/edits${mode === 'resubmit' ? '/review' : ''}`;
      const body = mode === 'resubmit'
        ? { versionId: data.content.currentEditVersionId, ...reviewer }
        : {
          assetType: formText(form, 'assetType'), assetUrl: formText(form, 'assetUrl').trim(),
          note: formText(form, 'note').trim(), ...reviewer,
        };
      const result = await fetchData(endpoint, submitEditVersionResultSchema, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      setOpen(false);
      onSaved(result, mode === 'resubmit' ? '已生成新的审核记录，旧待审记录已失效。' : '新成片版本已提交审核，历史版本已保留。');
    } catch (reason) { setError(errorText(reason)); } finally { setPending(false); }
  }

  const nextVersionNo = (data.versions[0]?.versionNo ?? 0) + 1;
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger render={<Button variant={mode === 'resubmit' ? 'outline' : 'default'} />}>
      {mode === 'resubmit' ? <><RotateCcw />重新发起审核</> : <><Send />提交成片 V{nextVersionNo}</>}
    </DialogTrigger>
    <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-2xl">
      <DialogHeader><DialogTitle>{mode === 'resubmit' ? `重新提交成片 V${current?.versionNo ?? ''}` : `提交成片 V${nextVersionNo}`}</DialogTitle><DialogDescription>{mode === 'resubmit' ? '当前成片不变；将失效旧待审记录并新建一条。' : '版本只新增、不覆盖。提交后内容进入待成片审核。'}</DialogDescription></DialogHeader>
      <form className="space-y-4" onSubmit={submit}>
        {mode === 'version' && <fieldset className="grid gap-4 sm:grid-cols-2" disabled={pending}>
          <label className="space-y-1.5 text-sm" htmlFor="edit-asset-type">素材类型<NativeSelect id="edit-asset-type" name="assetType" defaultValue="url"><option value="url">在线链接</option><option value="local_reference">本地素材引用</option></NativeSelect></label>
          <label className="space-y-1.5 text-sm sm:col-span-2" htmlFor="edit-asset-url">成片地址 / 素材引用<Input id="edit-asset-url" name="assetUrl" required maxLength={2000} placeholder="https://... 或 assets/final-v2.mp4" /></label>
          <label className="space-y-1.5 text-sm sm:col-span-2" htmlFor="edit-note">版本备注<Textarea id="edit-note" name="note" rows={4} maxLength={5000} placeholder="说明本版剪辑重点和修改内容" /></label>
        </fieldset>}
        <fieldset className="grid gap-4 sm:grid-cols-2" disabled={pending}>
          <label className="space-y-1.5 text-sm" htmlFor={`edit-reviewer-type-${mode}`}>审核方式<NativeSelect id={`edit-reviewer-type-${mode}`} value={reviewerType} onChange={(event) => setReviewerType(event.target.value as typeof reviewerType)}><option value="external_client">外部客户 Token</option><option value="internal_user">内部成员</option></NativeSelect></label>
          {reviewerType === 'internal_user' ? <label className="space-y-1.5 text-sm" htmlFor={`edit-reviewer-${mode}`}>审核人<NativeSelect id={`edit-reviewer-${mode}`} name="reviewerUserId" defaultValue={data.options.reviewers[0]?.id || ''} required><option value="">请选择</option>{data.options.reviewers.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</NativeSelect></label>
            : <label className="space-y-1.5 text-sm" htmlFor={`edit-expiry-${mode}`}>有效期（默认 7 天）<Input id={`edit-expiry-${mode}`} name="expiresAt" type="datetime-local" /></label>}
        </fieldset>
        {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
        <DialogFooter><Button type="submit" disabled={pending || (mode === 'resubmit' && !data.content.currentEditVersionId)}>{pending ? '提交中…' : '确认提交'}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}

export function EditReviewPanel({ contentId, onContentChanged }: { contentId: string; onContentChanged?: () => void }) {
  const state = useApiData(`/api/contents/${contentId}/edits`, editWorkspaceSchema);
  const [editorId, setEditorId] = useState('');
  const [pending, setPending] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [reviewPath, setReviewPath] = useState('');
  const [comments, setComments] = useState<Record<string, string>>({});

  function finish(message: string, path?: string | null) {
    setNotice(message); setError(''); setReviewPath(path || ''); state.reload(); onContentChanged?.();
  }
  async function mutate(action: 'assign' | 'start') {
    setPending(action); setNotice(''); setError('');
    try {
      await fetchData(`/api/contents/${contentId}/edits/${action}`, editWorkspaceSchema, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action === 'assign' ? { editorId } : {}),
      });
      finish(action === 'assign' ? '剪辑任务已分配。' : '已开始剪辑，内容状态已进入 EDITING。');
    } catch (reason) { setError(errorText(reason)); } finally { setPending(''); }
  }
  async function decide(approvalId: string, decision: 'approved' | 'changes_requested' | 'rejected') {
    setPending(approvalId); setNotice(''); setError('');
    try {
      await fetchData(`/api/approvals/${approvalId}/decision`, editWorkspaceSchema, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: decision, comment: comments[approvalId]?.trim() || '' }),
      });
      finish(decision === 'approved' ? '成片已通过，已设为活动批准版本。' : '成片已退回修改，内容进入 REVISION。');
    } catch (reason) { setError(errorText(reason)); } finally { setPending(''); }
  }

  return <section className="surface-card">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-lg font-semibold">剪辑版本与成片审核</h2><p className="mt-1 text-sm text-slate-500">新成片一律创建不可变版本；活动批准版本由审核事务设置。</p></div>{state.data && <EditStatusBadge status={state.data.content.status} />}</div>
    {state.loading ? <div className="mt-5 h-48 animate-pulse rounded-xl bg-slate-100" /> : state.error ? <div className="mt-5 rounded-xl bg-rose-50 p-4 text-sm text-rose-800" role="alert">{state.error.message}<Button className="ml-3" size="sm" variant="outline" onClick={state.reload}>重试</Button></div> : state.data && <>
      <div className="mt-5 flex flex-wrap items-end gap-3 rounded-xl border bg-slate-50 p-4">
        <div className="min-w-52"><p className="text-xs text-slate-500">当前 Editor</p><p className="mt-1 flex items-center gap-2 font-medium"><UserRound className="size-4" />{state.data.content.editorName || '未分配'}</p></div>
        {state.data.permissions.canAssign && <><label className="min-w-52 space-y-1 text-xs" htmlFor={`editor-${contentId}`}>分配给<NativeSelect id={`editor-${contentId}`} value={editorId} onChange={(event) => setEditorId(event.target.value)}><option value="">请选择 Editor</option>{state.data.options.editors.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</NativeSelect></label><Button variant="outline" disabled={!editorId || pending === 'assign'} onClick={() => void mutate('assign')}>保存分配</Button></>}
        {state.data.permissions.canStart && <Button disabled={pending === 'start'} onClick={() => void mutate('start')}><Play />开始剪辑</Button>}
        {state.data.permissions.canSubmit && <ReviewSubmissionDialog data={state.data} mode="version" onSaved={(result, message) => finish(message, result.reviewPath)} />}
        {state.data.permissions.canResubmit && <ReviewSubmissionDialog data={state.data} mode="resubmit" onSaved={(result, message) => finish(message, result.reviewPath)} />}
      </div>
      {notice && <output className="mt-4 block rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</output>}
      {reviewPath && <div className="mt-3 rounded-lg border border-cyan-200 bg-cyan-50 p-3 text-sm text-cyan-900"><p className="font-medium">审核链接只本次返回，请立即交给客户：</p><Link className="mt-1 inline-flex items-center gap-1 break-all underline" href={reviewPath} target="_blank">{typeof window === 'undefined' ? reviewPath : window.location.origin + reviewPath}<ExternalLink className="size-3" /></Link></div>}
      {error && <p role="alert" className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
      <div className="mt-6 grid gap-6 xl:grid-cols-[1.35fr_1fr]">
        <div><div className="mb-3 flex items-center justify-between"><h3 className="flex items-center gap-2 font-semibold"><Copy className="size-4" />Diff 式版本历史</h3><Badge variant="outline">{state.data.versions.length} 版</Badge></div>{state.data.versions.length ? <div className="space-y-3">{state.data.versions.map((version, index) => {
          const previous = state.data!.versions[index + 1];
          return <article className="rounded-xl border p-4" key={version.id}><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><h4 className="font-semibold">成片 V{version.versionNo}</h4>{version.isCurrent && <Badge>当前版本</Badge>}{version.isActiveApproved && <Badge className="bg-emerald-50 text-emerald-700">活动已批准</Badge>}</div><p className="mt-1 text-xs text-slate-500">{editAssetTypeLabels[version.assetType]} · {version.creatorName} · {new Date(version.createdAt).toLocaleString('zh-CN')}</p></div><Badge variant="outline">{previous ? `对比 V${previous.versionNo}` : '初始版'}</Badge></div><dl className="mt-4 grid gap-3 text-sm"><div className={`rounded-lg p-3 ${previous?.assetUrl !== version.assetUrl ? 'bg-cyan-50' : 'bg-slate-50'}`}><dt className="text-xs text-slate-500">素材引用 · {previous?.assetUrl !== version.assetUrl ? '已变更' : '未变更'}</dt><dd className="mt-1 break-all">{version.assetType === 'url' ? <a href={version.assetUrl} target="_blank" rel="noreferrer" className="text-cyan-800 underline">{version.assetUrl}</a> : version.assetUrl}</dd></div><div className={`rounded-lg p-3 ${previous?.note !== version.note ? 'bg-cyan-50' : 'bg-slate-50'}`}><dt className="text-xs text-slate-500">备注 · {previous?.note !== version.note ? '已变更' : '未变更'}</dt><dd className="mt-1 whitespace-pre-wrap">{version.note || '无备注'}</dd></div></dl></article>;
        })}</div> : <EmptyData title="还没有成片版本" description="Editor 开始处理后，可在此提交第一个成片链接或本地素材引用。" />}</div>
        <div><div className="mb-3 flex items-center justify-between"><h3 className="flex items-center gap-2 font-semibold"><History className="size-4" />成片审核记录</h3><Badge variant="outline">{state.data.approvals.length} 条</Badge></div>{state.data.approvals.length ? <div className="space-y-3">{state.data.approvals.map((approval) => <article className="rounded-xl border p-4" key={approval.id}><div className="flex items-center justify-between gap-2"><p className="font-medium">成片 V{approval.versionNo}</p><Badge className={approvalTone[approval.status]}>{approvalStatusLabels[approval.status]}</Badge></div><p className="mt-2 text-xs text-slate-500">{approvalReviewerTypeLabels[approval.reviewerType]}{approval.reviewerName ? ` · ${approval.reviewerName}` : ''}</p>{approval.expiresAt && <p className="mt-1 flex items-center gap-1 text-xs text-slate-500"><Clock3 className="size-3" />有效期至 {new Date(approval.expiresAt).toLocaleString('zh-CN')}</p>}{approval.comment && <p className="mt-3 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{approval.comment}</p>}{approval.status === 'pending' && approval.canDecide && <div className="mt-3 space-y-2"><Textarea rows={3} maxLength={3000} value={comments[approval.id] || ''} onChange={(event) => setComments((current) => ({ ...current, [approval.id]: event.target.value }))} placeholder="退回或拒绝时必须填写意见" /><div className="flex flex-wrap gap-2"><Button size="sm" disabled={pending === approval.id} onClick={() => void decide(approval.id, 'approved')}><CheckCircle2 />审核通过</Button><Button size="sm" variant="outline" disabled={pending === approval.id || !comments[approval.id]?.trim()} onClick={() => void decide(approval.id, 'changes_requested')}><RotateCcw />要求修改</Button></div></div>}</article>)}</div> : <EmptyData title="暂无成片审核" description="提交成片版本时会同时新建具体版本的审核记录。" />}</div>
      </div>
    </>}
  </section>;
}

export function EditTaskListPage() {
  const params = useSearchParams();
  const router = useRouter();
  const query = params.toString();
  const state = useApiData(`/api/edits?${query}`, editTaskListSchema);
  function filter(event: React.SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    const next = new URLSearchParams();
    new FormData(event.currentTarget).forEach((value, key) => { if (typeof value === 'string' && value) next.set(key, value); });
    next.set('page', '1'); router.push(`/edits?${next.toString()}`);
  }
  function page(value: number) { const next = new URLSearchParams(query); next.set('page', String(value)); router.push(`/edits?${next.toString()}`); }
  if (state.loading) return <LoadingData />;
  if (state.error) return <ErrorData error={state.error} retry={state.reload} />;
  if (!state.data) return null;
  const data = state.data;
  return <div className="space-y-6"><EditHeading title="Editor 工作台" description="Editor 只会看到分配给本人的剪辑任务；管理者可查看组织内任务。" />
    <form className="surface-card flex flex-wrap items-end gap-3" key={query} onSubmit={filter}><label className="min-w-56 space-y-1.5 text-sm" htmlFor="edit-filter-status">状态<NativeSelect id="edit-filter-status" name="status" defaultValue={params.get('status') || ''}><option value="">全部生产状态</option>{(['SHOT', 'EDITING', 'WAITING_REVIEW', 'REVISION', 'READY_TO_PUBLISH'] as const).map((status) => <option value={status} key={status}>{contentStatusLabels[status]}</option>)}</NativeSelect></label><input type="hidden" name="pageSize" value={params.get('pageSize') || '20'} /><Button type="submit">查询</Button><Button type="button" variant="ghost" onClick={() => router.push('/edits')}>清空</Button></form>
    <section className="surface-card !p-0">{data.items.length ? <><div className="grid gap-3 p-4 md:hidden">{data.items.map((item) => <Link href={`/edits/${item.id}`} className="rounded-xl border p-4" key={item.id}><div className="flex items-start justify-between gap-3"><p className="font-semibold">{item.title}</p><EditStatusBadge status={item.status} /></div><p className="mt-2 text-sm text-slate-500">{item.clientName} / {item.accountName}</p><p className="mt-3 text-sm">Editor：{item.editorName || '未分配'}</p></Link>)}</div><div className="hidden overflow-x-auto md:block"><Table><TableHeader><TableRow><TableHead>内容</TableHead><TableHead>客户 / 账号</TableHead><TableHead>Editor</TableHead><TableHead>版本</TableHead><TableHead>状态</TableHead><TableHead>更新时间</TableHead></TableRow></TableHeader><TableBody>{data.items.map((item) => <TableRow key={item.id}><TableCell><Link className="font-medium text-cyan-800 hover:underline" href={`/edits/${item.id}`}>{item.title}</Link></TableCell><TableCell>{item.clientName}<p className="mt-1 text-xs text-slate-500">{item.accountName}</p></TableCell><TableCell>{item.editorName || '未分配'}</TableCell><TableCell>当前 {item.currentVersionNo ? `V${item.currentVersionNo}` : '无'}<p className="mt-1 text-xs text-slate-500">批准 {item.activeApprovedVersionNo ? `V${item.activeApprovedVersionNo}` : '无'}</p></TableCell><TableCell><EditStatusBadge status={item.status} /></TableCell><TableCell className="text-xs text-slate-500">{new Date(item.updatedAt).toLocaleString('zh-CN')}</TableCell></TableRow>)}</TableBody></Table></div></> : <EmptyData title="暂无剪辑任务" description="已完成拍摄的内容会进入本工作台；Editor 视角仅显示本人任务。" />}
      <div className="flex items-center justify-between border-t p-4"><span className="text-sm text-slate-500">第 {data.page} 页 · 共 {data.total} 条</span><div className="flex gap-2"><Button variant="outline" disabled={data.page <= 1} onClick={() => page(data.page - 1)}>上一页</Button><Button variant="outline" disabled={data.page * data.pageSize >= data.total} onClick={() => page(data.page + 1)}>下一页</Button></div></div>
    </section></div>;
}

export function EditTaskDetailPage({ id }: { id: string }) {
  return <div className="space-y-6"><EditHeading title="剪辑任务详情" description="查看不可变成片版本、审核记录与当前批准指针。"><Button variant="outline" nativeButton={false} render={<Link href="/edits" />}><ArrowLeft />Editor 工作台</Button><Button variant="outline" nativeButton={false} render={<Link href={`/contents/${id}`} />}><Film />内容档案</Button></EditHeading><EditReviewPanel contentId={id} /></div>;
}
