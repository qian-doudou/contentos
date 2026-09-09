import { EditTaskDetailPage } from '@/components/contentos/edit/edit-pages';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <EditTaskDetailPage id={(await params).id} />;
}
