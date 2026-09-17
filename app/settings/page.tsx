import Link from 'next/link';
import { Activity, ArrowRight, Cpu, Settings2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const settingsEntries = [
  {
    href: '/settings/ai',
    title: 'AI 运行设置',
    description: '查看模型提供方、运行模式、超时重试、剩余额度与模型价格版本。',
    action: '进入 AI 设置',
    icon: Settings2,
    primary: true,
  },
  {
    href: '/skills',
    title: 'AI Skill',
    description: '管理 Prompt、模型档位、Points、输出 Schema 与不可变版本。',
    action: '管理 Skill',
    icon: Cpu,
    primary: false,
  },
  {
    href: '/ops/ai-cost',
    title: 'AI 成本与用量',
    description: '查看调用量、Token、Points、成本估算和异常运行记录。',
    action: '查看成本',
    icon: Activity,
    primary: false,
  },
] as const;

export default function Page() {
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">SYSTEM</p>
          <h1 className="page-title">系统设置</h1>
          <p className="page-description">统一管理 AI 运行配置、能力版本与成本用量。</p>
        </div>
        <Badge className="bg-emerald-50 text-emerald-700" variant="secondary">设置中心已接入</Badge>
      </header>

      <section className="grid gap-4 lg:grid-cols-3">
        {settingsEntries.map(({ href, title, description, action, icon: Icon, primary }) => (
          <Card className={primary ? 'border-cyan-200 bg-cyan-50/30' : undefined} key={href}>
            <CardHeader>
              <div className="mb-3 grid size-10 place-items-center rounded-lg bg-white text-cyan-700 shadow-sm"><Icon className="size-5" /></div>
              <CardTitle>{title}</CardTitle>
              <CardDescription className="leading-6">{description}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant={primary ? 'default' : 'outline'} nativeButton={false} render={<Link href={href} />}>
                {action}<ArrowRight data-icon="inline-end" />
              </Button>
            </CardContent>
          </Card>
        ))}
      </section>
    </div>
  );
}
