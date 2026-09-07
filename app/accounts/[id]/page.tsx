import { AccountDetailPage } from '@/components/contentos/master-data/account-detail';
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <AccountDetailPage id={(await params).id} />;
}
