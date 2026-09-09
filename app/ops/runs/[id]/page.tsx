import { RunDetailPage } from '@/components/contentos/ops-pages';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <RunDetailPage id={(await params).id} />;
}
