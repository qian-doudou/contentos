'use client';

import Link from 'next/link';
import {
  ArrowRight, BookOpenText, BrainCircuit, CircleAlert, Clock3, FilePenLine,
  History, Lightbulb, ListChecks, MemoryStick, SearchCheck, Sparkles, Workflow,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { dashboardDataSchema } from '@/lib/contracts';
import { plannerPageDataSchema } from '@/lib/planner/contracts';
import { EmptyData, ErrorData, LoadingData, useApiData } from '@/components/contentos/master-data/common';

const runStatusLabels = {
  queued: '排队中', running: '运行中', completed: '已完成', completed_with_warnings: '有警告',
  manual_review_required: '需人工审核', failed: '失败', cancelled: '已取消',
} as const;

const runTone = {
  queued: 'bg-slate-100 text-slate-700', running: 'bg-cyan-50 text-cyan-800', completed: 'bg-emerald-50 text-emerald-700',
  completed_with_warnings: 'bg-amber-50 text-amber-800', manual_review_required: 'bg-amber-50 text-amber-800',
  failed: 'bg-rose-50 text-rose-700', cancelled: 'bg-slate-100 text-slate-600',
} as const;

const primaryActions = [
  { href: '/scripts/new', title: '脚本生成', description: '选择账号，由 AI 推荐3组方向；确认后自动生成口播和分镜。', action: '开始生成', icon: Sparkles, featured: true },
  { href: '/contents', title: '继续已有内容', description: '在内容与脚本工作台继续修改、提交审核或查看历史版本。', action: '打开内容与脚本', icon: BookOpenText, featured: false },
  { href: '/ai/planner', title: '批量规划选题', description: '按月度计划缺口生成候选，经过历史去重后再选择保存。', action: '进入策划', icon: Lightbulb, featured: false },
  { href: '/ai/reviews', title: '复盘内容表现', description: '程序先计算真实指标，AI再解释规律并生成下一周期策略。', action: '开始复盘', icon: BrainCircuit, featured: false },
] as const;

const managementEntries: Array<{ href: string; title: string; description: string; icon: LucideIcon }> = [
  { href: '/ai/inspiration', title: '爆款灵感', description: '搜索公开内容，提取可借鉴的结构和角度。', icon: SearchCheck },
  { href: '/ai/memory', title: '品牌与账号记忆', description: '查看当前有效、过期和被替代的长期事实。', icon: MemoryStick },
  { href: '/ai/dedup-test', title: '历史去重测试', description: '查看同账号Top10召回和重复判断结果。', icon: History },
  { href: '/ops/runs', title: 'AI运行追踪', description: '检查模型、Token、成本、步骤和失败原因。', icon: Workflow },
];

function MetricCard({ label, value, helper, href, icon: Icon }: { label: string; value: string | number; helper: string; href: string; icon: LucideIcon }) {
  return <Link className="block rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2383e2]/35" href={href}><Card className="h-full transition hover:border-[#d3d1cb]"><CardHeader><CardDescription>{label}</CardDescription><CardTitle className="text-3xl tabular-nums">{value}</CardTitle><CardAction><span className="card-icon"><Icon /></span></CardAction></CardHeader><CardContent><p className="text-sm leading-5 text-[#787774]">{helper}</p></CardContent></Card></Link>;
}

export function AiHubPage() {
  const dashboard = useApiData('/api/dashboard', dashboardDataSchema);
  const planner = useApiData('/api/ai/planner', plannerPageDataSchema);
  if (dashboard.loading || planner.loading) return <LoadingData />;
  if (dashboard.error) return <ErrorData error={dashboard.error} retry={dashboard.reload} />;
  if (planner.error) return <ErrorData error={planner.error} retry={planner.reload} />;
  if (!dashboard.data || !planner.data) return null;

  const workbench = dashboard.data.workbench.counts;
  const writableAccounts = planner.data.accounts.filter(account => account.canWrite);
  const plannedAccounts = writableAccounts.filter(account => account.currentPlan);
  const recentProductionRuns = dashboard.data.recentRuns.filter(run => run.runType === 'production');
  const modeLabel = planner.data.mode === 'live' ? '千问已接入' : '演示模式';
  const estimatedGenerationCost = planner.data.plannerPointCost !== null && planner.data.scriptPointCost !== null
    ? planner.data.plannerPointCost + planner.data.scriptPointCost : null;

  return <div className="space-y-7">
    <header className="flex flex-wrap items-end justify-between gap-4"><div><p className="eyebrow">AI WORKBENCH</p><h1 className="page-title">AI 运营中心</h1><p className="page-description">先看当前状态和待处理事项，再直接进入脚本、策划或复盘。</p></div><div className="flex flex-wrap gap-2"><Badge variant="outline"><Sparkles />{modeLabel}</Badge><Button nativeButton={false} render={<Link href="/scripts/new" />}><FilePenLine />脚本生成</Button></div></header>

    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard label="可用 AI 积分" value={planner.data.remainingPoints} helper={estimatedGenerationCost === null ? '生成费用尚未配置' : `完整生成一条约 ${estimatedGenerationCost} 积分`} href="/settings/ai" icon={Sparkles} />
      <MetricCard label="可创作账号" value={writableAccounts.length} helper={`${plannedAccounts.length} 个账号已关联当月计划`} href="/clients" icon={ListChecks} />
      <MetricCard label="待生成脚本" value={workbench.scriptsToWrite} helper="已有选题或需要继续完善的脚本" href="/contents?statuses=IDEA,SCRIPTING" icon={FilePenLine} />
      <MetricCard label="待审核" value={workbench.pendingApproval} helper="等待处理的脚本或成片审核" href="/contents?statuses=WAITING_APPROVAL,WAITING_REVIEW" icon={Clock3} />
    </section>

    {dashboard.data.metrics.failedRuns > 0 && <Link href="/ops/runs?status=failed" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-5 py-4 text-rose-900"><span className="flex items-center gap-3"><CircleAlert className="size-5" /><span><strong>{dashboard.data.metrics.failedRuns} 个 AI Run 失败</strong><span className="ml-2 text-sm text-rose-700">可进入运行追踪查看错误和重试记录</span></span></span><span className="flex items-center gap-1 text-sm font-medium">查看失败记录<ArrowRight className="size-4" /></span></Link>}

    <section><div className="mb-4"><h2 className="text-xl font-semibold">现在要做什么？</h2><p className="mt-1 text-sm text-slate-500">按日常使用频率排列，脚本生产是第一入口。</p></div><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{primaryActions.map(({ href, title, description, action, icon: Icon, featured }) => <article className={`surface-card flex min-h-64 flex-col ${featured ? '!border-cyan-200 bg-cyan-50/40' : ''}`} key={href}><div className={`grid size-10 place-items-center rounded-xl ${featured ? 'bg-cyan-100 text-cyan-900' : 'bg-[#f1f1ef] text-[#5f5e5a]'}`}><Icon className="size-5" /></div><h3 className="mt-5 text-lg font-semibold">{title}</h3><p className="mt-2 flex-1 text-sm leading-6 text-slate-500">{description}</p><Button className="mt-5 self-start" variant={featured ? 'default' : 'outline'} nativeButton={false} render={<Link href={href} />}>{action}<ArrowRight /></Button></article>)}</div></section>

    <section className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(20rem,.65fr)]">
      <Card className="overflow-hidden"><CardHeader className="border-b"><div><CardTitle>最近 AI 运行</CardTitle><CardDescription>只展示真实持久化的 Production Run，可进入步骤时间线继续排查。</CardDescription></div><CardAction><Button size="sm" variant="outline" nativeButton={false} render={<Link href="/ops/runs" />}>全部 Run</Button></CardAction></CardHeader><CardContent className="px-0">{recentProductionRuns.length ? <div className="divide-y">{recentProductionRuns.slice(0, 5).map(run => <Link className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 transition hover:bg-[#fbfbfa]" href={`/ops/runs/${run.id}`} key={run.id}><div><p className="font-medium">{run.subjectType || 'AI任务'}</p><p className="mt-1 text-xs text-slate-500">{new Date(run.createdAt).toLocaleString('zh-CN')} · {run.steps.length} 个步骤</p></div><Badge variant="secondary" className={runTone[run.status]}>{runStatusLabels[run.status]}</Badge></Link>)}</div> : <EmptyData title="暂无正式 AI 运行" description="完成第一次AI脚本或策划后，这里会出现可追踪记录。" />}</CardContent></Card>
      <Card><CardHeader className="border-b"><CardTitle>管理与诊断</CardTitle><CardDescription>不常用，但对质量和可追踪性很重要。</CardDescription></CardHeader><CardContent className="space-y-2 pt-4">{managementEntries.map(({ href, title, description, icon: Icon }) => <Link className="flex gap-3 rounded-lg p-3 transition hover:bg-[#f7f7f5]" href={href} key={href}><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[#f1f1ef] text-[#5f5e5a]"><Icon className="size-4" /></span><span><span className="block text-sm font-medium">{title}</span><span className="mt-1 block text-xs leading-5 text-slate-500">{description}</span></span></Link>)}</CardContent></Card>
    </section>
  </div>;
}
