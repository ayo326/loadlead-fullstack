/**
 * Payee routing primitive.
 *
 * The settlement engine calls this when paying an invoice to learn the current
 * payee and where to send the money. It returns one of:
 *   - CARRIER: the mover (default), when no assignment and no partner funded it
 *   - FACTOR:  when an active factoring assignment exists for the invoice
 *   - PARTNER: when an embedded funding partner funded the invoice
 *
 * It reads the append-only assignment log (no mutable payee flag is ever stored
 * on the invoice or load). Settlement is unchanged except for where money is
 * sent; the mover still earns linehaul minus the effective take from Phase 2
 * (0 during the free beta) plus pass-through accessorials.
 */

import { FactoringAssignmentService, AssignmentScope } from './factoringAssignmentService';

export type PayeeType = 'CARRIER' | 'FACTOR' | 'PARTNER';

export interface PartnerFundingSignal {
  partnerId: string;
  destination: string;
  assignmentId?: string;
}

export interface ResolvePayeeInput {
  carrierId: string;
  invoiceId?: string;
  /** The mover's own payout destination, used when the payee is the carrier. */
  carrierPayoutDestination: string;
  /** Present when a funding partner has funded this invoice (Phase 10). */
  partnerFunding?: PartnerFundingSignal;
}

export interface PayeeResolution {
  type: PayeeType;
  /** The mover this invoice belongs to, always carried for the recourse path. */
  carrierId: string;
  /** Where the money is sent for this payee. */
  destination: string;
  assignmentId?: string;
  scope?: AssignmentScope;
  reason: string;
}

export class PayeeRoutingService {
  static async resolvePayee(input: ResolvePayeeInput): Promise<PayeeResolution> {
    if (!input.carrierId) throw new Error('payeeRouting: carrierId is required');
    if (!input.carrierPayoutDestination) throw new Error('payeeRouting: carrierPayoutDestination is required');

    // A partner that funded the invoice is paid back first.
    if (input.partnerFunding) {
      return {
        type: 'PARTNER',
        carrierId: input.carrierId,
        destination: input.partnerFunding.destination,
        ...(input.partnerFunding.assignmentId ? { assignmentId: input.partnerFunding.assignmentId } : {}),
        reason: `funded by partner ${input.partnerFunding.partnerId}`,
      };
    }

    // An active factoring assignment redirects payment to the factor.
    const active = await FactoringAssignmentService.getActiveAssignment(input.carrierId, input.invoiceId);
    if (active) {
      return {
        type: 'FACTOR',
        carrierId: input.carrierId,
        destination: active.payoutDestination,
        assignmentId: active.assignmentId,
        scope: active.scope,
        reason: `active ${active.accountLevel ? 'account-level' : 'invoice-level'} assignment to ${active.factorName}`,
      };
    }

    // Default: the mover.
    return {
      type: 'CARRIER',
      carrierId: input.carrierId,
      destination: input.carrierPayoutDestination,
      reason: 'no active assignment or partner funding',
    };
  }
}
