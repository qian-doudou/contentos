import { Suspense } from 'react';
import { ContentListPage } from '@/components/contentos/content/content-pages';
import { LoadingData } from '@/components/contentos/master-data/common';

export default function Page() {
  return <Suspense fallback={<LoadingData />}><ContentListPage /></Suspense>;
}
