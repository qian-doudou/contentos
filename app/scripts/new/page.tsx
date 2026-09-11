import { Suspense } from 'react';
import { ScriptWriterPage } from '@/components/contentos/script/script-writer-page';
import { LoadingData } from '@/components/contentos/master-data/common';

export default function Page() {
  return <Suspense fallback={<LoadingData />}><ScriptWriterPage /></Suspense>;
}
