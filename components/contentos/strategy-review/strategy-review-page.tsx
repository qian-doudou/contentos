'use client';

import Link from 'next/link';
import { useState } from 'react';
import { BrainCircuit, CheckCircle2, FlaskConical, LoaderCircle, Settings2, XCircle } from 'lucide-react';
import { z } from 'zod';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { contentGoalLabels, contentTypeLabels, hookTypeLabels } from '@/lib/content/contracts';
import {
  nextPeriodPlanResultSchema,
  strategyMetricsResultSchema,
  strategyReviewConfirmationResultSchema,
  strategyReviewGenerationResultSchema,
  strategyReviewListSchema,
  strategyReviewViewSchema,
  type StrategyMetricsSnapshot,
  type StrategyReviewView,
} from '@/lib/strategy-review/contracts';
import { EmptyData, ErrorData, fetchData, LoadingData, RequestError, useApiData } from '@/components/contentos/master-data/common';

const statusLabels = { draft: '待确认', confirmed: '已确认', rejected: '已驳回' } as const;
const statusClasses = {
  draft: 'bg-amber-50 text-amber-800',
  confirmed: 'bg-emerald-50 text-emerald-800',
  rejected: 'bg-slate-100 text-slate-600',
} as const;

function errorText(error: unknown) {
  return error instanceof RequestError
    ? `${error.message}${error.requestId ? `（请求编号 ${error.requestId}）` : ''}`
    : error instanceof Error
      ? error.message
      : '操作失败';
}

function number(value: number | null, maximumFractionDigits = 2) {
  return value === null ? '—' : new Intl.NumberFormat('zh-CN', { maximumFractionDigits }).format(value);
}

function rate(value: number | null) {
  return value === null ? '—' : new Intl.NumberFormat('zh-CN', { style: 'percent', maximumFractionDigits: 2 }).format(value);
}

function initialPeriod() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 0);
  const local = (value: Date) => {
    const offset = value.getTimezoneOffset() * 60_000;
    return new Date(value.getTime() - offset).toISOString().slice(0, 10);
  };
  return { start: local(start), end: local(end) };
}

function MetricCard({ label, value, note }: { label: string; value: string | number; note?: string }) {
  return <article className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-sm text-slate-500">{label}</p><p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>{note && <p className="mt-1 text-xs text-slate-400">{note}</p>}</article>;
}

function FactsPanel({ metrics }: { metrics: StrategyMetricsSnapshot }) {
  const groups = [
    ['内容类型', metrics.byContentType, (value: string) => contentTypeLabels[value as keyof typeof contentTypeLabels] ?? value],
    ['Hook 类型', metrics.byHookType, (value: string) => hookTypeLabels[value as keyof typeof hookTypeLabels] ?? value],
    ['内容目标', metrics.byContentGoal, (value: string) => contentGoalLabels[value as keyof typeof contentGoalLabels] ?? value],
  ] as const;
  return <section className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="eyebrow">COMPUTE FIRST</p><h2 className="text-xl font-semibold">数据事实</h2><p className="mt-1 text-sm text-slate-500">每条发布只取周期结束前最后一份累计快照，避免重复累加。</p></div><Badge variant="outline">生成于 {new Date(metrics.generatedAt).toLocaleString('zh-CN')}</Badge></div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard label="周期发布" value={metrics.publishedContentCount} note={`有效快照 ${metrics.sampledContentCount} 条`} />
      <MetricCard label="平均 / 中位播放" value={`${number(metrics.averageViews, 0)} / ${number(metrics.medianViews, 0)}`} note={`播放样本 ${metrics.viewsSampleCount} 条`} />
      <MetricCard label="团购 CTR" value={rate(metrics.groupbuyCtr)} note="有效点击与播放求和后计算" />
      <MetricCard label="千次播放 GMV" value={number(metrics.gmvPer1000Views)} note={`发布频率 ${number(metrics.publishFrequency.publishesPerWeek)} 条/周`} />
    </div>
    <div className="grid gap-4 xl:grid-cols-3">{groups.map(([label, items, display]) => <article className="surface-card !p-0" key={label}><div className="border-b px-5 py-4"><h3 className="font-semibold">按{label}</h3></div>{items.length ? <Table><TableHeader><TableRow><TableHead>{label}</TableHead><TableHead>样本</TableHead><TableHead>平均播放</TableHead></TableRow></TableHeader><TableBody>{items.map((item) => <TableRow key={item.value}><TableCell>{display(item.value)}</TableCell><TableCell>{item.viewsSampleCount}</TableCell><TableCell>{number(item.averageViews, 0)}</TableCell></TableRow>)}</TableBody></Table> : <div className="p-5 text-sm text-slate-500">暂无有效分组样本</div>}</article>)}</div>
    <div className="grid gap-4 xl:grid-cols-2"><Ranked title="TOP 内容" items={metrics.topContents} /><Ranked title="Bottom 内容" items={metrics.bottomContents} /></div>
  </section>;
}

function Ranked({ title, items }: { title: string; items: StrategyMetricsSnapshot['topContents'] }) {
  return <article className="surface-card"><div className="mb-4 flex items-center justify-between"><h3 className="font-semibold">{title}</h3><Badge variant="outline">结构化摘要</Badge></div>{items.length ? <div className="space-y-3">{items.map((item, index) => <div className="rounded-xl bg-slate-50 p-3" key={item.contentId}><div className="flex gap-3"><span className="grid size-7 shrink-0 place-items-center rounded-full bg-slate-900 text-xs text-white">{index + 1}</span><div className="min-w-0"><Link className="font-medium text-cyan-900 hover:underline" href={`/contents/${item.contentId}`}>{item.title}</Link><p className="mt-1 text-xs text-slate-500">{contentTypeLabels[item.contentType]} · {hookTypeLabels[item.hookType]} · 播放 {number(item.views, 0)}</p><p className="mt-2 line-clamp-2 text-sm text-slate-600">{item.angle || item.coreMessage || '未填写结构化摘要'}</p></div></div></div>)}</div> : <p className="text-sm text-slate-500">暂无带播放量的内容。</p>}</article>;
}

function ReviewPanel({ item, onChanged }: { item: StrategyReviewView; onChanged: (item: StrategyReviewView) => void }) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [savePattern, setSavePattern] = useState(false);
  async function confirm() {
    setPending(true); setMessage('');
    try {
      const result = await fetchData(`/api/strategy-reviews/${item.id}/confirm`, strategyReviewConfirmationResultSchema, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ savePerformancePattern: savePattern }),
      });
      onChanged(result.review);
      setMessage(result.performanceMemoryId ? '策略与表现规律均已人工确认，后续 AI 将自动参考。' : '策略已确认，后续 AI 将自动参考。');
    } catch (error) { setMessage(errorText(error)); } finally { setPending(false); }
  }
  async function reject() {
    setPending(true); setMessage('');
    try {
      const result = await fetchData(`/api/strategy-reviews/${item.id}/reject`, strategyReviewViewSchema, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: '人工复核后暂不采用' }),
      });
      onChanged(result); setMessage('已驳回；不会影响后续 AI。');
    } catch (error) { setMessage(errorText(error)); } finally { setPending(false); }
  }
  async function nextPlan() {
    setPending(true); setMessage('');
    try {
      const result = await fetchData(`/api/strategy-reviews/${item.id}/next-plan`, nextPeriodPlanResultSchema, { method: 'POST' });
      setMessage(`已创建 ${result.plan.year} 年 ${result.plan.month} 月计划草案（未启用）。`);
    } catch (error) { setMessage(errorText(error)); } finally { setPending(false); }
  }
  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="eyebrow">REVIEW RESULT</p><h2 className="text-xl font-semibold">{item.accountName} · 策略复盘</h2><p className="mt-1 text-sm text-slate-500">{new Date(item.periodStart).toLocaleDateString('zh-CN')} — {new Date(item.periodEnd).toLocaleDateString('zh-CN')}</p></div><Badge className={statusClasses[item.status]}>{statusLabels[item.status]}</Badge></div>
    <FactsPanel metrics={item.metricsSnapshotJson} />
    <section className="grid gap-4 xl:grid-cols-2"><article className="surface-card border-l-4 border-l-violet-400"><div className="flex items-center gap-2"><BrainCircuit className="size-5 text-violet-600" /><h3 className="font-semibold">AI 解释</h3></div><p className="mt-4 leading-7 text-slate-700">{item.aiAnalysisJson.summary}</p><p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">样本说明：{item.aiAnalysisJson.sample_size_notes} · 置信度 {rate(item.aiAnalysisJson.confidence)}</p><div className="mt-4 grid gap-4 sm:grid-cols-2"><TextList title="有效模式" items={item.aiAnalysisJson.effective_patterns} /><TextList title="弱势模式" items={item.aiAnalysisJson.weak_patterns} /></div></article><article className="surface-card border-l-4 border-l-cyan-400"><div className="flex items-center gap-2"><FlaskConical className="size-5 text-cyan-700" /><h3 className="font-semibold">AI 策略建议</h3></div><p className="mt-4 text-sm text-slate-500">下一周期目标：<span className="font-semibold text-slate-900">{contentGoalLabels[item.aiStrategyJson.next_period_goal]}</span></p><div className="mt-3 flex flex-wrap gap-2">{Object.entries(item.aiStrategyJson.recommended_content_mix).map(([type, value]) => <Badge variant="outline" key={type}>{contentTypeLabels[type as keyof typeof contentTypeLabels]} {value}%</Badge>)}</div><div className="mt-5 grid gap-4 sm:grid-cols-2"><TextList title="保留" items={item.aiStrategyJson.keep} /><TextList title="减少" items={item.aiStrategyJson.reduce} /><TextList title="测试" items={item.aiStrategyJson.test} /><TextList title="下一步" items={item.aiStrategyJson.next_actions} /></div></article></section>
    {item.status === 'draft' && item.permissions.canConfirm && <section className="surface-card"><h3 className="font-semibold">人工确认门禁</h3><p className="mt-2 text-sm text-slate-500">AI 输出目前只是草稿。确认后，该策略才会成为后续 AI 的参考。</p><label htmlFor={`save-pattern-${item.id}`} className="mt-4 flex items-start gap-3 rounded-xl border p-3 text-sm"><Checkbox id={`save-pattern-${item.id}`} checked={savePattern} onCheckedChange={(value) => setSavePattern(value === true)} disabled={!item.sampleThresholdMet || pending} /><span><span className="font-medium">同时保存为表现规律</span><span className="mt-1 block text-slate-500">需达到管理员阈值 {item.sampleThreshold} 条；当前 {item.metricsSnapshotJson.sampledContentCount} 条。{!item.sampleThresholdMet && ' 当前不可选。'}</span></span></label><div className="mt-4 flex flex-wrap gap-2"><Button onClick={() => void confirm()} disabled={pending}>{pending ? <LoaderCircle className="animate-spin" /> : <CheckCircle2 />}确认策略</Button><Button variant="outline" onClick={() => void reject()} disabled={pending}><XCircle />驳回</Button></div></section>}
    {item.status === 'confirmed' && item.permissions.canCreateNextPlan && <section className="surface-card"><h3 className="font-semibold">下一周期</h3><p className="mt-2 text-sm text-slate-500">创建 inactive 月度计划草案，不覆盖已存在的同月计划。</p><Button className="mt-4" variant="outline" onClick={() => void nextPlan()} disabled={pending}>一键创建下月计划草案</Button></section>}
    {message && <output className="block rounded-xl bg-slate-900 p-3 text-sm text-white">{message}</output>}
  </div>;
}

function TextList({ title, items }: { title: string; items: string[] }) {
  return <div><p className="text-sm font-medium">{title}</p>{items.length ? <ul className="mt-2 space-y-1 text-sm leading-6 text-slate-600">{items.map((item, index) => <li key={`${title}-${index}`}>· {item}</li>)}</ul> : <p className="mt-2 text-sm text-slate-400">暂无</p>}</div>;
}

export function StrategyReviewPage() {
  const [initial] = useState(initialPeriod);
  const state = useApiData('/api/strategy-reviews?pageSize=50', strategyReviewListSchema);
  const [selected, setSelected] = useState<StrategyReviewView | null>(null);
  const [preview, setPreview] = useState<z.infer<typeof strategyMetricsResultSchema> | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [accountId, setAccountId] = useState('');
  const [periodStart, setPeriodStart] = useState(initial.start);
  const [periodEnd, setPeriodEnd] = useState(initial.end);
  const targetAccount = accountId || state.data?.options.accounts[0]?.id || '';
  const request = () => ({
    accountId: targetAccount,
    periodStart: new Date(`${periodStart}T00:00:00.000Z`).toISOString(),
    periodEnd: new Date(`${periodEnd}T23:59:59.999Z`).toISOString(),
  });
  async function calculate() {
    if (!targetAccount) return;
    setPending(true); setMessage('');
    try {
      const query = new URLSearchParams(request()).toString();
      setPreview(await fetchData(`/api/strategy-reviews/aggregate?${query}`, strategyMetricsResultSchema));
    } catch (error) { setMessage(errorText(error)); } finally { setPending(false); }
  }
  async function generate() {
    setPending(true); setMessage('');
    try {
      const result = await fetchData('/api/strategy-reviews', strategyReviewGenerationResultSchema, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request()),
      });
      setSelected(result.review); setPreview(null); state.reload();
      setMessage(`AI 复盘草稿已保存，Run ${result.runId.slice(0, 8)}…，本次扣除 ${result.billedPoints} Points。`);
    } catch (error) { setMessage(errorText(error)); } finally { setPending(false); }
  }
  async function saveThreshold(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setMessage('');
    try {
      const form = new FormData(event.currentTarget);
      const minimumSampleSize = Number(form.get('minimumSampleSize'));
      await fetchData('/api/settings/strategy-review', z.object({ config: z.object({ minimumSampleSize: z.number() }), permissions: z.object({ canWrite: z.boolean() }) }), {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ minimumSampleSize }),
      });
      setMessage('样本阈值已更新。'); state.reload();
    } catch (error) { setMessage(errorText(error)); } finally { setPending(false); }
  }
  const updateReview = (item: StrategyReviewView) => { setSelected(item); state.reload(); };
  return <div className="space-y-7"><header className="flex flex-wrap items-end justify-between gap-4"><div><p className="eyebrow">AI REVIEW & STRATEGY</p><h1 className="page-title">策略复盘</h1><p className="page-description">代码先聚合 Performance Snapshot，千问只解释事实并提出待人工确认的策略。</p></div><Button variant="outline" nativeButton={false} render={<Link href="/ops/runs" />}>查看 Run Trace</Button></header>
    {state.loading ? <LoadingData /> : state.error ? <ErrorData error={state.error} retry={state.reload} /> : state.data && <>
      <section className="surface-card"><div className="flex items-center gap-2"><BrainCircuit className="size-5 text-cyan-700" /><h2 className="font-semibold">新建周期复盘</h2></div><div className="mt-5 grid items-end gap-3 sm:grid-cols-2 xl:grid-cols-5"><label className="space-y-1.5 text-sm xl:col-span-2" htmlFor="review-account">账号<NativeSelect id="review-account" value={targetAccount} onChange={(event) => { setAccountId(event.target.value); setPreview(null); }}><option value="">选择账号</option>{state.data.options.accounts.map((item) => <option value={item.id} key={item.id}>{item.clientName} / {item.name}</option>)}</NativeSelect></label><label className="space-y-1.5 text-sm" htmlFor="review-start">周期开始<Input id="review-start" type="date" value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} /></label><label className="space-y-1.5 text-sm" htmlFor="review-end">周期结束<Input id="review-end" type="date" value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} /></label><Button disabled={pending || !targetAccount} onClick={() => void calculate()}>{pending ? <LoaderCircle className="animate-spin" /> : <Settings2 />}先计算事实</Button></div>{message && <output className="mt-4 block rounded-lg bg-slate-900 p-3 text-sm text-white">{message}</output>}</section>
      {preview && <section className="surface-card"><FactsPanel metrics={preview.metrics} /><div className={`mt-5 rounded-xl p-4 text-sm ${preview.sampleThresholdMet ? 'bg-emerald-50 text-emerald-900' : 'bg-amber-50 text-amber-900'}`}>有效样本 {preview.metrics.sampledContentCount} 条；表现规律写入阈值为 {preview.sampleThreshold} 条。{preview.metrics.sampledContentCount === 0 ? ' 当前无有效快照，不会调用 AI。' : !preview.sampleThresholdMet ? ' 可生成方向性复盘，但不能保存为表现规律。' : ' 已达到表现规律确认门槛。'}</div><Button className="mt-4" onClick={() => void generate()} disabled={pending || !preview.canGenerate}>{pending ? <LoaderCircle className="animate-spin" /> : <BrainCircuit />}调用千问生成解释与策略草稿</Button></section>}
      {selected && <section className="surface-card"><ReviewPanel item={selected} onChanged={updateReview} /></section>}
      <section className="grid gap-4 xl:grid-cols-[1fr_320px]"><article className="surface-card !p-0"><div className="border-b p-5"><h2 className="font-semibold">历史策略复盘</h2><p className="mt-1 text-sm text-slate-500">未确认的 AI 草稿不会影响后续生成。</p></div>{state.data.items.length ? <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>账号 / 周期</TableHead><TableHead>样本</TableHead><TableHead>状态</TableHead><TableHead>创建时间</TableHead><TableHead /></TableRow></TableHeader><TableBody>{state.data.items.map((item) => <TableRow key={item.id}><TableCell><p className="font-medium">{item.accountName}</p><p className="mt-1 text-xs text-slate-500">{new Date(item.periodStart).toLocaleDateString('zh-CN')} — {new Date(item.periodEnd).toLocaleDateString('zh-CN')}</p></TableCell><TableCell>{item.metricsSnapshotJson.sampledContentCount} / 阈值 {item.sampleThreshold}</TableCell><TableCell><Badge className={statusClasses[item.status]}>{statusLabels[item.status]}</Badge></TableCell><TableCell>{new Date(item.createdAt).toLocaleString('zh-CN')}</TableCell><TableCell><Button size="sm" variant="outline" onClick={() => setSelected(item)}>查看</Button></TableCell></TableRow>)}</TableBody></Table></div> : <EmptyData title="暂无策略复盘" description="先选择账号和周期，计算真实表现数据后再生成。" />}</article><aside className="surface-card"><h2 className="font-semibold">表现规律门槛</h2><p className="mt-2 text-sm leading-6 text-slate-500">只有达到此样本量并经人工勾选确认，才会作为后续 AI 的表现规律。</p>{state.data.permissions.canConfigure ? <form className="mt-4 space-y-3" onSubmit={saveThreshold}><label className="space-y-1.5 text-sm" htmlFor="minimum-sample">最少有效快照内容数<Input id="minimum-sample" name="minimumSampleSize" type="number" min="1" max="10000" defaultValue={state.data.config.minimumSampleSize} required /></label><Button type="submit" variant="outline" disabled={pending}>保存阈值</Button></form> : <p className="mt-4 text-sm text-slate-500">当前身份只读；阈值为 {state.data.config.minimumSampleSize} 条。</p>}</aside></section>
    </>}
  </div>;
}
