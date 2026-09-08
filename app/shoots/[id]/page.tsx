import { ShootDetailPage } from '@/components/contentos/shoot/shoot-pages';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <ShootDetailPage id={(await params).id} />;
}
