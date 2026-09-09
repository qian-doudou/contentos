import { z } from 'zod';

const SENSITIVE_KEYS = new Set([
  'api_key', 'apikey', 'authorization', 'secret', 'review_token', 'reviewtoken',
  'access_token', 'accesstoken', 'refresh_token', 'refreshtoken', 'base_url', 'baseurl',
  'database_path', 'databasepath',
]);

export function parseTraceValue(value: string | null): unknown {
  if (value === null) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

export function sanitizeTrace(value: unknown): unknown {
  if (typeof value === 'string') {
    if (/^Bearer\s+/i.test(value) || /^(\/Users\/|\/home\/|\/var\/|[A-Za-z]:\\)/.test(value)) return '[REDACTED]';
    return value;
  }
  if (Array.isArray(value)) return value.map(sanitizeTrace);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      SENSITIVE_KEYS.has(key.replaceAll('-', '_').toLowerCase()) ? '[REDACTED]' : sanitizeTrace(item),
    ]));
  }
  return value;
}

export function sanitizeTraceJson(value: string | null) {
  if (value === null) return null;
  const safe = sanitizeTrace(parseTraceValue(value));
  return typeof safe === 'string' ? safe : JSON.stringify(safe);
}

export function snapshotIdsFrom(value: unknown, result = new Set<string>()) {
  if (Array.isArray(value)) {
    for (const item of value) snapshotIdsFrom(item, result);
    return result;
  }
  if (!value || typeof value !== 'object') return result;
  for (const [key, item] of Object.entries(value)) {
    if ((key === 'contextSnapshotId' || key === 'snapshotId') && typeof item === 'string' && z.uuid().safeParse(item).success)
      result.add(item);
    snapshotIdsFrom(item, result);
  }
  return result;
}
