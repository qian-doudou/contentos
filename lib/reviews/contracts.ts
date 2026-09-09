import { z } from 'zod';
import { publicEditReviewSchema } from '@/lib/edits/contracts';
import { publicScriptReviewSchema } from '@/lib/scripts/contracts';

export const publicReviewSchema = z.union([publicScriptReviewSchema, publicEditReviewSchema]);
export type PublicReview = z.infer<typeof publicReviewSchema>;
