// Factoring routes — /api/factoring
// All routes require authentication. Carrier identity is resolved from the
// authenticated user's OO or org profile.

import express from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { OwnerOperatorService } from '../services/ownerOperatorService';
import { OrgService, OrgMembershipService } from '../services/orgService';
import { OrgRole, OrgCapability } from '../types';
import {
  getFactoringProfile,
  registerByoFactor,
  verifyByoFactor,
  confirmByoRemittance,
  byoReady,
  selectIntegratedPartner,
  releaseCurrentFactor,
} from '../services/factoringProfile';
import { optInToFactoring, resolveInvoicePayee } from '../services/factoring';
import { assertPodComplete } from '../services/pod';
import { body, param } from 'express-validator';
import { validate } from '../middleware/validation';
import { FactorContactService } from '../services/factorContactService';
import { FactoringAssignmentService } from '../services/factoringAssignmentService';
import { NoticeOfAssignmentService } from '../services/noticeOfAssignmentService';
import { PayeeRoutingService } from '../services/payeeRoutingService';
import { InvoicePackageService } from '../services/invoicePackageService';
import { FactoringPacketService } from '../services/factoringPacketService';
import { FactoringSubmissionService } from '../services/factoringSubmissionService';
import { AccessorialChargeService } from '../services/accessorialChargeService';
import { LoadService } from '../services/loadService';
import { PlatformFeeService } from '../services/platformFeeService';
import { StopEventService } from '../services/stopEventService';
import { getChain } from '../services/attestation/signatureService';
import { dollarsToCents } from '../utils/money';

const router = express.Router();
router.use(authenticate);

/**
 * Org roles allowed to act for a carrier org in factoring. Factoring decisions
 * (registering a factor, assignments, export-and-send) bind the ORGANIZATION,
 * so only management may take them: dispatchers and org drivers cannot commit
 * the fleet's receivables. Deprecated aliases resolve as MANAGER (IAM-1).
 */
const FACTORING_ORG_ROLES: ReadonlySet<OrgRole> = new Set<OrgRole>([
  OrgRole.OWNER,
  OrgRole.MANAGER,
  OrgRole.ORG_ADMIN, // deprecated alias of MANAGER
  OrgRole.ADMIN, // deprecated alias of MANAGER
]);

/**
 * Resolve the carrierId the authenticated user acts for. Mirrors the
 * carrier-of-record precedence (services/carrierOfRecord.ts — identity team,
 * consumed here per the payee seam):
 *   1. Owner Operator profile        -> operatorId
 *   2. ACTIVE management membership in a CARRIER-capability org -> orgId
 *   3. Neither                       -> 404 (no carrier to act for)
 * Exported for unit tests.
 */
export async function resolveCarrierIdForUser(userId: string): Promise<string> {
  const profile = await OwnerOperatorService.getByUserId(userId);
  if (profile) return profile.operatorId;

  const memberships = await OrgMembershipService.getMembershipsForUser(userId);
  for (const m of memberships) {
    if (m.status !== 'ACTIVE') continue;
    if (!FACTORING_ORG_ROLES.has(m.orgRole)) continue;
    const org = await OrgService.getOrgById(m.orgId);
    if (org?.capabilities?.includes(OrgCapability.CARRIER)) return org.orgId;
  }

  throw new AppError(
    'No carrier profile: caller is neither an owner operator nor a manager of a carrier organization',
    404
  );
}

async function resolveCarrierId(req: AuthRequest): Promise<string> {
  return resolveCarrierIdForUser(req.user!.userId);
}

// ── Profile (account-level mode) ─────────────────────────────────────────────

// GET /api/factoring/profile
router.get('/profile', asyncHandler(async (req: AuthRequest, res) => {
  const carrierId = await resolveCarrierId(req);
  const profile   = await getFactoringProfile(carrierId);
  res.json({ profile: profile ?? { carrierId, mode: 'NONE' } });
}));

// POST /api/factoring/byo — register a BYO factor
router.post('/byo', asyncHandler(async (req: AuthRequest, res) => {
  const carrierId = await resolveCarrierId(req);
  const { factorName, noaKey, remittanceRef } = req.body;
  if (!factorName || !noaKey || !remittanceRef) {
    throw new AppError('factorName, noaKey, and remittanceRef are required', 400);
  }
  const profile = await registerByoFactor(carrierId, { factorName, noaKey, remittanceRef });
  res.status(201).json({ profile });
}));

// POST /api/factoring/byo/verify — trigger KYB on the BYO factor (Didit)
router.post('/byo/verify', asyncHandler(async (req: AuthRequest, res) => {
  const carrierId = await resolveCarrierId(req);
  await verifyByoFactor(carrierId);
  res.json({ ok: true });
}));

// POST /api/factoring/byo/confirm-remittance — ops confirms remittance out-of-band
router.post('/byo/confirm-remittance', asyncHandler(async (req: AuthRequest, res) => {
  const carrierId = await resolveCarrierId(req);
  await confirmByoRemittance(carrierId);
  res.json({ ok: true });
}));

// GET /api/factoring/byo/ready — is BYO assignment fully operational?
router.get('/byo/ready', asyncHandler(async (req: AuthRequest, res) => {
  const carrierId = await resolveCarrierId(req);
  const ready     = await byoReady(carrierId);
  res.json({ ready });
}));

// POST /api/factoring/partner — select an integrated partner
router.post('/partner', asyncHandler(async (req: AuthRequest, res) => {
  const carrierId = await resolveCarrierId(req);
  const { partnerId } = req.body;
  if (!partnerId) throw new AppError('partnerId is required', 400);
  const profile = await selectIntegratedPartner(carrierId, partnerId);
  res.status(201).json({ profile });
}));

// POST /api/factoring/release — release current assignment (required before switching)
router.post('/release', asyncHandler(async (req: AuthRequest, res) => {
  const carrierId = await resolveCarrierId(req);
  const { letterOfReleaseKey } = req.body;
  if (!letterOfReleaseKey) throw new AppError('letterOfReleaseKey is required', 400);
  const profile = await releaseCurrentFactor(carrierId, letterOfReleaseKey);
  res.json({ profile });
}));

// ── Per-load integrated opt-in ────────────────────────────────────────────────

// POST /api/factoring/loads/:loadId/opt-in — opt a delivered load into integrated factoring
router.post('/loads/:loadId/opt-in', asyncHandler(async (req: AuthRequest, res) => {
  const carrierId = await resolveCarrierId(req);
  const optIn     = await optInToFactoring(req.params.loadId, carrierId);
  res.status(201).json({ optIn });
}));

// GET /api/factoring/loads/:loadId/payee — who receives the invoice payment?
router.get('/loads/:loadId/payee', asyncHandler(async (req: AuthRequest, res) => {
  const result = await resolveInvoicePayee(req.params.loadId);
  res.json(result);
}));

// GET /api/factoring/loads/:loadId/pod — check POD completeness for a load
router.get('/loads/:loadId/pod', asyncHandler(async (req: AuthRequest, res) => {
  const result = await assertPodComplete(req.params.loadId);
  res.json(result);
}));

// ── v3 pipeline: saved factor contact, assignments, invoice package, export ───
// The invoice is the load in this system, so :invoiceId is a loadId. Payment
// terms and verification states are best-effort here (assumed within terms /
// verified) pending deeper wiring; the POD-attested and charge-status gates in
// InvoicePackageService still hold.

// Compute the mover's net linehaul, in integer cents, routed through the fee.
function loadLinehaulGrossCents(load: any): number {
  const dollars =
    load.rateType === 'PER_MILE'
      ? load.totalMiles
        ? load.rateAmount * load.totalMiles
        : 0
      : load.rateAmount ?? 0;
  return dollarsToCents(dollars);
}

async function buildPackageForInvoice(invoiceId: string, carrierId: string) {
  const load = await LoadService.getLoadById(invoiceId);
  if (!load) throw new AppError(`Load ${invoiceId} not found`, 404);
  const settlement = await PlatformFeeService.computeLinehaulSettlement(loadLinehaulGrossCents(load));
  const charges = await AccessorialChargeService.listForLoad(invoiceId);
  const activeAssignment = await FactoringAssignmentService.getActiveAssignment(carrierId, invoiceId);
  const chain = await getChain(invoiceId).catch(() => [] as any[]);
  const deliver = chain.find((s: any) => s.action === 'DRIVER_DELIVER');
  const podAttested = !!deliver || chain.some((s: any) => s.action === 'RECEIVER_CONFIRM');
  const pkg = InvoicePackageService.build({
    invoiceId,
    loadId: invoiceId,
    carrierId,
    debtor: { id: load.shipperId, verified: true },
    mover: { id: carrierId, verified: true },
    linehaulAmountCents: settlement.carrierNetCents,
    podAttested,
    withinTerms: true,
    ...(deliver ? { podRef: deliver.signatureId } : {}),
    rateConfRef: `rateconf:${invoiceId}`,
    charges,
    activeAssignment,
  });
  return { load, pkg, podRef: deliver?.signatureId as string | undefined, activeAssignment };
}

// GET /api/factoring/contact — the saved factor contact
router.get('/contact', asyncHandler(async (req: AuthRequest, res) => {
  const carrierId = await resolveCarrierId(req);
  res.json({ contact: await FactorContactService.get(carrierId) });
}));

// PUT /api/factoring/contact — save/update the saved factor contact
router.put(
  '/contact',
  validate([
    body('factorName').isString().isLength({ min: 1, max: 200 }),
    body('factorEmail').isString().isLength({ min: 3, max: 320 }),
  ]),
  asyncHandler(async (req: AuthRequest, res) => {
    const carrierId = await resolveCarrierId(req);
    const contact = await FactorContactService.save(carrierId, {
      factorName: req.body.factorName,
      factorEmail: req.body.factorEmail,
    });
    res.status(201).json({ contact });
  })
);

// POST /api/factoring/assignments — create an assignment (+ Notice of Assignment)
router.post(
  '/assignments',
  validate([
    body('invoiceId').optional().isString().isLength({ min: 1, max: 200 }),
    body('factorName').isString().isLength({ min: 1, max: 200 }),
    body('factorContact').optional().isString().isLength({ max: 320 }),
    body('recourseType').isString().isIn(['RECOURSE', 'NON_RECOURSE']),
    body('scope').optional().isString().isIn(['FULL_INVOICE', 'LINEHAUL_ONLY']),
    body('payoutDestination').isString().isLength({ min: 1, max: 500 }),
    body('debtorId').optional().isString().isLength({ max: 200 }),
    body('debtorName').optional().isString().isLength({ max: 200 }),
  ]),
  asyncHandler(async (req: AuthRequest, res) => {
    const carrierId = await resolveCarrierId(req);
    const assignment = await FactoringAssignmentService.create({
      carrierId,
      invoiceId: req.body.invoiceId,
      factorName: req.body.factorName,
      factorContact: req.body.factorContact,
      recourseType: req.body.recourseType,
      scope: req.body.scope,
      payoutDestination: req.body.payoutDestination,
      actorId: req.user!.userId,
    });
    let notice = null;
    if (req.body.debtorId) {
      notice = await NoticeOfAssignmentService.generate({
        assignment,
        debtor: { debtorId: req.body.debtorId, debtorName: req.body.debtorName },
        actorId: req.user!.userId,
      });
    }
    res.status(201).json({ assignment, notice });
  })
);

// GET /api/factoring/assignments — the mover's assignment history
router.get('/assignments', asyncHandler(async (req: AuthRequest, res) => {
  const carrierId = await resolveCarrierId(req);
  const assignments = await FactoringAssignmentService.listForCarrier(carrierId);
  res.json({ assignments, count: assignments.length });
}));

// POST /api/factoring/assignments/:assignmentId/release
router.post(
  '/assignments/:assignmentId/release',
  validate([param('assignmentId').isString().isLength({ min: 1, max: 200 })]),
  asyncHandler(async (req: AuthRequest, res) => {
    const released = await FactoringAssignmentService.release(req.params.assignmentId, req.user!.userId);
    res.json({ released });
  })
);

// GET /api/factoring/invoices/:invoiceId/payee — who receives payment (v3 resolver)
router.get(
  '/invoices/:invoiceId/payee',
  validate([param('invoiceId').isString().isLength({ min: 1, max: 200 })]),
  asyncHandler(async (req: AuthRequest, res) => {
    const carrierId = await resolveCarrierId(req);
    const payee = await PayeeRoutingService.resolvePayee({
      carrierId,
      invoiceId: req.params.invoiceId,
      carrierPayoutDestination: `acct:${carrierId}`,
    });
    res.json({ payee });
  })
);

// GET /api/factoring/invoices/:invoiceId/package — factoring-ready package per line
router.get(
  '/invoices/:invoiceId/package',
  validate([param('invoiceId').isString().isLength({ min: 1, max: 200 })]),
  asyncHandler(async (req: AuthRequest, res) => {
    const carrierId = await resolveCarrierId(req);
    const { pkg } = await buildPackageForInvoice(req.params.invoiceId, carrierId);
    res.json({ package: pkg });
  })
);

// POST /api/factoring/export — assemble the packet, review, and (on confirm) send.
// Without confirmed:true this returns the manifest + resolved recipient for the
// review step and sends nothing. With confirmed:true it sends to the confirmed
// recipient only, on the authenticated domain, and records the submission.
router.post(
  '/export',
  validate([
    body('invoiceId').isString().isLength({ min: 1, max: 200 }),
    body('recipientEmail').optional().isString().isLength({ max: 320 }),
    body('confirmed').optional().isBoolean(),
    body('moverReplyTo').optional().isString().isLength({ max: 320 }),
    body('moverName').optional().isString().isLength({ max: 200 }),
    body('saveContact').optional().isObject(),
  ]),
  asyncHandler(async (req: AuthRequest, res) => {
    const carrierId = await resolveCarrierId(req);
    const invoiceId = req.body.invoiceId;
    const { pkg, podRef, activeAssignment } = await buildPackageForInvoice(invoiceId, carrierId);
    const notice = activeAssignment
      ? await NoticeOfAssignmentService.getForAssignment(activeAssignment.assignmentId)
      : null;
    const stopEvents = await StopEventService.list(invoiceId);
    const packet = await FactoringPacketService.assemble({
      invoiceId,
      loadId: invoiceId,
      carrierId,
      pkg,
      ...(podRef ? { podRef } : {}),
      rateConfRef: `rateconf:${invoiceId}`,
      stopEvents,
      notice,
    });
    if (!packet.ok) {
      return res.status(422).json({ ok: false, missing: packet.missing });
    }

    // Recipient comes only from the mover (typed here, or the saved contact).
    const recipient = await FactoringSubmissionService.resolveRecipient(carrierId, req.body.recipientEmail);
    if (!recipient) {
      throw new AppError('A valid recipient email is required (typed or a saved factor contact)', 400);
    }

    // Nothing is sent until the mover explicitly confirms. Return the review view.
    if (req.body.confirmed !== true) {
      return res.json({ ok: true, requiresConfirmation: true, manifest: packet.manifest, recipient });
    }

    const submission = await FactoringSubmissionService.submit({
      carrierId,
      invoiceIds: [invoiceId],
      recipientEmail: recipient,
      confirmed: true,
      manifest: packet.manifest,
      pdf: packet.pdf,
      actorId: req.user!.userId,
      moverReplyTo: req.body.moverReplyTo,
      moverName: req.body.moverName,
      saveContact: req.body.saveContact,
    });
    res.status(201).json({ ok: true, submission });
  })
);

// GET /api/factoring/submissions — the disclosure trail (submitted to your factor)
router.get('/submissions', asyncHandler(async (req: AuthRequest, res) => {
  const carrierId = await resolveCarrierId(req);
  const submissions = await FactoringSubmissionService.listForCarrier(carrierId);
  res.json({ submissions, count: submissions.length });
}));

export default router;
