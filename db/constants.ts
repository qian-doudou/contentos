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
export const contentStatusTriggers = ['manual', 'approval', 'shoot', 'edit', 'publish', 'system'] as const;
export const scriptSourceTypes = ['ai', 'operator', 'client_revision', 'rewrite'] as const;
export const editAssetTypes = ['url', 'local_reference'] as const;
export const approvalTypes = ['script', 'final_video'] as const;
export const approvalStatuses = ['pending', 'approved', 'changes_requested', 'rejected', 'expired'] as const;
export const approvalReviewerTypes = ['internal_user', 'external_client'] as const;
export const shootStatuses = ['planned', 'in_progress', 'completed', 'partially_completed', 'cancelled', 'rescheduled'] as const;
export const shootItemStatuses = ['planned', 'shot', 'missing_shots', 'rescheduled', 'cancelled'] as const;
export const memoryScopeTypes = ['brand', 'account'] as const;
export const memoryTypes = ['brand', 'preference', 'content_pattern', 'performance_pattern', 'strategy', 'temporary'] as const;
export const memoryStatuses = ['active', 'inactive', 'superseded', 'expired'] as const;
export const memorySourceTypes = [
  'brand_profile', 'confirmed_preference', 'confirmed_performance', 'confirmed_strategy', 'manual',
] as const;
export const contentImportFormats = ['csv', 'json'] as const;
export const contentImportDedupStrategies = ['external_id', 'title_published_at', 'canonical'] as const;
export const contentImportStatuses = ['previewed', 'committed', 'failed'] as const;
export const contentEmbeddingStatuses = ['active', 'stale', 'failed'] as const;
export const historyRetrievalMethods = ['embedding', 'fallback_bigram'] as const;
export const plannerSessionStatuses = ['generating', 'awaiting_selection', 'completed', 'failed'] as const;
export const plannerCandidateStatuses = ['active', 'replaced', 'persisted', 'dismissed'] as const;
export const plannerQualityStatuses = ['passed', 'warning', 'blocked'] as const;
export const duplicateLevels = ['new', 'mild', 'remixable', 'high'] as const;
