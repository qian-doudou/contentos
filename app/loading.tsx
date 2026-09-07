import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return <div className="space-y-6"><div className="space-y-3"><Skeleton className="h-3 w-32" /><Skeleton className="h-10 w-72" /><Skeleton className="h-5 w-[520px] max-w-full" /></div><div className="grid gap-4 md:grid-cols-3"><Skeleton className="h-36 rounded-xl" /><Skeleton className="h-36 rounded-xl" /><Skeleton className="h-36 rounded-xl" /></div><Skeleton className="h-80 rounded-xl" /></div>;
}

