// LoadLead in-app guided tour.
//
// Built on Shepherd.js. Each persona has its own independent step config -
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
  /** Target selector always `[data-tour="…"]`. Omit for centered step. */
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

/** Tour variant separates the dashboard tour from a settings sub-tour
 * so each completion is tracked independently in localStorage. */
type TourVariant = "dashboard" | "settings";

/* ─── helpers ───────────────────────────────────────────────────────────── */

const STORAGE_PREFIX = "loadlead.tour.completed.";
const storageKey = (persona: Persona, variant: TourVariant) =>
  `${STORAGE_PREFIX}${persona}.${variant}`;

const storage = {
  get(persona: Persona, variant: TourVariant = "dashboard"): boolean {
    try {
      // Back-compat: the original key didn't include the variant suffix.
      const legacy = localStorage.getItem(STORAGE_PREFIX + persona);
      if (variant === "dashboard" && legacy === "1") return true;
      return localStorage.getItem(storageKey(persona, variant)) === "1";
    } catch {
      return false;
    }
  },
  set(persona: Persona, variant: TourVariant = "dashboard") {
    try {
      localStorage.setItem(storageKey(persona, variant), "1");
    } catch {
      /* private mode etc. */
    }
  },
  clear(persona: Persona, variant?: TourVariant) {
    try {
      if (!variant) {
        // Clear all variants for this persona, including the legacy key.
        localStorage.removeItem(STORAGE_PREFIX + persona);
        localStorage.removeItem(storageKey(persona, "dashboard"));
        localStorage.removeItem(storageKey(persona, "settings"));
      } else {
        localStorage.removeItem(storageKey(persona, variant));
      }
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
  // CSS handles them index.css's prefers-reduced-motion rule collapses
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
      text: "Three things to set up: your company, your drivers, and your dispatch board. We'll show you each in under a minute.",
    },
    {
      id: "carrier-company",
      title: "Your company profile",
      text: "Everything we run for you starts here. Legal name, MC, DOT, address, insurance: all of it lives on this tab.",
      attachTo: { element: '[data-tour="carrier-company"]', on: "bottom" },
      waitFor: '[data-tour="carrier-company"]',
    },
    {
      id: "verification-panel",
      title: "Verification is your unlock",
      text: [
        "We check your FMCSA authority, your KYB, your insurance documents, and your AML status from this panel.",
        "There are five states to watch: Unverified, Submitted, Pending, Verified, and Rejected.",
        "You can onboard drivers as soon as your status is Pending. Loads only broadcast to your roster once you reach Verified.",
      ],
      attachTo: { element: '[data-tour="verification-panel"]', on: "right" },
      waitFor: '[data-tour="verification-panel"]',
    },
    {
      id: "onboard-drivers",
      title: "Onboard your roster",
      text: "Add a driver directly or send them an invite link. Each driver completes their own identity check (IDV) once and you're set.",
      attachTo: { element: '[data-tour="onboard-drivers"]', on: "left" },
      waitFor: '[data-tour="onboard-drivers"]',
    },
    {
      id: "load-board",
      title: "Dispatching loads",
      text: "Once you're verified, shippers' loads land here, filtered by what your fleet can haul. You can accept on a driver's behalf, or let the driver self-accept from their own offer.",
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
      text: "You wear two hats here: the carrier and the driver. We'll cover your identity check, your fleet, and your loadboard.",
    },
    {
      id: "oo-verification",
      title: "Verify the business and yourself",
      text: [
        "We need to verify two things: your business (FMCSA and KYB) and you personally (IDV).",
        "It's the same five-state panel a carrier uses. The verified business lets you broadcast loads. The verified identity lets you self-haul.",
      ],
      attachTo: { element: '[data-tour="oo-verification"]', on: "right" },
      waitFor: '[data-tour="oo-verification"]',
    },
    {
      id: "oo-fleet",
      title: "Your fleet",
      text: "We created a self-driver record for you by default. Add more drivers as you grow. Each one completes their own IDV.",
      attachTo: { element: '[data-tour="oo-fleet"]', on: "bottom" },
      waitFor: '[data-tour="oo-fleet"]',
    },
    {
      id: "oo-loadboard",
      title: "Your self-haul loadboard",
      text: "Eligible loads land here, matched against your equipment, capacity, and lanes. Accept one and it becomes a live haul on your account.",
      attachTo: { element: '[data-tour="oo-loadboard"]', on: "top" },
      waitFor: '[data-tour="oo-loadboard"]',
    },
    {
      id: "oo-status",
      title: "While the load runs",
      text: "Status updates and POD upload work the same as they do for an employed driver. Payment routes to your business by default.",
      hint: "Change payment routing in Settings, under Payouts.",
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
      text: "Five quick stops: complete your identity check, join a carrier, see your live offers, accept one, then update status and upload the POD when you deliver.",
    },
    {
      id: "driver-idv",
      title: "Step 1: verify your identity",
      text: "Tap Start IDV to verify yourself one time. This unlocks your driver profile across every carrier you might haul for.",
      attachTo: { element: '[data-tour="driver-idv"]', on: "bottom" },
      waitFor: '[data-tour="driver-idv"]',
    },
    {
      id: "driver-affiliation",
      title: "Step 2: join a carrier to start hauling",
      text: [
        "Identity alone does not let you haul. To take live offers you must be affiliated with a verified Carrier or an Owner Operator.",
        "Either accept their invite or have their dispatcher add you. Until that happens, offers will not broadcast to you.",
      ],
      attachTo: { element: '[data-tour="driver-affiliation"]', on: "bottom" },
      waitFor: '[data-tour="driver-affiliation"]',
      hint: "If you're already affiliated, this card shows your carrier's name and you're ready to go.",
    },
    {
      id: "driver-offers",
      title: "Step 3: your live offers",
      text: "Each card shows the lane, the equipment, the rate, and a countdown timer. One tap accepts. Declined offers disappear from your board.",
      attachTo: { element: '[data-tour="driver-offers"]', on: "top" },
      waitFor: '[data-tour="driver-offers"]',
    },
    {
      id: "driver-status",
      title: "Step 4: status and POD",
      text: "Once you accept a load, update status as you go: At pickup, In transit, Delivered. Upload the BOL or POD at the end to close it out.",
      hint: "Your earnings show in Analytics, and your history is one click away.",
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
      text: "Two main things to learn: how to post a load with the right equipment and commodity, and how to track it once it broadcasts.",
    },
    {
      id: "shipper-post-cta",
      title: "Post a load",
      text: "Start here. The values you enter on the form drive everything downstream: who is eligible, who gets matched, and who sees the offer.",
      attachTo: { element: '[data-tour="shipper-post-cta"]', on: "bottom" },
      waitFor: '[data-tour="shipper-post-cta"]',
    },
    {
      id: "post-load-type",
      title: "Load type fields",
      text: [
        "Pick Mode (FTL, LTL, Partial), Service type, and Equipment class from the lists. These are not free-text fields.",
        "These choices decide which carriers and drivers see your offer.",
      ],
      attachTo: { element: '[data-tour="post-load-type"]', on: "right" },
      waitFor: '[data-tour="post-load-type"]',
    },
    {
      id: "post-commodity",
      title: "Commodity and accessorials",
      text: "Commodity is searchable across 100 plus entries. Accessorials are multi-select. Some commodities flag hazmat on automatically; leave it on if it applies.",
      attachTo: { element: '[data-tour="post-commodity"]', on: "right" },
      waitFor: '[data-tour="post-commodity"]',
    },
    {
      id: "shipper-tracking",
      title: "Once it broadcasts",
      text: "After you Post, the offer fans out to eligible drivers. Your dashboard shows active loads, live driver location once one accepts, and the ETA to delivery.",
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
      text: "Receivers skip the FMCSA and KYB process. You'll just set up your facility profile and watch your inbound shipments.",
    },
    {
      id: "receiver-facility",
      title: "Your facility",
      text: "Address, dock and forklift availability, and freight format. This is how shippers tell drivers what to expect when they arrive at your dock.",
      attachTo: { element: '[data-tour="receiver-facility"]', on: "right" },
      waitFor: '[data-tour="receiver-facility"]',
    },
    {
      id: "inbound-loads",
      title: "Inbound loads",
      text: "Every load with you as the consignee shows up here with a live ETA. Sort by arrival window to plan your dock for the day.",
      attachTo: { element: '[data-tour="inbound-loads"]', on: "top" },
      waitFor: '[data-tour="inbound-loads"]',
    },
    {
      id: "confirm-delivery",
      title: "Confirm delivery",
      text: "When the driver arrives, open the load, check the BOL, and tap Confirm delivery. That stamps the POD on the load and triggers payment release.",
      attachTo: { element: '[data-tour="confirm-delivery"]', on: "left" },
      waitFor: '[data-tour="confirm-delivery"]',
    },
  ],
};

/* ─── universal rail steps appended to every persona's dashboard tour ─── */

const railSteps: StepDef[] = [
  {
    id: "rail-nav",
    title: "Your menu",
    text: "Every page you'll use lives one click away on this rail. The items change with your role, so you only see what's relevant to you.",
    attachTo: { element: '[data-tour="rail-nav"]', on: "right" },
    waitFor: '[data-tour="rail-nav"]',
  },
  {
    id: "rail-settings",
    title: "Settings",
    text: "Your profile, equipment, identity verification, business verification, organisation, and security all live in Settings.",
    attachTo: { element: '[data-tour="rail-settings"]', on: "right" },
    waitFor: '[data-tour="rail-settings"]',
    hint: "We'll walk you through Settings the first time you open it.",
  },
  {
    id: "rail-account",
    title: "Your account",
    text: "Your email, role, and sign-out are right here at the bottom of the rail. Use the Replay tour link any time you want this guide back.",
    attachTo: { element: '[data-tour="rail-account"]', on: "right" },
    waitFor: '[data-tour="rail-account"]',
  },
];

// Append rail steps to each persona's dashboard tour so every persona ends
// the same way covering the menus + the door into Settings.
[carrierAdmin, ownerOperator, driver, shipper, receiver].forEach((t) => {
  t.steps = [...t.steps, ...railSteps];
});

const TOURS: Record<Persona, PersonaTour> = {
  CARRIER_ADMIN: carrierAdmin,
  OWNER_OPERATOR: ownerOperator,
  DRIVER: driver,
  SHIPPER: shipper,
  RECEIVER: receiver,
};

/* ─── Settings sub-tours ────────────────────────────────────────────────── */
//
// One per persona. Triggers the first time the user lands on the matching
// /settings path. Targets the Settings page's tablist + key tabs.

const settingsTours: Record<Persona, PersonaTour> = {
  CARRIER_ADMIN: {
    persona: "CARRIER_ADMIN",
    label: "Carrier admin settings",
    steps: [
      {
        id: "intro",
        title: "Your settings",
        text: "Six tabs cover everything the carrier company needs. We'll walk through the ones you'll use most often.",
      },
      {
        id: "settings-tabs",
        title: "The tab rail",
        text: "Click any tab to manage that area. Each tab is independent, so changes you make in one don't affect the others.",
        attachTo: { element: '[data-tour="settings-tabs"]', on: "right" },
        waitFor: '[data-tour="settings-tabs"]',
      },
      {
        id: "settings-tab-company",
        title: "Company",
        text: "Your legal name, MC and DOT numbers, address, contact info, and the main operating details for your company.",
        attachTo: { element: '[data-tour="settings-tab-company"]', on: "right" },
        waitFor: '[data-tour="settings-tab-company"]',
      },
      {
        id: "settings-tab-biz",
        title: "Business verification",
        text: "The five-state panel for FMCSA, KYB, and AML checks. You can't broadcast loads to your roster until this reaches Verified.",
        attachTo: { element: '[data-tour="settings-tab-biz"]', on: "right" },
        waitFor: '[data-tour="settings-tab-biz"]',
      },
      {
        id: "settings-tab-security",
        title: "Security",
        text: "Password, two-factor authentication, and active sessions. We recommend turning on 2FA before you onboard your first driver.",
        attachTo: { element: '[data-tour="settings-tab-security"]', on: "right" },
        waitFor: '[data-tour="settings-tab-security"]',
      },
    ],
  },
  OWNER_OPERATOR: {
    persona: "OWNER_OPERATOR",
    label: "Owner Operator settings",
    steps: [
      {
        id: "intro",
        title: "Your settings",
        text: "Four tabs to manage: Profile, Fleet, Verification, and Security. As an Owner Operator you cover both the company side and the driver side in one place.",
      },
      {
        id: "settings-tabs",
        title: "The tab rail",
        text: "Click any tab to manage that area. Each one is its own independent panel.",
        attachTo: { element: '[data-tour="settings-tabs"]', on: "right" },
        waitFor: '[data-tour="settings-tabs"]',
      },
      {
        id: "settings-tab-profile",
        title: "Profile",
        text: "Legal name, DBA, contact info, address. Your own equipment and CDL details live at the bottom of this tab, since you're also a driver.",
        attachTo: { element: '[data-tour="settings-tab-profile"]', on: "right" },
        waitFor: '[data-tour="settings-tab-profile"]',
      },
      {
        id: "settings-tab-fleet",
        title: "Fleet",
        text: "Manage your drivers (including yourself), invite new ones, and review their IDV status.",
        attachTo: { element: '[data-tour="settings-tab-fleet"]', on: "right" },
        waitFor: '[data-tour="settings-tab-fleet"]',
      },
      {
        id: "settings-tab-security",
        title: "Security",
        text: "Password and two-factor authentication. We recommend turning on 2FA before you start accepting live loads.",
        attachTo: { element: '[data-tour="settings-tab-security"]', on: "right" },
        waitFor: '[data-tour="settings-tab-security"]',
      },
    ],
  },
  DRIVER: {
    persona: "DRIVER",
    label: "Driver settings",
    steps: [
      {
        id: "intro",
        title: "Your settings",
        text: "Seven tabs cover your driver record. You'll spend most of your time in Profile, Equipment, and ID Verification.",
      },
      {
        id: "settings-tabs",
        title: "The tab rail",
        text: "Click any tab to manage that area. Each one is its own independent panel.",
        attachTo: { element: '[data-tour="settings-tabs"]', on: "right" },
        waitFor: '[data-tour="settings-tabs"]',
      },
      {
        id: "settings-tab-profile",
        title: "Profile",
        text: "Your legal name, CDL, contact info, and current location. This is what every potential carrier sees about you.",
        attachTo: { element: '[data-tour="settings-tab-profile"]', on: "right" },
        waitFor: '[data-tour="settings-tab-profile"]',
      },
      {
        id: "settings-tab-equipment",
        title: "Equipment",
        text: "Your truck, your trailer, and your capacity. This drives load matching: if your equipment doesn't fit a load, you won't see the offer.",
        attachTo: { element: '[data-tour="settings-tab-equipment"]', on: "right" },
        waitFor: '[data-tour="settings-tab-equipment"]',
      },
      {
        id: "settings-tab-id",
        title: "ID Verification",
        text: "Complete your IDV one time here. Note that a verified identity does not mean you can haul yet. You still need to be affiliated with a carrier or owner operator.",
        attachTo: { element: '[data-tour="settings-tab-id"]', on: "right" },
        waitFor: '[data-tour="settings-tab-id"]',
      },
      {
        id: "settings-tab-security",
        title: "Security",
        text: "Password and two-factor authentication. 2FA is required before you can take live offers.",
        attachTo: { element: '[data-tour="settings-tab-security"]', on: "right" },
        waitFor: '[data-tour="settings-tab-security"]',
      },
    ],
  },
  SHIPPER: {
    persona: "SHIPPER",
    label: "Shipper settings",
    steps: [
      {
        id: "intro",
        title: "Your settings",
        text: "The shipper settings. Profile, business verification, and security are the three you'll want to complete before going live.",
      },
      {
        id: "settings-tabs",
        title: "The tab rail",
        text: "Click any tab to manage that area. Each one is its own independent panel.",
        attachTo: { element: '[data-tour="settings-tabs"]', on: "right" },
        waitFor: '[data-tour="settings-tabs"]',
      },
      {
        id: "settings-tab-profile",
        title: "Profile",
        text: "Your shipper company info: legal name, contact, default pickup facility, and billing email.",
        attachTo: { element: '[data-tour="settings-tab-profile"]', on: "right" },
        waitFor: '[data-tour="settings-tab-profile"]',
      },
      {
        id: "settings-tab-biz",
        title: "Business verification",
        text: "We verify your business so carriers can trust your offers. Some lanes won't broadcast until you're verified.",
        attachTo: { element: '[data-tour="settings-tab-biz"]', on: "right" },
        waitFor: '[data-tour="settings-tab-biz"]',
      },
      {
        id: "settings-tab-security",
        title: "Security",
        text: "Password and two-factor authentication. We recommend turning on 2FA on any account that posts loads.",
        attachTo: { element: '[data-tour="settings-tab-security"]', on: "right" },
        waitFor: '[data-tour="settings-tab-security"]',
      },
    ],
  },
  RECEIVER: {
    persona: "RECEIVER",
    label: "Receiver settings",
    steps: [
      {
        id: "intro",
        title: "Your settings",
        text: "Receivers skip the FMCSA and KYB process. You'll just manage your facility info and your security settings.",
      },
      {
        id: "settings-tabs",
        title: "The tab rail",
        text: "Click any tab to manage that area. Each one is its own independent panel.",
        attachTo: { element: '[data-tour="settings-tabs"]', on: "right" },
        waitFor: '[data-tour="settings-tabs"]',
      },
      {
        id: "settings-tab-profile",
        title: "Profile",
        text: "Facility name, address, dock availability, forklift, and freight format. This is what shippers tell drivers about your dock.",
        attachTo: { element: '[data-tour="settings-tab-profile"]', on: "right" },
        waitFor: '[data-tour="settings-tab-profile"]',
      },
      {
        id: "settings-tab-security",
        title: "Security",
        text: "Password and two-factor authentication. We recommend turning on 2FA for anyone confirming POD on inbound loads.",
        attachTo: { element: '[data-tour="settings-tab-security"]', on: "right" },
        waitFor: '[data-tour="settings-tab-security"]',
      },
    ],
  },
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

function buildTour(personaTour: PersonaTour, variant: TourVariant = "dashboard"): Tour {
  // @ts-expect-error shepherd's default export typing isn't great in v14
  const tour: Tour = new Shepherd.Tour({
    useModalOverlay: true,
    defaultStepOptions,
    keyboardNavigation: true,   // Tab / Shift+Tab between buttons; Esc cancels
    exitOnEsc: true,
  });

  personaTour.steps.forEach((step, idx) => {
    const isFirst = idx === 0;
    const isLast = idx === personaTour.steps.length - 1;

    // Shepherd v14: action() must be a regular function so `this` binds
    // to the Tour instance. An arrow function silently does nothing.
    const buttons: any[] = [];
    if (!isFirst) {
      buttons.push({
        text: "Back",
        action() {
          (this as any).back();
        },
        secondary: true,
        classes: "loadlead-tour-btn loadlead-tour-btn--secondary",
      });
    }
    buttons.push({
      text: isLast ? "Finish" : "Next",
      action() {
        (this as any).next();
      },
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

  tour.on("complete", () => storage.set(personaTour.persona, variant));
  tour.on("cancel", () => storage.set(personaTour.persona, variant));

  return tour;
}

/* ─── React surface ─────────────────────────────────────────────────────── */

interface TourCtxValue {
  start: (opts?: { force?: boolean; variant?: TourVariant }) => void;
  reset: (variant?: TourVariant) => void;
  hasCompleted: (variant?: TourVariant) => boolean;
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
    (opts?: { force?: boolean; variant?: TourVariant }) => {
      if (!persona) return;
      const variant = opts?.variant ?? "dashboard";
      if (!opts?.force && storage.get(persona, variant)) return;
      // Late-bind: build a fresh tour each start so cancelled-then-replayed
      // tours don't reuse stale Shepherd state.
      const config = variant === "settings" ? settingsTours[persona] : TOURS[persona];
      const t = buildTour(config, variant);
      tourRef.current = t;
      t.start();
    },
    [persona],
  );

  const reset = useCallback(
    (variant?: TourVariant) => {
      if (!persona) return;
      storage.clear(persona, variant);
      tourRef.current?.cancel();
      tourRef.current = null;
    },
    [persona],
  );

  const hasCompleted = useCallback(
    (variant?: TourVariant) => (persona ? storage.get(persona, variant ?? "dashboard") : false),
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
    const path = location.pathname;
    const onDashboard = path.startsWith(dashboardPaths[persona]);
    const onSettings = path.startsWith("/settings") || path.startsWith("/owner-operator/settings");

    // Auto-start the SETTINGS tour the first time the user lands on Settings -
    // wins precedence over the dashboard tour because the user is clearly here.
    if (onSettings && !storage.get(persona, "settings")) {
      const t = setTimeout(() => start({ variant: "settings" }), 700);
      return () => clearTimeout(t);
    }

    if (onDashboard && !storage.get(persona, "dashboard")) {
      const t = setTimeout(() => start(), 700);
      return () => clearTimeout(t);
    }

    return undefined;
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

/** Drop into the rail footer / account menu. Replays whichever tour is
 *  contextual to the current route: settings tour on /settings*, otherwise
 *  the persona's dashboard tour. */
export function TourReplayButton({ className }: { className?: string }) {
  const tour = useTour();
  const location = useLocation();
  if (!tour.persona) return null;
  const onSettings =
    location.pathname.startsWith("/settings") ||
    location.pathname.startsWith("/owner-operator/settings");
  const variant: TourVariant = onSettings ? "settings" : "dashboard";
  return (
    <button
      type="button"
      onClick={() => {
        tour.reset(variant);
        tour.start({ force: true, variant });
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
