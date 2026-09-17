import { currentPermissions } from '@/lib/api/context';
import { handleApi, readJson } from '@/lib/api/handler';
import { inspirationService } from '@/lib/inspiration/service';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  return handleApi(async () => {
    currentPermissions(request).require('ai.test');
    return inspirationService({ youtubeApiKey: process.env.INSPIRATION_YOUTUBE_API_KEY })
      .search(await readJson(request));
  });
}
