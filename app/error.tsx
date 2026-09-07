'use client';

import { useEffect } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return <div className="surface-card"><Empty className="min-h-80 border border-rose-200 bg-rose-50/50"><EmptyHeader><EmptyMedia variant="icon"><AlertTriangle /></EmptyMedia><EmptyTitle>页面加载失败</EmptyTitle><EmptyDescription>页面遇到意外错误。可以重试；若问题持续，请检查服务日志。</EmptyDescription></EmptyHeader><Button onClick={reset}><RefreshCw data-icon="inline-start" />重试</Button></Empty></div>;
}

