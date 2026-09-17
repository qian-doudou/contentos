'use client';

import { Badge } from '@/components/ui/badge';

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
