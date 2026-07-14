/**
 * Hauler on-board capacity - frontend surfaces (Phases 3, 4, 6).
 *
 * One snapshot drives everything: the dashboard chip, the load-detail chip, the
 * smart login prompt, and the registration step all read GET /api/capacity/me
 * and declare through POST /api/capacity/declare. Capacity is informational: it
 * never blocks registration, login, or opening a load. Sentence case, plain
 * language, whole pounds, no dashes.
 */
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";

export interface CapacitySnapshot {
  equipmentId: string;
  ratedWeightLbs: number;
  platformActiveWeightLbs: number;
  declaredExternalWeightLbs: number;
  onboardWeightLbs: number;
  remainingWeightLbs: number;
  declState: "EMPTY" | "LOADED" | "UNKNOWN";
  declaredAt?: number;
  hasActivePlatformLoad: boolean;
  stale: boolean;
}

const lbs = (n: number | undefined) => `${(n ?? 0).toLocaleString()} lbs`;

/** Mirror of the server rule: prompt only when state is unknown or stale and no platform load is active. */
export function needsCapacityPrompt(c: CapacitySnapshot | null): boolean {
  if (!c) return false;
  if (c.hasActivePlatformLoad) return false;
  return c.declState === "UNKNOWN" || c.stale;
}

export function useCapacity(enabled = true) {
  const [capacity, setCapacity] = useState<CapacitySnapshot | null>(null);
  const [loading, setLoading] = useState(enabled);

  const refresh = useCallback(async () => {
    try {
      const r = await api.getCapacity();
      setCapacity(r.capacity as CapacitySnapshot);
    } catch {
      setCapacity(null); // unknown, treated as full rated by matching; chip hides
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (enabled) void refresh();
  }, [enabled, refresh]);

  return { capacity, loading, refresh, setCapacity };
}

/**
 * The empty/loaded declare controls, reused by the chip, the login prompt, and the
 * registration step. `ratedWeightLbs` bounds the loaded weight. Calls back with the
 * fresh snapshot; the caller decides what to do next (all callers keep flowing).
 */
export function CapacityDeclareControls({
  ratedWeightLbs,
  source,
  onDeclared,
  compact,
}: {
  ratedWeightLbs: number;
  source: "REGISTRATION" | "LOGIN_PROMPT" | "DASHBOARD";
  onDeclared?: (c: CapacitySnapshot) => void;
  compact?: boolean;
}) {
  const [mode, setMode] = useState<"idle" | "loaded">("idle");
  const [weight, setWeight] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const declare = async (state: "EMPTY" | "LOADED", weightLbs?: number) => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.declareCapacity({ state, weightLbs, source });
      onDeclared?.(r.capacity as CapacitySnapshot);
    } catch (e: any) {
      setError(e?.message || "Could not save that. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const submitLoaded = () => {
    const w = Math.round(Number(weight));
    if (!Number.isFinite(w) || w <= 0) return setError("Enter the weight on board in pounds.");
    if (w > ratedWeightLbs) return setError(`That is above your rated capacity of ${lbs(ratedWeightLbs)}.`);
    void declare("LOADED", w);
  };

  return (
    <div className={compact ? "flex flex-col gap-2" : "space-y-3"}>
      {mode === "idle" ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void declare("EMPTY")}
            className="rounded-md border border-border bg-card px-3 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
          >
            Confirm empty
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setMode("loaded")}
            className="rounded-md border border-primary bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            I'm loaded
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={ratedWeightLbs}
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            placeholder="Weight on board (lbs)"
            className="w-44 rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
          <button
            type="button"
            disabled={busy}
            onClick={submitLoaded}
            className="rounded-md border border-primary bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            Save
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => { setMode("idle"); setError(null); }}
            className="rounded-md px-2 py-2 text-sm text-muted-foreground hover:text-foreground"
          >
            Back
          </button>
        </div>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

/**
 * Capacity chip - remaining prominent, rated secondary, amber stale badge, tap to
 * update. Hidden entirely if we have no snapshot (unknown capacity shows nothing
 * rather than a wrong number). Used on the dashboard status rail and load detail.
 */
export function CapacityChip({
  capacity,
  onChanged,
  className,
}: {
  capacity: CapacitySnapshot | null;
  onChanged?: (c: CapacitySnapshot) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  if (!capacity) return null;

  const c = capacity;
  return (
    <div className={`rounded-xl border bg-card p-4 ${className ?? ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Available capacity
          </div>
          <div className="mt-0.5 text-2xl font-semibold tabular-nums">{lbs(c.remainingWeightLbs)}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            of {lbs(c.ratedWeightLbs)} rated
            {c.hasActivePlatformLoad ? " · a LoadLead load is on board" : ""}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          {c.stale && (
            <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">
              Needs update
            </span>
          )}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="text-xs font-medium text-primary hover:underline"
          >
            {open ? "Close" : "Update"}
          </button>
        </div>
      </div>
      {open && (
        <div className="mt-3 border-t border-border pt-3">
          {c.hasActivePlatformLoad && (
            <p className="mb-2 text-xs text-muted-foreground">
              A LoadLead load is on board, so its weight stays counted. Declaring empty only clears freight you picked up elsewhere.
            </p>
          )}
          <CapacityDeclareControls
            ratedWeightLbs={c.ratedWeightLbs}
            source="DASHBOARD"
            onDeclared={(next) => { onChanged?.(next); setOpen(false); }}
          />
        </div>
      )}
    </div>
  );
}

/** Self-fetching chip: drop it anywhere for a hauler with no parent wiring. */
export function CapacityChipSelf({ className }: { className?: string }) {
  const { capacity, setCapacity } = useCapacity();
  if (!capacity) return null;
  return <CapacityChip capacity={capacity} onChanged={setCapacity} className={className} />;
}

/**
 * Smart login prompt (Phase 4). Lightweight, not a blocking wall. Shows only when
 * the snapshot needs it (unknown or stale, no active platform load). Dismiss leaves
 * the stale state and never nags again in the same session.
 */
export function CapacityLoginPrompt() {
  const { capacity, refresh, setCapacity } = useCapacity();
  const [dismissed, setDismissed] = useState(
    () => sessionStorage.getItem("ll_capacity_prompt_dismissed") === "1",
  );

  if (dismissed || !needsCapacityPrompt(capacity) || !capacity) return null;

  const dismiss = () => {
    sessionStorage.setItem("ll_capacity_prompt_dismissed", "1");
    setDismissed(true);
  };

  return (
    <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium">Still empty?</div>
          <div className="text-xs text-muted-foreground">
            Confirm what's on your truck so we only show loads you can carry.
          </div>
        </div>
        <button type="button" onClick={dismiss} className="text-xs text-muted-foreground hover:text-foreground">
          Not now
        </button>
      </div>
      <div className="mt-3">
        <CapacityDeclareControls
          ratedWeightLbs={capacity.ratedWeightLbs}
          source="LOGIN_PROMPT"
          onDeclared={(next) => { setCapacity(next); void refresh(); }}
          compact
        />
      </div>
    </div>
  );
}

/**
 * Registration step (Phase 3). Rated capacity prefilled by equipment type
 * (editable), then "what's on your truck right now". Never blocks completion -
 * the parent onboarding calls onComplete either way.
 */
export function CapacityRegistrationStep({
  trailerType,
  defaultRatedLbs,
  onComplete,
}: {
  trailerType?: string;
  defaultRatedLbs?: number;
  onComplete: () => void;
}) {
  const [rated, setRated] = useState<string>(defaultRatedLbs ? String(defaultRatedLbs) : "");
  const [ratedSaved, setRatedSaved] = useState(false);
  const [snapshot, setSnapshot] = useState<CapacitySnapshot | null>(null);
  const [savingRated, setSavingRated] = useState(false);

  const saveRated = async () => {
    const r = Math.round(Number(rated));
    if (!Number.isFinite(r) || r <= 0) return;
    setSavingRated(true);
    try {
      await api.updateDriverProfile({ maxCapacityLbs: r });
      setRatedSaved(true);
    } catch { /* rated save is best-effort; capacity never blocks registration */ }
    finally { setSavingRated(false); }
  };

  const ratedNum = Math.max(0, Math.round(Number(rated)) || 0);

  return (
    <div className="space-y-4">
      <div>
        <label className="mb-1 block text-sm font-medium">Your trailer's maximum payload</label>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="number"
            inputMode="numeric"
            min={1}
            value={rated}
            onChange={(e) => { setRated(e.target.value); setRatedSaved(false); }}
            onBlur={saveRated}
            placeholder="lbs"
            className="w-40 rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
          <span className="text-xs text-muted-foreground">
            {trailerType ? `Prefilled for ${trailerType.replace(/_/g, " ").toLowerCase()}. ` : ""}Edit if yours differs.
          </span>
          {savingRated && <span className="text-xs text-muted-foreground">Saving...</span>}
          {ratedSaved && <span className="text-xs text-emerald-600">Saved</span>}
        </div>
      </div>

      <div className="rounded-xl border bg-card p-4">
        <div className="text-sm font-medium">What's on your truck right now?</div>
        {snapshot ? (
          <p className="mt-2 text-sm">
            You have <span className="font-semibold tabular-nums">{lbs(snapshot.remainingWeightLbs)}</span> available.
          </p>
        ) : (
          <div className="mt-3">
            <CapacityDeclareControls
              ratedWeightLbs={ratedNum}
              source="REGISTRATION"
              onDeclared={setSnapshot}
            />
          </div>
        )}
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => { void saveRated(); onComplete(); }}
          className="rounded-md border border-primary bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          Continue
        </button>
      </div>
    </div>
  );
}
