/**
 * Platform-admin compliance/oversight routes - /api/admin/compliance
 *
 * Every surface is gated by the specific compliance role (least privilege +
 * separation); grant management is STAFF_ADMIN. Sensitive reads (discrepancy
 * scan, case file, audit log) are audited. The services enforce append-only,
 * fail-closed audit, counsel gating, and legal holds; the routes only translate
 * HTTP to those services.
 */

import express from 'express';
import { body, param, query } from 'express-validator';
import { authenticate, requireStaffTier, requireComplianceRole, AuthRequest } from '../middleware/auth';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { validate } from '../middleware/validation';
import { PlatformRole } from '../types/platformRole';
import { ComplianceRole, ALL_COMPLIANCE_ROLES } from '../types/complianceRole';
import { ComplianceRoleService } from '../services/complianceRoleService';
import { AdminAuditService } from '../services/adminAuditService';
import { detectDiscrepancies } from '../services/discrepancyDetector';
import { AdjudicationService } from '../services/adjudicationService';
import { LegalHoldService } from '../services/legalHoldService';
import { CaseFileService } from '../services/caseFileService';
import { LawEnforcementService, LE_REQUEST_TYPES } from '../services/lawEnforcementService';
import { PayoutInterceptService } from '../services/payoutInterceptService';
import { gatherForLoad, gatherCaseFileRecords } from '../services/complianceGather';

const router = express.Router();
router.use(authenticate);

// ── Grant management (STAFF_ADMIN) ──────────────────────────────────────────
router.post(
  '/grants',
  requireStaffTier(PlatformRole.STAFF_ADMIN),
  validate([body('userId').isString().isLength({ min: 1, max: 200 }), body('role').isString().isIn(ALL_COMPLIANCE_ROLES)]),
  asyncHandler(async (req: AuthRequest, res) => {
    await AdminAuditService.record({ actorId: req.user!.userId, actorRole: 'STAFF_ADMIN', action: 'GRANT_COMPLIANCE_ROLE', targetRefs: [req.body.userId], reason: req.body.role });
    const grant = await ComplianceRoleService.grant(req.user!.userId, req.body.userId, req.body.role as ComplianceRole);
    res.status(201).json({ grant });
  })
);
router.delete(
  '/grants/:userId/:role',
  requireStaffTier(PlatformRole.STAFF_ADMIN),
  validate([param('userId').isString(), param('role').isIn(ALL_COMPLIANCE_ROLES)]),
  asyncHandler(async (req: AuthRequest, res) => {
    await AdminAuditService.record({ actorId: req.user!.userId, actorRole: 'STAFF_ADMIN', action: 'REVOKE_COMPLIANCE_ROLE', targetRefs: [req.params.userId], reason: req.params.role });
    const grant = await ComplianceRoleService.revoke(req.user!.userId, req.params.userId, req.params.role as ComplianceRole);
    res.json({ grant });
  })
);
router.get(
  '/grants/:userId',
  requireStaffTier(PlatformRole.STAFF_ADMIN),
  asyncHandler(async (req: AuthRequest, res) => {
    res.json({ userId: req.params.userId, roles: await ComplianceRoleService.getRoles(req.params.userId) });
  })
);

// ── Dispute + discrepancy review (DISPUTE_ADMIN) ────────────────────────────
router.get(
  '/discrepancies/:loadId',
  requireComplianceRole(ComplianceRole.DISPUTE_ADMIN),
  validate([param('loadId').isString().isLength({ min: 1, max: 200 })]),
  asyncHandler(async (req: AuthRequest, res) => {
    // Sensitive read: audit first (fail closed), then scan.
    const findings = await AdminAuditService.withAudit(
      { actorId: req.user!.userId, actorRole: ComplianceRole.DISPUTE_ADMIN, action: 'SCAN_DISCREPANCIES', targetRefs: [req.params.loadId] },
      async () => detectDiscrepancies(await gatherForLoad(req.params.loadId))
    );
    res.json({ loadId: req.params.loadId, findings, count: findings.length });
  })
);
router.post(
  '/adjudicate',
  requireComplianceRole(ComplianceRole.DISPUTE_ADMIN),
  validate([
    body('targetType').isIn(['CHARGE_DISPUTE', 'RECOURSE_BUYBACK', 'DISCREPANCY']),
    body('targetId').isString().isLength({ min: 1, max: 300 }),
    body('action').isIn(['UPHOLD', 'REVERSE', 'ADJUST', 'ESCALATE']),
    body('reason').isString().isLength({ min: 1, max: 2000 }),
    body('invoiceId').optional().isString(),
    body('carrierId').optional().isString(),
    body('compensation').optional().isObject(),
  ]),
  asyncHandler(async (req: AuthRequest, res) => {
    const adjudication = await AdjudicationService.adjudicate({
      actorId: req.user!.userId,
      targetType: req.body.targetType,
      targetId: req.body.targetId,
      action: req.body.action,
      reason: req.body.reason,
      invoiceId: req.body.invoiceId,
      carrierId: req.body.carrierId,
      compensation: req.body.compensation,
    });
    res.status(201).json({ adjudication });
  })
);

// ── Legal records + holds (LEGAL_ADMIN) ─────────────────────────────────────
const holdValidators = [
  body('entityType').isString().isLength({ min: 1, max: 40 }),
  body('entityId').isString().isLength({ min: 1, max: 200 }),
  body('reason').isString().isLength({ min: 1, max: 2000 }),
  body('authorityRef').optional().isString().isLength({ max: 300 }),
];
router.post('/holds', requireComplianceRole(ComplianceRole.LEGAL_ADMIN), validate(holdValidators), asyncHandler(async (req: AuthRequest, res) => {
  const hold = await LegalHoldService.placeHold({ ...req.body, actorId: req.user!.userId });
  res.status(201).json({ hold });
}));
router.post('/holds/release', requireComplianceRole(ComplianceRole.LEGAL_ADMIN), validate(holdValidators), asyncHandler(async (req: AuthRequest, res) => {
  const hold = await LegalHoldService.releaseHold({ ...req.body, actorId: req.user!.userId });
  res.status(201).json({ hold });
}));
router.get('/holds', requireComplianceRole(ComplianceRole.LEGAL_ADMIN), asyncHandler(async (req: AuthRequest, res) => {
  const entityType = req.query.entityType ? String(req.query.entityType) : undefined;
  const entityId = req.query.entityId ? String(req.query.entityId) : undefined;
  res.json({ holds: await LegalHoldService.listHolds({ entityType, entityId }) });
}));
router.get(
  '/case-file/:loadId',
  requireComplianceRole(ComplianceRole.LEGAL_ADMIN),
  validate([param('loadId').isString().isLength({ min: 1, max: 200 })]),
  asyncHandler(async (req: AuthRequest, res) => {
    const caseFile = await AdminAuditService.withAudit(
      { actorId: req.user!.userId, actorRole: ComplianceRole.LEGAL_ADMIN, action: 'READ_CASE_FILE', targetRefs: [req.params.loadId] },
      async () => CaseFileService.assemble('LOAD', req.params.loadId, await gatherCaseFileRecords(req.params.loadId))
    );
    res.json({ caseFile, integrity: CaseFileService.verifyIntegrity(caseFile) });
  })
);

// ── Law enforcement (LAW_ENFORCEMENT_LIAISON, counsel-gated) ─────────────────
router.post(
  '/le/requests',
  requireComplianceRole(ComplianceRole.LAW_ENFORCEMENT_LIAISON),
  validate([
    body('type').isIn(LE_REQUEST_TYPES),
    body('issuingAuthority').isString().isLength({ min: 1, max: 300 }),
    body('receivedDate').isString().isLength({ min: 1, max: 40 }),
    body('describedScope').isString().isLength({ min: 1, max: 4000 }),
    body('scopeEntities').isArray({ min: 1 }),
    body('nonDisclosure').optional().isBoolean(),
    body('nonDisclosureBasis').optional().isString().isLength({ max: 500 }),
  ]),
  asyncHandler(async (req: AuthRequest, res) => {
    const intake = await LawEnforcementService.intake({ ...req.body, actorId: req.user!.userId });
    res.status(201).json({ intake });
  })
);
router.post(
  '/le/requests/:requestId/counsel-signoff',
  requireComplianceRole(ComplianceRole.LAW_ENFORCEMENT_LIAISON),
  validate([
    param('requestId').isString(),
    body('counselId').isString().isLength({ min: 1, max: 200 }),
    body('validityDetermination').isIn(['VALID', 'INVALID', 'VALID_IN_PART']),
    body('note').optional().isString().isLength({ max: 2000 }),
  ]),
  asyncHandler(async (req: AuthRequest, res) => {
    const signOff = await LawEnforcementService.recordCounselSignOff({ requestId: req.params.requestId, ...req.body, actorId: req.user!.userId });
    res.status(201).json({ signOff });
  })
);
router.post(
  '/le/requests/:requestId/disclose',
  requireComplianceRole(ComplianceRole.LAW_ENFORCEMENT_LIAISON),
  validate([param('requestId').isString(), body('recipient').isString().isLength({ min: 1, max: 300 }), body('recordRefs').isArray({ min: 1 })]),
  asyncHandler(async (req: AuthRequest, res) => {
    try {
      const disclosure = await LawEnforcementService.discloseScoped({ requestId: req.params.requestId, recipient: req.body.recipient, recordRefs: req.body.recordRefs, actorId: req.user!.userId });
      res.status(201).json({ disclosure });
    } catch (e: any) {
      if (String(e?.message).includes('DISCLOSURE_BLOCKED')) throw new AppError('Disclosure blocked: counsel sign-off is required first', 409);
      throw e;
    }
  })
);
router.get(
  '/le/requests/:requestId',
  requireComplianceRole(ComplianceRole.LAW_ENFORCEMENT_LIAISON),
  asyncHandler(async (req: AuthRequest, res) => {
    const intake = await LawEnforcementService.getIntake(req.params.requestId);
    if (!intake) throw new AppError('Request not found', 404);
    res.json({ intake, disclosures: await LawEnforcementService.disclosuresForRequest(req.params.requestId) });
  })
);
router.post(
  '/intercepts',
  requireComplianceRole(ComplianceRole.LAW_ENFORCEMENT_LIAISON),
  validate([
    body('requestId').isString(),
    body('targetType').isIn(['CARRIER', 'INVOICE']),
    body('targetId').isString(),
    body('carrierId').isString(),
    body('instrumentRef').isString().isLength({ min: 1, max: 300 }),
    body('amountCents').optional().isInt({ min: 1 }),
    body('percentageBps').optional().isInt({ min: 1, max: 10000 }),
    body('priority').optional().isInt({ min: 0 }),
    body('instruction').isIn(['HOLD', 'REDIRECT']),
    body('redirectTo').optional().isString().isLength({ max: 300 }),
  ]),
  asyncHandler(async (req: AuthRequest, res) => {
    const intercept = await PayoutInterceptService.create({ ...req.body, actorId: req.user!.userId });
    res.status(201).json({ intercept });
  })
);
router.get(
  '/intercepts',
  requireComplianceRole(ComplianceRole.LAW_ENFORCEMENT_LIAISON),
  validate([query('invoiceId').isString(), query('carrierId').isString()]),
  asyncHandler(async (req: AuthRequest, res) => {
    res.json({ intercepts: await PayoutInterceptService.activeFor(String(req.query.invoiceId), String(req.query.carrierId)) });
  })
);

// ── Admin audit log (LEGAL_ADMIN) ───────────────────────────────────────────
router.get(
  '/audit',
  requireComplianceRole(ComplianceRole.LEGAL_ADMIN),
  asyncHandler(async (req: AuthRequest, res) => {
    const targetRef = req.query.targetRef ? String(req.query.targetRef) : undefined;
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 100;
    const entries = await AdminAuditService.withAudit(
      { actorId: req.user!.userId, actorRole: ComplianceRole.LEGAL_ADMIN, action: 'READ_ADMIN_AUDIT', ...(targetRef ? { targetRefs: [targetRef] } : {}) },
      async () => AdminAuditService.list({ targetRef, limit })
    );
    res.json({ entries, count: entries.length });
  })
);

export default router;
