import { ContentDetailPage } from '@/components/contentos/content/content-pages';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <ContentDetailPage id={(await params).id} />;
}
