import { z } from 'zod';
import { ApiError } from '@/lib/api/envelope';
import {
  inspirationSearchDataSchema, inspirationSearchInputSchema,
  type InspirationItem, type InspirationSearchInput,
} from '@/lib/inspiration/contracts';

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const youtubeSearchSchema = z.object({
  items: z.array(z.object({
    id: z.object({ videoId: z.string() }),
    snippet: z.object({
      title: z.string(), description: z.string(), channelTitle: z.string(), publishedAt: z.iso.datetime({ offset: true }),
    }),
  })).default([]),
});
const youtubeVideosSchema = z.object({
  items: z.array(z.object({
    id: z.string(),
    snippet: z.object({
      title: z.string(), description: z.string(), channelTitle: z.string(), publishedAt: z.iso.datetime({ offset: true }),
    }),
    statistics: z.object({
      viewCount: z.string().optional(), likeCount: z.string().optional(), commentCount: z.string().optional(),
    }).optional(),
  })).default([]),
});

function count(value?: string) {
  if (!value || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function text(value: string, max: number) {
  return value
    .replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<').replaceAll('&gt;', '>').replace(/\s+/g, ' ').trim().slice(0, max);
}

function score(views: number | null, likes: number | null, comments: number | null) {
  if (views === null) return 0;
  const reach = Math.min(75, Math.round(Math.log10(views + 1) * 13));
  const engagement = views > 0 ? ((likes ?? 0) + (comments ?? 0) * 2) / views : 0;
  return Math.min(100, reach + Math.min(25, Math.round(engagement * 350)));
}

function reasons(views: number | null, likes: number | null, comments: number | null) {
  const result: string[] = [];
  if (views !== null) result.push(`${new Intl.NumberFormat('zh-CN', { notation: 'compact' }).format(views)} 次播放`);
  if (views && likes !== null && likes / views >= 0.03) result.push('点赞率较高');
  if (views && comments !== null && comments / views >= 0.003) result.push('讨论度较高');
  return result.length ? result : ['公开内容样本'];
}

function demoItems(input: InspirationSearchInput): InspirationItem[] {
  const query = input.query;
  const templates = [
    { title: `为什么同样做${query}，结果差距这么大？`, author: '演示创作者 A', excerpt: '以反差问题开场，先给结果，再用三个具体细节解释原因，最后回到用户能立刻执行的一步。', views: 1280000, likes: 76000, comments: 4200 },
    { title: `${query}最容易踩的 3 个坑`, author: '演示创作者 B', excerpt: '用“错误示范—真实后果—正确做法”的结构推进，每个观点配一个生活化场景，结尾邀请观众分享经历。', views: 860000, likes: 51000, comments: 3100 },
    { title: `我花 7 天实测${query}，这是最终答案`, author: '演示创作者 C', excerpt: '用过程记录建立可信度，关键节点展示前后变化，不夸大结论，并把适用条件与不适用人群讲清楚。', views: 650000, likes: 39000, comments: 1800 },
    { title: `${query}背后，很多人没注意到这个细节`, author: '演示创作者 D', excerpt: '从一个容易忽略的现场细节切入，通过近景、人物动作和一句解释完成认知反转，适合本地门店与人物内容。', views: 420000, likes: 21000, comments: 1200 },
    { title: `如果只用 30 秒讲清${query}`, author: '演示创作者 E', excerpt: '三秒明确受众，中段只保留一个核心观点和一个证据，结尾给出清晰行动建议，节奏紧凑。', views: 310000, likes: 16000, comments: 860 },
    { title: `${query}真实顾客最关心的不是价格`, author: '演示创作者 F', excerpt: '先呈现顾客的真实顾虑，再用服务过程和结果回应，弱化硬广表达，强调选择依据与信任感。', views: 260000, likes: 14000, comments: 740 },
  ];
  const sourceUrl = new URL('https://www.youtube.com/results');
  sourceUrl.searchParams.set('search_query', query);
  return templates.slice(0, input.limit).map((item, index) => ({
    sourceId: `demo-${index + 1}`,
    platform: 'youtube',
    sourceUrl: sourceUrl.toString(),
    title: item.title,
    author: item.author,
    publishedAt: null,
    excerpt: item.excerpt,
    views: item.views,
    likes: item.likes,
    comments: item.comments,
    hotScore: score(item.views, item.likes, item.comments),
    hotReasons: reasons(item.views, item.likes, item.comments),
  }));
}

export function inspirationService(options: { youtubeApiKey?: string; fetcher?: Fetcher; now?: () => Date } = {}) {
  const apiKey = options.youtubeApiKey?.trim() || '';
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? (() => new Date());

  async function youtube(input: InspirationSearchInput) {
    const searchUrl = new URL('https://www.googleapis.com/youtube/v3/search');
    searchUrl.searchParams.set('part', 'snippet');
    searchUrl.searchParams.set('type', 'video');
    searchUrl.searchParams.set('order', 'viewCount');
    searchUrl.searchParams.set('q', input.query);
    searchUrl.searchParams.set('maxResults', String(input.limit));
    searchUrl.searchParams.set('relevanceLanguage', 'zh-Hans');
    searchUrl.searchParams.set('publishedAfter', new Date(now().getTime() - input.publishedWithinDays * 86_400_000).toISOString());
    searchUrl.searchParams.set('key', apiKey);
    let searchResponse: Response;
    try {
      searchResponse = await fetcher(searchUrl, { signal: AbortSignal.timeout(12_000) });
    } catch {
      throw new ApiError(502, 'INSPIRATION_SOURCE_FAILED', 'YouTube 搜索暂时无法连接');
    }
    if (!searchResponse.ok) throw new ApiError(502, 'INSPIRATION_SOURCE_FAILED', `YouTube 搜索失败（${searchResponse.status}）`);
    let searchPayload: unknown;
    try { searchPayload = await searchResponse.json(); }
    catch { throw new ApiError(502, 'INSPIRATION_SOURCE_INVALID', 'YouTube 搜索返回了无法识别的数据'); }
    const searchParsed = youtubeSearchSchema.safeParse(searchPayload);
    if (!searchParsed.success) throw new ApiError(502, 'INSPIRATION_SOURCE_INVALID', 'YouTube 搜索返回了无法识别的数据');
    const searchData = searchParsed.data;
    const ids = searchData.items.map(item => item.id.videoId);
    if (!ids.length) return [];

    const videoUrl = new URL('https://www.googleapis.com/youtube/v3/videos');
    videoUrl.searchParams.set('part', 'snippet,statistics');
    videoUrl.searchParams.set('id', ids.join(','));
    videoUrl.searchParams.set('key', apiKey);
    let videoResponse: Response;
    try {
      videoResponse = await fetcher(videoUrl, { signal: AbortSignal.timeout(12_000) });
    } catch {
      throw new ApiError(502, 'INSPIRATION_SOURCE_FAILED', 'YouTube 指标暂时无法连接');
    }
    if (!videoResponse.ok) throw new ApiError(502, 'INSPIRATION_SOURCE_FAILED', `YouTube 指标读取失败（${videoResponse.status}）`);
    let detailsPayload: unknown;
    try { detailsPayload = await videoResponse.json(); }
    catch { throw new ApiError(502, 'INSPIRATION_SOURCE_INVALID', 'YouTube 指标返回了无法识别的数据'); }
    const detailsParsed = youtubeVideosSchema.safeParse(detailsPayload);
    if (!detailsParsed.success) throw new ApiError(502, 'INSPIRATION_SOURCE_INVALID', 'YouTube 指标返回了无法识别的数据');
    const details = detailsParsed.data;
    return details.items.map((item): InspirationItem => {
      const views = count(item.statistics?.viewCount);
      const likes = count(item.statistics?.likeCount);
      const comments = count(item.statistics?.commentCount);
      return {
        sourceId: item.id,
        platform: 'youtube',
        sourceUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(item.id)}`,
        title: text(item.snippet.title, 300),
        author: text(item.snippet.channelTitle, 200) || '未知创作者',
        publishedAt: new Date(item.snippet.publishedAt).toISOString(),
        excerpt: text(item.snippet.description, 600),
        views, likes, comments,
        hotScore: score(views, likes, comments),
        hotReasons: reasons(views, likes, comments),
      };
    }).sort((a, b) => b.hotScore - a.hotScore || (b.views ?? 0) - (a.views ?? 0));
  }

  return {
    async search(raw: unknown) {
      const input = inspirationSearchInputSchema.parse(raw);
      const mode = apiKey ? 'live' as const : 'demo' as const;
      const items = mode === 'live' ? await youtube(input) : demoItems(input);
      return inspirationSearchDataSchema.parse({
        platform: input.platform,
        query: input.query,
        mode,
        notice: mode === 'live'
          ? '来自 YouTube Data API 的公开标题、简介与互动指标；仅用于结构和选题参考。'
          : '尚未配置 INSPIRATION_YOUTUBE_API_KEY，当前为原创演示样例，不是平台实时数据。',
        fetchedAt: now().toISOString(),
        items,
      });
    },
  };
}
