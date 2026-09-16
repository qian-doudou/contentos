'use client';

import { useEffect, useState } from 'react';
import { z } from 'zod';
import { AlertTriangle, Inbox, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchData, RequestError } from '@/lib/api/client';
export { fetchData, RequestError } from '@/lib/api/client';

export const cooperationLabels: Record<string, string> = { lead: '意向', active: '合作中', paused: '暂停', ended: '已结束' };
export const accountTypeLabels: Record<string, string> = { official: '官方账号', owner_ip: '老板 IP', employee_ip: '员工 IP', store: '门店账号', other: '其他' };
export const statusLabels: Record<string, string> = { active: '启用', inactive: '停用' };

export function useApiData<T>(url: string, schema: z.ZodType<T>) {
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ url: string; revision: number; data?: T; error?: Error }>();
  useEffect(() => {
    const controller = new AbortController();
    void fetchData(url, schema, { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setResult({ url, revision, data }); })
      .catch((error: unknown) => { if (!controller.signal.aborted) setResult({ url, revision, error: error instanceof Error ? error : new Error('连接失败') }); });
    return () => controller.abort();
  }, [url, schema, revision]);
  const current = result?.url === url && result.revision === revision ? result : undefined;
  return { data: current?.data, error: current?.error, loading: !current, reload: () => setRevision(value => value + 1) };
}
export function LoadingData() {
  return <div aria-label="正在加载业务数据" className="space-y-4"><Skeleton className="h-10 w-64" /><Skeleton className="h-24 w-full" /><Skeleton className="h-64 w-full" /></div>;
}
export function ErrorData({ error, retry }: { error: Error; retry: () => void }) {
  return <div className="surface-card"><Empty className="min-h-64"><EmptyHeader><EmptyMedia variant="icon"><AlertTriangle /></EmptyMedia><EmptyTitle>无法加载数据</EmptyTitle><EmptyDescription>{error.message}</EmptyDescription></EmptyHeader>{error instanceof RequestError && error.requestId && <p className="text-xs text-slate-500">请求编号：{error.requestId}</p>}<Button onClick={retry}><RefreshCw />重试</Button></Empty></div>;
}
export function EmptyData({ title = '暂无记录', description, children }: { title?: string; description: string; children?: React.ReactNode }) {
  return <Empty className="min-h-52"><EmptyHeader><EmptyMedia variant="icon"><Inbox /></EmptyMedia><EmptyTitle>{title}</EmptyTitle><EmptyDescription>{description}</EmptyDescription></EmptyHeader>{children}</Empty>;
}
export function BusinessBadge({ value, demo = false }: { value: string; demo?: boolean }) {
  return <span className="inline-flex gap-2"><Badge variant="secondary" className={value === 'inactive' ? 'bg-slate-100 text-slate-500' : 'bg-emerald-50 text-emerald-700'}>{statusLabels[value] || value}</Badge>{demo && <Badge variant="outline">演示</Badge>}</span>;
}
export function PageHeading({ title, description, children }: { title: string; description: string; children?: React.ReactNode }) {
  return <header className="flex flex-wrap items-end justify-between gap-4"><div><p className="eyebrow">业务主数据</p><h1 className="page-title">{title}</h1><p className="page-description">{description}</p></div><div className="flex flex-wrap gap-2">{children}</div></header>;
}
export function Tags({ values }: { values: string[] }) {
  return values.length ? <div className="flex flex-wrap gap-2">{values.map(value => <Badge className="h-auto whitespace-normal py-1" variant="secondary" key={value}>{value}</Badge>)}</div> : <p className="text-sm text-slate-500">未填写</p>;
}
export function DateText({ value }: { value: string | null }) {
  return <span>{value ? new Date(value).toLocaleDateString('zh-CN') : '未填写'}</span>;
}
