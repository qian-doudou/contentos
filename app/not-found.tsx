import Link from 'next/link';
import { ArrowLeft, MapPinOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';

export default function NotFound() {
  return <div className="surface-card"><Empty className="min-h-80 border border-dashed"><EmptyHeader><EmptyMedia variant="icon"><MapPinOff /></EmptyMedia><EmptyTitle>页面不存在</EmptyTitle><EmptyDescription>该地址不属于 ContentOS 当前阶段的功能范围。</EmptyDescription></EmptyHeader><Button variant="outline" render={<Link href="/" />}><ArrowLeft data-icon="inline-start" />返回工作台</Button></Empty></div>;
}

