import express from 'express';
import { DriverService } from '../services/driverService';
import { ShipperService } from '../services/shipperService';
import { LoadService } from '../services/loadService';
import { CapacityService } from '../services/capacityService';
import { authenticate, requireAdmin, AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { TrackingService } from '../services/trackingService';
import { RoutingService } from '../services/routingService';
import { OrgService, OrgMembershipService, OrgAuditService } from '../services/orgService';
import { Database } from '../config/database';
import { docClient } from '../config/aws';
import { ScanCommand } from '@aws-sdk/lib-dynamodb';
import config from '../config/environment';
import { DriverStatus, OrgRole, UserRole, type Organization } from '../types';
import { GeolocationService } from '../services/geolocationService';
import { EquipmentService, deriveLoadingRequirements } from '../services/equipmentService';
import { Helpers } from '../utils/helpers';
import {
  getReviewQueue,
  adminOverride,
  VerificationStatus,
} from '../services/verification';

const router = express.Router();

// All routes require admin authentication
router.use(authenticate);
router.use(requireAdmin);

// GET /api/admin/drivers
router.get('/drivers', asyncHandler(async (req: AuthRequest, res) => {
  const { status } = req.query;
  
  let drivers;
  if (status) {
    drivers = await DriverService.getDriversByStatus(status as any);
  } else {
    // Get all drivers (you'd need to implement this in DriverService)
    drivers = await DriverService.getDriversByStatus('PENDING_VERIFICATION' as any);
  }
  
  res.json({ drivers });
}));

// GET /api/admin/drivers/:driverId
router.get('/drivers/:driverId', asyncHandler(async (req: AuthRequest, res) => {
  const { driverId } = req.params;
  const driver = await DriverService.getProfileById(driverId);
  
  res.json({ driver });
}));

// POST /api/admin/drivers/:driverId/verify
router.post('/drivers/:driverId/verify', asyncHandler(async (req: AuthRequest, res) => {
  const { driverId } = req.params;
  
  await DriverService.verifyDriver(driverId);
  res.json({ message: 'Driver verified successfully' });
}));

// POST /api/admin/drivers/:driverId/suspend
router.post('/drivers/:driverId/suspend', asyncHandler(async (req: AuthRequest, res) => {
  const { driverId } = req.params;
  
  await DriverService.suspendDriver(driverId);
  res.json({ message: 'Driver suspended successfully' });
}));

// GET /api/admin/shippers/admin-requests
router.get('/shippers/admin-requests', asyncHandler(async (req: AuthRequest, res) => {
  const requests = await ShipperService.getPendingAdminRequests();
  res.json({ requests });
}));

// POST /api/admin/shippers/:shipperId/approve-admin
router.post('/shippers/:shipperId/approve-admin', asyncHandler(async (req: AuthRequest, res) => {
  const { shipperId } = req.params;
  
  await ShipperService.approveAdminPrivileges(shipperId);
  res.json({ message: 'Shipper admin privileges approved' });
}));

// POST /api/admin/shippers/:shipperId/revoke-admin
router.post('/shippers/:shipperId/revoke-admin', asyncHandler(async (req: AuthRequest, res) => {
  const { shipperId } = req.params;
  
  await ShipperService.revokeAdminPrivileges(shipperId);
  res.json({ message: 'Shipper admin privileges revoked' });
}));

// GET /api/admin/loads
router.get('/loads', asyncHandler(async (req: AuthRequest, res) => {
  const { status } = req.query;
  
  let loads;
  if (status) {
    loads = await LoadService.getLoadsByStatus(status as any);
  } else {
    // Get all open loads
    loads = await LoadService.getLoadsByStatus('OPEN' as any);
  }
  
  res.json({ loads });
}));

// GET /api/admin/loads/:loadId
router.get('/loads/:loadId', asyncHandler(async (req: AuthRequest, res) => {
  const { loadId } = req.params;
  const load = await LoadService.getLoadById(loadId);
  
  let tracking: any = null;

      if (load?.assignedDriverId) {
        try {
          const driver = await DriverService.getProfileById(load.assignedDriverId);

          const hasDriverCoords = driver?.currentLat && driver?.currentLng;
          const hasDeliveryCoords = load?.deliveryLat && load?.deliveryLng;

          let eta = null;
          if (hasDriverCoords && hasDeliveryCoords) {
            eta = await RoutingService.distanceMatrixMilesAndDuration(
              { lat: driver.currentLat, lng: driver.currentLng },
              { lat: load.deliveryLat, lng: load.deliveryLng }
            );
          }

          tracking = {
            driverLocation: hasDriverCoords ? {
              driverId: driver.driverId,
              lat: driver.currentLat,
              lng: driver.currentLng,
              city: driver.currentCity || null,
              state: driver.currentState || null,
              updatedAt: driver.lastLocationUpdate || null,
            } : null,
            etaToDelivery: eta ? {
              miles: Math.round((eta.miles || 0) * 10) / 10,
              durationSeconds: eta.durationSeconds,
              durationText: eta.durationText,
            } : null,
          };
        } catch (e) {}
      }

      res.json({ load, tracking });
}));

// PUT /api/admin/loads/:loadId/status
router.put('/loads/:loadId/status', asyncHandler(async (req: AuthRequest, res) => {
  const { loadId } = req.params;
  const { status } = req.body;
  
  await LoadService.updateLoadStatus(loadId, status);
  res.json({ message: 'Load status updated successfully' });
}));

// PATCH /api/admin/drivers/:driverId/buffer — admin sets a driver's safety buffer %
router.patch('/drivers/:driverId/buffer', asyncHandler(async (req: AuthRequest, res) => {
  const { driverId } = req.params;
  const { safetyBufferPct } = req.body;
  if (safetyBufferPct === undefined) return res.status(400).json({ error: 'safetyBufferPct is required' });

  const { overBuffer } = await CapacityService.updateDriverBuffer(
    driverId,
    Number(safetyBufferPct),
    req.user!.userId,
    req.user!.role,
    DriverService,
  );

  res.json({
    message: `Buffer updated to ${safetyBufferPct}%`,
    overBuffer,
    ...(overBuffer && {
      alert: 'This driver is now Over Buffer. They are blocked from accepting new loads until resolved.',
    }),
  });
}));

// GET /api/admin/drivers/:driverId/buffer — get current buffer + audit trail
router.get('/drivers/:driverId/buffer', asyncHandler(async (req: AuthRequest, res) => {
  const { driverId } = req.params;
  const driver = await DriverService.getProfileById(driverId);
  if (!driver) return res.status(404).json({ error: 'Driver not found' });
  const bufferPct = driver.safetyBufferPct ?? 10;
  const setByRole = driver.bufferSetByRole ?? 'ADMIN';
  res.json({
    safetyBufferPct: bufferPct,
    overBufferFlag: driver.overBufferFlag ?? false,
    maxCapacityLbs: driver.maxCapacityLbs,
    maxOperationalLbs: driver.maxCapacityLbs * (1 - (bufferPct / 100)),
    currentLoadLbs: driver.currentLoadLbs,
    bufferSetBy: driver.bufferSetBy,
    bufferSetByRole: setByRole,
    // Human-readable message per spec §5.1
    bufferSetByMessage: setByRole === 'OWNER'
      ? 'Safety buffer set by your owner.'
      : 'Safety buffer set by your admin.',
  });
}));

// GET /api/admin/loads/:loadId/tracking
router.get('/loads/:loadId/tracking', asyncHandler(async (req: AuthRequest, res) => {
  const { loadId } = req.params;
  const tracking = await TrackingService.getLoadTrackingForAdmin(loadId);
  res.json(tracking);
}));

// GET /api/admin/debug/broadcast/:loadId — trace why drivers are or aren't matched
router.get('/debug/broadcast/:loadId', asyncHandler(async (req: AuthRequest, res) => {
  const { loadId } = req.params;
  const load = await LoadService.getLoadById(loadId);
  if (!load) return res.status(404).json({ error: 'Load not found' });

  const verifiedDrivers = await DriverService.getDriversByStatus(DriverStatus.VERIFIED);
  const availableDrivers = await DriverService.getDriversByStatus(DriverStatus.AVAILABLE);
  const allDrivers = [...verifiedDrivers, ...availableDrivers];

  const loadWithDerived = {
    ...load,
    derivedLoadingRequirements: load.derivedLoadingRequirements
      ?? deriveLoadingRequirements(undefined, undefined),
  };

  const trace = allDrivers.map(driver => {
    const distanceMiles = GeolocationService.calculateDistance(
      load.pickupLat, load.pickupLng, driver.currentLat, driver.currentLng
    );
    const inRadius = distanceMiles <= load.broadcastRadiusMiles;
    const equipCheck = EquipmentService.checkEquipmentMatch(driver, loadWithDerived as any);
    const mcMaturityDays = Helpers.calculateMcMaturityDays(driver.authorityStartDate);
    const cargoOk = driver.cargoInsuranceAmount >= load.minCargoInsurance;
    const liabilityOk = driver.liabilityInsuranceAmount >= load.minLiabilityInsurance;
    const mcOk = mcMaturityDays >= load.minMcMaturityDays;
    const expOk = (driver.experienceYears ?? 0) >= (load.experienceRequired ?? 0);
    return {
      driverId: driver.driverId,
      status: driver.status,
      trailerType: driver.trailerType,
      currentLat: driver.currentLat,
      currentLng: driver.currentLng,
      distanceMiles,
      inRadius,
      equipCheck,
      mcMaturityDays,
      mcOk,
      cargoInsurance: driver.cargoInsuranceAmount,
      cargoOk,
      liabilityInsurance: driver.liabilityInsuranceAmount,
      liabilityOk,
      experienceYears: driver.experienceYears,
      expOk,
    };
  });

  res.json({
    load: {
      loadId, status: load.status, equipmentType: load.equipmentType,
      acceptedEquipmentTypes: load.acceptedEquipmentTypes,
      pickupLat: load.pickupLat, pickupLng: load.pickupLng,
      broadcastRadiusMiles: load.broadcastRadiusMiles,
      minMcMaturityDays: load.minMcMaturityDays,
      minCargoInsurance: load.minCargoInsurance,
      minLiabilityInsurance: load.minLiabilityInsurance,
      derivedLoadingRequirements: loadWithDerived.derivedLoadingRequirements,
    },
    totalDriversScanned: allDrivers.length,
    driverTrace: trace,
  });
}));

// ── Carrier verification queue ────────────────────────────────────────────────

// GET /api/admin/verifications?status=PENDING|REJECTED|EXPIRED
router.get('/verifications', asyncHandler(async (req: AuthRequest, res) => {
  const status = (req.query.status as VerificationStatus) ?? VerificationStatus.PENDING;
  const queue  = await getReviewQueue(status);
  res.json({ verifications: queue, count: queue.length });
}));

// POST /api/admin/verifications/:entityId/approve
router.post('/verifications/:entityId/approve', asyncHandler(async (req: AuthRequest, res) => {
  const v = await adminOverride(req.params.entityId, 'approve');
  res.json({ verification: v });
}));

// POST /api/admin/verifications/:entityId/reject
router.post('/verifications/:entityId/reject', asyncHandler(async (req: AuthRequest, res) => {
  const v = await adminOverride(req.params.entityId, 'reject');
  res.json({ verification: v });
}));

// ─── Platform override (LoadLead_Admin_Carrier_IAM_Spec.md §5) ──────────────
// Every route below: exact-ADMIN gated (via the router.use(requireAdmin) at
// the top of the file), requires a `reason`, audit-logs via OrgAuditService.

/**
 * GET /api/admin/orgs?status=active|suspended&limit=50&cursor=...
 * Paginated list of every Organization with member count + suspension state.
 */
router.get('/orgs', asyncHandler(async (req: AuthRequest, res) => {
  const status = String(req.query.status ?? 'all').toLowerCase();
  const limit  = Math.min(200, Math.max(1, parseInt(String(req.query.limit ?? '50'), 10) || 50));
  const cursor = req.query.cursor as string | undefined;

  // DynamoDB scan with optional pagination. Filter happens after the page
  // pull, which is fine for the moderate size of the orgs table.
  const result = await docClient.send(new ScanCommand({
    TableName: config.dynamodb.orgsTable,
    Limit: limit,
    ExclusiveStartKey: cursor ? { orgId: cursor } : undefined,
  }));

  let items = (result.Items ?? []) as Organization[];
  if (status === 'suspended') items = items.filter((o) => o.suspended === true);
  if (status === 'active')    items = items.filter((o) => !o.suspended);

  // Enrich with member count. Parallelize but cap fan-out.
  const enriched = await Promise.all(items.slice(0, limit).map(async (o) => {
    const members = await OrgMembershipService.getMembersOfOrg(o.orgId).catch(() => []);
    return {
      orgId: o.orgId,
      legalName: o.legalName,
      dba: o.dba,
      capabilities: o.capabilities,
      suspended: o.suspended === true,
      suspendedAt: o.suspendedAt ?? null,
      suspendedBy: o.suspendedBy ?? null,
      memberCount: members.length,
      ownerUserId: members.find((m) => m.orgRole === OrgRole.OWNER)?.userId ?? null,
      createdAt: o.createdAt,
    };
  }));

  res.json({
    items: enriched,
    nextCursor: result.LastEvaluatedKey?.orgId ?? null,
  });
}));

function requireReason(req: AuthRequest, res: any): string | null {
  const reason = String(req.body?.reason ?? '').trim();
  if (reason.length < 6) {
    res.status(400).json({ error: 'reason is required (at least 6 characters)' });
    return null;
  }
  return reason;
}

/** POST /api/admin/orgs/:orgId/suspend  body { reason } */
router.post('/orgs/:orgId/suspend', asyncHandler(async (req: AuthRequest, res) => {
  const reason = requireReason(req, res);
  if (!reason) return;
  await OrgService.suspendOrg(req.params.orgId, req.user!.userId, reason);
  res.json({ ok: true, orgId: req.params.orgId, suspended: true });
}));

/** POST /api/admin/orgs/:orgId/reinstate  body { reason } */
router.post('/orgs/:orgId/reinstate', asyncHandler(async (req: AuthRequest, res) => {
  const reason = requireReason(req, res);
  if (!reason) return;
  await OrgService.reinstateOrg(req.params.orgId, req.user!.userId);
  await OrgAuditService.log({
    orgId: req.params.orgId,
    targetUserId: req.params.orgId,
    actorUserId: req.user!.userId,
    actorRole: UserRole.ADMIN,
    action: 'ORG_REINSTATED',
    newValue: reason,
  });
  res.json({ ok: true, orgId: req.params.orgId, suspended: false });
}));

/**
 * POST /api/admin/users/:userId/revoke-admin  body { reason }
 *
 * Strip OWNER/CARRIER_ADMIN privileges from a user. If the user is the SOLE
 * OWNER of any org, suspend that org rather than orphan it; the spec calls
 * this out explicitly. Audit per affected org.
 */
router.post('/users/:userId/revoke-admin', asyncHandler(async (req: AuthRequest, res) => {
  const reason = requireReason(req, res);
  if (!reason) return;
  const targetUserId = req.params.userId;
  const actorUserId  = req.user!.userId;

  // Find every org the target is an OWNER of.
  const memberships = await OrgMembershipService.getMembershipsForUser(targetUserId);
  const ownedOrgs = memberships.filter((m) => m.orgRole === OrgRole.OWNER && (m.status ?? 'ACTIVE') === 'ACTIVE');

  const suspendedOrgs: string[] = [];
  for (const m of ownedOrgs) {
    const members = await OrgMembershipService.getMembersOfOrg(m.orgId);
    const otherOwners = members.filter((x: any) =>
      x.userId !== targetUserId && x.orgRole === OrgRole.OWNER && (x.status ?? 'ACTIVE') === 'ACTIVE');
    if (otherOwners.length === 0) {
      // Sole owner — suspend the org rather than orphan it.
      await OrgService.suspendOrg(m.orgId, actorUserId, `Admin revoke: ${reason}`);
      suspendedOrgs.push(m.orgId);
    }
  }

  // Demote the user's CARRIER_ADMIN role on every owned membership.
  for (const m of memberships) {
    if (m.orgRole === OrgRole.OWNER || m.orgRole === OrgRole.MANAGER) {
      await Database.updateItem(
        config.dynamodb.membershipsTable,
        { orgId: m.orgId, userId: targetUserId },
        { orgRole: OrgRole.ORG_DRIVER, updatedAt: Date.now() },
      );
      await OrgAuditService.log({
        orgId: m.orgId,
        targetUserId,
        actorUserId,
        actorRole: UserRole.ADMIN,
        action: 'ROLE_CHANGED',
        oldValue: m.orgRole,
        newValue: OrgRole.ORG_DRIVER,
      });
    }
  }

  res.json({
    ok: true,
    userId: targetUserId,
    revokedMemberships: memberships.length,
    suspendedOrgs,
  });
}));

export default router;
