/**
 * Load negotiation routes - /api/negotiations
 *
 * Hauler side (engaged carrier or owner-operator, via their driver profile):
 *   POST /loads/:loadId/engage     acquire the exclusive lock (verified carrier
 *                                  of record only; e-sign is at accept/assign)
 *   POST /:id/accept-load          take the posted rate; assign
 *   POST /:id/bid                  first offer { ratePerMileCents }
 *   POST /:id/counter              hauler counter { ratePerMileCents }
 *   POST /:id/accept               accept the shipper's counter; assign
 *   POST /:id/reject               walk away; rebroadcast
 *
 * Shipper side:
 *   POST /:id/shipper/counter      shipper counter { ratePerMileCents }
 *   POST /:id/shipper/accept       accept the hauler's bid/counter; assign
 *   POST /:id/shipper/reject       reject; rebroadcast
 *
 * Both:
 *   GET /loads/:loadId             current negotiation state for the viewer:
 *                                  display status, available actions, rates,
 *                                  round, and seconds remaining in the window
 *
 * Turn order, the single-active-negotiation lock, idempotent accept, and the
 * window are all enforced in NegotiationService with conditional writes; the
 * routes translate HTTP and notify the counterparty on every action through
 * PushService.send (which also enforces the compliance suppression seam).
 */

import express from 'express';
import { body, param } from 'express-validator';
import { authenticate, AuthRequest } from '../middleware/auth';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { validate } from '../middleware/validation';
import { NegotiationService, LoadNegotiation, NegotiationParty } from '../services/negotiationService';
import { DriverService } from '../services/driverService';
import { ShipperService } from '../services/shipperService';
import { resolveCarrierOfRecord } from '../services/carrierOfRecord';
import { requireVerifiedCarrier } from '../services/verification';
import { PushService } from '../services/pushService';
import { LoadService } from '../services/loadService';

const router = express.Router();
router.use(authenticate);

// An offer is EITHER cents per mile (PER_MILE loads) or a flat total in cents
// (FLAT_RATE loads). The service validates the field against the load's basis.
const offerValidators = [
  body('ratePerMileCents').optional().isInt({ min: 1 }),
  body('totalCents').optional().isInt({ min: 1 }),
  body().custom((b) => {
    if (b?.ratePerMileCents == null && b?.totalCents == null) {
      throw new Error('Send ratePerMileCents (per-mile loads) or totalCents (flat-rate loads)');
    }
    return true;
  }),
];
const offerAmountOf = (b: any) => ({
  ...(b.ratePerMileCents != null ? { ratePerMileCents: Number(b.ratePerMileCents) } : {}),
  ...(b.totalCents != null ? { totalCents: Number(b.totalCents) } : {}),
});

async function haulerActor(req: AuthRequest): Promise<{ party: NegotiationParty; driverId: string; userId: string; carrierId: string }> {
  const driver = await DriverService.getProfileByUserId(req.user!.userId);
  if (!driver) throw new AppError('Driver profile not found', 404);
  const cor = await resolveCarrierOfRecord(driver);
  if (!cor) throw new AppError('You must belong to a carrier to negotiate loads', 403);
  return { party: 'HAULER', driverId: driver.driverId, userId: req.user!.userId, carrierId: cor.entityId };
}

async function shipperActor(req: AuthRequest, neg: LoadNegotiation): Promise<{ party: NegotiationParty; shipperId: string }> {
  // load.shipperId is used as the shipper's id (and as their notification
  // userId elsewhere); accept either the direct match or the profile match.
  const userId = req.user!.userId;
  if (neg.shipperId === userId) return { party: 'SHIPPER', shipperId: userId };
  const profile = await ShipperService.getProfileByUserId(userId);
  if (profile && profile.shipperId === neg.shipperId) return { party: 'SHIPPER', shipperId: profile.shipperId };
  throw new AppError('Only the load shipper may act on this negotiation', 403);
}

/**
 * E-sign gate for the assignment step. A negotiated assignment must be attested
 * by a CARRIER_ACCEPT signature in the load's chain, exactly as the claim path
 * (routes/driver.ts `/offers/:loadId/accept`) requires before it assigns a
 * driver. This is the attestation that used to gate /engage: it belongs here,
 * at accept/assign, because CARRIER_ACCEPT binds assignedDriverId and only
 * makes sense once a driver is actually being committed to the load.
 *
 * requireSignature throws 412 (CARRIER_ACCEPT_SIGNATURE_REQUIRED) when the
 * signature is absent; we additionally assert a carrier signer role, mirroring
 * the claim-path cross-check so a signature from a non-carrier role cannot
 * satisfy the gate. Applied to every route that reaches finishAccepted():
 * hauler accept-load, hauler accept-counter, and shipper accept-bid (where the
 * carrier signed earlier, when placing the bid the shipper is now accepting).
 */
async function requireCarrierAcceptForAssignment(loadId: string): Promise<void> {
  const { requireSignature } = await import('../services/attestation/requireSignature');
  const sig = await requireSignature(loadId, 'CARRIER_ACCEPT');
  if (sig.signerRole !== 'CARRIER_ADMIN' && sig.signerRole !== 'OWNER_OPERATOR') {
    throw new AppError(JSON.stringify({
      error: 'CARRIER_ACCEPT signature was signed by a non-carrier role',
      code:  'CARRIER_ACCEPT_SIGNER_INVALID',
    }), 409);
  }
}

function fmtRate(cents: number | null | undefined): string {
  return cents == null ? 'the posted rate' : `$${(cents / 100).toFixed(2)}/mi`;
}
function fmtOffer(neg: LoadNegotiation): string {
  if (neg.currentOfferRatePerMileCents != null) return fmtRate(neg.currentOfferRatePerMileCents);
  if (neg.currentOfferTotalCents != null) return `$${(neg.currentOfferTotalCents / 100).toFixed(2)} total`;
  return 'the posted rate';
}
function fmtAgreed(neg: LoadNegotiation): string {
  if (neg.agreedRatePerMileCents != null) return fmtRate(neg.agreedRatePerMileCents);
  if (neg.agreedLinehaulCents != null) return `$${(neg.agreedLinehaulCents / 100).toFixed(2)} total`;
  return 'the posted rate';
}

/** Best-effort counterparty notification. Suppression seam applies inside send. */
async function notify(neg: LoadNegotiation, actedParty: NegotiationParty, title: string, bodyText: string) {
  try {
    const url = actedParty === 'HAULER'
      ? `/shipper/loads/${neg.loadId}`
      : `/driver/loads/${neg.loadId}`;
    const toUserId = actedParty === 'HAULER' ? neg.shipperId : neg.haulerUserId;
    await PushService.send(toUserId, title, bodyText, url);
  } catch (_) { /* notification is best-effort */ }
}

/** Display status + available actions for the requesting viewer. */
function viewFor(neg: LoadNegotiation, viewer: NegotiationParty) {
  const now = Date.now();
  const secondsRemaining = ['ENGAGED', 'PENDING_SHIPPER', 'PENDING_HAULER'].includes(neg.status)
    ? Math.max(0, Math.floor((neg.deadlineAt - now) / 1000))
    : 0;
  let display = '';
  let actions: string[] = [];
  switch (neg.status) {
    case 'ENGAGED':
      display = viewer === 'HAULER' ? 'Engaged - accept load or bid' : 'A hauler is reviewing your load';
      actions = viewer === 'HAULER' ? ['ACCEPT_LOAD', 'BID', 'REJECT'] : [];
      break;
    case 'PENDING_SHIPPER':
      display = neg.roundCount <= 1 ? 'Bid' : 'Counter offer';
      actions = viewer === 'SHIPPER' ? ['ACCEPT_BID', 'COUNTER', 'REJECT'] : [];
      break;
    case 'PENDING_HAULER':
      display = 'Counter offer';
      actions = viewer === 'HAULER' ? ['ACCEPT_COUNTER', 'COUNTER', 'REJECT'] : [];
      break;
    case 'ACCEPTED':
      display = neg.outcome === 'ACCEPT_LOAD' ? 'Accept load' : neg.outcome === 'ACCEPT_BID' ? 'Accept bid' : 'Accept counter';
      break;
    case 'REJECTED': display = 'Reject bid'; break;
    case 'EXPIRED': display = 'Expired'; break;
  }
  return {
    negotiationId: neg.negotiationId,
    loadId: neg.loadId,
    status: neg.status,
    display,
    actions,
    rateBasis: NegotiationService.basisOf(neg),
    postedRatePerMileCents: neg.postedRatePerMileCents,
    postedLinehaulCents: neg.postedLinehaulCents,
    currentOfferRatePerMileCents: neg.currentOfferRatePerMileCents,
    currentOfferTotalCents: neg.currentOfferTotalCents ?? null,
    currentOfferParty: neg.currentOfferParty,
    roundCount: neg.roundCount,
    secondsRemaining,
    deadlineAt: neg.deadlineAt,
    updatedAt: neg.updatedAt,
    agreedRatePerMileCents: neg.agreedRatePerMileCents ?? null,
    agreedLinehaulCents: neg.agreedLinehaulCents ?? null,
  };
}

// ── engage ────────────────────────────────────────────────────────────────

router.post(
  '/loads/:loadId/engage',
  requireVerifiedCarrier(),
  validate([param('loadId').isString().isLength({ min: 1, max: 200 })]),
  asyncHandler(async (req: AuthRequest, res) => {
    const actor = await haulerActor(req);
    // No e-sign gate here: CARRIER_ACCEPT is an ASSIGNMENT attestation (its
    // projection binds assignedDriverId) so it cannot exist on a still-broadcast
    // load. Engagement only acquires the exclusive negotiation lock. The e-sign
    // is enforced at the accept/assign step instead (the same place the claim
    // path signs) via requireCarrierAcceptForAssignment() on the accept routes.
    // requireVerifiedCarrier above still gates engage on a verified carrier.
    const neg = await NegotiationService.engage({
      loadId: req.params.loadId,
      haulerCarrierId: actor.carrierId,
      haulerDriverId: actor.driverId,
      haulerUserId: actor.userId,
    });
    res.status(201).json({ negotiation: viewFor(neg, 'HAULER') });
  })
);

// ── hauler actions ────────────────────────────────────────────────────────

router.post('/:id/accept-load', asyncHandler(async (req: AuthRequest, res) => {
  const actor = await haulerActor(req);
  const pending = await NegotiationService.getById(req.params.id);
  if (!pending) throw new AppError('Negotiation not found', 404);
  await requireCarrierAcceptForAssignment(pending.loadId);
  const neg = await NegotiationService.acceptLoad(req.params.id, actor.driverId);
  await notify(neg, 'HAULER', 'Load accepted', `Your load was accepted at the posted rate (${fmtRate(neg.agreedRatePerMileCents)}).`);
  res.json({ negotiation: viewFor(neg, 'HAULER') });
}));

router.post('/:id/bid', validate(offerValidators), asyncHandler(async (req: AuthRequest, res) => {
  const actor = await haulerActor(req);
  const neg = await NegotiationService.bid(req.params.id, actor.driverId, offerAmountOf(req.body));
  await notify(neg, 'HAULER', 'New bid on your load', `A hauler bid ${fmtOffer(neg)}. Accept, counter, or reject.`);
  res.json({ negotiation: viewFor(neg, 'HAULER') });
}));

router.post('/:id/counter', validate(offerValidators), asyncHandler(async (req: AuthRequest, res) => {
  const actor = await haulerActor(req);
  const neg = await NegotiationService.counter(req.params.id, actor, offerAmountOf(req.body));
  await notify(neg, 'HAULER', 'Counter offer on your load', `The hauler countered at ${fmtOffer(neg)}.`);
  res.json({ negotiation: viewFor(neg, 'HAULER') });
}));

router.post('/:id/accept', asyncHandler(async (req: AuthRequest, res) => {
  const actor = await haulerActor(req);
  const pending = await NegotiationService.getById(req.params.id);
  if (!pending) throw new AppError('Negotiation not found', 404);
  await requireCarrierAcceptForAssignment(pending.loadId);
  const neg = await NegotiationService.acceptOffer(req.params.id, actor);
  await notify(neg, 'HAULER', 'Counter accepted - load assigned', `The hauler accepted your counter at ${fmtAgreed(neg)}.`);
  res.json({ negotiation: viewFor(neg, 'HAULER') });
}));

router.post('/:id/reject', asyncHandler(async (req: AuthRequest, res) => {
  const actor = await haulerActor(req);
  const neg = await NegotiationService.reject(req.params.id, actor);
  await notify(neg, 'HAULER', 'Negotiation ended', 'The hauler declined. Your load is back on the board at the posted rate.');
  res.json({ negotiation: viewFor(neg, 'HAULER') });
}));

// ── shipper actions ───────────────────────────────────────────────────────

router.post('/:id/shipper/counter', validate(offerValidators), asyncHandler(async (req: AuthRequest, res) => {
  const existing = await NegotiationService.getById(req.params.id);
  if (!existing) throw new AppError('Negotiation not found', 404);
  const actor = await shipperActor(req, existing);
  const neg = await NegotiationService.counter(req.params.id, actor, offerAmountOf(req.body));
  await notify(neg, 'SHIPPER', 'Counter offer from the shipper', `The shipper countered at ${fmtOffer(neg)}. Accept, counter, or reject.`);
  res.json({ negotiation: viewFor(neg, 'SHIPPER') });
}));

router.post('/:id/shipper/accept', asyncHandler(async (req: AuthRequest, res) => {
  const existing = await NegotiationService.getById(req.params.id);
  if (!existing) throw new AppError('Negotiation not found', 404);
  const actor = await shipperActor(req, existing);
  // The carrier isn't the actor here, but their bid becomes a binding
  // assignment the moment the shipper accepts it — so the CARRIER_ACCEPT
  // attestation the hauler signed for that bid must be present, or there is
  // no assignment to make. 412s until the carrier has signed.
  await requireCarrierAcceptForAssignment(existing.loadId);
  const neg = await NegotiationService.acceptOffer(req.params.id, actor);
  await notify(neg, 'SHIPPER', 'Bid accepted - load is yours', `The shipper accepted your offer of ${fmtAgreed(neg)}. The load is assigned to you.`);
  res.json({ negotiation: viewFor(neg, 'SHIPPER') });
}));

router.post('/:id/shipper/reject', asyncHandler(async (req: AuthRequest, res) => {
  const existing = await NegotiationService.getById(req.params.id);
  if (!existing) throw new AppError('Negotiation not found', 404);
  const actor = await shipperActor(req, existing);
  const neg = await NegotiationService.reject(req.params.id, actor);
  await notify(neg, 'SHIPPER', 'Bid rejected', 'The shipper rejected the bid. The load has been rebroadcast.');
  res.json({ negotiation: viewFor(neg, 'SHIPPER') });
}));

// ── state for either party ────────────────────────────────────────────────

/** Which side of the negotiation is this user on (null = not a party). */
async function resolveViewer(userId: string, neg: LoadNegotiation): Promise<NegotiationParty | null> {
  if (neg.haulerUserId === userId) return 'HAULER';
  if (neg.shipperId === userId) return 'SHIPPER';
  const profile = await ShipperService.getProfileByUserId(userId);
  if (profile && profile.shipperId === neg.shipperId) return 'SHIPPER';
  const driver = await DriverService.getProfileByUserId(userId);
  if (driver && driver.driverId === neg.haulerDriverId) return 'HAULER';
  return null;
}

/**
 * Live updates without websockets: long poll. Holds up to ~25s (safely under
 * the ALB's 60s idle timeout), re-reading the store every second, and returns
 * the fresh view the moment updatedAt moves past `since`. Stateless across
 * instances - any web instance can answer - so it needs no pub/sub layer.
 */
router.get(
  '/loads/:loadId/events',
  validate([param('loadId').isString().isLength({ min: 1, max: 200 })]),
  asyncHandler(async (req: AuthRequest, res) => {
    const since = Number(req.query.since ?? 0) || 0;
    const changed = await NegotiationService.waitForChange(req.params.loadId, since);
    if (!changed) return res.json({ changed: false, since });
    const viewer = await resolveViewer(req.user!.userId, changed);
    if (!viewer) return res.json({ changed: false, since });
    res.json({ changed: true, negotiation: viewFor(changed, viewer) });
  })
);

router.get(
  '/loads/:loadId',
  validate([param('loadId').isString().isLength({ min: 1, max: 200 })]),
  asyncHandler(async (req: AuthRequest, res) => {
    const neg = await NegotiationService.latestForLoad(req.params.loadId);
    if (!neg) return res.json({ negotiation: null });
    // Lazy expiry so a stale window shows EXPIRED without waiting for the sweeper.
    await NegotiationService.expireIfOverdue(neg);
    const fresh = (await NegotiationService.getById(neg.negotiationId))!;

    const viewer = await resolveViewer(req.user!.userId, fresh);
    if (!viewer) {
      // Not a party: reveal only that the load is under negotiation.
      const load = await LoadService.getLoadById(req.params.loadId);
      const active = ['ENGAGED', 'PENDING_SHIPPER', 'PENDING_HAULER'].includes(fresh.status);
      return res.json({ negotiation: null, underNegotiation: active && !load?.assignedDriverId });
    }
    res.json({ negotiation: viewFor(fresh, viewer), offers: await NegotiationService.offersFor(fresh.negotiationId) });
  })
);

export default router;
