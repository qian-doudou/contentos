'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { BarChart3, CheckCircle2, ExternalLink, FileUp, LoaderCircle, Send, UploadCloud } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { contentGoals, contentTypes, hookTypes } from '@/db/constants';
import { contentGoalLabels, contentTypeLabels, hookTypeLabels } from '@/lib/content/contracts';
import {
  analyticsContentResultSchema,
  contentPerformanceSchema,
  performanceImportCommitResultSchema,
  performanceImportPreviewSchema,
  performanceSnapshotViewSchema,
  publishResultSchema,
  type PerformanceSnapshotView,
} from '@/lib/performance/contracts';
import { EmptyData, ErrorData, fetchData, LoadingData, RequestError, useApiData } from '@/components/contentos/master-data/common';

const metricFields = [
  ['views', '播放量'], ['likes', '点赞'], ['comments', '评论'], ['shares', '分享'], ['favorites', '收藏'],
  ['profileVisits', '主页访问'], ['groupbuyClicks', '团购点击'], ['orders', '订单'], ['gmv', 'GMV'],
] as const;
const mappingDefaults: Record<string, string> = {
  publishId: 'publish_id', platformPostId: 'platform_post_id', snapshotTime: 'snapshot_time',
  views: 'views', likes: 'likes', comments: 'comments', shares: 'shares', favorites: 'favorites',
  profileVisits: 'profile_visits', groupbuyClicks: 'groupbuy_clicks', orders: 'orders', gmv: 'gmv',
};

function errorText(reason: unknown) {
  return reason instanceof RequestError
    ? `${reason.message}${reason.requestId ? `（请求编号 ${reason.requestId}）` : ''}`
    : reason instanceof Error ? reason.message : '操作失败';
}

function formText(form: FormData, key: string) {
  const value = form.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

function displayNumber(value: number | null) {
  return value === null ? '—' : new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value);
}

function displayRate(value: number | null) {
  return value === null ? '—' : new Intl.NumberFormat('zh-CN', { style: 'percent', maximumFractionDigits: 2 }).format(value);
}

function localDateTime(value: string | null | undefined) {
  if (!value) return '';
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function PerformanceHeading({ title, description, children }: { title: string; description: string; children?: React.ReactNode }) {
  return <header className="flex flex-wrap items-end justify-between gap-4"><div><p className="eyebrow">运营数据</p><h1 className="page-title">{title}</h1><p className="page-description">{description}</p></div><div className="flex flex-wrap gap-2">{children}</div></header>;
}

function SnapshotMetrics({ item }: { item: PerformanceSnapshotView }) {
  return <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
    <div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">互动率</p><p className="mt-1 font-semibold">{displayRate(item.derived.engagementRate)}</p></div>
    <div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">团购点击率</p><p className="mt-1 font-semibold">{displayRate(item.derived.groupbuyCtr)}</p></div>
    <div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">订单转化率</p><p className="mt-1 font-semibold">{displayRate(item.derived.orderConversionRate)}</p></div>
    <div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">千次播放 GMV</p><p className="mt-1 font-semibold">{displayNumber(item.derived.gmvPer1000Views)}</p></div>
  </div>;
}

function PublishDialog({ contentId, onSaved }: { contentId: string; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: React.SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault(); setPending(true); setError('');
    try {
      const form = new FormData(event.currentTarget);
      await fetchData(`/api/contents/${contentId}/publish`, publishResultSchema, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: 'douyin', publishedAt: new Date(formText(form, 'publishedAt')).toISOString(),
          postUrl: formText(form, 'postUrl'), platformPostId: formText(form, 'platformPostId') || null,
        }),
      });
      setOpen(false); onSaved();
    } catch (reason) { setError(errorText(reason)); } finally { setPending(false); }
  }
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger render={<Button />}><Send />登记发布</DialogTrigger>
    <DialogContent><DialogHeader><DialogTitle>登记抖音发布</DialogTitle><DialogDescription>保存发布记录和 PUBLISHED 状态属于同一事务。</DialogDescription></DialogHeader>
      <form className="space-y-4" onSubmit={submit}>
        <label className="space-y-1.5 text-sm" htmlFor={`publish-time-${contentId}`}>发布时间<Input id={`publish-time-${contentId}`} name="publishedAt" type="datetime-local" required defaultValue={localDateTime(new Date().toISOString())} /></label>
        <label className="space-y-1.5 text-sm" htmlFor={`publish-url-${contentId}`}>作品链接<Input id={`publish-url-${contentId}`} name="postUrl" type="url" required maxLength={2000} placeholder="https://www.douyin.com/video/..." /></label>
        <label className="space-y-1.5 text-sm" htmlFor={`publish-platform-id-${contentId}`}>平台作品 ID（可选）<Input id={`publish-platform-id-${contentId}`} name="platformPostId" maxLength={300} /></label>
        {error && <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800" role="alert">{error}</p>}
        <DialogFooter><Button type="submit" disabled={pending}>{pending ? '提交中…' : '确认发布记录'}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}

function SnapshotDialog({ publishId, onSaved }: { publishId: string; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: React.SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault(); setPending(true); setError('');
    try {
      const form = new FormData(event.currentTarget);
      const body: Record<string, string | number | null> = { snapshotTime: new Date(formText(form, 'snapshotTime')).toISOString() };
      for (const [field] of metricFields) {
        const raw = formText(form, field);
        body[field] = raw === '' ? null : Number(raw);
      }
      await fetchData(`/api/publishes/${publishId}/snapshots`, performanceSnapshotViewSchema, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      setOpen(false); onSaved();
    } catch (reason) { setError(errorText(reason)); } finally { setPending(false); }
  }
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger render={<Button variant="outline" />}><UploadCloud />录入数据快照</DialogTrigger>
    <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>人工录入表现快照</DialogTitle><DialogDescription>相同发布时间点只能保存一次，旧快照不会被覆盖。</DialogDescription></DialogHeader>
      <form className="space-y-4" onSubmit={submit}><label className="space-y-1.5 text-sm" htmlFor={`snapshot-time-${publishId}`}>快照时间<Input id={`snapshot-time-${publishId}`} name="snapshotTime" type="datetime-local" required defaultValue={localDateTime(new Date().toISOString())} /></label>
        <fieldset className="grid gap-4 sm:grid-cols-3" disabled={pending}>{metricFields.map(([field, label]) => <label className="space-y-1.5 text-sm" htmlFor={`snapshot-${field}-${publishId}`} key={field}>{label}<Input id={`snapshot-${field}-${publishId}`} name={field} type="number" min="0" step={field === 'gmv' ? '0.01' : '1'} /></label>)}</fieldset>
        {error && <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800" role="alert">{error}</p>}
        <DialogFooter><Button type="submit" disabled={pending}>{pending ? '保存中…' : '保存新快照'}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}

export function ContentPerformancePanel({ contentId, onContentChanged }: { contentId: string; onContentChanged?: () => void }) {
  const state = useApiData(`/api/contents/${contentId}/performance`, contentPerformanceSchema);
  const [notice, setNotice] = useState('');
  const saved = (message: string) => { setNotice(message); state.reload(); onContentChanged?.(); };
  return <section className="surface-card">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-lg font-semibold">发布与表现</h2><p className="mt-1 text-sm text-slate-500">发布事务、人工数据快照和代码计算的衍生指标。</p></div><div className="flex flex-wrap gap-2">{state.data?.permissions.canPublish && <PublishDialog contentId={contentId} onSaved={() => saved('发布记录已创建，内容已进入已发布状态。')} />}{state.data?.publish && state.data.permissions.canWritePerformance && <SnapshotDialog publishId={state.data.publish.id} onSaved={() => saved('新数据快照已保存，历史记录未覆盖。')} />}</div></div>
    {notice && <output className="mt-4 block rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</output>}
    {state.loading ? <div className="mt-5 h-48 animate-pulse rounded-xl bg-slate-100" /> : state.error ? <div className="mt-5 rounded-xl bg-rose-50 p-4 text-sm text-rose-800" role="alert">{state.error.message}<Button className="ml-3" size="sm" variant="outline" onClick={state.reload}>重试</Button></div> : state.data && <>
      {state.data.publish ? <div className="mt-5 rounded-xl border p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-semibold">抖音发布记录</p><p className="mt-1 text-sm text-slate-500">{new Date(state.data.publish.publishedAt).toLocaleString('zh-CN')}</p></div><Badge className="bg-emerald-50 text-emerald-700">有效</Badge></div><a className="mt-3 inline-flex items-center gap-1 break-all text-sm text-cyan-800 underline" href={state.data.publish.postUrl} target="_blank" rel="noreferrer">{state.data.publish.postUrl}<ExternalLink className="size-3" /></a>{state.data.publish.platformPostId && <p className="mt-2 text-xs text-slate-500">作品 ID：{state.data.publish.platformPostId}</p>}</div> : <div className="mt-5"><EmptyData title="尚未登记发布" description={state.data.content.status === 'READY_TO_PUBLISH' ? '已批准成片可通过发布事务登记抖音作品。' : '内容达到待发布状态并存在活动批准成片后，才可登记发布。'} /></div>}
      {state.data.publish && <div className="mt-6"><div className="mb-3 flex items-center justify-between"><h3 className="font-semibold">Snapshot 时间序列</h3><Badge variant="outline">{state.data.snapshots.length} 个时间点</Badge></div>{state.data.snapshots.length ? <div className="space-y-4">{state.data.snapshots.map(snapshot => <article className="rounded-xl border p-4" key={snapshot.id}><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium">{new Date(snapshot.snapshotTime).toLocaleString('zh-CN')}</p><p className="text-xs text-slate-500">播放 {displayNumber(snapshot.views)} · 点赞 {displayNumber(snapshot.likes)} · 订单 {displayNumber(snapshot.orders)} · GMV {displayNumber(snapshot.gmv)}</p></div><div className="mt-4"><SnapshotMetrics item={snapshot} /></div></article>)}</div> : <EmptyData title="暂无表现快照" description="人工录入或通过 CSV 导入第一个数据时间点。" />}</div>}
    </>}
  </section>;
}

export function ContentAnalyticsPage() {
  const params = useSearchParams();
  const router = useRouter();
  const query = params.toString();
  const state = useApiData(`/api/analytics/content?${query}`, analyticsContentResultSchema);
  const [preview, setPreview] = useState<ReturnType<typeof performanceImportPreviewSchema.parse> | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');

  function filter(event: React.SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const next = new URLSearchParams();
    for (const key of ['accountId', 'contentType', 'hookType', 'contentGoal', 'pageSize']) {
      const value = formText(form, key); if (value) next.set(key, value);
    }
    for (const key of ['from', 'to']) { const value = formText(form, key); if (value) next.set(key, new Date(value).toISOString()); }
    next.set('page', '1'); router.push(`/analytics/content?${next.toString()}`);
  }
  function page(value: number) { const next = new URLSearchParams(query); next.set('page', String(value)); router.push(`/analytics/content?${next.toString()}`); }
  async function previewCsv(event: React.SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault(); setPending(true); setMessage(''); setPreview(null);
    try {
      const form = new FormData(event.currentTarget);
      const file = form.get('file');
      if (!(file instanceof File) || file.size === 0) throw new Error('请选择 CSV 文件');
      if (file.size > 1_000_000) throw new Error('单次导入文件不得超过 1 MB');
      const mapping: Record<string, string> = {};
      for (const field of Object.keys(mappingDefaults)) { const header = formText(form, `mapping_${field}`); if (header) mapping[field] = header; }
      const result = await fetchData('/api/performance/import/preview', performanceImportPreviewSchema, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload: await file.text(), mapping }),
      });
      setPreview(result); setMessage(result.canCommit ? '预览通过，确认后才会写入快照。' : '预览完成，请修正错误行后重新上传。');
    } catch (reason) { setMessage(errorText(reason)); } finally { setPending(false); }
  }
  async function commitCsv() {
    if (!preview) return; setPending(true); setMessage('');
    try {
      const result = await fetchData('/api/performance/import/commit', performanceImportCommitResultSchema, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ batchId: preview.batch.id }),
      });
      setMessage(`已新增 ${result.snapshotIds.length} 条快照，未覆盖任何历史记录。`); setPreview(null); state.reload();
    } catch (reason) { setMessage(errorText(reason)); } finally { setPending(false); }
  }

  return <div className="space-y-6"><PerformanceHeading title="内容表现" description="按账号和内容结构筛选人工快照；缺失或零分母指标统一显示为空。"><Button variant="outline" nativeButton={false} render={<Link href="/contents" />}>内容档案</Button></PerformanceHeading>
    {state.loading ? <LoadingData /> : state.error ? <ErrorData error={state.error} retry={state.reload} /> : state.data && <>
      <form className="surface-card grid items-end gap-3 sm:grid-cols-2 xl:grid-cols-7" key={query} onSubmit={filter}>
        <label className="space-y-1.5 text-sm" htmlFor="analytics-account">账号<NativeSelect id="analytics-account" name="accountId" defaultValue={params.get('accountId') || ''}><option value="">全部账号</option>{state.data.options.accounts.map(item => <option value={item.id} key={item.id}>{item.clientName} / {item.accountName}</option>)}</NativeSelect></label>
        <label className="space-y-1.5 text-sm" htmlFor="analytics-type">内容类型<NativeSelect id="analytics-type" name="contentType" defaultValue={params.get('contentType') || ''}><option value="">全部类型</option>{contentTypes.map(value => <option value={value} key={value}>{contentTypeLabels[value]}</option>)}</NativeSelect></label>
        <label className="space-y-1.5 text-sm" htmlFor="analytics-hook">Hook 类型<NativeSelect id="analytics-hook" name="hookType" defaultValue={params.get('hookType') || ''}><option value="">全部 Hook</option>{hookTypes.map(value => <option value={value} key={value}>{hookTypeLabels[value]}</option>)}</NativeSelect></label>
        <label className="space-y-1.5 text-sm" htmlFor="analytics-goal">内容目标<NativeSelect id="analytics-goal" name="contentGoal" defaultValue={params.get('contentGoal') || ''}><option value="">全部目标</option>{contentGoals.map(value => <option value={value} key={value}>{contentGoalLabels[value]}</option>)}</NativeSelect></label>
        <label className="space-y-1.5 text-sm" htmlFor="analytics-from">开始时间<Input id="analytics-from" name="from" type="datetime-local" defaultValue={localDateTime(params.get('from'))} /></label>
        <label className="space-y-1.5 text-sm" htmlFor="analytics-to">结束时间<Input id="analytics-to" name="to" type="datetime-local" defaultValue={localDateTime(params.get('to'))} /></label>
        <input type="hidden" name="pageSize" value={params.get('pageSize') || '20'} /><div className="flex gap-2"><Button type="submit">筛选</Button><Button type="button" variant="ghost" onClick={() => router.push('/analytics/content')}>清空</Button></div>
      </form>
      <section className="grid gap-4 sm:grid-cols-3"><article className="surface-card"><p className="text-sm text-slate-500">匹配快照</p><p className="mt-3 text-3xl font-semibold">{state.data.total}</p></article><article className="surface-card sm:col-span-2"><div className="flex items-center gap-2 font-semibold"><BarChart3 className="size-4 text-cyan-700" />指标口径</div><p className="mt-3 text-sm leading-6 text-slate-500">所有衍生指标由服务端确定性计算；任一必要字段缺失或分母为 0 时返回 null。</p></article></section>
      <section className="surface-card !p-0"><div className="border-b p-5"><h2 className="font-semibold">数据快照</h2></div>{state.data.items.length ? <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>时间 / 内容</TableHead><TableHead>账号</TableHead><TableHead>播放 / 互动</TableHead><TableHead>团购 / 订单</TableHead><TableHead>GMV</TableHead><TableHead>衍生指标</TableHead></TableRow></TableHeader><TableBody>{state.data.items.map(item => <TableRow key={item.snapshot.id}><TableCell className="min-w-64"><p className="text-xs text-slate-500">{new Date(item.snapshot.snapshotTime).toLocaleString('zh-CN')}</p><Link className="mt-1 block font-medium text-cyan-800 hover:underline" href={`/contents/${item.content.id}`}>{item.content.title}</Link><p className="mt-1 text-xs text-slate-500">{contentTypeLabels[item.content.contentType]} · {hookTypeLabels[item.content.hookType]} · {contentGoalLabels[item.content.contentGoal]}</p></TableCell><TableCell>{item.account.accountName}</TableCell><TableCell>播放 {displayNumber(item.snapshot.views)}<p className="mt-1 text-xs text-slate-500">互动率 {displayRate(item.snapshot.derived.engagementRate)}</p></TableCell><TableCell>点击 {displayNumber(item.snapshot.groupbuyClicks)} / 订单 {displayNumber(item.snapshot.orders)}<p className="mt-1 text-xs text-slate-500">转化率 {displayRate(item.snapshot.derived.orderConversionRate)}</p></TableCell><TableCell>{displayNumber(item.snapshot.gmv)}<p className="mt-1 text-xs text-slate-500">千播 {displayNumber(item.snapshot.derived.gmvPer1000Views)}</p></TableCell><TableCell>团购 CTR {displayRate(item.snapshot.derived.groupbuyCtr)}</TableCell></TableRow>)}</TableBody></Table></div> : <EmptyData title="暂无内容表现数据" description="完成发布后，可在内容详情人工录入快照，或使用下方 CSV 导入。" />}<div className="flex items-center justify-between border-t p-4"><span className="text-sm text-slate-500">第 {state.data.page} 页 · 共 {state.data.total} 条</span><div className="flex gap-2"><Button variant="outline" disabled={state.data.page <= 1} onClick={() => page(state.data!.page - 1)}>上一页</Button><Button variant="outline" disabled={state.data.page * state.data.pageSize >= state.data.total} onClick={() => page(state.data!.page + 1)}>下一页</Button></div></div></section>
      {state.data.permissions.canImport && <section className="surface-card"><div><h2 className="text-lg font-semibold">CSV 数据导入</h2><p className="mt-1 text-sm text-slate-500">先映射字段并生成错误行报告，确认后才写入不可变快照。</p></div><form className="mt-5 space-y-5" onSubmit={previewCsv}><label className="block space-y-1.5 text-sm" htmlFor="performance-csv">CSV 文件（最多 500 行、1 MB）<Input id="performance-csv" name="file" type="file" accept=".csv,text/csv" required /></label><fieldset className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" disabled={pending}><legend className="mb-3 text-sm font-medium">字段映射（填写 CSV 表头）</legend>{Object.entries(mappingDefaults).map(([field, header]) => <label className="space-y-1 text-xs text-slate-500" htmlFor={`mapping-${field}`} key={field}>{field}<Input id={`mapping-${field}`} name={`mapping_${field}`} defaultValue={header} required={field === 'snapshotTime'} /></label>)}</fieldset><Button type="submit" disabled={pending}>{pending ? <LoaderCircle className="animate-spin" /> : <FileUp />}仅预览与校验</Button></form>{message && <output className={`mt-4 block rounded-lg p-3 text-sm ${message.startsWith('已新增') || message.startsWith('预览通过') ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-900'}`}>{message}</output>}{preview && <div className="mt-5"><div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm">有效 {preview.batch.validRows} · 重复 {preview.batch.duplicateRows} · 错误 {preview.batch.invalidRows}</p><Button disabled={!preview.canCommit || pending} onClick={() => void commitCsv()}><CheckCircle2 />确认写入 {preview.batch.validRows} 条</Button></div><div className="mt-3 overflow-x-auto rounded-xl border"><Table><TableHeader><TableRow><TableHead>行</TableHead><TableHead>状态</TableHead><TableHead>内容 / 账号</TableHead><TableHead>快照时间</TableHead><TableHead>错误报告</TableHead></TableRow></TableHeader><TableBody>{preview.items.map(item => <TableRow key={`${preview.batch.id}:${item.rowNumber}`}><TableCell>{item.rowNumber}</TableCell><TableCell><Badge className={item.status === 'valid' ? 'bg-emerald-50 text-emerald-700' : item.status === 'duplicate' ? 'bg-slate-100 text-slate-600' : 'bg-rose-50 text-rose-700'}>{item.status === 'valid' ? '有效' : item.status === 'duplicate' ? '重复' : '错误'}</Badge></TableCell><TableCell>{item.contentTitle || '未解析'}<p className="mt-1 text-xs text-slate-500">{item.accountName || '—'}</p></TableCell><TableCell>{item.snapshot ? new Date(item.snapshot.snapshotTime).toLocaleString('zh-CN') : '—'}</TableCell><TableCell className="max-w-80 text-sm text-rose-700">{item.issues.join('；') || '—'}</TableCell></TableRow>)}</TableBody></Table></div></div>}</section>}
    </>}
  </div>;
}
