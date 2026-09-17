'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  Bot, CalendarClock, Camera, ChevronRight, Clapperboard,
  Clock3, FileCheck2, RefreshCw, Rocket, ShieldAlert,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { dashboardDataSchema, devResetDataSchema } from '@/lib/contracts';
import { roleLabels, type WorkspaceAccess } from '@/lib/auth/contracts';
import { approvalStatuses, scriptDraftStatuses } from '@/lib/content/workflow';
import { EmptyData, ErrorData, fetchData, LoadingData, useApiData } from './master-data/common';
import { ScriptStartCard } from './script/script-start-card';

const runTypeLabels = { production: '正式', test: '测试', eval: '评测' } as const;
const runStatusLabels = {
  queued: '排队中', running: '运行中', completed: '已完成', completed_with_warnings: '完成但有警告',
  manual_review_required: '需人工审核', failed: '失败', cancelled: '已取消',
} as const;
const urgencyLabels = { normal: '待处理', due_soon: '48h 内', overdue: '已延期', high: '高风险' } as const;

function formatDate(value: string | null) {
  return value ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—';
}

export function Dashboard() {
  const state = useApiData('/api/dashboard', dashboardDataSchema);
  const [resetting, setResetting] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    void Promise.resolve(context.registerTool({
      name: 'get_contentos_dashboard',
      title: '读取 ContentOS 工作台',
      description: '读取当前身份的真实待办、延期风险、今日拍摄和履约风险。',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute: async () => {
        const data = await fetchData('/api/dashboard', dashboardDataSchema);
        return { currentUser: data.workbench.currentUser.name, counts: data.workbench.counts, tasks: data.workbench.tasks };
      },
    }, { signal: lifecycle.signal })).catch(() => undefined);
    return () => lifecycle.abort();
  }, []);

  async function resetDemo() {
    setResetting(true);
    setNotice('');
    try {
      await fetchData('/api/dev/reset', devResetDataSchema, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: 'RESET_DEMO' }),
      });
      state.reload();
      setNotice('演示数据已恢复，工作台已重新计算。');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '重置失败');
    } finally {
      setResetting(false);
    }
  }

  if (state.loading) return <LoadingData />;
  if (state.error) return <ErrorData error={state.error} retry={state.reload} />;
  if (!state.data) return null;
  const data = state.data;
  const access = data.permissions.workspaceAccess;
  const scriptRole = access.scripts;
  const counts = data.workbench.counts;
  const cards = [
    { label: '今日待办', value: counts.todayTodo, helper: '按当前身份去重后的行动项', icon: CalendarClock, href: '#today-actions', access: null },
    { label: '待生成脚本', value: counts.scriptsToWrite, helper: '选题和待完善的草稿', icon: Clapperboard, href: `/contents?statuses=${scriptDraftStatuses.join(',')}`, access: 'contents' },
    { label: '待审核', value: counts.pendingApproval, helper: '脚本或成片审核', icon: FileCheck2, href: `/contents?statuses=${approvalStatuses.join(',')}`, access: 'contents' },
    { label: '今日拍摄', value: counts.todayShoots, helper: '上海自然日排期', icon: Camera, href: '/shoots', access: 'shoots' },
    { label: '待发布', value: counts.readyToPublish, helper: '已批准成片', icon: Rocket, href: '/contents?status=READY_TO_PUBLISH', access: 'contents' },
    { label: '即将延期', value: counts.dueSoon, helper: '未来 48 小时内', icon: Clock3, href: '/contents?deadlineState=dueSoon', access: 'contents' },
    { label: '高风险客户', value: counts.highRiskClients, helper: '履约显著落后', icon: ShieldAlert, href: '#high-risk-clients', access: 'masterData' },
  ] satisfies Array<{ label: string; value: number; helper: string; icon: LucideIcon; href: string; access: keyof WorkspaceAccess | null }>;
  const visibleCards = cards.filter(card => card.access === null || access[card.access]);

  return <div className="space-y-7">
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div><p className="eyebrow">工作台</p><h1 className="page-title">{scriptRole ? '从一条好脚本开始' : `${data.workbench.currentUser.name}，查看今天的任务`}</h1><p className="page-description">{data.organization?.name ?? '当前组织'} · {roleLabels[data.workbench.currentUser.role]}</p></div>
      <Badge variant="outline"><Bot />{data.system.llmMode === 'mock' ? 'AI 演示模式' : '千问已接入'}</Badge>
    </header>
    {notice && <div aria-live="polite" className="rounded-md border border-[#e9e9e7] bg-[#f7f7f5] px-4 py-3 text-sm text-[#37352f]">{notice}</div>}
    {scriptRole && <ScriptStartCard />}
    <details className="rounded-lg border border-[#e9e9e7] bg-white p-4">
      <summary className="cursor-pointer text-sm font-medium text-[#787774]">业务进度概览 · {counts.scriptsToWrite} 条待生成脚本，{counts.pendingApproval} 项待审核</summary>
    <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {visibleCards.map(({ label, value, helper, icon: Icon, href }) => <Link className="block rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2383e2]/35" href={href} key={label}><Card className="h-full transition hover:border-[#d3d1cb]"><CardHeader><CardDescription>{label}</CardDescription><CardTitle className="text-3xl tabular-nums">{value}</CardTitle><CardAction><span className="card-icon"><Icon /></span></CardAction></CardHeader><CardContent><p className="text-sm text-[#787774]">{helper}</p></CardContent></Card></Link>)}
    </section>
    </details>
    <section className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(20rem,.5fr)]">
      <Card id="today-actions" className="overflow-hidden scroll-mt-24"><CardHeader className="border-b"><div><CardTitle>今日行动清单</CardTitle><CardDescription>延期、高风险、48 小时内截止和当前流程任务按优先级排序。</CardDescription></div><CardAction><Badge variant="outline">{data.workbench.counts.todayTodo} 项</Badge></CardAction></CardHeader><CardContent className="px-0">
        {data.workbench.tasks.length ? <Table><TableHeader><TableRow><TableHead>事项</TableHead><TableHead>紧急度</TableHead><TableHead>截止</TableHead><TableHead className="text-right">行动</TableHead></TableRow></TableHeader><TableBody>{data.workbench.tasks.map((task) => <TableRow key={task.id}><TableCell><p className="font-medium">{task.title}</p><p className="mt-1 text-xs text-slate-500">{task.detail}</p></TableCell><TableCell><Badge variant={task.urgency === 'overdue' ? 'destructive' : 'secondary'} className={task.urgency === 'high' ? 'bg-rose-50 text-rose-700' : task.urgency === 'due_soon' ? 'bg-amber-50 text-amber-700' : ''}>{urgencyLabels[task.urgency]}</Badge></TableCell><TableCell className="text-sm">{formatDate(task.dueAt)}</TableCell><TableCell className="text-right"><Button size="sm" variant="outline" nativeButton={false} render={<Link href={task.href} />}>处理<ChevronRight /></Button></TableCell></TableRow>)}</TableBody></Table> : <EmptyData title="当前没有待办" description="新增内容、审核、拍摄或发布任务后，工作台会自动出现行动项。" />}
      </CardContent></Card>
      {access.masterData && <Card id="high-risk-clients" className="scroll-mt-24"><CardHeader className="border-b"><div><CardTitle>高风险客户</CardTitle><CardDescription>来自当前自然月履约计算。</CardDescription></div></CardHeader><CardContent className="space-y-3 pt-5">{data.workbench.highRiskClients.length ? data.workbench.highRiskClients.map((client) => <Link className="block rounded-xl border border-rose-100 bg-rose-50/60 p-4 transition hover:border-rose-300" href={client.href} key={client.clientId}><div className="flex items-center justify-between gap-2"><p className="font-medium text-rose-900">{client.clientName}</p><Badge className="bg-white text-rose-700" variant="secondary">缺 {client.remainingCount} 条</Badge></div><p className="mt-2 text-xs leading-5 text-rose-700">{client.accountNames.join('、')}</p><p className="mt-1 text-xs leading-5 text-slate-500">{client.reasons.join('；')}</p></Link>) : <EmptyData title="暂无高风险客户" description="当前可见计划未触发高风险规则。" />}</CardContent></Card>}
    </section>
    {data.permissions.canReadRuns && <Card className="overflow-hidden"><CardHeader className="border-b"><div><CardTitle>最近 Run</CardTitle><CardDescription>失败或警告可直接进入步骤时间线排查。</CardDescription></div><CardAction><Button variant="outline" nativeButton={false} render={<Link href="/ops/runs" />}>全部 Run</Button></CardAction></CardHeader><CardContent className="px-0">{data.recentRuns.length ? <Table><TableHeader><TableRow><TableHead>对象</TableHead><TableHead>类型</TableHead><TableHead>状态</TableHead><TableHead>时间</TableHead><TableHead className="text-right">行动</TableHead></TableRow></TableHeader><TableBody>{data.recentRuns.slice(0, 8).map((run) => <TableRow key={run.id}><TableCell className="font-mono text-xs">{run.subjectType}</TableCell><TableCell>{runTypeLabels[run.runType]}</TableCell><TableCell><Badge variant={run.status === 'failed' ? 'destructive' : 'outline'}>{runStatusLabels[run.status]}</Badge></TableCell><TableCell className="text-sm">{formatDate(run.createdAt)}</TableCell><TableCell className="text-right"><Button size="sm" variant="outline" nativeButton={false} render={<Link href={`/ops/runs/${run.id}`} />}>排查<ChevronRight /></Button></TableCell></TableRow>)}</TableBody></Table> : <EmptyData title="暂无 Run" description="执行 AI 测试或正式任务后，可从这里进入追踪详情。" />}</CardContent></Card>}
    {data.permissions.canResetDemo && <Card className="border-dashed bg-slate-50/70 shadow-none"><CardHeader><div><CardTitle>本地演示数据</CardTitle><CardDescription>恢复固定 is_demo 主数据，不删除业务记录或清空数据库。</CardDescription></div><CardAction><Dialog><DialogTrigger render={<Button variant="outline" />}><RefreshCw />恢复演示数据</DialogTrigger><DialogContent><DialogHeader><DialogTitle>确认恢复演示数据？</DialogTitle><DialogDescription>演示组织、成员和德祥楼数据将按 seed 幂等恢复；已有工作流历史会保留。</DialogDescription></DialogHeader><DialogFooter><DialogClose render={<Button variant="outline" />}>取消</DialogClose><DialogClose render={<Button variant="destructive" disabled={resetting} onClick={() => void resetDemo()} />}>{resetting ? '恢复中…' : '确认恢复'}</DialogClose></DialogFooter></DialogContent></Dialog></CardAction></CardHeader></Card>}
  </div>;
}
