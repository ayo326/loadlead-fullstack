/**
 * Phase 9: provider-neutral funding seam.
 *
 * Proves the factory defaults to manual, returns a stub for a named partner, and
 * that the stub throws "provider not configured" while manual returns a no-advance
 * MANUAL decision.
 */
import { describe, it, expect } from 'vitest';
import {
  getFundingProvider,
  ManualFundingProvider,
  OtrFundingProvider,
} from '../../../src/services/funding/fundingProvider';
import type { FactoringInvoicePackage } from '../../../src/services/invoicePackageService';

const pkg = { invoiceId: 'inv-1', loadId: 'load-1', advanceableTotalCents: 150000, lines: [] } as unknown as FactoringInvoicePackage;

describe('funding factory', () => {
  it('defaults to the manual provider', () => {
    expect(getFundingProvider(undefined).name).toBe('manual');
    expect(getFundingProvider('').name).toBe('manual');
    expect(getFundingProvider('manual')).toBeInstanceOf(ManualFundingProvider);
  });

  it('returns a stub for a named partner', () => {
    expect(getFundingProvider('otr')).toBeInstanceOf(OtrFundingProvider);
    expect(getFundingProvider('triumph').name).toBe('Triumph');
    expect(getFundingProvider('outgo').name).toBe('Outgo');
    expect(getFundingProvider('denim').name).toBe('Denim');
  });

  it('an unknown provider name falls back to manual', () => {
    expect(getFundingProvider('nope').name).toBe('manual');
  });
});

describe('manual provider', () => {
  it('returns a MANUAL decision with no advance', async () => {
    const d = await new ManualFundingProvider().submitInvoicePackage(pkg);
    expect(d.decision).toBe('MANUAL');
    expect(d.advanceAmountCents).toBe(0);
  });
});

describe('unconfigured stub', () => {
  it('throws "provider not configured" on every call', async () => {
    const otr = getFundingProvider('otr');
    await expect(otr.submitInvoicePackage(pkg)).rejects.toThrow(/provider not configured: OTR/);
    await expect(otr.getFundingStatus('ref')).rejects.toThrow(/provider not configured/);
    expect(() => otr.parseWebhook({})).toThrow(/provider not configured/);
  });
});
