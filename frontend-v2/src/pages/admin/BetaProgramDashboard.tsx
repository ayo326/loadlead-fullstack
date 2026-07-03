/**
 * Beta Program Dashboard — the staff control surface for the private beta.
 * Lives in the admin bundle (admin.loadleadapp.com). Exact-ADMIN gated on
 * the server (every /api/admin/beta/* call 403s a non-ADMIN); this page is
 * the operator UX over those endpoints.
 *
 * Sections:
 *   - Cohort balance widget (HEADLINE — live shipper:carrier ratio vs cap)
 *   - Pipeline table filterable by status + side + wave
 *   - Application detail drawer: answers, autoFlags, score editor,
 *     lane-overlap helper, notes, admit / waitlist actions
 *   - Allowlist + Waitlist tabs
 */

import { useEffect, useState, useCallback } from "react";
import {
  api, type BetaApplicationRow, type CohortBalance, type LaneOverlap,
  type AllowlistEntry, type WaitlistRow,
} from "@/lib/api";
import { SubmittedIntakeDrawer } from "@/components/beta/SubmittedIntakeDrawer";

const STATUSES = ["NEW", "QUALIFIED", "WAITLISTED", "ADMITTED", "INVITED", "ONBOARDED", "DISQUALIFIED"] as const;
const STATUS_TONE: Record<string, string> = {
  NEW: "bg-zinc-100 text-zinc-700",
  QUALIFIED: "bg-blue-100 text-blue-800",
  WAITLISTED: "bg-amber-100 text-amber-800",
  ADMITTED: "bg-violet-100 text-violet-800",
  INVITED: "bg-emerald-100 text-emerald-800",
  ONBOARDED: "bg-emerald-200 text-emerald-900",
  DISQUALIFIED: "bg-rose-100 text-rose-800",
};

type Tab = "pipeline" | "allowlist" | "waitlist";

export default function BetaProgramDashboard() {
  const [tab, setTab] = useState<Tab>("pipeline");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Beta Program</h1>
        <p className="text-sm text-muted-foreground">
          Applications from Tally, scoring, admit-to-invite, and cohort balance.
        </p>
      </div>

      <CohortBalanceWidget />

      <div className="flex gap-1 border-b border-border">
        {(["pipeline", "allowlist", "waitlist"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px capitalize transition-colors ${
              tab === t
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "pipeline" && <PipelineTab />}
      {tab === "allowlist" && <AllowlistTab />}
      {tab === "waitlist" && <WaitlistTab />}
    </div>
  );
}

// ─── Cohort balance (HEADLINE metric) ───────────────────────────────────────

/** Map the server's balance verdict to a label + Tailwind color classes. */
function balanceBadge(b: CohortBalance): { label: string; cls: string } {
  switch (b.balanceState) {
    case "BALANCED":
      return { label: "✓ Balanced", cls: "bg-emerald-100 text-emerald-800" };
    case "NEED_CARRIERS":
      return { label: "⚠ Need carriers", cls: "bg-amber-100 text-amber-900" };
    case "NEED_SHIPPERS":
      return { label: "⚠ Need shippers", cls: "bg-amber-100 text-amber-900" };
    case "SKEWED":
      return { label: `⚠ Skewed to ${b.skewedTo}`, cls: "bg-amber-100 text-amber-900" };
    case "EMPTY":
    default:
      return { label: "No applicants yet", cls: "bg-zinc-100 text-zinc-600" };
  }
}

function RatioBar({ shippers, carriers, dim }: { shippers: number; carriers: number; dim?: boolean }) {
  const total = shippers + carriers;
  const shipperPct = total === 0 ? 50 : Math.round((shippers / total) * 100);
  const base = dim ? "opacity-60" : "";
  return (
    <div className={`flex h-6 rounded-md overflow-hidden text-xs font-medium ${base}`}
      aria-label={`${shippers} shippers, ${carriers} carriers`}>
      {total === 0 ? (
        <div className="flex-1 bg-zinc-200 text-zinc-500 flex items-center justify-center">0 : 0</div>
      ) : (
        <>
          <div className="bg-blue-500 text-white flex items-center justify-center" style={{ width: `${shipperPct}%` }}>
            {shippers > 0 ? shippers : ""}
          </div>
          <div className="bg-violet-500 text-white flex items-center justify-center" style={{ width: `${100 - shipperPct}%` }}>
            {carriers > 0 ? carriers : ""}
          </div>
        </>
      )}
    </div>
  );
}

function CohortBalanceWidget() {
  const [b, setB] = useState<CohortBalance | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    api.adminBeta.cohortBalance().then(setB).catch((e) => setErr(e.message));
  }, []);

  if (err) return <div className="text-sm text-rose-700">Could not load cohort balance: {err}</div>;
  if (!b) return <div className="text-sm text-muted-foreground">Loading cohort balance…</div>;

  const badge = balanceBadge(b);

  return (
    <div className="rounded-lg border border-border bg-card p-5 gtile gtile-brand">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-sm font-semibold text-foreground">
          Cohort balance — {b.currentCohort}
        </h2>
        <span
          className={`text-xs font-medium px-2 py-0.5 rounded-full ${badge.cls}`}
          title="Target is ~1:1 shippers to carriers. A BOTH applicant counts toward both sides. The badge measures the admitted cohort once any seat is filled, otherwise the qualified pipeline."
        >
          {badge.label}
        </span>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        Measuring the {b.measuring === "admitted" ? "admitted cohort" : "qualified pipeline"} · target {b.ratioTarget}
      </p>

      {/* Two explicit populations — no single misleading number. */}
      <div className="space-y-3">
        <div className={b.measuring === "admitted" ? "" : "opacity-70"}>
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="font-medium text-foreground">
              Admitted {b.admitted.shippers} shippers : {b.admitted.carriers} carriers
              {b.measuring === "admitted" && <span className="ml-1 text-emerald-700">(scored)</span>}
            </span>
          </div>
          <RatioBar shippers={b.admitted.shippers} carriers={b.admitted.carriers} dim={b.measuring !== "admitted"} />
        </div>

        <div className={b.measuring === "pipeline" ? "" : "opacity-70"}>
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="font-medium text-foreground">
              Pipeline {b.pipeline.shippers} shippers : {b.pipeline.carriers} carriers
              {b.measuring === "pipeline" && <span className="ml-1 text-emerald-700">(scored)</span>}
            </span>
          </div>
          <RatioBar shippers={b.pipeline.shippers} carriers={b.pipeline.carriers} dim={b.measuring !== "pipeline"} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 mt-4 text-center">
        <Stat label="Seats filled" value={`${b.seatsFilled}${b.cohortCap ? ` / ${b.cohortCap}` : ""}`} />
        <Stat label="Ratio target" value={b.ratioTarget} />
      </div>

      {(b.admitted.both > 0 || b.pipeline.both > 0) && (
        <p className="text-[11px] text-muted-foreground mt-3">
          “Both” applicants ({b.measuring === "admitted" ? b.admitted.both : b.pipeline.both}) count toward
          both the shipper and carrier tallies — they supply and demand freight.
        </p>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-lg font-semibold text-foreground">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

// ─── Pipeline tab ───────────────────────────────────────────────────────────

function PipelineTab() {
  const [apps, setApps] = useState<BetaApplicationRow[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    setLoading(true);
    api.adminBeta
      .listApplications(statusFilter ? { status: statusFilter } : undefined)
      .then((r) => setApps(r.applications))
      .finally(() => setLoading(false));
  }, [statusFilter]);

  useEffect(() => { reload(); }, [reload]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <label className="text-sm text-muted-foreground">Filter:</label>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded border border-border bg-background px-2 py-1 text-sm"
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <a
          href={`${(import.meta.env.VITE_API_URL ?? "")}/api/admin/beta/export/applications.csv`}
          className="ml-auto text-sm text-primary hover:underline"
        >
          Export CSV
        </a>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading applications…</div>
      ) : apps.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No applications yet. When the Tally form is connected and submissions
          arrive, they appear here.
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Applicant</th>
                <th className="text-left px-3 py-2 font-medium">Side</th>
                <th className="text-left px-3 py-2 font-medium">Texas</th>
                <th className="text-left px-3 py-2 font-medium">Score</th>
                <th className="text-left px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {apps.map((a) => (
                <tr key={a.applicationId} className="border-t border-border hover:bg-muted/30">
                  <td className="px-3 py-2">
                    <div className="font-medium text-foreground">{a.fullName || a.workEmail}</div>
                    <div className="text-xs text-muted-foreground">{a.company ?? a.workEmail}</div>
                  </td>
                  <td className="px-3 py-2">{a.side}</td>
                  <td className="px-3 py-2">{a.texasFocus}</td>
                  <td className="px-3 py-2 font-medium">{a.score ?? "—"}<span className="text-muted-foreground">/15</span></td>
                  <td className="px-3 py-2">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_TONE[a.status]}`}>
                      {a.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => setSelected(a.applicationId)} className="text-primary hover:underline text-xs">
                      Open
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <ApplicationDetail
          applicationId={selected}
          onClose={() => setSelected(null)}
          onChanged={reload}
        />
      )}
    </div>
  );
}

// ─── Application detail drawer ──────────────────────────────────────────────

function ApplicationDetail({
  applicationId, onClose, onChanged,
}: { applicationId: string; onClose: () => void; onChanged: () => void }) {
  const [app, setApp] = useState<BetaApplicationRow | null>(null);
  const [overlaps, setOverlaps] = useState<LaneOverlap[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(() => {
    api.adminBeta.getApplication(applicationId).then((r) => {
      setApp(r.application);
      setOverlaps(r.laneOverlaps);
    });
  }, [applicationId]);
  useEffect(() => { load(); }, [load]);

  async function saveScore(field: string, value: number) {
    if (!app) return;
    setBusy(true);
    try {
      const r = await api.adminBeta.score(applicationId, { [field]: value });
      setApp(r.application);
      onChanged();
    } finally { setBusy(false); }
  }

  async function admit() {
    setBusy(true); setMsg("");
    try {
      const r = await api.adminBeta.admit(applicationId);
      setMsg(`Admitted (${r.userRole}, ${r.cohort}). Beta access link auto-emailed to the applicant. Copy as fallback: ${r.acceptUrl}`);
      load(); onChanged();
    } catch (e) {
      setMsg(`Admit failed: ${(e as Error).message}`);
    } finally { setBusy(false); }
  }

  async function waitlist() {
    setBusy(true); setMsg("");
    try {
      await api.adminBeta.waitlistApplication(applicationId);
      load(); onChanged();
    } finally { setBusy(false); }
  }

  if (!app) return null;

  const b = app.scoreBreakdown;

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/30" onClick={onClose}>
      <div className="w-full max-w-lg bg-background h-full overflow-y-auto shadow-xl p-6 space-y-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-foreground">{app.fullName || app.workEmail}</h2>
            <p className="text-sm text-muted-foreground">
              {app.workEmail} · {sideLabel(app.side)} · {texasLabel(app.texasFocus)}
            </p>
            {(app.company || app.region || app.phone) && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {[app.company, app.region, app.phone].filter(Boolean).join(" · ")}
              </p>
            )}
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-xl leading-none">×</button>
        </div>

        {app.autoFlags.length > 0 && (
          <div className="rounded bg-amber-50 border border-amber-200 px-3 py-2">
            <div className="text-xs font-medium text-amber-900 mb-1">Why this applicant was flagged</div>
            <div className="flex flex-wrap gap-1.5">
              {app.autoFlags.map((f) => (
                <span key={f} className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-900">
                  {flagLabel(f)}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Score editor */}
        {b && (
          <div className="rounded border border-border p-3">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold">Score: {app.score}/15</h3>
              {busy && <span className="text-xs text-muted-foreground">saving…</span>}
            </div>
            <div className="space-y-2 text-sm">
              <AutoDim label="Volume (auto)" value={b.volume} max={3} />
              <AutoDim label="Geography / Texas (auto)" value={b.geography} max={3} />
              <AutoDim label="Tool sophistication (auto)" value={b.tools} max={1} />
              <StaffDim label="Segment fit" value={b.segmentFit} max={3} onChange={(v) => saveScore("segmentFit", v)} />
              <StaffDim label="Lane overlap" value={b.laneOverlap} max={2} onChange={(v) => saveScore("laneOverlap", v)} />
              <StaffDim label="Pain intensity" value={b.pain} max={2} onChange={(v) => saveScore("pain", v)} />
              <StaffDim label="Responsiveness" value={b.responsiveness} max={1} onChange={(v) => saveScore("responsiveness", v)} />
            </div>
          </div>
        )}

        {/* Lane overlap helper */}
        {overlaps.length > 0 && (
          <div className="rounded border border-border p-3">
            <h3 className="text-sm font-semibold mb-2">Lane-overlap candidates ({overlaps.length})</h3>
            <ul className="space-y-1 text-sm">
              {overlaps.map((o) => (
                <li key={o.applicationId} className="flex items-center gap-2">
                  {o.bothTexas && <span className="text-xs px-1 py-0.5 rounded bg-emerald-100 text-emerald-800">TX↔TX</span>}
                  <span className="text-foreground">{o.fullName}</span>
                  <span className="text-xs text-muted-foreground">({o.side})</span>
                  {o.sharedLaneTokens.length > 0 && (
                    <span className="text-xs text-muted-foreground ml-auto">{o.sharedLaneTokens.join(", ")}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Commitment — humanized */}
        <div className="rounded border border-border p-3 space-y-1.5">
          <h3 className="text-sm font-semibold mb-1">Commitment</h3>
          <CommitmentRow ok={app.commitment.realFreight}
            yes="Can test with real freight" no="Will not test with real freight" />
          <CommitmentRow ok={app.commitment.feedbackCall}
            yes="Will join feedback call + weekly check-in" no="Won't commit to feedback call" />
          {app.commitment.contactPref && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Prefers</span>
              <span className="text-foreground font-medium">{contactPrefLabel(app.commitment.contactPref)}</span>
            </div>
          )}
        </div>

        {/* Applicant profile — labeled, plain-language (replaces JSON dump) */}
        {(app.side === "SHIPPER" || app.side === "BOTH") && app.sideSpecificData?.shipper && (
          <ProfileSection
            title={app.side === "BOTH" ? "Shipper profile" : "Profile"}
            rows={shipperRows(app.sideSpecificData.shipper)}
          />
        )}
        {(app.side === "CARRIER" || app.side === "BOTH") && app.sideSpecificData?.carrier && (
          <ProfileSection
            title={app.side === "BOTH" ? "Carrier profile" : "Profile"}
            rows={carrierRows(app.sideSpecificData.carrier)}
          />
        )}

        {/* Raw view — collapsed by default, for debugging */}
        <details className="rounded border border-border p-3">
          <summary className="text-xs text-muted-foreground cursor-pointer">View raw data</summary>
          <pre className="text-xs text-muted-foreground mt-2 whitespace-pre-wrap break-words">
            {JSON.stringify(
              { side: app.side, texasFocus: app.texasFocus, commitment: app.commitment, sideSpecificData: app.sideSpecificData },
              null, 2,
            )}
          </pre>
        </details>

        {msg && <div className="text-sm text-foreground bg-muted rounded px-3 py-2">{msg}</div>}

        {/* Actions */}
        <div className="flex gap-2 pt-2">
          <button
            onClick={admit}
            disabled={busy || app.status === "INVITED" || app.status === "ONBOARDED"}
            className="flex-1 rounded-md bg-emerald-600 text-white px-4 py-2 text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
          >
            {app.status === "INVITED" || app.status === "ONBOARDED" ? "Already admitted" : "Admit → issue invite"}
          </button>
          <button
            onClick={waitlist}
            disabled={busy}
            className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
          >
            Waitlist
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Humanizers (display-only; no data-model change) ─────────────────────────

function sideLabel(side: string): string {
  return side === "BOTH" ? "Shipper + Carrier" : side === "CARRIER" ? "Carrier" : "Shipper";
}
function texasLabel(tx: string): string {
  return tx === "MOSTLY" ? "Mostly Texas" : tx === "PARTLY" ? "Partly Texas" : "Outside Texas";
}
function flagLabel(flag: string): string {
  switch (flag) {
    case "NO_COMMITMENT": return "No commitment";
    case "LOW_VOLUME":    return "Under 5 loads/week";
    case "NO_AUTHORITY":  return "No MC/DOT";
    default:              return flag.replace(/_/g, " ").toLowerCase();
  }
}
function contactPrefLabel(pref: string): string {
  const p = pref.toLowerCase();
  if (p === "phone") return "Phone";
  if (p === "sms" || p === "text") return "Text";
  return "Email";
}

/** Coerce a stored value to a clean display string. Arrays comma-join;
 *  numbers/bands pass through; empty/null → "" (caller decides to show). */
function display(v: any): string {
  if (v == null) return "";
  if (Array.isArray(v)) return v.filter((x) => x != null && String(x).trim()).join(", ");
  return String(v).trim();
}

type ProfileRow = { label: string; value: string; quote?: boolean };

/** Build labeled shipper rows, omitting empties. */
function shipperRows(s: Record<string, any>): ProfileRow[] {
  return [
    { label: "Company type",    value: display(s.companyType) },
    { label: "What they ship",  value: display(s.commodities) },
    { label: "Shipments/week",  value: display(s.loadsPerWeek) },
    { label: "Modes",           value: display(s.modes) },
    { label: "Lanes",           value: display(s.lanes) },
    { label: "Books freight via", value: display(s.bookingMethod) },
    { label: "Biggest pain",    value: display(s.pain), quote: true },
  ].filter((r) => r.value !== "");
}

/** Build labeled carrier rows, omitting empties. */
function carrierRows(c: Record<string, any>): ProfileRow[] {
  return [
    { label: "MC/DOT",          value: display(c.mcOrDot) },
    { label: "Trucks",          value: display(c.truckCount) },
    { label: "Loads/week",      value: display(c.loadsPerWeek) },
    { label: "Equipment",       value: display(c.equipment) },
    { label: "Lanes",           value: display(c.lanes) },
    { label: "Finds loads via", value: display(c.findMethod) },
    { label: "Biggest pain",    value: display(c.pain), quote: true },
  ].filter((r) => r.value !== "");
}

function ProfileSection({ title, rows }: { title: string; rows: ProfileRow[] }) {
  return (
    <div className="rounded border border-border p-3">
      <h3 className="text-sm font-semibold mb-2">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Not provided</p>
      ) : (
        <dl className="space-y-1.5 text-sm">
          {rows.map((r) => (
            <div key={r.label} className="flex gap-3">
              <dt className="text-muted-foreground w-32 shrink-0">{r.label}</dt>
              <dd className="text-foreground">{r.quote ? `“${r.value}”` : r.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

function CommitmentRow({ ok, yes, no }: { ok: boolean; yes: string; no: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className={ok ? "text-emerald-600" : "text-rose-600"}>{ok ? "✓" : "✗"}</span>
      <span className="text-foreground">{ok ? yes : no}</span>
    </div>
  );
}

function AutoDim({ label, value, max }: { label: string; value: number; max: number }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono">{value}/{max}</span>
    </div>
  );
}

function StaffDim({ label, value, max, onChange }: { label: string; value: number; max: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-foreground">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="rounded border border-border bg-background px-2 py-0.5 text-xs"
      >
        {Array.from({ length: max + 1 }, (_, i) => <option key={i} value={i}>{i}</option>)}
      </select>
    </div>
  );
}

// ─── Allowlist tab ──────────────────────────────────────────────────────────

function AllowlistTab() {
  const [drawerEmail, setDrawerEmail] = useState<string | null>(null);
  const [entries, setEntries] = useState<AllowlistEntry[]>([]);
  const [type, setType] = useState<"EMAIL" | "DOMAIN">("EMAIL");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => {
    api.adminBeta.listAllowlist().then((r) => setEntries(r.entries));
  }, []);
  useEffect(() => { reload(); }, [reload]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.adminBeta.addAllowlist({ type, value: value.trim(), reason: reason.trim() || undefined });
      setValue(""); setReason("");
      reload();
    } finally { setBusy(false); }
  }

  async function remove(id: string) {
    await api.adminBeta.removeAllowlist(id);
    reload();
  }

  return (
    <div className="space-y-4">
      <form onSubmit={add} className="flex flex-wrap items-end gap-2 rounded-lg border border-border p-4">
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Type</label>
          <select value={type} onChange={(e) => setType(e.target.value as any)} className="rounded border border-border bg-background px-2 py-1.5 text-sm">
            <option value="EMAIL">EMAIL</option>
            <option value="DOMAIN">DOMAIN</option>
          </select>
        </div>
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs text-muted-foreground mb-1">{type === "EMAIL" ? "Email address" : "Domain (e.g. acme.com)"}</label>
          <input value={value} onChange={(e) => setValue(e.target.value)} required className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm" />
        </div>
        <div className="flex-1 min-w-[160px]">
          <label className="block text-xs text-muted-foreground mb-1">Reason (optional)</label>
          <input value={reason} onChange={(e) => setReason(e.target.value)} className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm" />
        </div>
        <button type="submit" disabled={busy} className="rounded-md bg-primary text-primary-foreground px-4 py-1.5 text-sm font-medium disabled:opacity-50">Add</button>
      </form>

      <div className="rounded-lg border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th className="text-left px-3 py-2 font-medium">Type</th>
              <th className="text-left px-3 py-2 font-medium">Value</th>
              <th className="text-left px-3 py-2 font-medium">Reason</th>
              <th className="text-left px-3 py-2 font-medium">Active</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.allowlistId} className="border-t border-border">
                <td className="px-3 py-2">{e.type}</td>
                <td className="px-3 py-2 font-mono text-xs">
                  {e.type === "EMAIL" ? (
                    <button className="text-primary hover:underline" onClick={() => setDrawerEmail(e.value)} title="View submitted intake">
                      {e.value}
                    </button>
                  ) : e.value}
                </td>
                <td className="px-3 py-2 text-muted-foreground text-xs">{e.reason ?? "—"}</td>
                <td className="px-3 py-2">{e.active ? "✓" : "✗"}</td>
                <td className="px-3 py-2 text-right">
                  {e.active && (
                    <button onClick={() => remove(e.allowlistId)} className="text-rose-600 hover:underline text-xs">Remove</button>
                  )}
                </td>
              </tr>
            ))}
            {entries.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-sm text-muted-foreground">No allowlist entries yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <SubmittedIntakeDrawer email={drawerEmail} contextLabel="allowlist" onClose={() => setDrawerEmail(null)} />
    </div>
  );
}

// ─── Waitlist tab ───────────────────────────────────────────────────────────

function WaitlistTab() {
  const [drawerEmail, setDrawerEmail] = useState<string | null>(null);
  const [entries, setEntries] = useState<WaitlistRow[]>([]);
  const reload = useCallback(() => { api.adminBeta.listWaitlist().then((r) => setEntries(r.entries)); }, []);
  useEffect(() => { reload(); }, [reload]);

  async function promote(w: WaitlistRow) {
    const role = w.personaInterest || "SHIPPER";
    await api.adminBeta.promoteWaitlist(w.waitlistId, { userRole: role });
    reload();
  }

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-xs text-muted-foreground">
          <tr>
            <th className="text-left px-3 py-2 font-medium">Email</th>
            <th className="text-left px-3 py-2 font-medium">Name</th>
            <th className="text-left px-3 py-2 font-medium">Interest</th>
            <th className="text-left px-3 py-2 font-medium">Source</th>
            <th className="text-left px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {entries.map((w) => (
            <tr key={w.waitlistId} className="border-t border-border">
              <td className="px-3 py-2 font-mono text-xs">
                <button className="text-primary hover:underline" onClick={() => setDrawerEmail(w.email)} title="View submitted intake">
                  {w.email}
                </button>
              </td>
              <td className="px-3 py-2">{w.name ?? "—"}</td>
              <td className="px-3 py-2">{w.personaInterest ?? "—"}</td>
              <td className="px-3 py-2 text-muted-foreground text-xs">{w.source}</td>
              <td className="px-3 py-2">{w.status}</td>
              <td className="px-3 py-2 text-right">
                {w.status === "WAITING" && (
                  <button onClick={() => promote(w)} className="text-primary hover:underline text-xs">Promote → invite</button>
                )}
              </td>
            </tr>
          ))}
          {entries.length === 0 && (
            <tr><td colSpan={6} className="px-3 py-6 text-center text-sm text-muted-foreground">Waitlist is empty.</td></tr>
          )}
        </tbody>
      </table>
      <SubmittedIntakeDrawer email={drawerEmail} contextLabel="waitlist" onClose={() => setDrawerEmail(null)} />
    </div>
  );
}
