/**
 * Provider-neutral funding seam.
 *
 * A FundingProvider is the boundary between LoadLead and an external funding
 * partner. The factory defaults to a manual provider that performs no API call
 * and supports only the assignment flow, so the foundation works today with no
 * partner selected. Likely partners (OTR, Triumph, Outgo, Denim) have stub
 * implementations that throw "provider not configured" until built.
 *
 * All money is integer cents.
 */

import { assertIntegerCents } from '../../utils/money';
import type { FactoringInvoicePackage } from '../invoicePackageService';

export type FundingDecisionType = 'MANUAL' | 'APPROVED' | 'DECLINED';

export interface FundingDecision {
  decision: FundingDecisionType;
  /** Advance offered, in integer cents. 0 for manual or declined. */
  advanceAmountCents: number;
  providerRef?: string;
  reason?: string;
}

export interface FundingStatus {
  providerRef: string;
  state: 'NONE' | 'SUBMITTED' | 'FUNDED' | 'SETTLED' | 'DECLINED';
  advanceAmountCents: number;
}

export interface FundingWebhookEvent {
  providerRef: string;
  type: string;
  raw: unknown;
}

export interface FundingProvider {
  readonly name: string;
  submitInvoicePackage(pkg: FactoringInvoicePackage): Promise<FundingDecision>;
  getFundingStatus(providerRef: string): Promise<FundingStatus>;
  parseWebhook(payload: unknown): FundingWebhookEvent;
}

/**
 * Manual provider: no external API. A funding decision is "manual", meaning the
 * mover's assignment redirects payment to their own factor and LoadLead advances
 * nothing itself. This is the default and works with no partner configured.
 */
export class ManualFundingProvider implements FundingProvider {
  readonly name = 'manual';

  async submitInvoicePackage(pkg: FactoringInvoicePackage): Promise<FundingDecision> {
    assertIntegerCents(pkg.advanceableTotalCents, 'advanceableTotalCents');
    return {
      decision: 'MANUAL',
      advanceAmountCents: 0,
      reason: 'manual provider: routed via the mover assignment; no platform advance',
    };
  }

  async getFundingStatus(providerRef: string): Promise<FundingStatus> {
    return { providerRef, state: 'NONE', advanceAmountCents: 0 };
  }

  parseWebhook(): FundingWebhookEvent {
    throw new Error('manual funding provider does not receive webhooks');
  }
}

/** A partner stub that is not yet built. Every call throws until configured. */
class UnconfiguredFundingProvider implements FundingProvider {
  constructor(readonly name: string) {}
  private fail(): never {
    throw new Error(`provider not configured: ${this.name}`);
  }
  async submitInvoicePackage(): Promise<FundingDecision> {
    this.fail();
  }
  async getFundingStatus(): Promise<FundingStatus> {
    this.fail();
  }
  parseWebhook(): FundingWebhookEvent {
    this.fail();
  }
}

export class OtrFundingProvider extends UnconfiguredFundingProvider {
  constructor() {
    super('OTR');
  }
}
export class TriumphFundingProvider extends UnconfiguredFundingProvider {
  constructor() {
    super('Triumph');
  }
}
export class OutgoFundingProvider extends UnconfiguredFundingProvider {
  constructor() {
    super('Outgo');
  }
}
export class DenimFundingProvider extends UnconfiguredFundingProvider {
  constructor() {
    super('Denim');
  }
}

/**
 * Resolve the funding provider from FUNDING_PROVIDER (defaults to manual). The
 * stubs return a provider object whose calls throw "provider not configured", so
 * a misconfiguration fails loudly rather than silently doing nothing.
 */
export function getFundingProvider(name: string | undefined = process.env.FUNDING_PROVIDER): FundingProvider {
  switch ((name || 'manual').trim().toLowerCase()) {
    case 'otr':
      return new OtrFundingProvider();
    case 'triumph':
      return new TriumphFundingProvider();
    case 'outgo':
      return new OutgoFundingProvider();
    case 'denim':
      return new DenimFundingProvider();
    case 'manual':
    case '':
      return new ManualFundingProvider();
    default:
      return new ManualFundingProvider();
  }
}
