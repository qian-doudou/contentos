import { SkillDetailPage } from '@/components/contentos/ai-pages';

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <SkillDetailPage id={(await params).id} />;
}
