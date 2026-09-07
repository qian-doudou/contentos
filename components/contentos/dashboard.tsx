'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, AlertTriangle, Bot, CheckCircle2, Network, PlayCircle,
  RefreshCw, Route, Users,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { dashboardResponseSchema, type DashboardData, type DashboardRun } from '@/lib/contracts';

const roleLabels = {
  owner: '运营负责人', operator: '运营', photographer: '摄影', editor: '剪辑',
} as const;

const runTypeLabels = { production: '生产', test: '测试', eval: '评测' } as const;
const statusLabels = { pending: '待执行', running: '运行中', succeeded: '已成功', failed: '已失败', cancelled: '已取消' } as const;

function formatDate(value: string | null) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function StatusBadge({ status }: { status: DashboardRun['status'] }) {
  const variant = status === 'failed' ? 'destructive' : status === 'succeeded' ? 'secondary' : 'outline';
  return <Badge variant={variant}>{statusLabels[status]}</Badge>;
}

function DashboardLoading() {
  return (
    <div className="space-y-6" aria-label="正在加载工作台">
      <div className="space-y-3"><Skeleton className="h-3 w-36" /><Skeleton className="h-10 w-80 max-w-full" /><Skeleton className="h-5 w-[520px] max-w-full" /></div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <Skeleton className="h-36 rounded-xl" key={index} />)}</div>
      <Skeleton className="h-80 rounded-xl" />
    </div>
  );
}

function DashboardError({ message, retry }: { message: string; retry: () => void }) {
  return (
    <div className="surface-card min-h-80">
      <Empty className="min-h-72 border border-rose-200 bg-rose-50/50">
        <EmptyHeader><EmptyMedia variant="icon"><AlertTriangle /></EmptyMedia><EmptyTitle>工作台数据加载失败</EmptyTitle><EmptyDescription>{message}</EmptyDescription></EmptyHeader>
        <Button onClick={retry}><RefreshCw data-icon="inline-start" />重试</Button>
      </Empty>
    </div>
  );
}

function RunStructureDrawer() {
  const steps = [
    { code: 'validate_input', title: '输入校验', detail: 'Zod 校验输入与业务对象' },
    { code: 'execute', title: '执行任务', detail: '记录步骤输入、输出、耗时与警告' },
    { code: 'persist_result', title: '持久化结果', detail: '结果与错误均按 Run 可追踪' },
  ];
  return (
    <Sheet>
      <SheetTrigger render={<Button variant="outline" />}><Route data-icon="inline-start" />查看 Run 结构</SheetTrigger>
      <SheetContent className="w-full sm:max-w-lg">
        <SheetHeader className="border-b"><SheetTitle>Run 追踪结构</SheetTitle><SheetDescription>这是执行规范说明，不是伪造的运行记录。</SheetDescription></SheetHeader>
        <div className="space-y-0 px-5 py-2">
          {steps.map((step, index) => (
            <div className="relative flex gap-4 pb-7" key={step.code}>
              {index < steps.length - 1 && <span className="absolute left-[15px] top-8 h-[calc(100%-1rem)] w-px bg-slate-200" />}
              <span className="z-10 grid size-8 shrink-0 place-items-center rounded-full border border-cyan-200 bg-cyan-50 text-xs font-semibold text-cyan-700">{index + 1}</span>
              <div className="pt-0.5"><p className="font-medium text-slate-900">{step.title}</p><code className="mt-1 block text-xs text-cyan-700">{step.code}</code><p className="mt-2 text-sm leading-6 text-slate-500">{step.detail}</p></div>
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [resetting, setResetting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('all');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/dashboard', { cache: 'no-store' });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const apiError = payload as { error?: { message?: string } };
        throw new Error(apiError.error?.message || `HTTP ${response.status}`);
      }
      setData(dashboardResponseSchema.parse(payload).data);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '未知错误');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const task = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(task);
  }, [load]);

  useEffect(() => {
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    void Promise.resolve(context.registerTool({
      name: 'get_contentos_dashboard',
      title: '读取 ContentOS 工作台',
      description: '读取当前组织、团队成员、Run 计数与基础设施状态。',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute: async () => {
        const response = await fetch('/api/dashboard', { cache: 'no-store' });
        const payload = dashboardResponseSchema.parse(await response.json());
        return { organization: payload.data.organization?.name ?? null, metrics: payload.data.metrics, system: payload.data.system };
      },
    }, { signal: lifecycle.signal })).catch(() => undefined);
    return () => lifecycle.abort();
  }, []);

  const resetDemo = async () => {
    setResetting(true);
    setNotice(null);
    try {
      const response = await fetch('/api/dev/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: 'RESET_DEMO' }),
      });
      const payload = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message || '重置失败');
      await load();
      setNotice('演示数据已重置');
    } catch (resetError) {
      setNotice(resetError instanceof Error ? resetError.message : '重置失败');
    } finally {
      setResetting(false);
    }
  };

  const filteredRuns = useMemo(
    () => data?.recentRuns.filter((run) => statusFilter === 'all' || run.status === statusFilter) ?? [],
    [data, statusFilter],
  );

  if (loading) return <DashboardLoading />;
  if (error || !data) return <DashboardError message={error || '未返回数据'} retry={() => void load()} />;

  const metrics = [
    { label: '组织', value: data.metrics.organizations, helper: '当前可见组织', icon: Network },
    { label: '团队成员', value: data.metrics.users, helper: '活跃与停用成员', icon: Users },
    { label: '运行记录', value: data.metrics.runs, helper: 'Production / Test / Eval', icon: PlayCircle },
    { label: '失败运行', value: data.metrics.failedRuns, helper: '需要排查的 Run', icon: AlertTriangle },
  ];

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div><p className="eyebrow">工作台 / 系统总览</p><h1 className="page-title">内容运营控制台</h1><p className="page-description">{data.organization?.name ?? '尚未创建组织'} · 第一阶段工程基础</p></div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge className="h-7 bg-emerald-100 px-3 text-emerald-700"><CheckCircle2 />SQLite 已连接</Badge>
          <Badge className="h-7 bg-cyan-100 px-3 text-cyan-800"><Bot />LLM {data.system.llmMode === 'mock' ? 'Mock' : 'Live'}</Badge>
        </div>
      </section>

      {notice && <div aria-live="polite" className="rounded-xl border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm text-cyan-800">{notice}</div>}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map(({ label, value, helper, icon: Icon }) => (
          <Card key={label}>
            <CardHeader><CardDescription>{label}</CardDescription><CardTitle className="text-3xl tabular-nums">{value}</CardTitle><CardAction><span className="card-icon"><Icon /></span></CardAction></CardHeader>
            <CardContent><p className="text-sm text-slate-500">{helper}</p></CardContent>
          </Card>
        ))}
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,.8fr)]">
        <Card>
          <CardHeader className="border-b">
            <div><p className="section-kicker">执行中心</p><CardTitle className="mt-1 text-xl">最近运行</CardTitle></div>
            <CardAction className="flex items-center gap-2">
              <Select value={statusFilter} onValueChange={(value) => setStatusFilter(String(value))}>
                <SelectTrigger aria-label="按状态筛选" className="min-w-28"><SelectValue placeholder="全部状态" /></SelectTrigger>
                <SelectContent><SelectItem value="all">全部状态</SelectItem><SelectItem value="running">运行中</SelectItem><SelectItem value="succeeded">已成功</SelectItem><SelectItem value="failed">已失败</SelectItem></SelectContent>
              </Select>
              <RunStructureDrawer />
            </CardAction>
          </CardHeader>
          <CardContent className="px-0">
            {filteredRuns.length === 0 ? (
              <Empty className="min-h-60"><EmptyHeader><EmptyMedia variant="icon"><Activity /></EmptyMedia><EmptyTitle>暂无运行记录</EmptyTitle><EmptyDescription>首个内容或评测任务执行后，Run 与步骤时间线会出现在这里。</EmptyDescription></EmptyHeader></Empty>
            ) : (
              <Table><TableHeader><TableRow><TableHead>类型</TableHead><TableHead>对象</TableHead><TableHead>状态</TableHead><TableHead>开始时间</TableHead><TableHead className="text-right">步骤</TableHead></TableRow></TableHeader><TableBody>
                {filteredRuns.map((run) => <TableRow key={run.id}><TableCell>{runTypeLabels[run.runType]}</TableCell><TableCell>{run.subjectType}</TableCell><TableCell><StatusBadge status={run.status} /></TableCell><TableCell>{formatDate(run.startedAt)}</TableCell><TableCell className="text-right tabular-nums">{run.steps.length}</TableCell></TableRow>)}
              </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b"><div><p className="section-kicker">组织成员</p><CardTitle className="mt-1 text-xl">演示团队</CardTitle></div><CardAction><Badge variant="outline">{data.users.length} 人</Badge></CardAction></CardHeader>
          <CardContent className="px-0">
            {data.users.length === 0 ? <Empty className="min-h-60"><EmptyHeader><EmptyMedia variant="icon"><Users /></EmptyMedia><EmptyTitle>暂无团队成员</EmptyTitle><EmptyDescription>使用演示数据重置恢复基础团队。</EmptyDescription></EmptyHeader></Empty> : (
              <Table><TableHeader><TableRow><TableHead>成员</TableHead><TableHead>角色</TableHead><TableHead className="text-right">状态</TableHead></TableRow></TableHeader><TableBody>{data.users.map((user) => <TableRow key={user.id}><TableCell className="font-medium">{user.name}</TableCell><TableCell className="text-slate-500">{roleLabels[user.role]}</TableCell><TableCell className="text-right"><Badge className="bg-emerald-50 text-emerald-700" variant="secondary">{user.status === 'active' ? '启用' : '停用'}</Badge></TableCell></TableRow>)}</TableBody></Table>
            )}
          </CardContent>
        </Card>
      </section>

      <Card className="border-dashed bg-slate-50/70 shadow-none">
        <CardHeader><CardTitle>本地演示数据</CardTitle><CardDescription>仅重置 is_demo 数据；此操作在数据库事务中执行。</CardDescription><CardAction>
          <Dialog><DialogTrigger render={<Button variant="outline" />}><RefreshCw data-icon="inline-start" />重置演示数据</DialogTrigger><DialogContent><DialogHeader><DialogTitle>确认重置演示数据？</DialogTitle><DialogDescription>现有演示组织及其成员、Run 和审计记录会被重新创建。本地数据库文件不会被删除。</DialogDescription></DialogHeader><DialogFooter><DialogClose render={<Button variant="outline" />}>取消</DialogClose><DialogClose render={<Button variant="destructive" disabled={resetting} onClick={() => void resetDemo()} />}>{resetting ? '重置中…' : '确认重置'}</DialogClose></DialogFooter></DialogContent></Dialog>
        </CardAction></CardHeader>
      </Card>
    </div>
  );
}
