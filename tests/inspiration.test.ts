import { describe, expect, it, vi } from 'vitest';
import { inspirationService } from '@/lib/inspiration/service';

const input = {
  platform: 'youtube' as const,
  query: '上海探店',
  publishedWithinDays: 30 as const,
  limit: 6,
};

describe('public inspiration service', () => {
  it('returns clearly labelled deterministic demo references without an API key', async () => {
    const result = await inspirationService({ now: () => new Date('2026-09-13T00:00:00.000Z') }).search(input);

    expect(result).toMatchObject({ platform: 'youtube', query: '上海探店', mode: 'demo' });
    expect(result.notice).toContain('原创演示样例');
    expect(result.items).toHaveLength(6);
    expect(result.items[0]).toMatchObject({ sourceId: 'demo-1', platform: 'youtube' });
    expect(result.items[0].title).toContain('上海探店');
    expect(result.items.every(item => item.sourceUrl.startsWith('https://www.youtube.com/'))).toBe(true);
  });

  it('queries the official search and video endpoints and normalizes public metadata', async () => {
    const requested: URL[] = [];
    const fetcher = vi.fn(async (inputValue: string | URL | Request) => {
      const url = inputValue instanceof Request ? new URL(inputValue.url) : new URL(inputValue);
      requested.push(url);
      if (url.pathname.endsWith('/search')) return Response.json({
        items: [{
          id: { videoId: 'video-123' },
          snippet: {
            title: '搜索结果', description: '摘要', channelTitle: '频道', publishedAt: '2026-09-01T00:00:00Z',
          },
        }],
      });
      return Response.json({
        items: [{
          id: 'video-123',
          snippet: {
            title: '上海探店 &amp; 后厨真相',
            description: '第一行\n第二行',
            channelTitle: '本地观察',
            publishedAt: '2026-09-01T00:00:00Z',
          },
          statistics: { viewCount: '120000', likeCount: '6000', commentCount: '800' },
        }],
      });
    });

    const result = await inspirationService({
      youtubeApiKey: 'test-key', fetcher, now: () => new Date('2026-09-13T00:00:00.000Z'),
    }).search(input);

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(requested[0].origin + requested[0].pathname).toBe('https://www.googleapis.com/youtube/v3/search');
    expect(requested[0].searchParams.get('q')).toBe('上海探店');
    expect(requested[0].searchParams.get('order')).toBe('viewCount');
    expect(requested[0].searchParams.get('publishedAfter')).toBe('2026-08-14T00:00:00.000Z');
    expect(requested[1].origin + requested[1].pathname).toBe('https://www.googleapis.com/youtube/v3/videos');
    expect(requested[1].searchParams.get('id')).toBe('video-123');
    expect(result).toMatchObject({ mode: 'live', items: [{
      sourceId: 'video-123', title: '上海探店 & 后厨真相', excerpt: '第一行 第二行',
      views: 120000, likes: 6000, comments: 800,
    }] });
  });

  it('maps unavailable or malformed upstream data to a source error', async () => {
    const unavailable = inspirationService({
      youtubeApiKey: 'test-key', fetcher: async () => new Response('', { status: 503 }),
    });
    await expect(unavailable.search(input)).rejects.toMatchObject({ status: 502, code: 'INSPIRATION_SOURCE_FAILED' });

    const malformed = inspirationService({
      youtubeApiKey: 'test-key', fetcher: async () => Response.json({ items: [{ id: {} }] }),
    });
    await expect(malformed.search(input)).rejects.toMatchObject({ status: 502, code: 'INSPIRATION_SOURCE_INVALID' });
  });

  it('validates the search boundary before calling a provider', async () => {
    const fetcher = vi.fn();
    await expect(inspirationService({ youtubeApiKey: 'test-key', fetcher }).search({ ...input, query: 'a' }))
      .rejects.toHaveProperty('issues');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
