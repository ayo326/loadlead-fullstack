import type { Page } from "@playwright/test";

/**
 * A stateful, in-memory mock of the negotiation backend, installed at the
 * network boundary via page.route. It mirrors the server's viewFor() so the
 * REAL NegotiationPanel renders the correct status + action buttons for each
 * state, and it advances the state machine in response to the panel's POSTs.
 * The returned controller lets a test simulate the counterparty (whose moves
 * arrive through the long-poll events channel) and toggle the e-sign gate.
 */
export type Party = "HAULER" | "SHIPPER";
type Status = "ENGAGED" | "PENDING_SHIPPER" | "PENDING_HAULER" | "ACCEPTED" | "REJECTED" | "EXPIRED";

const POSTED_RATE = 250;      // cents/mi
const MILES = 240;
const POSTED_LINEHAUL = POSTED_RATE * MILES; // 60000

export interface NegController {
  /** Simulate the shipper countering (delivered to a HAULER page via events). */
  shipperCounter(cents: number): void;
  /** Simulate the hauler bidding (delivered to a SHIPPER page via events). */
  haulerBid(cents: number): void;
  /** Force the window to expire (delivered via events). */
  expire(): void;
  /** When true, the three assigning routes return 412 (missing CARRIER_ACCEPT). */
  setEsignBlocked(v: boolean): void;
  /** Count of each endpoint hit, for assertions. */
  hits: Record<string, number>;
}

export async function installNegotiationMock(
  page: Page,
  party: Party,
  loadId = "SEED-NEGO-DEMO",
  opts: { suppressTour?: boolean } = {},
): Promise<NegController> {
  const s = {
    negotiationId: "neg-e2e-1",
    status: null as Status | null,
    currentOfferRatePerMileCents: null as number | null,
    currentOfferParty: null as Party | null,
    roundCount: 0,
    outcome: undefined as string | undefined,
    agreedRatePerMileCents: null as number | null,
    agreedLinehaulCents: null as number | null,
    updatedAt: 1,
  };
  let esignBlocked = false;
  const hits: Record<string, number> = {};
  const bump = () => { s.updatedAt += 1; };
  const hit = (k: string) => { hits[k] = (hits[k] ?? 0) + 1; };

  // Suppress the Shepherd persona onboarding tour: its modal auto-starts ~700ms
  // after the dashboard mounts and would intercept clicks on the panel. Marking
  // every persona's tour "completed" in localStorage (the app's own gate) keeps
  // the flows deterministic. addInitScript runs before any app script. Pass
  // suppressTour:false to leave the tour armed (the F1 regression test relies on
  // an un-suppressed tour to prove it no longer fires on load-detail routes).
  if (opts.suppressTour !== false) {
    await page.addInitScript(() => {
      for (const p of ["OWNER_OPERATOR", "SHIPPER", "CARRIER_ADMIN", "DRIVER", "RECEIVER"]) {
        localStorage.setItem(`loadlead.tour.completed.${p}`, "1");
        localStorage.setItem(`loadlead.tour.completed.${p}.dashboard`, "1");
        localStorage.setItem(`loadlead.tour.completed.${p}.settings`, "1");
      }
    });
  }

  function view(viewer: Party = party) {
    if (!s.status) return null;
    const active = ["ENGAGED", "PENDING_SHIPPER", "PENDING_HAULER"].includes(s.status);
    let display = "";
    let actions: string[] = [];
    if (s.status === "ENGAGED") {
      display = viewer === "HAULER" ? "Engaged - accept load or bid" : "A hauler is reviewing your load";
      actions = viewer === "HAULER" ? ["ACCEPT_LOAD", "BID", "REJECT"] : [];
    } else if (s.status === "PENDING_SHIPPER") {
      display = s.roundCount <= 1 ? "Bid" : "Counter offer";
      actions = viewer === "SHIPPER" ? ["ACCEPT_BID", "COUNTER", "REJECT"] : [];
    } else if (s.status === "PENDING_HAULER") {
      display = "Counter offer";
      actions = viewer === "HAULER" ? ["ACCEPT_COUNTER", "COUNTER", "REJECT"] : [];
    } else if (s.status === "ACCEPTED") {
      display = s.outcome === "ACCEPT_LOAD" ? "Accept load" : s.outcome === "ACCEPT_BID" ? "Accept bid" : "Accept counter";
    } else if (s.status === "REJECTED") display = "Reject bid";
    else if (s.status === "EXPIRED") display = "Expired";
    return {
      negotiationId: s.negotiationId, loadId, status: s.status, display, actions,
      rateBasis: "PER_MILE", postedRatePerMileCents: POSTED_RATE, postedLinehaulCents: POSTED_LINEHAUL,
      currentOfferRatePerMileCents: s.currentOfferRatePerMileCents, currentOfferTotalCents: null,
      currentOfferParty: s.currentOfferParty, roundCount: s.roundCount,
      secondsRemaining: active ? 1180 : 0, deadlineAt: Date.now() + 1_180_000, updatedAt: s.updatedAt,
      agreedRatePerMileCents: s.agreedRatePerMileCents, agreedLinehaulCents: s.agreedLinehaulCents,
    };
  }

  const json = (route: any, body: unknown, status = 200) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  const rateFromBody = (route: any): number => {
    try { return JSON.parse(route.request().postData() || "{}").ratePerMileCents ?? 0; } catch { return 0; }
  };
  const assignGuard = (route: any, apply: () => void) => {
    if (esignBlocked) return json(route, { message: "CARRIER_ACCEPT signature is required for this transition", code: "CARRIER_ACCEPT_SIGNATURE_REQUIRED" }, 412);
    apply(); bump(); return json(route, { negotiation: view() });
  };

  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/api/, "");
    const method = route.request().method();

    // ── auth / session hydrate ──
    if (path === "/auth/me") {
      hit("me");
      return json(route, { user: { userId: "oo-user", email: "demo@x.test", role: party === "HAULER" ? "OWNER_OPERATOR" : "SHIPPER" } });
    }
    // ── page data deps (kept minimal but valid so the page renders) ──
    if (method === "GET" && /\/owner-operator\/offers\//.test(path)) {
      hit("offer");
      return json(route, {
        driverId: "drv-1",
        offer: { offerId: "offer-e2e", loadId, driverId: "drv-1", status: "OFFERED", createdAt: Date.now(), expiresAt: Date.now() + 6e8, driverDistanceMiles: 12 },
        load: loadRow(loadId),
      });
    }
    if (method === "GET" && (/\/shipper\/loads\//.test(path) || /\/loads\/[^/]+$/.test(path))) {
      hit("shipperLoad");
      return json(route, { load: loadRow(loadId), offers: [], receiver: null });
    }
    // AccessorialsPanel is mounted next to the negotiation panel and reads
    // `.charges` unconditionally in render - give it an empty list so the page
    // renders (the panel itself is not under test here).
    if (method === "GET" && /\/accessorials\/loads\/.*\/charges/.test(path)) {
      hit("accessorials");
      return json(route, { charges: [], count: 0 });
    }
    // The shipper page renders an AttestationChain that reads `.chain` - an empty
    // chain keeps the page rendering (signatures aren't under test here).
    if (method === "GET" && /\/attestation\/chain\//.test(path)) {
      hit("attestationChain");
      return json(route, { chain: [] });
    }

    // ── attestation: the hauler signs CARRIER_ACCEPT before their first bid /
    //    accept (the AttestationDialog posts here). ──
    if (method === "POST" && /\/attestation\/sign/.test(path)) {
      hit("attestationSign");
      return json(route, { signatureId: "sig-e2e", documentHash: "hash-e2e", signedAt: new Date().toISOString() });
    }

    // ── negotiation: long-poll events (hold, then answer) ──
    if (/\/negotiations\/loads\/.*\/events/.test(path)) {
      hit("events");
      const since = Number(url.searchParams.get("since") || 0);
      await new Promise((r) => setTimeout(r, 500)); // emulate the server hold; prevents a tight loop
      if (s.updatedAt > since) return json(route, { changed: true, negotiation: view() });
      return json(route, { changed: false });
    }
    // ── negotiation: current state ──
    if (method === "GET" && /\/negotiations\/loads\//.test(path)) {
      hit("forLoad");
      return json(route, { negotiation: view(), underNegotiation: !!s.status });
    }
    // ── negotiation: transitions ──
    if (method === "POST" && /\/negotiations\/loads\/.*\/engage/.test(path)) {
      hit("engage"); s.status = "ENGAGED"; s.roundCount = 0; bump(); return json(route, { negotiation: view() }, 201);
    }
    if (method === "POST" && /\/negotiations\/[^/]+\/bid/.test(path)) {
      hit("bid"); s.status = "PENDING_SHIPPER"; s.currentOfferRatePerMileCents = rateFromBody(route); s.currentOfferParty = "HAULER"; s.roundCount = 1; bump();
      return json(route, { negotiation: view() });
    }
    if (method === "POST" && /\/negotiations\/[^/]+\/counter$/.test(path)) {
      hit("counter"); s.status = "PENDING_SHIPPER"; s.currentOfferRatePerMileCents = rateFromBody(route); s.currentOfferParty = "HAULER"; s.roundCount += 1; bump();
      return json(route, { negotiation: view() });
    }
    if (method === "POST" && /\/negotiations\/[^/]+\/shipper\/counter/.test(path)) {
      hit("shipperCounter"); s.status = "PENDING_HAULER"; s.currentOfferRatePerMileCents = rateFromBody(route); s.currentOfferParty = "SHIPPER"; s.roundCount += 1; bump();
      return json(route, { negotiation: view() });
    }
    if (method === "POST" && /\/negotiations\/[^/]+\/accept-load/.test(path)) {
      hit("acceptLoad"); return assignGuard(route, () => { s.status = "ACCEPTED"; s.outcome = "ACCEPT_LOAD"; s.agreedRatePerMileCents = POSTED_RATE; s.agreedLinehaulCents = POSTED_LINEHAUL; });
    }
    if (method === "POST" && /\/negotiations\/[^/]+\/accept$/.test(path)) {
      hit("acceptCounter"); return assignGuard(route, () => { s.status = "ACCEPTED"; s.outcome = "ACCEPT_COUNTER"; s.agreedRatePerMileCents = s.currentOfferRatePerMileCents; s.agreedLinehaulCents = (s.currentOfferRatePerMileCents ?? 0) * MILES; });
    }
    if (method === "POST" && /\/negotiations\/[^/]+\/shipper\/accept/.test(path)) {
      hit("shipperAccept"); return assignGuard(route, () => { s.status = "ACCEPTED"; s.outcome = "ACCEPT_BID"; s.agreedRatePerMileCents = s.currentOfferRatePerMileCents; s.agreedLinehaulCents = (s.currentOfferRatePerMileCents ?? 0) * MILES; });
    }
    if (method === "POST" && /\/negotiations\/[^/]+\/(shipper\/)?reject/.test(path)) {
      hit("reject"); s.status = "REJECTED"; s.outcome = "REJECT"; bump(); return json(route, { negotiation: view() });
    }

    // ── catch-all: benign empty payloads so incidental calls never break render ──
    hit("other");
    return json(route, Array.isArray(undefined) ? [] : {});
  });

  // Block anything that isn't our localhost origin (maps, fonts, analytics).
  await page.route(/^https?:\/\/(?!localhost:3001)/, (route) => route.abort());

  return {
    shipperCounter(cents) { s.status = "PENDING_HAULER"; s.currentOfferRatePerMileCents = cents; s.currentOfferParty = "SHIPPER"; s.roundCount += 1; bump(); },
    haulerBid(cents) { s.status = "PENDING_SHIPPER"; s.currentOfferRatePerMileCents = cents; s.currentOfferParty = "HAULER"; s.roundCount = 1; bump(); },
    expire() { s.status = "EXPIRED"; bump(); },
    setEsignBlocked(v) { esignBlocked = v; },
    hits,
  };
}

function loadRow(loadId: string) {
  const now = Date.now();
  return {
    loadId, shipperId: "ship-1", status: "OPEN", referenceNumber: "DEMO-NEGO-001",
    equipmentType: "DRY_VAN", loadSize: "FULL", totalWeightLbs: 34000, commodityDescription: "Palletized general freight",
    pickupCity: "Dallas", pickupState: "TX", pickupZip: "75201", pickupDate: now + 2 * 864e5, pickupTime: "09:00", pickupType: "APPOINTMENT",
    deliveryCity: "Houston", deliveryState: "TX", deliveryZip: "77002", deliveryDate: now + 3 * 864e5, deliveryTime: "14:00", deliveryType: "LIVE_UNLOAD",
    totalMiles: 240, rateType: "PER_MILE", rateAmount: 2.5, createdAt: now, updatedAt: now,
  };
}
