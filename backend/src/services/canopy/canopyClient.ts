/**
 * Canopy Connect API client (SCRUM-60).
 *
 * Retrieves Pull data and toggles monitoring. Two operating modes, chosen by
 * whether credentials are configured, so the whole pipeline runs offline in CI:
 *
 *   - live mode  (client id + secret present): real HTTPS calls to Canopy with
 *     HTTP Basic auth (username=clientId, password=clientSecret). Used in
 *     sandbox and production. The credentials are never logged.
 *   - fixture mode (no credentials): reads an in-memory registry of sandbox
 *     pulls that tests seed via registerFixturePull(). No network, no secrets.
 *
 * In production canopyConfig.connectEnabled is false unless credentials are set,
 * so the connect experience is simply not offered and fixture mode never runs
 * with real users. The hauler's insurer login always happens inside Canopy's own
 * flow; this client only ever reads already-consented pull results server-side.
 */

import canopyConfig from '../../config/canopyConfig';
import { Logger } from '../../utils/logger';
import { CanopyPull } from './canopyTypes';

export class CanopyApiError extends Error {
  constructor(
    message: string,
    readonly httpStatus?: number,
  ) {
    super(message);
    this.name = 'CanopyApiError';
  }
}

// ── Fixture registry (test + offline mode) ──────────────────────────────────
const fixturePulls = new Map<string, CanopyPull>();
const fixtureMonitorings = new Map<string, boolean>();

/** Seed a pull for fixture mode (tests). Overwrites any prior pull with the id. */
export function registerFixturePull(pull: CanopyPull): void {
  fixturePulls.set(pull.pull_id, pull);
}

/** Clear all fixtures (test teardown). */
export function resetFixtures(): void {
  fixturePulls.clear();
  fixtureMonitorings.clear();
}

function useFixtureMode(): boolean {
  return !(canopyConfig.clientId && canopyConfig.clientSecret);
}

function authHeader(): string {
  const token = Buffer.from(`${canopyConfig.clientId}:${canopyConfig.clientSecret}`).toString('base64');
  return `Basic ${token}`;
}

async function httpGet<T>(pathAndQuery: string): Promise<T> {
  const url = `${canopyConfig.apiBaseUrl}${pathAndQuery}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: authHeader(), Accept: 'application/json' },
  });
  if (!res.ok) {
    // Never include the Authorization header or any secret in the error.
    throw new CanopyApiError(`Canopy GET ${pathAndQuery} failed`, res.status);
  }
  return (await res.json()) as T;
}

async function httpSend<T>(method: 'POST' | 'PATCH' | 'DELETE', pathAndQuery: string, body?: unknown): Promise<T> {
  const url = `${canopyConfig.apiBaseUrl}${pathAndQuery}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: authHeader(),
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    throw new CanopyApiError(`Canopy ${method} ${pathAndQuery} failed`, res.status);
  }
  return (await res.json()) as T;
}

export const CanopyClient = {
  isFixtureMode(): boolean {
    return useFixtureMode();
  },

  /**
   * Retrieve a Pull by id. The single source of truth for a pull's result: the
   * webhook only notifies; we always read the authoritative data here before
   * acting on it (this also means an unsigned/forged webhook cannot inject state
   * in sandbox, because the pull id must resolve to real Canopy data).
   *
   * Endpoint path per recon (get-pull-by-id). Confirm exact path with the Canopy
   * contact (question A9); it is trivially adjustable here with no pipeline change.
   */
  async getPull(pullId: string): Promise<CanopyPull> {
    if (useFixtureMode()) {
      const pull = fixturePulls.get(pullId);
      if (!pull) throw new CanopyApiError(`fixture pull not found: ${pullId}`, 404);
      return pull;
    }
    return httpGet<CanopyPull>(`/pulls/${encodeURIComponent(pullId)}`);
  },

  /**
   * Enable monitoring on a pull. Returns a monitoring identifier we persist on
   * the connection row. Fixture mode returns a deterministic id.
   */
  async enableMonitoring(pullId: string): Promise<{ monitoringId: string }> {
    if (useFixtureMode()) {
      fixtureMonitorings.set(pullId, true);
      return { monitoringId: `mon_${pullId}` };
    }
    const res = await httpSend<{ monitoring_id?: string; id?: string }>('POST', `/monitorings`, {
      pull_id: pullId,
    });
    const monitoringId = res.monitoring_id || res.id || `mon_${pullId}`;
    Logger.info(`[canopy] monitoring enabled for pull ${pullId}`);
    return { monitoringId };
  },

  /** Disable monitoring on a pull (best-effort). */
  async disableMonitoring(monitoringId: string): Promise<void> {
    if (useFixtureMode()) {
      return;
    }
    await httpSend('DELETE', `/monitorings/${encodeURIComponent(monitoringId)}`);
  },
};

export default CanopyClient;
