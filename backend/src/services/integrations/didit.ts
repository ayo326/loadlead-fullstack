// services/integrations/didit.ts
//
// Didit KYC/KYB/AML adapter. Ships to every environment, including
// production. Didit has no logic branch between modes - "sandbox" and
// "live" hit the exact same verification.didit.me/v3 endpoints; the only
// difference is which Didit app's credentials (DIDIT_API_KEY, workflow IDs,
// webhook secret) are loaded into this environment. The boot guard
// (bootGuard.ts) is what actually prevents a sandbox environment from
// carrying live credentials, or vice versa - this adapter just makes the
// resolved mode visible for logging.
//
// Moved verbatim from services/verification.ts - verification.ts now
// delegates here instead of calling fetch() directly. recomputeAndPersist,
// deriveStatus, and the webhook handler's decision flow are untouched.

import { resolveMode } from './modeResolver';
import Logger from '../../utils/logger';

const DIDIT_BASE = 'https://verification.didit.me';

export type SubStatus = 'pending' | 'pass' | 'fail';

export async function createDiditSession(
  workflowId: string,
  vendorData: string,
): Promise<{ session_id: string; url: string } | null> {
  const apiKey = process.env.DIDIT_API_KEY;
  if (!apiKey) {
    Logger.warn('[integrations/didit] DIDIT_API_KEY not set - skipping session creation');
    return null;
  }

  const mode = resolveMode('didit');
  const body = {
    workflow_id: workflowId,
    vendor_data: vendorData,
    callback: `${process.env.FRONTEND_URL ?? 'https://loadleadapp.com'}/verification/complete`,
    callback_method: 'both',
  };

  try {
    const res = await fetch(`${DIDIT_BASE}/v3/session/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      Logger.error(`[integrations/didit] session creation failed (mode=${mode}): ${res.status} ${text}`);
      return null;
    }

    const data: any = await res.json();
    return { session_id: data.session_id, url: data.url };
  } catch (err) {
    Logger.error(`[integrations/didit] session creation error (mode=${mode}): ${err}`);
    return null;
  }
}

export async function checkAml(entityId: string, fullName: string): Promise<SubStatus> {
  const apiKey = process.env.DIDIT_API_KEY;
  if (!apiKey) {
    Logger.warn('[integrations/didit] DIDIT_API_KEY not set - treating AML check as passing');
    return 'pass';
  }

  try {
    const res = await fetch(`${DIDIT_BASE}/v3/aml/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify({
        full_name: fullName,
        entity_type: 'person',
        vendor_data: entityId,
        save_api_request: true,
        include_adverse_media: false,
        include_ongoing_monitoring: false,
        aml_name_weight: 60,
        aml_dob_weight: 25,
        aml_country_weight: 15,
      }),
    });

    if (!res.ok) {
      Logger.error(`[integrations/didit] AML check failed: ${res.status} ${await res.text()}`);
      return 'pending';
    }

    const data: any = await res.json();
    const status: string = data?.aml?.status ?? '';
    return status === 'Approved' && (data?.aml?.total_hits ?? 0) === 0
      ? 'pass'
      : status === 'Declined' || (data?.aml?.total_hits ?? 0) > 0
        ? 'fail'
        : 'pending';
  } catch (err) {
    Logger.error(`[integrations/didit] AML check error: ${err}`);
    return 'pending';
  }
}
