import { Suspense } from 'react';
import { EditTaskListPage } from '@/components/contentos/edit/edit-pages';

export default function Page() {
  return <Suspense fallback={<div className="h-64 animate-pulse rounded-xl bg-white" />}><EditTaskListPage /></Suspense>;
}
