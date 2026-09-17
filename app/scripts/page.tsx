import { Suspense } from 'react';
import { LoadingData } from '@/components/contentos/master-data/common';
import { ScriptLibraryPage } from '@/components/contentos/script/script-library-page';

export default function Page() {
  return <Suspense fallback={<LoadingData />}><ScriptLibraryPage /></Suspense>;
}
