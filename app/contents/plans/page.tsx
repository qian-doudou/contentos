import { Suspense } from 'react';
import { PlanListPage } from '@/components/contentos/content/plan-pages';
import { LoadingData } from '@/components/contentos/master-data/common';

export default function Page() {
  return <Suspense fallback={<LoadingData />}><PlanListPage /></Suspense>;
}
