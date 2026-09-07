'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export function ContentNav() {
  const pathname = usePathname();
  return <nav aria-label="内容运营子导航" className="flex w-fit gap-1 rounded-xl border bg-white p-1">
    <Link className={cn('rounded-lg px-4 py-2 text-sm font-medium text-slate-500', !pathname.startsWith('/contents/plans') && 'bg-slate-900 text-white')} href="/contents">内容列表</Link>
    <Link className={cn('rounded-lg px-4 py-2 text-sm font-medium text-slate-500', pathname.startsWith('/contents/plans') && 'bg-slate-900 text-white')} href="/contents/plans">月度计划</Link>
  </nav>;
}

export function ContentHeading({ title, description, children }: { title: string; description: string; children?: React.ReactNode }) {
  return <header className="flex flex-wrap items-end justify-between gap-4"><div><p className="eyebrow">内容运营</p><h1 className="page-title">{title}</h1><p className="page-description">{description}</p></div><div className="flex flex-wrap gap-2">{children}</div></header>;
}

export function ActiveBadge({ status, demo = false }: { status: 'active' | 'inactive'; demo?: boolean }) {
  return <span className="inline-flex gap-2"><Badge variant="secondary" className={status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}>{status === 'active' ? '启用' : '停用'}</Badge>{demo && <Badge variant="outline">演示</Badge>}</span>;
}

export function formatLocalDate(value: string | null) {
  return value ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' }).format(new Date(value)) : '未设置';
}

export function periodLabel(year: number, month: number) {
  return `${year} 年 ${month} 月`;
}
