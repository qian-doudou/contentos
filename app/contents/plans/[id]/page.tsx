import { PlanDetailPage } from '@/components/contentos/content/plan-pages';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <PlanDetailPage id={(await params).id} />;
}
