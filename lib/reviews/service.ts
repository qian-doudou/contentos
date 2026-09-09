import { and, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as tables from '@/db/schema';
import { ApiError } from '@/lib/api/envelope';
import { editReviewService, publicEditReviewService } from '@/lib/edits/service';
import { publicScriptReviewService, scriptApprovalService } from '@/lib/scripts/service';
import { reviewTokenHash, reviewTokenSchema } from './token';
import { z } from 'zod';

type Database = BetterSQLite3Database<typeof tables>;
const missing = () => new ApiError(404, 'NOT_FOUND', '记录不存在或不属于当前组织');

export function approvalDecisionService(db: Database, organizationId: string, userId: string) {
  return {
    decide(approvalId: string, input: unknown) {
      const validApprovalId = z.uuid().parse(approvalId);
      const approval = db.select({ approvalType: tables.approvals.approvalType }).from(tables.approvals).where(and(
        eq(tables.approvals.organizationId, organizationId), eq(tables.approvals.id, validApprovalId),
      )).get();
      if (!approval) throw missing();
      return approval.approvalType === 'script'
        ? scriptApprovalService(db, organizationId, userId).decide(approvalId, input)
        : editReviewService(db, organizationId, userId).decide(approvalId, input);
    },
  };
}

export function publicReviewService(db: Database, runtime: { now?: () => Date } = {}) {
  function typeFor(token: string) {
    const validToken = reviewTokenSchema.parse(token);
    const approval = db.select({ approvalType: tables.approvals.approvalType }).from(tables.approvals).where(and(
      eq(tables.approvals.reviewTokenHash, reviewTokenHash(validToken)),
      eq(tables.approvals.reviewerType, 'external_client'),
    )).get();
    if (!approval) throw new ApiError(404, 'REVIEW_LINK_NOT_FOUND', '审核链接不存在或已失效');
    return approval.approvalType;
  }
  return {
    view(token: string) {
      return typeFor(token) === 'script'
        ? publicScriptReviewService(db, runtime).view(token)
        : publicEditReviewService(db, runtime).view(token);
    },
    decide(token: string, input: unknown) {
      return typeFor(token) === 'script'
        ? publicScriptReviewService(db, runtime).decide(token, input)
        : publicEditReviewService(db, runtime).decide(token, input);
    },
  };
}
