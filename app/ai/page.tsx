import Link from 'next/link';
import { BrainCircuit, History, Lightbulb, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';

const workbenches = [
  { href: '/ai/planner', title: 'AI Content Planner', description: '基于已有账号 Context 生成候选，并经过历史去重与质量门禁。', icon: Lightbulb },
  { href: '/ai/reviews', title: '策略复盘', description: '代码先聚合表现事实，千问再解释并生成待确认的下一周期策略。', icon: BrainCircuit },
  { href: '/ai/memory', title: '长期记忆', description: '管理已确认事实、偏好、表现规律与策略 Memory。', icon: Sparkles },
  { href: '/ai/dedup-test', title: '去重测试', description: '查看同账号历史召回、规则分数和 duplicate_judge 结果。', icon: History },
] as const;

export default function Page() {
  return <div className="space-y-7"><header><p className="eyebrow">AI WORKBENCH</p><h1 className="page-title">AI 运营</h1><p className="page-description">所有正式调用经过统一百炼千问 Client、Schema 校验、Run Trace 与 Points 结算。</p></header><section className="grid gap-4 md:grid-cols-2">{workbenches.map(({ href, title, description, icon: Icon }) => <article className="surface-card" key={href}><div className="grid size-10 place-items-center rounded-xl bg-cyan-50 text-cyan-800"><Icon className="size-5" /></div><h2 className="mt-4 text-lg font-semibold">{title}</h2><p className="mt-2 min-h-12 text-sm leading-6 text-slate-500">{description}</p><Button className="mt-5" variant="outline" nativeButton={false} render={<Link href={href} />}>进入工作台</Button></article>)}</section></div>;
}
