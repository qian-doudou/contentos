import Link from 'next/link';
import { ArrowRight, Filter, Inbox, Layers3, Search, Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Input } from '@/components/ui/input';

export type SectionConfig = {
  slug: string;
  title: string;
  eyebrow: string;
  description: string;
  entity: string;
};

const kanbanColumns = [
  { title: '内容池', detail: '待策划与补充素材' },
  { title: '客户审核', detail: '待客户确认脚本' },
  { title: '待拍摄', detail: '已通过且待排期' },
  { title: '待发布', detail: '已剪辑且待上线' },
];

function EmptyKanban() {
  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2"><div className="relative"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" /><Input className="w-full pl-9 sm:w-64" placeholder="搜索内容标题" disabled /></div><Button variant="outline" disabled><Filter data-icon="inline-start" />筛选</Button></div>
        <Badge variant="outline">0 条内容</Badge>
      </div>
      <div className="grid gap-4 xl:grid-cols-4">
        {kanbanColumns.map((column) => (
          <Card className="min-h-72 bg-slate-100/60 shadow-none" key={column.title}>
            <CardHeader className="border-b"><CardTitle className="flex items-center justify-between">{column.title}<Badge className="bg-white text-slate-500" variant="secondary">0</Badge></CardTitle><CardDescription>{column.detail}</CardDescription></CardHeader>
            <CardContent><Empty className="min-h-40 border border-dashed border-slate-300 bg-white/70"><EmptyHeader><EmptyMedia variant="icon"><Inbox /></EmptyMedia><EmptyTitle>暂无内容</EmptyTitle></EmptyHeader></Empty></CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}

export function SectionPage({ config }: { config: SectionConfig }) {
  const isContents = config.slug === 'contents';
  const isAi = config.slug === 'ai';
  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div><p className="eyebrow">{config.eyebrow}</p><h1 className="page-title">{config.title}</h1><p className="page-description">{config.description}</p></div>
        <Badge className={`h-7 px-3 ${isAi ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`} variant="secondary">{isAi ? 'Content Planner 已可用' : '后续阶段实现'}</Badge>
      </section>

      {isContents ? <EmptyKanban /> : (
        <Card className="min-h-[420px]">
          <CardHeader className="border-b"><div><p className="section-kicker">后续阶段</p><CardTitle className="mt-1 text-xl">{config.entity}</CardTitle><CardDescription className="mt-1">当前阶段仅保留统一入口、状态与数据边界。</CardDescription></div><Badge variant="outline">0 条记录</Badge></CardHeader>
          <CardContent className="flex min-h-80 items-center justify-center">
            <Empty className="max-w-xl border border-dashed border-slate-200 bg-slate-50/70">
              <EmptyHeader><EmptyMedia variant="icon">{isAi ? <Sparkles /> : <Layers3 />}</EmptyMedia><EmptyTitle>{isAi ? 'AI 内容策划工作台' : `${config.entity}暂无数据`}</EmptyTitle><EmptyDescription>{isAi ? '从账号 Context 与月度计划缺口生成候选，逐条执行历史检索、重复判断和质量门禁，人工选择后才写入内容库。' : '该模块不在当前阶段实现范围内。后续接入时将沿用 organization_id、多租户数据隔离与统一 Run 追踪。'}</EmptyDescription></EmptyHeader>
              {isAi ? <div className="flex flex-wrap gap-2"><Button nativeButton={false} render={<Link href="/ai/planner" />}>打开 Content Planner<ArrowRight data-icon="inline-end" /></Button><Button variant="outline" nativeButton={false} render={<Link href="/ai/memory" />}>Memory</Button><Button variant="outline" nativeButton={false} render={<Link href="/ai/dedup-test" />}>去重测试</Button></div> : <Button variant="outline" nativeButton={false} render={<Link href="/" />}>返回工作台<ArrowRight data-icon="inline-end" /></Button>}
            </Empty>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
