import { PublicScriptReviewPage } from '@/components/contentos/script/public-review-page';

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  return <PublicScriptReviewPage token={(await params).token} />;
}
