import { ProposalDetailPage } from '@/components/contentos/evals-pages';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <ProposalDetailPage id={(await params).id} />;
}
