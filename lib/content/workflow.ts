import { contentStatuses, type contentStatusTriggers } from '@/db/constants';
import { ApiError } from '@/lib/api/envelope';

export type ContentStatus = (typeof contentStatuses)[number];
export type ContentStatusTrigger = (typeof contentStatusTriggers)[number];

type TransitionRule = { from: ContentStatus; to: ContentStatus; trigger: 'manual' | 'shoot' | 'publish' };

export const contentTransitionRules = [
  { from: 'IDEA', to: 'SCRIPTING', trigger: 'manual' },
  { from: 'SCRIPTING', to: 'WAITING_APPROVAL', trigger: 'manual' },
  { from: 'WAITING_APPROVAL', to: 'SCRIPTING', trigger: 'manual' },
  { from: 'WAITING_APPROVAL', to: 'APPROVED', trigger: 'manual' },
  { from: 'APPROVED', to: 'WAITING_SHOOT', trigger: 'shoot' },
  { from: 'WAITING_SHOOT', to: 'APPROVED', trigger: 'shoot' },
  { from: 'WAITING_SHOOT', to: 'SHOT', trigger: 'shoot' },
  { from: 'SHOT', to: 'EDITING', trigger: 'manual' },
  { from: 'EDITING', to: 'WAITING_REVIEW', trigger: 'manual' },
  { from: 'WAITING_REVIEW', to: 'REVISION', trigger: 'manual' },
  { from: 'REVISION', to: 'WAITING_REVIEW', trigger: 'manual' },
  { from: 'WAITING_REVIEW', to: 'READY_TO_PUBLISH', trigger: 'manual' },
  { from: 'READY_TO_PUBLISH', to: 'PUBLISHED', trigger: 'publish' },
  { from: 'PUBLISHED', to: 'REVIEWED', trigger: 'manual' },
] as const satisfies readonly TransitionRule[];

export const kanbanColumns = [
  { id: 'ideas', label: '选题池', statuses: ['IDEA'] },
  { id: 'scripts', label: '脚本', statuses: ['SCRIPTING'] },
  { id: 'approval', label: '待审核', statuses: ['WAITING_APPROVAL'] },
  { id: 'shoot', label: '待拍摄', statuses: ['APPROVED', 'WAITING_SHOOT'] },
  { id: 'editing', label: '剪辑', statuses: ['SHOT', 'EDITING', 'REVISION'] },
  { id: 'publish', label: '待发布', statuses: ['WAITING_REVIEW', 'READY_TO_PUBLISH'] },
  { id: 'published', label: '已发布', statuses: ['PUBLISHED', 'REVIEWED'] },
] as const satisfies ReadonlyArray<{ id: string; label: string; statuses: readonly ContentStatus[] }>;

export function transitionRule(from: ContentStatus, to: ContentStatus) {
  return contentTransitionRules.find(rule => rule.from === from && rule.to === to);
}

export function assertContentTransition(from: ContentStatus, to: ContentStatus, trigger: ContentStatusTrigger) {
  const rule = transitionRule(from, to);
  if (!rule) throw new ApiError(409, 'INVALID_STATUS_TRANSITION', `不允许从 ${from} 转换到 ${to}`);
  if (rule.trigger !== trigger)
    throw new ApiError(409, 'BUSINESS_TRIGGER_REQUIRED', '该状态转换必须由对应的拍摄或发布业务事务触发');
  return rule;
}

export function manualNextStatuses(status: ContentStatus) {
  return contentTransitionRules.filter(rule => rule.from === status && rule.trigger === 'manual').map(rule => rule.to);
}

export function kanbanColumnId(status: ContentStatus) {
  return kanbanColumns.find(column => (column.statuses as readonly ContentStatus[]).includes(status))?.id;
}

export function deadlineFlags(deadline: string | null, status: ContentStatus, now = new Date()) {
  if (!deadline || status === 'PUBLISHED' || status === 'REVIEWED') return { overdue: false, dueSoon: false };
  const deadlineMs = Date.parse(deadline);
  const nowMs = now.getTime();
  if (deadlineMs < nowMs) return { overdue: true, dueSoon: false };
  return { overdue: false, dueSoon: deadlineMs - nowMs <= 48 * 60 * 60 * 1000 };
}
