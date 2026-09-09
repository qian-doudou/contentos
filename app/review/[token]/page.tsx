import { PublicReviewPage } from '@/components/contentos/script/public-review-page';

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  return <PublicReviewPage token={(await params).token} />;
}
