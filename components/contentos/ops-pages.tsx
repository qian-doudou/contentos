'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  AlertTriangle, ArrowLeft, ArrowRight, Bot, CalendarDays, CheckCircle2,
  CircleDollarSign, Clock3, Gauge, ListChecks, Save, Settings2, ShieldAlert,
  Sparkles, Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Progress, ProgressLabel, ProgressValue } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  aiCostDataSchema, opsConfigSchema, opsOverviewDataSchema, runDetailDataSchema,
  type AiCostGroup, type OpsConfig, type RunDetailData,
} from '@/lib/ops/contracts';
import { roleLabels } from '@/lib/auth/contracts';
import { EmptyData, ErrorData, fetchData, LoadingData, useApiData } from './master-data/common';

const riskLabels = { low: '正常', medium: '轻度落后', high: '高风险' } as const;
const stateLabels = {
  current: '本月执行中', future: '未来计划', closed: '已完成', overdue: '已逾期',
  closed_with_gap: '关闭但有缺口', draft: '草案',
} as const;
const runStatusLabels = {
  queued: '排队中', running: '运行中', completed: '已完成', completed_with_warnings: '完成但有警告',
  manual_review_required: '需人工审核', failed: '失败', cancelled: '已取消',
} as const;

function formatRate(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatDateTime(value: string | null) {
  return value ? new Date(value).toLocaleString('zh-CN') : '—';
}

function formatDuration(value: number | null) {
  if (value === null) return '暂无可计算样本';
  if (value < 60_000) return `${Math.round(value / 1000)} 秒`;
  if (value < 3_600_000) return `${Math.round(value / 60_000)} 分钟`;
  return `${(value / 3_600_000).toFixed(1)} 小时`;
}

function formText(form: FormData, key: string) {
  const value = form.get(key);
  if (typeof value !== 'string') throw new Error(`${key} 必须是文本`);
  return value;
}

function OpsHeading({ title, description, back }: { title: string; description: string; back?: boolean }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="eyebrow">运营中心 / 发现问题并行动</p>
        <h1 className="page-title">{title}</h1>
        <p className="page-description">{description}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {back && <Button variant="outline" nativeButton={false} render={<Link href="/ops/runs" />}><ArrowLeft />Run 列表</Button>}
        <Button variant="outline" nativeButton={false} render={<Link href="/ops" />}>履约与团队</Button>
        <Button variant="outline" nativeButton={false} render={<Link href="/ops/ai-cost" />}>AI 成本</Button>
        <Button variant="outline" nativeButton={false} render={<Link href="/ops/runs" />}>Run 追踪</Button>
      </div>
    </header>
  );
}

function RiskBadge({ risk }: { risk: 'low' | 'medium' | 'high' }) {
  const className = risk === 'high' ? 'bg-rose-50 text-rose-700' : risk === 'medium' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700';
  return <Badge className={className} variant="secondary">{riskLabels[risk]}</Badge>;
}

function QuotaCard({ quota }: { quota: NonNullable<ReturnType<typeof opsOverviewDataSchema.parse>['quota']> | null }) {
  if (!quota) return (
    <Card className="border-amber-200 bg-amber-50/40">
      <CardHeader><CardTitle className="text-base">AI 额度期不可用</CardTitle><CardDescription>收费生产任务会被服务端阻止；请先配置有效额度期。</CardDescription></CardHeader>
    </Card>
  );
  const levelClass = quota.alertLevel === 'blocked_100' ? 'text-rose-700' : quota.alertLevel === 'critical_90' ? 'text-orange-700' : quota.alertLevel === 'warning_70' ? 'text-amber-700' : 'text-emerald-700';
  return (
    <Card>
      <CardHeader>
        <div><CardDescription>AI Points 额度预警</CardDescription><CardTitle className={`mt-1 text-2xl ${levelClass}`}>{formatRate(quota.usageRate)}</CardTitle></div>
        <CardAction><ShieldAlert className={levelClass} /></CardAction>
      </CardHeader>
      <CardContent className="space-y-3">
        <Progress value={quota.usageRate * 100}><ProgressLabel>{quota.usedPoints} / {quota.quotaPoints}</ProgressLabel><ProgressValue>{() => `${quota.remainingPoints} 剩余`}</ProgressValue></Progress>
        <p className="text-xs leading-5 text-slate-500">
          {quota.billedProductionBlocked ? '100%：新的收费 Production Run 已由服务端禁止。' : '达到 70% / 90% / 100% 时分级预警。'}
          {quota.adminTestEvalAllowed ? ' 管理员仍可运行 Test/Eval。' : ' 当前设置同时禁止管理员 Test/Eval。'}
        </p>
      </CardContent>
    </Card>
  );
}

function ConfigDialog({ value, reload }: { value: OpsConfig; reload: () => void }) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  async function save(event: React.SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    setPending(true);
    setMessage('');
    const form = new FormData(event.currentTarget);
    try {
      await fetchData('/api/ops/config', opsConfigSchema, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deliveryRisk: {
            toleranceRate: Number(form.get('toleranceRate')) / 100,
            highGapRate: Number(form.get('highGapRate')) / 100,
            nearMonthEndDays: Number(form.get('nearMonthEndDays')),
            nearMonthEndRemainingCount: Number(form.get('nearMonthEndRemainingCount')),
          },
          allowAdminTestEvalAtQuotaLimit: form.get('allowAdminTestEvalAtQuotaLimit') === 'on',
        }),
      });
      setMessage('配置已保存，风险结果会按新阈值重新计算。');
      reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存失败');
    } finally {
      setPending(false);
    }
  }
  return (
    <Dialog>
      <DialogTrigger render={<Button variant="outline" />}><Settings2 />风险与额度策略</DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader><DialogTitle>运营中心配置</DialogTitle><DialogDescription>阈值存入组织级 app_settings，页面不硬编码风险结论。</DialogDescription></DialogHeader>
        <form className="grid gap-4 px-5 pb-5 sm:grid-cols-2" onSubmit={save}>
          <label htmlFor="ops-tolerance" className="space-y-1.5 text-sm">容忍度（%）<Input id="ops-tolerance" name="toleranceRate" type="number" min="0" max="100" step="1" defaultValue={value.deliveryRisk.toleranceRate * 100} required /></label>
          <label htmlFor="ops-high-gap" className="space-y-1.5 text-sm">高风险额外差距（%）<Input id="ops-high-gap" name="highGapRate" type="number" min="0" max="100" step="1" defaultValue={value.deliveryRisk.highGapRate * 100} required /></label>
          <label htmlFor="ops-month-end-days" className="space-y-1.5 text-sm">接近月底天数<Input id="ops-month-end-days" name="nearMonthEndDays" type="number" min="0" max="15" defaultValue={value.deliveryRisk.nearMonthEndDays} required /></label>
          <label htmlFor="ops-remaining-count" className="space-y-1.5 text-sm">月底高风险剩余条数<Input id="ops-remaining-count" name="nearMonthEndRemainingCount" type="number" min="1" max="1000" defaultValue={value.deliveryRisk.nearMonthEndRemainingCount} required /></label>
          <div className="flex items-start gap-3 rounded-xl border p-3 text-sm sm:col-span-2">
            <input aria-label="额度耗尽后允许管理员 Test/Eval" id="ops-admin-test-eval" className="mt-1 size-4" name="allowAdminTestEvalAtQuotaLimit" type="checkbox" defaultChecked={value.allowAdminTestEvalAtQuotaLimit} />
            <div><b className="block">额度耗尽后允许管理员 Test/Eval</b><p className="mt-1 text-xs leading-5 text-slate-500">只适用于 owner/admin 且不扣正式 Points；Operator 仍会被服务端阻止。</p></div>
          </div>
          {message && <output className="text-sm text-cyan-800 sm:col-span-2">{message}</output>}
          <DialogFooter className="sm:col-span-2"><DialogClose render={<Button variant="outline" />}>关闭</DialogClose><Button disabled={pending}><Save />{pending ? '保存中…' : '保存配置'}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function OpsCenterPage() {
  const [url, setUrl] = useState('/api/ops/overview');
  const state = useApiData(url, opsOverviewDataSchema);
  function filter(event: React.SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    const value = formText(new FormData(event.currentTarget), 'period');
    const [year, month] = value.split('-').map(Number);
    if (year && month) setUrl(`/api/ops/overview?year=${year}&month=${month}`);
  }
  return (
    <div className="space-y-6">
      <OpsHeading title="运营履约中心" description="从月度履约缺口、团队事实与额度风险直接进入业务对象处理。" />
      <form className="surface-card flex flex-wrap items-end gap-3" onSubmit={filter}>
        <label htmlFor="ops-period" className="space-y-1.5 text-sm">查看月份<Input id="ops-period" name="period" type="month" required defaultValue={state.data ? `${state.data.period.year}-${String(state.data.period.month).padStart(2, '0')}` : ''} /></label>
        <Button><CalendarDays />切换周期</Button>
        {state.data?.permissions.canConfigure && <ConfigDialog value={state.data.config} reload={state.reload} />}
      </form>
      {state.loading ? <LoadingData /> : state.error ? <ErrorData error={state.error} retry={state.reload} /> : state.data && <>
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {([
            { label: '计划数', value: state.data.summary.planCount, icon: ListChecks },
            { label: '计划目标', value: state.data.summary.plannedCount, icon: Gauge },
            { label: '已发布', value: state.data.summary.publishedCount, icon: CheckCircle2 },
            { label: '剩余缺口', value: state.data.summary.remainingCount, icon: Clock3 },
            { label: '高风险计划', value: state.data.summary.highRiskPlanCount, icon: AlertTriangle },
          ] satisfies Array<{ label: string; value: number; icon: LucideIcon }>).map(({ label, value, icon: Icon }) => <Card key={label}><CardHeader><CardDescription>{label}</CardDescription><CardTitle className="text-3xl tabular-nums">{value}</CardTitle><CardAction><span className="card-icon"><Icon /></span></CardAction></CardHeader></Card>)}
        </section>
        <section className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(20rem,.6fr)]">
          <Card className="overflow-hidden">
            <CardHeader className="border-b"><div><CardTitle>客户履约</CardTitle><CardDescription>{state.data.period.label} · 发布数来自实际 Publish 记录</CardDescription></div><CardAction><Badge variant="outline">{state.data.delivery.length} 个账号计划</Badge></CardAction></CardHeader>
            <CardContent className="px-0">
              {state.data.delivery.length ? <Table><TableHeader><TableRow><TableHead>客户 / 账号</TableHead><TableHead>履约</TableHead><TableHead>时间进度</TableHead><TableHead>风险</TableHead><TableHead className="text-right">行动</TableHead></TableRow></TableHeader><TableBody>
                {state.data.delivery.map((row) => <TableRow key={row.planId}>
                  <TableCell><p className="font-medium">{row.clientName}</p><p className="mt-1 text-xs text-slate-500">{row.accountName} · {stateLabels[row.periodState]}</p></TableCell>
                  <TableCell className="min-w-36"><p className="font-medium tabular-nums">{row.publishedCount} / {row.plannedCount}</p><p className="mt-1 text-xs text-slate-500">剩余 {row.remainingCount} · {formatRate(row.completionRate)}</p></TableCell>
                  <TableCell className="min-w-40"><Progress value={row.periodProgressRate * 100}><ProgressValue>{() => formatRate(row.periodProgressRate)}</ProgressValue></Progress></TableCell>
                  <TableCell><RiskBadge risk={row.riskLevel} />{row.riskReasons.map((reason) => <p className="mt-1 max-w-52 text-xs leading-5 text-slate-500" key={reason}>{reason}</p>)}</TableCell>
                  <TableCell className="text-right"><Button size="sm" variant="outline" nativeButton={false} render={<Link href={`/contents/plans/${row.planId}`} />}>处理计划<ArrowRight /></Button></TableCell>
                </TableRow>)}
              </TableBody></Table> : <EmptyData title="本周期暂无月度计划" description="创建计划后，履约完成率和自然月进度会在这里实时计算。" />}
            </CardContent>
          </Card>
          <QuotaCard quota={state.data.quota} />
        </section>
        <Card className="overflow-hidden">
          <CardHeader className="border-b"><div><CardTitle>团队事实指标</CardTitle><CardDescription>仅展示可追溯业务事实，不生成员工绩效分。</CardDescription></div><CardAction><Users /></CardAction></CardHeader>
          <CardContent className="px-0">
            {state.data.teamFacts.length ? <Table><TableHeader><TableRow><TableHead>成员</TableHead><TableHead>角色</TableHead><TableHead>指标一</TableHead><TableHead>指标二</TableHead><TableHead>指标三</TableHead><TableHead>指标四</TableHead></TableRow></TableHeader><TableBody>
              {state.data.teamFacts.map((fact) => <TableRow key={fact.member.id}>
                <TableCell className="font-medium">{fact.member.name}</TableCell><TableCell>{roleLabels[fact.member.role]}</TableCell>
                {fact.kind === 'operator' ? <><TableCell>负责客户 {fact.metrics.clientCount}</TableCell><TableCell>创建内容 {fact.metrics.contentsCreated}</TableCell><TableCell>已发布 {fact.metrics.publishedCount}</TableCell><TableCell>延期 {fact.metrics.overdueCount}</TableCell></>
                  : fact.kind === 'photographer' ? <><TableCell>拍摄场次 {fact.metrics.shootCount}</TableCell><TableCell>计划条数 {fact.metrics.plannedItemCount}</TableCell><TableCell>完成条数 {fact.metrics.completedItemCount}</TableCell><TableCell>—</TableCell></>
                    : <><TableCell>待剪辑 {fact.metrics.pendingEditCount}</TableCell><TableCell>已提交版本 {fact.metrics.submittedVersionCount}</TableCell><TableCell>平均处理 {formatDuration(fact.metrics.averageHandlingMs)}</TableCell><TableCell>—</TableCell></>}
              </TableRow>)}
            </TableBody></Table> : <EmptyData title="暂无执行角色" description="组织内没有启用的 Operator、Photographer 或 Editor。" />}
          </CardContent>
        </Card>
      </>}
    </div>
  );
}

function CostTable({ rows }: { rows: AiCostGroup[] }) {
  if (!rows.length) return <EmptyData title="暂无 AI 调用" description="当前筛选周期没有 Usage 记录，指标按 0 返回。" />;
  return <Table><TableHeader><TableRow><TableHead>分组</TableHead><TableHead>调用</TableHead><TableHead>Tokens</TableHead><TableHead>Points</TableHead><TableHead>Estimated cost</TableHead></TableRow></TableHeader><TableBody>
    {rows.map((row) => <TableRow key={row.key}><TableCell className="font-medium">{row.label}</TableCell><TableCell>{row.callCount}</TableCell><TableCell>{row.inputTokens + row.outputTokens}{row.unknownTokenCalls > 0 && <p className="text-xs text-amber-700">{row.unknownTokenCalls} 次 usage 未知</p>}</TableCell><TableCell>{row.billedPoints}</TableCell><TableCell>{row.estimatedCost === null ? <span className="text-amber-700">未知</span> : row.estimatedCost.toFixed(6)}{row.unknownCostCalls > 0 && <p className="text-xs text-slate-500">已知部分 {row.knownEstimatedCost.toFixed(6)}</p>}</TableCell></TableRow>)}
  </TableBody></Table>;
}

export function AiCostPage() {
  const [url, setUrl] = useState('/api/ops/ai-cost');
  const state = useApiData(url, aiCostDataSchema);
  function filter(event: React.SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setUrl(`/api/ops/ai-cost?from=${encodeURIComponent(formText(form, 'from'))}&to=${encodeURIComponent(formText(form, 'to'))}`);
  }
  return <div className="space-y-6">
    <OpsHeading title="AI 成本与额度" description="从真实 ai_usage_logs 汇总 Tokens、Points 与可计算成本；未配置价格的调用明确显示未知。" />
    {state.loading ? <LoadingData /> : state.error ? <ErrorData error={state.error} retry={state.reload} /> : state.data && <>
      <form className="surface-card flex flex-wrap items-end gap-3" onSubmit={filter}>
        <label htmlFor="cost-from" className="space-y-1.5 text-sm">开始日期<Input id="cost-from" name="from" type="date" required defaultValue={state.data.period.from} /></label>
        <label htmlFor="cost-to" className="space-y-1.5 text-sm">结束日期<Input id="cost-to" name="to" type="date" required defaultValue={state.data.period.to} /></label>
        <Button><CalendarDays />筛选</Button>
      </form>
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {([
          { label: '调用次数', value: state.data.totals.callCount, icon: Bot },
          { label: '输入 Token', value: state.data.totals.inputTokens, icon: Sparkles },
          { label: '输出 Token', value: state.data.totals.outputTokens, icon: Sparkles },
          { label: 'Points', value: state.data.totals.billedPoints, icon: Gauge },
        ] satisfies Array<{ label: string; value: number; icon: LucideIcon }>).map(({ label, value, icon: Icon }) => <Card key={label}><CardHeader><CardDescription>{label}</CardDescription><CardTitle className="text-3xl tabular-nums">{value}</CardTitle><CardAction><span className="card-icon"><Icon /></span></CardAction></CardHeader></Card>)}
        <Card><CardHeader><CardDescription>Estimated cost</CardDescription><CardTitle className="text-2xl">{state.data.totals.estimatedCost === null ? '未知' : state.data.totals.estimatedCost.toFixed(6)}</CardTitle><CardAction><span className="card-icon"><CircleDollarSign /></span></CardAction></CardHeader><CardContent><p className="text-xs text-slate-500">{state.data.totals.unknownCostCalls ? `${state.data.totals.unknownCostCalls} 次调用缺少有效价格` : '全部调用均有价格依据'}</p></CardContent></Card>
      </section>
      <QuotaCard quota={state.data.quota} />
      <Card className="overflow-hidden"><CardHeader className="border-b"><CardTitle>成本维度</CardTitle><CardDescription>所有分组均限定当前 organization_id 和筛选周期。</CardDescription></CardHeader><CardContent className="p-0">
        <Tabs defaultValue="skill" className="gap-0"><TabsList variant="line" className="mx-5 mt-4"><TabsTrigger value="skill">Skill</TabsTrigger><TabsTrigger value="model">模型</TabsTrigger><TabsTrigger value="client">客户</TabsTrigger><TabsTrigger value="account">账号</TabsTrigger><TabsTrigger value="user">用户</TabsTrigger></TabsList>
          <TabsContent value="skill"><CostTable rows={state.data.groups.bySkill} /></TabsContent><TabsContent value="model"><CostTable rows={state.data.groups.byModel} /></TabsContent><TabsContent value="client"><CostTable rows={state.data.groups.byClient} /></TabsContent><TabsContent value="account"><CostTable rows={state.data.groups.byAccount} /></TabsContent><TabsContent value="user"><CostTable rows={state.data.groups.byUser} /></TabsContent>
        </Tabs>
      </CardContent></Card>
    </>}
  </div>;
}

function JsonBlock({ value }: { value: unknown }) {
  return <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-slate-950 p-4 text-xs leading-6 text-slate-100">{JSON.stringify(value, null, 2)}</pre>;
}

function TraceTimeline({ data }: { data: RunDetailData }) {
  if (!data.steps.length) return <EmptyData title="Run 尚无步骤" description="该 Run 未创建任何 Step。" />;
  return <div className="space-y-0">{data.steps.map((step, index) => <div className="relative flex gap-4 pb-7" key={step.id}>
    {index < data.steps.length - 1 && <span className="absolute left-[15px] top-8 h-[calc(100%-1rem)] w-px bg-slate-200" />}
    <span className={`z-10 grid size-8 shrink-0 place-items-center rounded-full border text-xs font-semibold ${step.status === 'failed' ? 'border-rose-200 bg-rose-50 text-rose-700' : step.status === 'succeeded' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-white text-slate-500'}`}>{step.sequence + 1}</span>
    <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="font-mono text-sm font-medium">{step.stepCode}</p><Badge variant="outline">{step.status}</Badge><span className="text-xs text-slate-400">{step.durationMs === null ? '—' : `${step.durationMs} ms`}</span></div><p className="mt-1 text-xs text-slate-500">{formatDateTime(step.startedAt)} → {formatDateTime(step.finishedAt)}</p>
      {(step.error !== null || step.warningCodes.length > 0) && <div className="mt-3 rounded-lg bg-rose-50 p-3 text-xs text-rose-800">{step.error !== null && <JsonBlock value={step.error} />}{step.warningCodes.length > 0 && <p className="mt-2">Warnings: {step.warningCodes.join('、')}</p>}</div>}
      <details className="mt-3 text-xs"><summary className="cursor-pointer text-cyan-800">查看安全输入 / 输出</summary><div className="mt-3 grid gap-3 lg:grid-cols-2"><JsonBlock value={step.input} /><JsonBlock value={step.output} /></div></details>
    </div>
  </div>)}</div>;
}

export function RunDetailPage({ id }: { id: string }) {
  const state = useApiData(`/api/ops/runs/${id}`, runDetailDataSchema);
  return <div className="space-y-6"><OpsHeading title="Run 详情" description="查看步骤时间线、Context、Skill、实际用量、重试和最终业务结果；敏感字段由服务端脱敏。" back />
    {state.loading ? <LoadingData /> : state.error ? <ErrorData error={state.error} retry={state.reload} /> : state.data && <>
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card><CardHeader><CardDescription>Run 状态</CardDescription><CardTitle>{runStatusLabels[state.data.run.status]}</CardTitle></CardHeader><CardContent><p className="font-mono text-xs text-slate-500">{state.data.run.id}</p></CardContent></Card>
        <Card><CardHeader><CardDescription>Tokens</CardDescription><CardTitle>{state.data.totals.inputTokens + state.data.totals.outputTokens}</CardTitle></CardHeader><CardContent><p className="text-xs text-slate-500">输入 {state.data.totals.inputTokens} / 输出 {state.data.totals.outputTokens}</p></CardContent></Card>
        <Card><CardHeader><CardDescription>成本 / Points</CardDescription><CardTitle>{state.data.totals.estimatedCost === null ? '未知' : state.data.totals.estimatedCost.toFixed(6)}</CardTitle></CardHeader><CardContent><p className="text-xs text-slate-500">{state.data.totals.billedPoints} Points</p></CardContent></Card>
        <Card><CardHeader><CardDescription>实际重试</CardDescription><CardTitle>{state.data.totals.retryCount}</CardTitle></CardHeader><CardContent><p className="text-xs text-slate-500">由每次 usage 的 attempts 计算</p></CardContent></Card>
      </section>
      <Card><CardHeader className="border-b"><div><CardTitle>最终业务结果</CardTitle><CardDescription>{state.data.run.runType.toUpperCase()} · {state.data.actor?.name ?? '系统'} · {formatDateTime(state.data.run.createdAt)}</CardDescription></div><CardAction>{state.data.businessResult.href && <Button size="sm" nativeButton={false} render={<Link href={state.data.businessResult.href} />}>打开业务对象<ArrowRight /></Button>}</CardAction></CardHeader><CardContent className="grid gap-3 py-5 sm:grid-cols-3"><div><p className="text-xs text-slate-500">类型</p><p className="mt-1 font-mono text-sm">{state.data.businessResult.type}</p></div><div><p className="text-xs text-slate-500">对象</p><p className="mt-1 text-sm">{state.data.businessResult.label}</p></div><div><p className="text-xs text-slate-500">状态</p><p className="mt-1 text-sm">{state.data.businessResult.status ?? '无持久化结果'}</p></div></CardContent></Card>
      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(22rem,.7fr)]">
        <Card><CardHeader className="border-b"><CardTitle>步骤时间线</CardTitle><CardDescription>{state.data.steps.length} Steps · {state.data.errors.length} 个错误</CardDescription></CardHeader><CardContent className="pt-5"><TraceTimeline data={state.data} /></CardContent></Card>
        <div className="space-y-6"><Card><CardHeader className="border-b"><CardTitle>Skill 与模型</CardTitle></CardHeader><CardContent className="px-0">{state.data.usage.length ? <Table><TableHeader><TableRow><TableHead>Skill</TableHead><TableHead>模型</TableHead><TableHead>用量</TableHead></TableRow></TableHeader><TableBody>{state.data.usage.map((row) => <TableRow key={row.id}><TableCell><p className="font-mono text-xs">{row.skillCode}</p><p className="text-xs text-slate-500">v{row.skillVersion}</p></TableCell><TableCell className="font-mono text-xs">{row.model}</TableCell><TableCell className="text-xs">{(row.inputTokens ?? 0) + (row.outputTokens ?? 0)} tokens<br />{row.attempts} 次尝试</TableCell></TableRow>)}</TableBody></Table> : <EmptyData title="未调用模型" description="该 Run 没有 AI Usage。" />}</CardContent></Card>
          <Card><CardHeader className="border-b"><CardTitle>Context Snapshot</CardTitle><CardDescription>仅展示本 Run 引用的快照。</CardDescription></CardHeader><CardContent className="space-y-3 pt-5">{state.data.contextSnapshots.length ? state.data.contextSnapshots.map((snapshot) => <details key={snapshot.id}><summary className="cursor-pointer font-mono text-xs text-cyan-800">{snapshot.id}</summary><div className="mt-3"><JsonBlock value={snapshot.snapshot} /></div></details>) : <EmptyData title="无 Context Snapshot" description="该 Run 未构建或未引用上下文。" />}</CardContent></Card></div>
      </section>
    </>}
  </div>;
}
