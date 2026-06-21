// LoadLead in-app guided tour.
//
// Built on Shepherd.js. Each persona has its own independent step config —
// no cross-persona branching. Steps target real DOM elements via stable
// `data-tour="…"` attributes; CSS class selectors are forbidden so a UI
// refresh doesn't break the tour.
//
// Public API:
//   <TourMount />                  ← drop once near the root (e.g. AppLayout)
//   useTour()                       ← returns { start, reset, hasCompleted }
//   <TourReplayButton />            ← convenience UI control
//
// Persistence: completion is stored per persona in localStorage. A future
// switch to server-side completion only needs to change `storage` below.
//
// Async steps (verification panel, inbound list, driver offers) use
// `beforeShowPromise + waitForElement` so the step blocks until the DOM
// node lands. A 10s ceiling means a fatally broken API still aborts cleanly.

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useLocation } from "react-router-dom";
import Shepherd from "shepherd.js";
import type Tour from "shepherd.js";
import "shepherd.js/dist/css/shepherd.css";
import "./tour-theme.css";

import { useAuth } from "@/contexts/AuthContext";

/* ─── types ─────────────────────────────────────────────────────────────── */

export type Persona =
  | "CARRIER_ADMIN"
  | "OWNER_OPERATOR"
  | "DRIVER"
  | "SHIPPER"
  | "RECEIVER";

interface StepDef {
  id: string;
  title: string;
  text: string | string[];
  /** Target selector — always `[data-tour="…"]`. Omit for centered step. */
  attachTo?: { element: string; on: "top" | "bottom" | "left" | "right" | "auto" };
  /** Wait for the target to appear before showing. */
  waitFor?: string;
  /** Override default buttons for this step. */
  buttons?: "default" | "first" | "last" | "next-only";
  /** Optional one-line note that renders in italics under the text. */
  hint?: string;
}

interface PersonaTour {
  persona: Persona;
  label: string;
  steps: StepDef[];
}

/* ─── helpers ───────────────────────────────────────────────────────────── */

const STORAGE_PREFIX = "loadlead.tour.completed.";

const storage = {
  get(persona: Persona): boolean {
    try {
      return localStorage.getItem(STORAGE_PREFIX + persona) === "1";
    } catch {
      return false;
    }
  },
  set(persona: Persona) {
    try {
      localStorage.setItem(STORAGE_PREFIX + persona, "1");
    } catch {
      /* private mode etc. */
    }
  },
  clear(persona: Persona) {
    try {
      localStorage.removeItem(STORAGE_PREFIX + persona);
    } catch {
      /* noop */
    }
  },
};

/**
 * Wait for a DOM element to appear. Resolves immediately if already present.
 * Uses MutationObserver so we don't poll. Resolves false on timeout so the
 * tour can either skip or stop without hanging.
 */
function waitForElement(selector: string, timeoutMs = 10_000): Promise<boolean> {
  return new Promise((resolve) => {
    if (document.querySelector(selector)) return resolve(true);

    const obs = new MutationObserver(() => {
      if (document.querySelector(selector)) {
        obs.disconnect();
        clearTimeout(t);
        resolve(true);
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });

    const t = setTimeout(() => {
      obs.disconnect();
      resolve(false);
    }, timeoutMs);
  });
}

function reducedMotion(): boolean {
  return typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/* ─── default step options (theme + a11y) ───────────────────────────────── */

const defaultStepOptions = {
  classes: "loadlead-tour-step",
  scrollTo: { behavior: reducedMotion() ? "auto" : ("smooth" as ScrollBehavior), block: "center" as ScrollLogicalPosition },
  cancelIcon: { enabled: true, label: "Close tour" },
  modalOverlayOpeningPadding: 6,
  modalOverlayOpeningRadius: 6,
  arrow: true,
  // Shepherd.js uses Floating UI; we don't pass animation overrides because
  // CSS handles them — index.css's prefers-reduced-motion rule collapses
  // shepherd transitions automatically.
};

/* ─── persona tour configs ──────────────────────────────────────────────── */

const carrierAdmin: PersonaTour = {
  persona: "CARRIER_ADMIN",
  label: "Carrier admin",
  steps: [
    {
      id: "intro",
      title: "Welcome to LoadLead",
      text: "We'll walk through your three jobs: prove the company, onboard your drivers, then dispatch loads. Five quick stops.",
    },
    {
      id: "carrier-company",
      title: "Your company profile",
      text: "Everything we ship for you ties back to this org. Legal name, MC, DOT, addresses, insurance — all here.",
      attachTo: { element: '[data-tour="carrier-company"]', on: "bottom" },
      waitFor: '[data-tour="carrier-company"]',
    },
    {
      id: "verification-panel",
      title: "Verification — your unlock",
      text: [
        "FMCSA authority, KYB, insurance docs, and AML each get checked here.",
        "Five states: Unverified → Submitted → Pending → Verified or Rejected.",
        "You can onboard drivers while Pending, but no loads broadcast to your roster until Verified.",
      ],
      attachTo: { element: '[data-tour="verification-panel"]', on: "right" },
      waitFor: '[data-tour="verification-panel"]',
    },
    {
      id: "onboard-drivers",
      title: "Onboard your roster",
      text: "Direct-add a driver or send them an invite link. Each driver completes their own personal identity check (IDV) once.",
      attachTo: { element: '[data-tour="onboard-drivers"]', on: "left" },
      waitFor: '[data-tour="onboard-drivers"]',
    },
    {
      id: "load-board",
      title: "Dispatching",
      text: "Once you're verified, shippers' loads land here filtered by what your fleet can haul. Accept on behalf of a driver, or let a driver self-accept from the offer.",
      attachTo: { element: '[data-tour="load-board"]', on: "top" },
      waitFor: '[data-tour="load-board"]',
    },
  ],
};

const ownerOperator: PersonaTour = {
  persona: "OWNER_OPERATOR",
  label: "Owner Operator",
  steps: [
    {
      id: "intro",
      title: "Welcome, Owner Operator",
      text: "You're both the carrier and the driver. We'll cover your identity check, your self-haul fleet, and your loadboard.",
    },
    {
      id: "oo-verification",
      title: "Verify the business + you",
      text: [
        "We need FMCSA / KYB on the business side, plus your personal IDV.",
        "Same five-state panel a carrier uses — verified business unlocks broadcasting; verified identity unlocks self-haul.",
      ],
      attachTo: { element: '[data-tour="oo-verification"]', on: "right" },
      waitFor: '[data-tour="oo-verification"]',
    },
    {
      id: "oo-fleet",
      title: "Your fleet",
      text: "By default we created a self-driver record for you. Add more drivers if you grow; each one needs their own IDV.",
      attachTo: { element: '[data-tour="oo-fleet"]', on: "bottom" },
      waitFor: '[data-tour="oo-fleet"]',
    },
    {
      id: "oo-loadboard",
      title: "Self-haul loadboard",
      text: "Eligible loads land here — matched against your equipment, capacity, and lanes. Accept one and it becomes a live haul.",
      attachTo: { element: '[data-tour="oo-loadboard"]', on: "top" },
      waitFor: '[data-tour="oo-loadboard"]',
    },
    {
      id: "oo-status",
      title: "While the load runs",
      text: "Status updates and POD upload work the same way they do for an employed driver. Payment routes to your business by default.",
      hint: "You can change the payment routing in Settings → Payouts.",
    },
  ],
};

const driver: PersonaTour = {
  persona: "DRIVER",
  label: "Driver",
  steps: [
    {
      id: "intro",
      title: "Welcome, Driver",
      text: "Five stops: identity check, join a carrier, see your offers, accept one, complete it with status updates and POD.",
    },
    {
      id: "driver-idv",
      title: "Step 1 — Identity",
      text: [
        "Tap Start IDV to verify yourself once. This unlocks your driver profile across every carrier you might haul for.",
      ],
      attachTo: { element: '[data-tour="driver-idv"]', on: "bottom" },
      waitFor: '[data-tour="driver-idv"]',
    },
    {
      id: "driver-affiliation",
      title: "Step 2 — Join a carrier (the affiliation gate)",
      text: [
        "Identity alone does NOT let you haul. You must be affiliated with a verified Carrier or an Owner Operator.",
        "Accept their invite or get added by their dispatcher. Until then offers won't broadcast to you.",
      ],
      attachTo: { element: '[data-tour="driver-affiliation"]', on: "bottom" },
      waitFor: '[data-tour="driver-affiliation"]',
      hint: "If you're already affiliated, this card shows your carrier's name and you're good to go.",
    },
    {
      id: "driver-offers",
      title: "Step 3 — Your live offers",
      text: "Each card shows the lane, equipment, rate, and a countdown. One-tap accept; declined offers vanish from your board.",
      attachTo: { element: '[data-tour="driver-offers"]', on: "top" },
      waitFor: '[data-tour="driver-offers"]',
    },
    {
      id: "driver-status",
      title: "Step 4 — Status + POD",
      text: "Once you accept, update status as you go (At pickup → In transit → Delivered) and upload the BOL/POD at the end. That closes the load.",
      hint: "Your earnings show in Analytics; history is one click away.",
    },
  ],
};

const shipper: PersonaTour = {
  persona: "SHIPPER",
  label: "Shipper",
  steps: [
    {
      id: "intro",
      title: "Welcome, Shipper",
      text: "We'll cover posting a load with the right equipment + commodity, then tracking it once it broadcasts.",
    },
    {
      id: "shipper-post-cta",
      title: "Post a load",
      text: "Start here. The form drives everything downstream — eligibility, matching, who sees your offer.",
      attachTo: { element: '[data-tour="shipper-post-cta"]', on: "bottom" },
      waitFor: '[data-tour="shipper-post-cta"]',
    },
    {
      id: "post-load-type",
      title: "Load type — the orthogonal fields",
      text: [
        "Mode (FTL/LTL/Partial), service type, and equipment class are selected from the taxonomy, not free text.",
        "This is what determines which carriers and drivers see your offer.",
      ],
      attachTo: { element: '[data-tour="post-load-type"]', on: "right" },
      waitFor: '[data-tour="post-load-type"]',
    },
    {
      id: "post-commodity",
      title: "Commodity + accessorials",
      text: "Commodity is searchable across 100+ entries; accessorials are multi-select. Some commodities auto-flag hazmat — leave it on if it applies.",
      attachTo: { element: '[data-tour="post-commodity"]', on: "right" },
      waitFor: '[data-tour="post-commodity"]',
    },
    {
      id: "shipper-tracking",
      title: "Once it broadcasts",
      text: "After Post, the offer fans out to eligible drivers. The dashboard shows active loads, live driver location once accepted, and ETA to delivery.",
      attachTo: { element: '[data-tour="shipper-tracking"]', on: "top" },
      waitFor: '[data-tour="shipper-tracking"]',
    },
  ],
};

const receiver: PersonaTour = {
  persona: "RECEIVER",
  label: "Receiver",
  steps: [
    {
      id: "intro",
      title: "Welcome, Receiver",
      text: "Receivers don't go through FMCSA/KYB — just your facility profile and the inbound shipments you're expecting.",
    },
    {
      id: "receiver-facility",
      title: "Your facility",
      text: "Address, dock + forklift availability, freight format. This is how shippers tell drivers what to expect at your dock.",
      attachTo: { element: '[data-tour="receiver-facility"]', on: "right" },
      waitFor: '[data-tour="receiver-facility"]',
    },
    {
      id: "inbound-loads",
      title: "Inbound loads",
      text: "Every load with you as the consignee shows up here with live ETA. Sort by arrival window to plan your dock.",
      attachTo: { element: '[data-tour="inbound-loads"]', on: "top" },
      waitFor: '[data-tour="inbound-loads"]',
    },
    {
      id: "confirm-delivery",
      title: "Confirm delivery",
      text: "When the driver arrives, open the load, verify the BOL, and Confirm delivery. That stamps POD on the load and triggers payment release.",
      attachTo: { element: '[data-tour="confirm-delivery"]', on: "left" },
      waitFor: '[data-tour="confirm-delivery"]',
    },
  ],
};

const TOURS: Record<Persona, PersonaTour> = {
  CARRIER_ADMIN: carrierAdmin,
  OWNER_OPERATOR: ownerOperator,
  DRIVER: driver,
  SHIPPER: shipper,
  RECEIVER: receiver,
};

/* ─── tour controller ───────────────────────────────────────────────────── */

function roleToPersona(role: string | undefined): Persona | null {
  switch (role) {
    case "CARRIER_ADMIN":
    case "OWNER_OPERATOR":
    case "DRIVER":
    case "SHIPPER":
    case "RECEIVER":
      return role;
    default:
      return null;
  }
}

function buildTour(personaTour: PersonaTour): Tour {
  // @ts-expect-error — shepherd's default export typing isn't great in v14
  const tour: Tour = new Shepherd.Tour({
    useModalOverlay: true,
    defaultStepOptions,
    keyboardNavigation: true,   // Tab / Shift+Tab between buttons; Esc cancels
    exitOnEsc: true,
  });

  personaTour.steps.forEach((step, idx) => {
    const isFirst = idx === 0;
    const isLast = idx === personaTour.steps.length - 1;

    const buttons: any[] = [];
    if (!isFirst) {
      buttons.push({
        text: "Back",
        action: () => tour.back(),
        secondary: true,
        classes: "loadlead-tour-btn loadlead-tour-btn--secondary",
      });
    }
    buttons.push({
      text: isLast ? "Finish" : "Next",
      action: () => tour.next(),
      classes: "loadlead-tour-btn loadlead-tour-btn--primary",
    });

    const textHtml = Array.isArray(step.text)
      ? step.text.map((p) => `<p>${p}</p>`).join("")
      : `<p>${step.text}</p>`;
    const hintHtml = step.hint
      ? `<p class="loadlead-tour-hint"><em>${step.hint}</em></p>`
      : "";

    tour.addStep({
      id: step.id,
      title: step.title,
      text: textHtml + hintHtml,
      attachTo: step.attachTo,
      buttons,
      beforeShowPromise: step.waitFor
        ? async () => {
            const ok = await waitForElement(step.waitFor!);
            if (!ok) {
              // Element never showed; abort gracefully so the user isn't stuck.
              // eslint-disable-next-line no-console
              console.warn(`[tour] target ${step.waitFor} did not appear; ending tour`);
              setTimeout(() => tour.complete(), 0);
            }
          }
        : undefined,
    });
  });

  tour.on("complete", () => storage.set(personaTour.persona));
  tour.on("cancel", () => storage.set(personaTour.persona));

  return tour;
}

/* ─── React surface ─────────────────────────────────────────────────────── */

interface TourCtxValue {
  start: (opts?: { force?: boolean }) => void;
  reset: () => void;
  hasCompleted: () => boolean;
  persona: Persona | null;
}

const noopCtx: TourCtxValue = {
  start: () => {},
  reset: () => {},
  hasCompleted: () => false,
  persona: null,
};

let live: TourCtxValue = noopCtx;

export function useTour(): TourCtxValue {
  return live;
}

/**
 * Mount once near the root of authed surfaces. Resolves the persona from
 * useAuth, builds the right tour, and auto-starts it the first time the
 * matching dashboard mounts. Subsequent visits do not auto-start.
 */
export function TourMount() {
  const { user } = useAuth();
  const persona = useMemo(() => roleToPersona(user?.role), [user?.role]);
  const tourRef = useRef<Tour | null>(null);
  const location = useLocation();

  const start = useCallback(
    (opts?: { force?: boolean }) => {
      if (!persona) return;
      if (!opts?.force && storage.get(persona)) return;
      // Late-bind: build a fresh tour each start so cancelled-then-replayed
      // tours don't reuse stale Shepherd state.
      const t = buildTour(TOURS[persona]);
      tourRef.current = t;
      t.start();
    },
    [persona],
  );

  const reset = useCallback(() => {
    if (!persona) return;
    storage.clear(persona);
    tourRef.current?.cancel();
    tourRef.current = null;
  }, [persona]);

  const hasCompleted = useCallback(
    () => (persona ? storage.get(persona) : false),
    [persona],
  );

  // Auto-start when the persona's home dashboard mounts and tour hasn't run.
  const dashboardPaths: Record<Persona, string> = {
    CARRIER_ADMIN: "/carrier",
    OWNER_OPERATOR: "/owner-operator",
    DRIVER: "/driver",
    SHIPPER: "/shipper",
    RECEIVER: "/receiver",
  };

  useEffect(() => {
    if (!persona) return;
    const onDashboard = location.pathname.startsWith(dashboardPaths[persona]);
    if (!onDashboard) return;
    if (storage.get(persona)) return;
    // Slight delay so the dashboard's own data has had a chance to land.
    const t = setTimeout(() => start(), 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persona, location.pathname]);

  // Expose to consumers via module-scoped ref so non-React call sites
  // (Logo footer Replay link, dev console, etc.) can still trigger.
  useEffect(() => {
    live = { start, reset, hasCompleted, persona };
    return () => {
      live = noopCtx;
    };
  }, [start, reset, hasCompleted, persona]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      tourRef.current?.cancel();
    };
  }, []);

  return null;
}

/** Drop into the rail footer / account menu. */
export function TourReplayButton({ className }: { className?: string }) {
  const tour = useTour();
  if (!tour.persona) return null;
  return (
    <button
      type="button"
      onClick={() => {
        tour.reset();
        tour.start({ force: true });
      }}
      className={
        className ??
        "w-full text-left rounded-sm px-3 py-2 text-body text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground cursor-pointer transition-colors duration-fast"
      }
    >
      Replay tour
    </button>
  );
}
