import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';

export const reviewTokenSchema = z.string().trim().regex(/^[A-Za-z0-9_-]{43,128}$/, '审核 Token 格式无效');

export function reviewTokenHash(token: string) {
  return createHash('sha256').update(reviewTokenSchema.parse(token)).digest('hex');
}

export function createReviewToken() {
  return randomBytes(32).toString('base64url');
}
