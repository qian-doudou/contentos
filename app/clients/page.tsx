import { Suspense } from 'react';
import { ClientListPage } from '@/components/contentos/master-data/client-list';
import { LoadingData } from '@/components/contentos/master-data/common';
export default function Page() { return <Suspense fallback={<LoadingData />}><ClientListPage /></Suspense>; }
