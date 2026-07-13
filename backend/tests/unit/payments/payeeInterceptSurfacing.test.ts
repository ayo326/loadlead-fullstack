/**
 * SEC-6 (audit v5): the live payee-routing seam must SURFACE an active payout
 * intercept on the CARRIER branch, so a downstream payout cannot silently pay a
 * carrier net while a garnishment/levy/lien is in force. resolvePayee routes (it
 * does not move money), so it only sets a flag; the amount reduction stays in
 * reconciliationService.reconcileDebtorPayment.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted: vi.mock is hoisted above module-scope consts, so the mock fns must
// be hoisted too or they hit a temporal-dead-zone ReferenceError.
const { getActiveAssignment, activeFor } = vi.hoisted(() => ({
  getActiveAssignment: vi.fn(async (): Promise<any> => null),
  activeFor: vi.fn(async (): Promise<any[]> => []),
}));

vi.mock('../../../src/services/factoringAssignmentService', () => ({
  FactoringAssignmentService: { getActiveAssignment },
  AssignmentScope: {},
}));
vi.mock('../../../src/services/payoutInterceptService', () => ({
  PayoutInterceptService: { activeFor },
}));

import { PayeeRoutingService } from '../../../src/services/payeeRoutingService';

const base = { carrierId: 'oo-9', invoiceId: 'load-1', carrierPayoutDestination: 'acct-oo-9' };

beforeEach(() => {
  vi.clearAllMocks();
  getActiveAssignment.mockResolvedValue(null);
  activeFor.mockResolvedValue([]);
});

describe('PayeeRoutingService intercept surfacing (SEC-6)', () => {
  it('CARRIER payee with NO active intercept: intercepted is not set', async () => {
    const r = await PayeeRoutingService.resolvePayee(base);
    expect(r.type).toBe('CARRIER');
    expect(r.intercepted).toBeFalsy();
  });

  it('CARRIER payee WITH an active intercept: surfaces intercepted=true + a loud reason', async () => {
    activeFor.mockResolvedValue([{ interceptId: 'int-1', status: 'ACTIVE' }]);
    const r = await PayeeRoutingService.resolvePayee(base);
    expect(r.type).toBe('CARRIER');
    expect(r.intercepted).toBe(true);
    expect(r.reason).toMatch(/INTERCEPT/);
    expect(activeFor).toHaveBeenCalledWith('load-1', 'oo-9');
  });

  it('FACTOR payee short-circuits before the intercept lookup (money goes to the factor)', async () => {
    getActiveAssignment.mockResolvedValue({
      assignmentId: 'a-1', payoutDestination: 'factor-acct', factorName: 'ABC', scope: 'ACCOUNT', accountLevel: true,
    });
    activeFor.mockResolvedValue([{ interceptId: 'int-1' }]);
    const r = await PayeeRoutingService.resolvePayee(base);
    expect(r.type).toBe('FACTOR');
    expect(r.intercepted).toBeUndefined();
    expect(activeFor).not.toHaveBeenCalled();
  });
});
