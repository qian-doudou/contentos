import { db } from '@/db/client';
import { permissionService } from '@/lib/auth/permissions';
import { masterDataService } from '@/lib/master-data/service';
import { contentService } from '@/lib/content/service';
import { aiInfrastructureService } from '@/lib/ai/service';
import { memoryService } from '@/lib/memory/service';
import { historyRetrievalService } from '@/lib/history/service';
import { aiPlannerService } from '@/lib/planner/service';
import { scriptApprovalService } from '@/lib/scripts/service';
import { shootService } from '@/lib/shoots/service';
import { editReviewService } from '@/lib/edits/service';
import { approvalDecisionService, publicReviewService } from '@/lib/reviews/service';
import { performanceService } from '@/lib/performance/service';
import { strategyReviewService } from '@/lib/strategy-review/service';
import { z } from 'zod';

export const DEV_USER_COOKIE = 'contentos_dev_user_id';
type LocalIdentityEnvironment = {
  NODE_ENV?: string;
  LOCAL_ORGANIZATION_ID?: string;
  LOCAL_USER_ID?: string;
};

function cookieValue(request: Request | undefined, name: string) {
  if (!request) return undefined;
  const item = request.headers.get('cookie')?.split(';').map(value => value.trim()).find(value => value.startsWith(`${name}=`));
  if (!item) return undefined;
  try { return decodeURIComponent(item.slice(name.length + 1)); } catch { return undefined; }
}

// The organization remains server-owned. Only a non-production, HttpOnly cookie may
// select a user, and every service still verifies that user inside the organization.
export function localContextIds(request?: Request, environment: LocalIdentityEnvironment = process.env) {
  const configuredUserId = environment.LOCAL_USER_ID || '0198f744-8e18-7ae2-a780-52a0e20c1932';
  const cookieUserId = environment.NODE_ENV === 'production' ? undefined : cookieValue(request, DEV_USER_COOKIE);
  return {
    organizationId: environment.LOCAL_ORGANIZATION_ID || '0198f744-8e18-7ae2-a780-52a0e20c1931',
    userId: z.uuid().safeParse(cookieUserId).success ? cookieUserId! : configuredUserId,
  };
}
export function currentPermissions(request?: Request) {
  const { organizationId, userId } = localContextIds(request);
  return permissionService(db, organizationId, userId);
}
export function currentMasterData(request?: Request) {
  const { organizationId, userId } = localContextIds(request);
  return masterDataService(db, organizationId, userId);
}
export function currentContentData(request?: Request) {
  const { organizationId, userId } = localContextIds(request);
  return contentService(db, organizationId, userId);
}
export function currentAiInfrastructure(request?: Request) {
  const { organizationId, userId } = localContextIds(request);
  return aiInfrastructureService(db, organizationId, userId);
}
export function currentMemory(request?: Request) {
  const { organizationId, userId } = localContextIds(request);
  return memoryService(db, organizationId, userId);
}
export function currentHistoryRetrieval(request?: Request) {
  const { organizationId, userId } = localContextIds(request);
  return historyRetrievalService(db, organizationId, userId);
}
export function currentAiPlanner(request?: Request) {
  const { organizationId, userId } = localContextIds(request);
  return aiPlannerService(db, organizationId, userId);
}
export function currentScriptApproval(request?: Request) {
  const { organizationId, userId } = localContextIds(request);
  return scriptApprovalService(db, organizationId, userId);
}
export function currentShoots(request?: Request) {
  const { organizationId, userId } = localContextIds(request);
  return shootService(db, organizationId, userId);
}
export function currentEdits(request?: Request) {
  const { organizationId, userId } = localContextIds(request);
  return editReviewService(db, organizationId, userId);
}
export function currentApprovalDecisions(request?: Request) {
  const { organizationId, userId } = localContextIds(request);
  return approvalDecisionService(db, organizationId, userId);
}
export function currentPerformance(request?: Request) {
  const { organizationId, userId } = localContextIds(request);
  return performanceService(db, organizationId, userId);
}
export function currentStrategyReviews(request?: Request) {
  const { organizationId, userId } = localContextIds(request);
  return strategyReviewService(db, organizationId, userId);
}
export function publicReview() {
  return publicReviewService(db);
}
