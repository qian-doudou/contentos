import { shootItemStatuses, shootStatuses } from '@/db/constants';

export type ShootStatus = (typeof shootStatuses)[number];
export type ShootItemStatus = (typeof shootItemStatuses)[number];

export function deriveShootStatus(items: readonly ShootItemStatus[]): ShootStatus {
  if (!items.length) return 'planned';
  if (items.every((status) => status === 'planned' || status === 'cancelled'))
    return items.every((status) => status === 'cancelled') ? 'cancelled' : 'planned';
  if (items.every((status) => status === 'shot')) return 'completed';
  if (items.every((status) => status === 'cancelled')) return 'cancelled';
  if (items.every((status) => status === 'rescheduled')) return 'rescheduled';
  if (items.includes('planned')) return 'in_progress';
  return 'partially_completed';
}

export function shootProgress(items: readonly ShootItemStatus[]) {
  return {
    total: items.length,
    shot: items.filter((status) => status === 'shot').length,
    issues: items.filter((status) => status === 'missing_shots').length,
    rescheduled: items.filter((status) => status === 'rescheduled').length,
    cancelled: items.filter((status) => status === 'cancelled').length,
  };
}
