import { Suspense } from 'react';
import { NewContentPage } from '@/components/contentos/content/content-pages';
import { LoadingData } from '@/components/contentos/master-data/common';

export default function Page() {
  return <Suspense fallback={<LoadingData />}><NewContentPage /></Suspense>;
}
