// services/integrations/stubs/fmcsaStub.ts
//
// NON-PRODUCTION ONLY. Physically deleted from the production build by
// deploy-backend.sh. Reachable only via the guarded dynamic import in
// services/integrations/fmcsa.ts - never import this statically.
//
// Canned, QCMobile-shaped responses for a fixed set of seeded test MC/DOT
// numbers. Shape matches exactly what the live FMCSA adapter parses:
//   data.content[0].carrier.allowToOperate === 'Y' && !carrier.outOfServiceDate

export const SEEDED_TEST_IDS = {
  ACTIVE_DOT: '999000001',
  ACTIVE_MC: '999100001',
  INACTIVE_DOT: '999000002',
  INACTIVE_MC: '999100002',
};

function qcMobileShape(allowToOperate: 'Y' | 'N', outOfServiceDate: string | null) {
  return {
    content: [{ carrier: { allowToOperate, outOfServiceDate } }],
  };
}

function isActive(data: ReturnType<typeof qcMobileShape>): boolean {
  const carrier = data?.content?.[0]?.carrier;
  return carrier?.allowToOperate === 'Y' && !carrier?.outOfServiceDate;
}

export default {
  SEEDED_TEST_IDS,
  async check(mc?: string, dot?: string): Promise<boolean> {
    const id = dot || mc;

    if (id === SEEDED_TEST_IDS.ACTIVE_DOT || id === SEEDED_TEST_IDS.ACTIVE_MC) {
      return isActive(qcMobileShape('Y', null));
    }
    if (id === SEEDED_TEST_IDS.INACTIVE_DOT || id === SEEDED_TEST_IDS.INACTIVE_MC) {
      return isActive(qcMobileShape('N', '2024-01-01'));
    }

    // Unseeded MC/DOT in stub mode (e.g. a developer typing a random test
    // number) - default to active so ordinary dev/staging flows aren't
    // blocked. The seeded INACTIVE ids exist specifically to exercise the
    // rejection path on demand.
    return isActive(qcMobileShape('Y', null));
  },
};
