import { Suspense } from 'react';
import { ShootListPage } from '@/components/contentos/shoot/shoot-pages';
import { LoadingData } from '@/components/contentos/master-data/common';

export default function Page() {
  return <Suspense fallback={<LoadingData />}><ShootListPage /></Suspense>;
}
