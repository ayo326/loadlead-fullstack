// services/integrations/fmcsaInsurance.ts
//
// FMCSA QCMobile insurance-filing adapter. Retrieves the Licensing and
// Insurance (L&I) filings on record for a carrier's DOT number so a submitted
// COI can be corroborated against what the FMCSA shows on file. This is a
// corroboration signal, not a substitute for verification.
//
// Mirrors fmcsa.ts (authority): mode-resolved, stub outside production, live in
// production. resolveMode('fmcsa') is reused since this is the same integration.

import { resolveMode } from './modeResolver';
import Logger from '../../utils/logger';

export interface InsuranceFilingSummary {
  /** Whether any active insurance filing is on record. */
  hasActiveInsurance: boolean;
  /** Insurer names present on the filings, upper-cased for comparison. */
  insurerNames: string[];
  /** BIPD (liability) coverage on file, in dollars, when available. */
  bipdOnFileDollars?: number;
  /** Raw provider note for the verification detail. */
  note?: string;
}

interface FmcsaInsuranceStubModule {
  default: { getInsurance(dot?: string): Promise<InsuranceFilingSummary> };
}

export async function getInsuranceFilings(dot?: string): Promise<InsuranceFilingSummary> {
  const mode = resolveMode('fmcsa');

  if (mode !== 'live') {
    const modulePath = './stubs/' + 'fmcsaInsurance' + 'Stub';
    const stub = (await import(modulePath)) as FmcsaInsuranceStubModule;
    return stub.default.getInsurance(dot);
  }

  const key = process.env.FMCSA_WEBKEY;
  if (!key) {
    Logger.warn('[integrations/fmcsaInsurance] live mode but FMCSA_WEBKEY not set - returning empty filing set');
    return { hasActiveInsurance: false, insurerNames: [], note: 'FMCSA_WEBKEY not set' };
  }
  if (!dot) return { hasActiveInsurance: false, insurerNames: [], note: 'no DOT number' };

  try {
    const base = 'https://mobile.fmcsa.dot.gov/qc/services/carriers';
    const url = `${base}/${encodeURIComponent(dot)}/basics?webKey=${encodeURIComponent(key)}`;
    const res = await fetch(url);
    if (!res.ok) {
      return { hasActiveInsurance: false, insurerNames: [], note: `FMCSA HTTP ${res.status}` };
    }
    const data: any = await res.json();
    // The L&I payload shape varies; extract insurer names + BIPD defensively.
    const content = Array.isArray(data?.content) ? data.content : [data?.content].filter(Boolean);
    const insurerNames: string[] = [];
    let bipd: number | undefined;
    for (const c of content) {
      const name = c?.insurance?.insurerName ?? c?.carrier?.insurerName;
      if (name) insurerNames.push(String(name).toUpperCase());
      const b = Number(c?.insurance?.bipdInsuranceOnFile ?? c?.carrier?.bipdInsuranceOnFile);
      if (!Number.isNaN(b) && b > 0) bipd = b * 1000; // FMCSA reports in thousands
    }
    return {
      hasActiveInsurance: insurerNames.length > 0,
      insurerNames,
      bipdOnFileDollars: bipd,
      note: `FMCSA filings: ${insurerNames.length}`,
    };
  } catch (err) {
    Logger.warn(`[integrations/fmcsaInsurance] fetch failed: ${err}`);
    return { hasActiveInsurance: false, insurerNames: [], note: 'FMCSA fetch failed' };
  }
}
