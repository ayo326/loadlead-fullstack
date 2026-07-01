/**
 * Phase 13 capstone: the whole pipeline composes end to end.
 *
 * Delivered load -> accessorial computed and auto-approved -> factoring-ready
 * package -> assignment + Notice of Assignment -> payee resolves to the factor ->
 * advance issued against the APPROVED line only -> debtor payment reconciled to
 * the factor -> packet assembled -> confirmed send recorded. Proves the services
 * built across Phases 2-12 work together, with money in integer cents throughout.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { tables, putItem, getItem, scan, sendRawEmail } = vi.hoisted(() => {
  const tables: Record<string, any[]> = {};
  return {
    tables,
    putItem: vi.fn(async (table: string, item: any) => {
      const arr = (tables[table] ??= []);
      let pk: string | null = null;
      if ('chargeId' in item) pk = 'chargeId';
      else if ('loadId' in item && 'version' in item && 'policy' in item) pk = 'loadId';
      else if ('carrierId' in item && 'factorEmail' in item && !('submissionId' in item)) pk = 'carrierId';
      if (pk) {
        const idx = arr.findIndex((x) => x[pk!] === item[pk!]);
        if (idx >= 0) { arr[idx] = item; return; }
      }
      arr.push(item);
    }),
    getItem: vi.fn(async (table: string, key: any) => {
      const arr = tables[table] ?? [];
      return arr.find((x) => Object.keys(key).every((k) => x[k] === key[k])) ?? null;
    }),
    scan: vi.fn(async (table: string) => [...(tables[table] ?? [])]),
    sendRawEmail: vi.fn(async () => undefined),
  };
});

vi.mock('../../../src/config/database', () => ({
  Database: { putItem, getItem, scan, updateItem: vi.fn(), deleteItem: vi.fn() },
  default: { putItem, getItem, scan, updateItem: vi.fn(), deleteItem: vi.fn() },
}));
vi.mock('../../../src/utils/logger', () => ({ Logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock('../../../src/services/integrations/email', () => ({ sendRawEmail }));

import config from '../../../src/config/environment';
import { TrailerType } from '../../../src/types';
import { PlatformFeeService } from '../../../src/services/platformFeeService';
import { StopEventService } from '../../../src/services/stopEventService';
import { AccessorialChargeService } from '../../../src/services/accessorialChargeService';
import { InvoicePackageService } from '../../../src/services/invoicePackageService';
import { FactoringAssignmentService } from '../../../src/services/factoringAssignmentService';
import { PayeeRoutingService } from '../../../src/services/payeeRoutingService';
import { NoticeOfAssignmentService } from '../../../src/services/noticeOfAssignmentService';
import { FundingAdvanceService } from '../../../src/services/fundingAdvanceService';
import { ReconciliationService } from '../../../src/services/reconciliationService';
import { FactoringPacketService } from '../../../src/services/factoringPacketService';
import { FactoringSubmissionService } from '../../../src/services/factoringSubmissionService';
import { dollarsToCents } from '../../../src/utils/money';

const STOPS = config.dynamodb.stopEventsTable;
const HOUR = 3600 * 1000;
const load = { loadId: 'load-1', hazmat: false, equipmentType: TrailerType.DRY_VAN };

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  sendRawEmail.mockClear();
});

it('runs the full payments + factoring pipeline end to end', async () => {
  // Phase 2: beta waiver on -> the mover nets the full gross linehaul, 0 take.
  const grossCents = dollarsToCents(1500); // $1,500 linehaul
  const settlement = await PlatformFeeService.computeLinehaulSettlement(grossCents);
  expect(settlement.effectiveTakeRateBps).toBe(0);
  expect(settlement.carrierNetCents).toBe(grossCents);

  // Phase 4: check-in/check-out evidence (3h dwell -> 1h detained -> auto-approve).
  tables[STOPS] = [
    { eventId: 'a1', loadId: 'load-1', stopId: 'PICKUP', eventType: 'ARRIVAL', eventAt: 0, actorId: 'd', createdAt: 0 },
    { eventId: 'd1', loadId: 'load-1', stopId: 'PICKUP', eventType: 'DEPARTURE', eventAt: 3 * HOUR, actorId: 'd', createdAt: 1 },
  ];

  // Phase 5: compute the accessorial; 1h detained at $50/hr auto-approves.
  const charge = await AccessorialChargeService.computeForStop(load, 'PICKUP', 'sys');
  expect(charge!.status).toBe('APPROVED');
  expect(charge!.amountCents).toBe(5000);

  // Phase 8: factoring-ready package, both lines factorable.
  const pkg = InvoicePackageService.build({
    invoiceId: 'inv-1', loadId: 'load-1', carrierId: 'carrier-1',
    debtor: { id: 'shipper-1', name: 'Globex', verified: true },
    mover: { id: 'carrier-1', name: 'Owner Op LLC', verified: true },
    linehaulAmountCents: settlement.carrierNetCents,
    podAttested: true, withinTerms: true, podRef: 'pod-1', rateConfRef: 'rc-1',
    charges: [charge!],
    activeAssignment: null,
  });
  expect(pkg.advanceableTotalCents).toBe(grossCents + 5000);

  // Phase 6/7: assign the invoice to a factor and serve the Notice of Assignment.
  const assignment = await FactoringAssignmentService.create({
    carrierId: 'carrier-1', invoiceId: 'inv-1', factorName: 'Acme Factoring',
    recourseType: 'RECOURSE', scope: 'FULL_INVOICE', payoutDestination: 'acct://acme', actorId: 'mover-1',
  });
  const noa = await NoticeOfAssignmentService.generate({
    assignment, debtor: { debtorId: 'shipper-1', debtorName: 'Globex' }, actorId: 'mover-1', invoiceAmountCents: grossCents,
  });
  const payee = await PayeeRoutingService.resolvePayee({
    carrierId: 'carrier-1', invoiceId: 'inv-1', carrierPayoutDestination: 'acct://mover',
  });
  expect(payee.type).toBe('FACTOR');
  expect(payee.destination).toBe('acct://acme');

  // Phase 10: advance only the APPROVED lines, then reconcile the debtor payment.
  const advance = await FundingAdvanceService.issueAdvance({
    invoiceId: 'inv-1', carrierId: 'carrier-1', lineKind: 'ACCESSORIAL', chargeId: charge!.chargeId,
    chargeStatus: charge!.status, amountCents: charge!.amountCents, payeeType: payee.type,
    destination: payee.destination, providerName: 'manual', recourseType: 'RECOURSE', scope: 'FULL_INVOICE',
    assignmentId: assignment.assignmentId,
  });
  expect(advance.amountCents).toBe(5000);
  const recon = await ReconciliationService.reconcileDebtorPayment({
    invoiceId: 'inv-1', carrierId: 'carrier-1', payee, collectedCents: grossCents + 5000, feeCents: 0,
  });
  expect(recon.find((o) => o.type === 'PAYMENT_ROUTED')!.payeeType).toBe('FACTOR');

  // Phase 11: assemble the combined PDF packet (includes the NoA).
  const packet = await FactoringPacketService.assemble({
    invoiceId: 'inv-1', loadId: 'load-1', carrierId: 'carrier-1', pkg,
    podRef: 'pod-1', rateConfRef: 'rc-1',
    stopEvents: tables[STOPS] as any, notice: noa,
  });
  expect(packet.ok).toBe(true);
  if (!packet.ok) return;
  expect(packet.pdf.subarray(0, 4).toString()).toBe('%PDF');

  // Phase 12: confirmed send to the factor; append-only SENT record.
  const submission = await FactoringSubmissionService.submit({
    carrierId: 'carrier-1', invoiceIds: ['inv-1'], recipientEmail: 'ar@acme.com', confirmed: true,
    manifest: packet.manifest, pdf: packet.pdf, actorId: 'mover-1', moverReplyTo: 'mover@example.com', moverName: 'Owner Op LLC',
  });
  expect(submission.status).toBe('SENT');
  expect(sendRawEmail).toHaveBeenCalledTimes(1);
  const sent = await FactoringSubmissionService.listForInvoice('inv-1');
  expect(sent).toHaveLength(1);
});
