import { z } from 'zod';

export const inspirationPlatformSchema = z.literal('youtube');
export const inspirationSearchInputSchema = z.object({
  platform: inspirationPlatformSchema,
  query: z.string().trim().min(2).max(100),
  publishedWithinDays: z.union([z.literal(7), z.literal(30), z.literal(90), z.literal(365)]),
  limit: z.number().int().min(3).max(20),
}).strict();

export const inspirationItemSchema = z.object({
  sourceId: z.string().min(1).max(160),
  platform: inspirationPlatformSchema,
  sourceUrl: z.url(),
  title: z.string().min(1).max(300),
  author: z.string().min(1).max(200),
  publishedAt: z.iso.datetime({ offset: true }).nullable(),
  excerpt: z.string().max(600),
  views: z.number().int().nonnegative().nullable(),
  likes: z.number().int().nonnegative().nullable(),
  comments: z.number().int().nonnegative().nullable(),
  hotScore: z.number().int().min(0).max(100),
  hotReasons: z.array(z.string().min(1).max(120)).max(4),
});

export const inspirationSearchDataSchema = z.object({
  platform: inspirationPlatformSchema,
  query: z.string(),
  mode: z.enum(['demo', 'live']),
  notice: z.string(),
  fetchedAt: z.iso.datetime({ offset: true }),
  items: z.array(inspirationItemSchema).max(20),
});

export const inspirationSelectionSchema = z.array(inspirationItemSchema).min(1).max(5);

export type InspirationSearchInput = z.infer<typeof inspirationSearchInputSchema>;
export type InspirationSearchData = z.infer<typeof inspirationSearchDataSchema>;
export type InspirationItem = z.infer<typeof inspirationItemSchema>;
