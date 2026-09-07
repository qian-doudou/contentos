import { ClientDetailPage } from '@/components/contentos/master-data/client-detail';
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <ClientDetailPage id={(await params).id} />;
}
