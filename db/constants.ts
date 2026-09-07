export const organizationStatuses = ['active', 'inactive'] as const;
export const userRoles = ['owner', 'admin', 'operator', 'photographer', 'editor', 'viewer'] as const;
export const userStatuses = ['active', 'inactive'] as const;
export const runTypes = ['production', 'test', 'eval'] as const;
export const runStatuses = [
  'queued', 'running', 'completed', 'completed_with_warnings', 'manual_review_required', 'failed', 'cancelled',
] as const;
export const runStepStatuses = ['pending', 'running', 'succeeded', 'failed', 'skipped'] as const;
export const modelProfiles = ['light', 'standard', 'strong'] as const;
export const priceConfigStatuses = ['active', 'inactive'] as const;
export const aiLedgerTypes = ['consume', 'grant', 'refund', 'adjustment'] as const;
export const aiUsageStatuses = ['completed', 'failed'] as const;
export const cooperationStatuses = ['lead', 'active', 'paused', 'ended'] as const;
export const accountTypes = ['official', 'owner_ip', 'employee_ip', 'store', 'other'] as const;
export const businessStatuses = ['active', 'inactive'] as const;
export const contentTypes = ['persona', 'product', 'local', 'trust', 'conversion', 'education', 'process', 'customer_case', 'other'] as const;
export const contentGoals = ['exposure', 'followers', 'trust', 'click', 'conversion', 'gmv'] as const;
export const hookTypes = ['contrast', 'conflict', 'price', 'question', 'identity', 'local', 'result', 'mistake', 'secret', 'challenge', 'other'] as const;
export const contentPriorities = ['low', 'normal', 'high', 'urgent'] as const;
export const contentStatuses = [
  'IDEA', 'SCRIPTING', 'WAITING_APPROVAL', 'APPROVED', 'WAITING_SHOOT', 'SHOT', 'EDITING',
  'WAITING_REVIEW', 'REVISION', 'READY_TO_PUBLISH', 'PUBLISHED', 'REVIEWED',
] as const;
export const contentStatusTriggers = ['manual', 'shoot', 'publish', 'system'] as const;
