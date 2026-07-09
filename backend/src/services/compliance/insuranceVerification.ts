/**
 * Insurance verification seam.
 *
 * An InsuranceVerificationProvider is the boundary between LoadLead and an
 * external COI verification service. The factory defaults to a manual provider
 * (an admin reviews the COI plus the FMCSA auto-check and marks it VERIFIED or
 * REJECTED). Likely partners (Highway, RMIS, MyCarrierPackets) have stub
 * implementations that throw "provider not configured" until a contract exists.
 * Selected by configuration, mirroring the funding and messaging seams.
 */

export interface InsuranceSubmission {
  documentId: string;
  mcNumber?: string;
  dotNumber?: string;
  insurerName?: string;
  policyNumber?: string;
}

export type InsuranceVerificationState = 'PENDING' | 'VERIFIED' | 'REJECTED';

export interface InsuranceVerificationStatus {
  providerRef: string;
  state: InsuranceVerificationState;
  detail?: string;
}

export interface InsuranceVerificationProvider {
  readonly name: string;
  submit(sub: InsuranceSubmission): Promise<InsuranceVerificationStatus>;
  getStatus(providerRef: string): Promise<InsuranceVerificationStatus>;
}

/**
 * Manual provider: no external API. Submission simply registers the COI for
 * admin review; an admin makes the VERIFIED/REJECTED decision through the
 * coiService. This is the default and works with no partner configured.
 */
export class ManualInsuranceProvider implements InsuranceVerificationProvider {
  readonly name = 'manual';

  async submit(sub: InsuranceSubmission): Promise<InsuranceVerificationStatus> {
    return { providerRef: `manual:${sub.documentId}`, state: 'PENDING', detail: 'awaiting admin review' };
  }

  async getStatus(providerRef: string): Promise<InsuranceVerificationStatus> {
    return { providerRef, state: 'PENDING', detail: 'manual review' };
  }
}

/** A not-yet-contracted third-party provider. Throws until built. */
class UnconfiguredProvider implements InsuranceVerificationProvider {
  constructor(readonly name: string) {}
  async submit(): Promise<InsuranceVerificationStatus> {
    throw new Error(`insurance provider "${this.name}" not configured`);
  }
  async getStatus(): Promise<InsuranceVerificationStatus> {
    throw new Error(`insurance provider "${this.name}" not configured`);
  }
}

export class HighwayProvider extends UnconfiguredProvider {
  constructor() {
    super('highway');
  }
}
export class RmisProvider extends UnconfiguredProvider {
  constructor() {
    super('rmis');
  }
}
export class MyCarrierPacketsProvider extends UnconfiguredProvider {
  constructor() {
    super('mycarrierpackets');
  }
}

/** Resolve the active provider by configuration. Defaults to manual. */
export function resolveInsuranceProvider(): InsuranceVerificationProvider {
  const name = (process.env.INSURANCE_VERIFICATION_PROVIDER || 'manual').trim().toLowerCase();
  switch (name) {
    case 'highway':
      return new HighwayProvider();
    case 'rmis':
      return new RmisProvider();
    case 'mycarrierpackets':
      return new MyCarrierPacketsProvider();
    case 'manual':
    default:
      return new ManualInsuranceProvider();
  }
}
