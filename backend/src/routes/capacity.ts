/**
 * Hauler on-board capacity API.
 *
 * Every surface (registration, the smart login prompt, the dashboard chip, the
 * load-detail chip) reads the same derived snapshot from getCapacity, so the
 * numbers can never disagree. Capacity is informational: these endpoints never
 * block a registration, login, or claim; they record append-only declarations
 * and return the recomputed snapshot.
 *
 * Persona: haulers only (owner-operators and their fleet drivers), mirroring the
 * per-driver routes. The equipment is the caller's own Driver profile.
 */
import express from 'express';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { UserRole, CapacityEventSource } from '../types';
import { DriverService } from '../services/driverService';
import { HaulerCapacityService } from '../services/haulerCapacityService';
import { resolveCarrierIdForUser } from './factoring';

const router = express.Router();

router.use(authenticate);
// Haulers: an OWNER_OPERATOR's self-driver row and each fleet DRIVER own an
// equipment profile. ADMIN is admitted for support. Fleet-carrier persona
// surfaces stay muted at the UI/flag layer; this API serves the hauler.
router.use(requireRole(UserRole.DRIVER, UserRole.OWNER_OPERATOR, UserRole.ADMIN));

async function resolveEquipment(req: AuthRequest): Promise<{ driver: any; carrierId: string }> {
  const driver = await DriverService.getProfileByUserId(req.user!.userId);
  if (!driver) throw new AppError('No equipment profile for this account yet.', 404);
  let carrierId: string;
  try {
    carrierId = await resolveCarrierIdForUser(req.user!.userId);
  } catch {
    carrierId = driver.carrierId ?? driver.driverId;
  }
  return { driver, carrierId };
}

function coerceSource(v: unknown): CapacityEventSource {
  return v === 'REGISTRATION' || v === 'LOGIN_PROMPT' || v === 'DASHBOARD' ? v : 'DASHBOARD';
}

// GET /api/capacity/me - current derived capacity snapshot for the hauler's equipment.
router.get(
  '/me',
  asyncHandler(async (req: AuthRequest, res) => {
    const { driver, carrierId } = await resolveEquipment(req);
    const capacity = await HaulerCapacityService.getCapacity(
      driver.driverId,
      driver.maxCapacityLbs ?? 0,
      carrierId,
    );
    res.json({ capacity });
  }),
);

// POST /api/capacity/declare - hauler declares empty or loaded. Never blocks.
// body: { state: 'EMPTY' | 'LOADED', weightLbs?: number, source?: CapacityEventSource }
router.post(
  '/declare',
  asyncHandler(async (req: AuthRequest, res) => {
    const { state, weightLbs } = req.body ?? {};
    const source = coerceSource(req.body?.source);
    const { driver, carrierId } = await resolveEquipment(req);
    const rated = driver.maxCapacityLbs ?? 0;

    if (state === 'EMPTY') {
      await HaulerCapacityService.declareEmpty(driver.driverId, carrierId, source);
    } else if (state === 'LOADED') {
      await HaulerCapacityService.declareLoaded(driver.driverId, carrierId, Number(weightLbs), rated, source);
    } else {
      throw new AppError("state must be 'EMPTY' or 'LOADED'.", 400);
    }

    const capacity = await HaulerCapacityService.getCapacity(driver.driverId, rated, carrierId);
    res.status(201).json({ capacity });
  }),
);

export default router;
