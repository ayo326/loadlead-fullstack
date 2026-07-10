/**
 * Query-first data access with a guarded scan fallback (audit v4 H3/COA-3A).
 *
 * The repo's historical convention was scan-all + filter-in-JS, which is
 * correct but lethal at scale on request-hot paths. Hot reads now query a
 * single-attribute GSI and only fall back to the caller-supplied scan when
 * the query path is unusable in this environment:
 *   - the index isn't created/backfilled yet (ValidationException), or
 *   - the data layer doesn't expose query (partial test harnesses).
 *
 * The fallback stays CORRECT but is treated as an incident, not a
 * convenience: it logs a grep-able/alertable `[scan-fallback]` error line
 * every time, so a missing index degrades loudly instead of silently
 * self-DoSing (the v4 audit's H3c lesson).
 */
import { Database } from '../config/database';
import { Logger } from './logger';

/** A Query against a GSI that doesn't exist raises ValidationException. */
export function isMissingIndex(err: any): boolean {
  return err?.name === 'ValidationException' && /index/i.test(String(err?.message ?? ''));
}

export async function queryIndexOrScan<T>(
  table: string,
  indexName: string,
  attr: string,
  value: string,
  scanFallback: () => Promise<T[]>,
  label: string,
): Promise<T[]> {
  if (typeof Database.query === 'function') {
    try {
      return await Database.query<T>(table, indexName, '#k = :v', { '#k': attr }, { ':v': value });
    } catch (err: any) {
      if (err?.name === 'ResourceNotFoundException') return [];
      if (!isMissingIndex(err)) throw err;
    }
  }
  Logger.error(`[scan-fallback] ${label}: index ${indexName} unavailable on ${table}; full table scan used`);
  return scanFallback();
}
