// services/integrations/stubs/fmcsaInsuranceStub.ts
//
// NON-PRODUCTION ONLY. Physically deleted from the production build by
// deploy-backend.sh. Reachable only via the guarded dynamic import in
// services/integrations/fmcsaInsurance.ts - never import this statically.
//
// Canned insurance-filing summaries for seeded test DOT numbers, matching the
// shape the live adapter returns.

import type { InsuranceFilingSummary } from '../fmcsaInsurance';

/** A seeded DOT with an active filing under "GREAT WEST CASUALTY". */
const ACTIVE_DOT = '999000001';

export default {
  async getInsurance(dot?: string): Promise<InsuranceFilingSummary> {
    if (dot === ACTIVE_DOT) {
      return {
        hasActiveInsurance: true,
        insurerNames: ['GREAT WEST CASUALTY'],
        bipdOnFileDollars: 1_000_000,
        note: 'stub: active filing',
      };
    }
    return { hasActiveInsurance: false, insurerNames: [], note: 'stub: no filing on record' };
  },
};
