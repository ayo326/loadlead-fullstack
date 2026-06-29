/**
 * Admin route: GET /api/admin/liquidity?weeks=8
 *
 * Returns the Lane Liquidity numbers (gate dials, per lane fill, cumulative
 * fill rate and average time to cover by lane over time), computed live from
 * LoadLead_Loads. Mounted at /api/admin/liquidity in index.ts and guarded by
 * the repo's existing admin middleware (authenticate verifies the ll_token
 * httpOnly cookie or a Bearer token, requireAdmin enforces UserRole.ADMIN).
 */

import { Router, type Request, type Response } from "express";
import { authenticate, requireAdmin } from "../middleware/auth";
import { Logger } from "../utils/logger";
import { getLoadsInRange } from "../services/liquidity/liquidityRepo";
import { computeLiquidity, mondayUTC, isoDate } from "../services/liquidity/liquidityMetrics";
import { BetaTrustEventService } from "../services/betaTrustEventService";

const router = Router();

// Same admin guard the rest of /api/admin/* uses. No placeholder.
router.use(authenticate);
router.use(requireAdmin);

// Tiny in-memory cache so the dashboard can poll without hammering DynamoDB.
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; body: unknown }>();

const DAY_MS = 24 * 60 * 60 * 1000;

router.get("/", async (req: Request, res: Response) => {
  try {
    const weeks = Math.min(Math.max(parseInt(String(req.query.weeks ?? "8"), 10) || 8, 1), 26);
    const cacheKey = `weeks:${weeks}`;
    const hit = cache.get(cacheKey);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
      return res.json(hit.body);
    }

    const now = new Date();
    // Fetch from the Monday that starts the oldest charted week, through now.
    const fromMonday = new Date(mondayUTC(now).getTime() - (weeks - 1) * 7 * DAY_MS);
    const fromIso = isoDate(fromMonday) + "T00:00:00.000Z";
    const toIso = now.toISOString();

    const loads = await getLoadsInRange(fromIso, toIso);
    const result = computeLiquidity(loads, { now, weeks });

    // The no-show and trust-incident dials are backed by the BetaTrustEvents
    // store, not the Load model. Override the two metric placeholders (which the
    // pure math leaves at 0 because Load carries no such fields) with the real
    // aggregation for the same charted window. With no events this is a real 0.
    const counts = await BetaTrustEventService.getCounts({
      fromMs: Date.parse(fromIso),
      toMs: now.getTime(),
    });
    result.dials.noShows = counts.noShows;
    result.dials.trustIncidents = counts.trustIncidents;

    cache.set(cacheKey, { at: Date.now(), body: result });
    return res.json(result);
  } catch (err) {
    Logger.error("liquidity route error", err);
    return res.status(500).json({ error: "Failed to compute liquidity" });
  }
});

export default router;
