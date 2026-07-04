/**
 * Compliance / oversight console - the admin face of /api/admin/compliance.
 *
 * Least privilege + separation of duties: the tabs shown here are driven by the
 * caller's own compliance grants (fetched from GET /compliance/me), and the
 * server still gates every call. This screen is oversight only - every action
 * is append-only and audited server-side; nothing here mutates or deletes an
 * immutable pipeline record, decides legal validity, or auto-discloses.
 *
 *   Disputes         (DISPUTE_ADMIN)            scan discrepancies, adjudicate
 *   Legal            (LEGAL_ADMIN)              holds, case file, admin audit log
 *   Law enforcement  (LAW_ENFORCEMENT_LIAISON)  intake, counsel sign-off, disclose, intercepts
 *   Grants           (STAFF_ADMIN)             grant/revoke compliance roles
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  Scale, Gavel, Landmark, KeyRound, ShieldAlert, Search, RefreshCw, Lock, Unlock,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import {
  api, formatCents,
  type ComplianceMe, type ComplianceRole,
  type DiscrepancyFinding, type DiscrepancySeverity,
  type AdjudicationTargetType, type AdjudicationAction,
  type LegalHoldEvent, type CaseFile, type CaseFileIntegrity, type AdminAuditEntry,
  type LERequestType, type LERequestIntake, type CounselSignOff, type DisclosureRecord,
  type PayoutIntercept,
} from "@/lib/api";

// ── small shared helpers ────────────────────────────────────────────────────
const INPUT =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground " +
  "placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/40";
const LABEL = "block text-xs font-medium text-muted-foreground mb-1";

function fmtTs(ms: number): string {
  try { return new Date(ms).toLocaleString(); } catch { return String(ms); }
}

/** Run an async action, toasting failures (and an optional success). */
async function guard<T>(fn: () => Promise<T>, opts?: { ok?: string; onOk?: (v: T) => void }): Promise<void> {
  try {
    const v = await fn();
    if (opts?.ok) toast.success(opts.ok);
    opts?.onOk?.(v);
  } catch (e: any) {
    toast.error(e?.message ?? "Request failed");
  }
}

function Panel({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card p-4 md:p-5">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {hint && <p className="mt-0.5 mb-3 text-xs text-muted-foreground">{hint}</p>}
      {!hint && <div className="mb-3" />}
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className={LABEL}>{label}</label>
      {children}
    </div>
  );
}

function SeverityBadge({ s }: { s: DiscrepancySeverity }) {
  const tone =
    s === "CRITICAL" ? "bg-rose-100 text-rose-800"
    : s === "WARN" ? "bg-amber-100 text-amber-800"
    : "bg-zinc-200 text-zinc-700";
  return <span className={`text-[10px] font-bold tracking-wide px-2 py-0.5 rounded-full ${tone}`}>{s}</span>;
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">{children}</div>;
}

// ── Disputes (DISPUTE_ADMIN) ─────────────────────────────────────────────────
function DisputesTab() {
  const [loadId, setLoadId] = useState("");
  const [findings, setFindings] = useState<DiscrepancyFinding[] | null>(null);
  const [scanning, setScanning] = useState(false);

  const [adj, setAdj] = useState<{
    targetType: AdjudicationTargetType; targetId: string; action: AdjudicationAction;
    reason: string; invoiceId: string; carrierId: string; compAmount: string; compNote: string;
  }>({ targetType: "DISCREPANCY", targetId: "", action: "UPHOLD", reason: "", invoiceId: "", carrierId: "", compAmount: "", compNote: "" });

  async function scan() {
    if (!loadId.trim()) return;
    setScanning(true);
    await guard(() => api.adminCompliance.discrepancies(loadId.trim()), { onOk: (r) => setFindings(r.findings) });
    setScanning(false);
  }

  async function submitAdjudication() {
    if (!adj.targetId.trim() || !adj.reason.trim()) { toast.error("Target id and reason are required"); return; }
    const compensation = adj.compAmount.trim()
      ? { amountCents: Math.round(parseFloat(adj.compAmount) * 100), note: adj.compNote.trim() || undefined }
      : undefined;
    if (compensation && (!Number.isFinite(compensation.amountCents) || compensation.amountCents <= 0)) {
      toast.error("Compensation must be a positive dollar amount"); return;
    }
    await guard(
      () => api.adminCompliance.adjudicate({
        targetType: adj.targetType, targetId: adj.targetId.trim(), action: adj.action, reason: adj.reason.trim(),
        invoiceId: adj.invoiceId.trim() || undefined, carrierId: adj.carrierId.trim() || undefined, compensation,
      }),
      { ok: "Adjudication recorded", onOk: (r) => {
        toast.message(`adjudication ${r.adjudication.adjudicationId}`);
        setAdj((a) => ({ ...a, targetId: "", reason: "", compAmount: "", compNote: "" }));
      } }
    );
  }

  return (
    <div className="space-y-5">
      <Panel title="Discrepancy scan" hint="Read-only anomaly scan across a load's charges, advances, assignments and reconciliation. The scan itself is audited.">
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-[240px]">
            <Field label="Load id">
              <input className={INPUT} value={loadId} onChange={(e) => setLoadId(e.target.value)} placeholder="load_..." />
            </Field>
          </div>
          <Button onClick={scan} disabled={scanning || !loadId.trim()}>
            <Search className="h-4 w-4 mr-1.5" aria-hidden /> {scanning ? "Scanning…" : "Scan"}
          </Button>
        </div>

        {findings !== null && (
          <div className="mt-4">
            {findings.length === 0 ? (
              <Empty>No discrepancies found for this load.</Empty>
            ) : (
              <ul className="space-y-2">
                {findings.map((f, i) => (
                  <li key={`${f.code}-${i}`} className="rounded-md border border-border p-3">
                    <div className="flex items-center gap-2">
                      <SeverityBadge s={f.severity} />
                      <span className="text-xs font-mono text-muted-foreground">{f.code}</span>
                    </div>
                    <p className="mt-1 text-sm text-foreground">{f.message}</p>
                    {f.refs?.length > 0 && (
                      <p className="mt-1 text-[11px] font-mono text-muted-foreground break-all">refs: {f.refs.join(", ")}</p>
                    )}
                    <div className="mt-2">
                      <button
                        className="text-xs text-primary hover:underline"
                        onClick={() => setAdj((a) => ({ ...a, targetType: "DISCREPANCY", targetId: `${f.code}:${f.refs?.[0] ?? loadId}` }))}
                      >
                        Adjudicate this →
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Panel>

      <Panel title="Adjudicate" hint="Records an append-only decision. ADJUST/REVERSE with a compensation amount writes a compensating reconciliation entry - the original record is never changed.">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Target type">
            <select className={INPUT} value={adj.targetType} onChange={(e) => setAdj({ ...adj, targetType: e.target.value as AdjudicationTargetType })}>
              <option value="DISCREPANCY">DISCREPANCY</option>
              <option value="CHARGE_DISPUTE">CHARGE_DISPUTE</option>
              <option value="RECOURSE_BUYBACK">RECOURSE_BUYBACK</option>
            </select>
          </Field>
          <Field label="Action">
            <select className={INPUT} value={adj.action} onChange={(e) => setAdj({ ...adj, action: e.target.value as AdjudicationAction })}>
              <option value="UPHOLD">UPHOLD</option>
              <option value="REVERSE">REVERSE</option>
              <option value="ADJUST">ADJUST</option>
              <option value="ESCALATE">ESCALATE</option>
            </select>
          </Field>
          <Field label="Target id">
            <input className={INPUT} value={adj.targetId} onChange={(e) => setAdj({ ...adj, targetId: e.target.value })} placeholder="charge id / buyback outcome / code:ref" />
          </Field>
          <Field label="Invoice id (optional)">
            <input className={INPUT} value={adj.invoiceId} onChange={(e) => setAdj({ ...adj, invoiceId: e.target.value })} placeholder="inv_..." />
          </Field>
          <Field label="Carrier id (optional)">
            <input className={INPUT} value={adj.carrierId} onChange={(e) => setAdj({ ...adj, carrierId: e.target.value })} placeholder="carrier_..." />
          </Field>
          <Field label="Compensation (USD, optional)">
            <input className={INPUT} value={adj.compAmount} onChange={(e) => setAdj({ ...adj, compAmount: e.target.value })} placeholder="0.00" inputMode="decimal" />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Reason">
              <textarea className={INPUT} rows={2} value={adj.reason} onChange={(e) => setAdj({ ...adj, reason: e.target.value })} placeholder="Basis for the decision (recorded)" />
            </Field>
          </div>
          {adj.compAmount.trim() && (
            <div className="sm:col-span-2">
              <Field label="Compensation note (optional)">
                <input className={INPUT} value={adj.compNote} onChange={(e) => setAdj({ ...adj, compNote: e.target.value })} />
              </Field>
            </div>
          )}
        </div>
        <div className="mt-4">
          <Button onClick={submitAdjudication}><Gavel className="h-4 w-4 mr-1.5" aria-hidden /> Record adjudication</Button>
        </div>
      </Panel>
    </div>
  );
}

// ── Legal (LEGAL_ADMIN) ──────────────────────────────────────────────────────
const HOLD_ENTITY_TYPES = ["LOAD", "INVOICE", "CARRIER", "SHIPPER", "RECORD"];

function LegalTab() {
  // holds
  const [holds, setHolds] = useState<LegalHoldEvent[] | null>(null);
  const [holdForm, setHoldForm] = useState({ entityType: "LOAD", entityId: "", reason: "", authorityRef: "" });

  async function refreshHolds() {
    await guard(() => api.adminCompliance.listHolds(), { onOk: (r) => setHolds(r.holds) });
  }
  useEffect(() => { refreshHolds(); }, []);

  async function place(kind: "place" | "release") {
    if (!holdForm.entityId.trim() || !holdForm.reason.trim()) { toast.error("Entity id and reason are required"); return; }
    const payload = {
      entityType: holdForm.entityType, entityId: holdForm.entityId.trim(),
      reason: holdForm.reason.trim(), authorityRef: holdForm.authorityRef.trim() || undefined,
    };
    await guard(
      () => kind === "place" ? api.adminCompliance.placeHold(payload) : api.adminCompliance.releaseHold(payload),
      { ok: kind === "place" ? "Legal hold placed" : "Legal hold released", onOk: () => { setHoldForm((f) => ({ ...f, entityId: "", reason: "", authorityRef: "" })); refreshHolds(); } }
    );
  }

  // case file
  const [cfLoadId, setCfLoadId] = useState("");
  const [caseFile, setCaseFile] = useState<{ caseFile: CaseFile; integrity: CaseFileIntegrity } | null>(null);
  const [assembling, setAssembling] = useState(false);
  async function assemble() {
    if (!cfLoadId.trim()) return;
    setAssembling(true);
    await guard(() => api.adminCompliance.caseFile(cfLoadId.trim()), { onOk: setCaseFile });
    setAssembling(false);
  }

  // audit
  const [auditRef, setAuditRef] = useState("");
  const [audit, setAudit] = useState<AdminAuditEntry[] | null>(null);
  async function loadAudit() {
    await guard(() => api.adminCompliance.audit({ targetRef: auditRef.trim() || undefined, limit: 100 }), { onOk: (r) => setAudit(r.entries) });
  }

  // current-state map: newest event per entity decides
  const holdState = useMemo(() => {
    const m = new Map<string, LegalHoldEvent>();
    for (const h of holds ?? []) {
      const k = `${h.entityType}:${h.entityId}`;
      if (!m.has(k)) m.set(k, h); // listHolds is newest-first
    }
    return [...m.values()];
  }, [holds]);

  return (
    <div className="space-y-5">
      <Panel title="Legal hold" hint="A hold blocks deletion of the entity for everyone, including admins. Place and release are append-only, audited events; the newest event decides current state.">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Entity type">
            <select className={INPUT} value={holdForm.entityType} onChange={(e) => setHoldForm({ ...holdForm, entityType: e.target.value })}>
              {HOLD_ENTITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Entity id">
            <input className={INPUT} value={holdForm.entityId} onChange={(e) => setHoldForm({ ...holdForm, entityId: e.target.value })} placeholder="load_... / inv_... / carrier_..." />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Reason">
              <input className={INPUT} value={holdForm.reason} onChange={(e) => setHoldForm({ ...holdForm, reason: e.target.value })} placeholder="Litigation / preservation basis (recorded)" />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Authority reference (optional)">
              <input className={INPUT} value={holdForm.authorityRef} onChange={(e) => setHoldForm({ ...holdForm, authorityRef: e.target.value })} placeholder="matter / docket / counsel ref" />
            </Field>
          </div>
        </div>
        <div className="mt-4 flex gap-2">
          <Button onClick={() => place("place")}><Lock className="h-4 w-4 mr-1.5" aria-hidden /> Place hold</Button>
          <Button variant="outline" onClick={() => place("release")}><Unlock className="h-4 w-4 mr-1.5" aria-hidden /> Release hold</Button>
          <Button variant="ghost" size="sm" onClick={refreshHolds} className="ml-auto"><RefreshCw className="h-4 w-4 mr-1.5" aria-hidden /> Refresh</Button>
        </div>

        <div className="mt-4">
          <div className="text-xs font-medium text-muted-foreground mb-2">Current holds</div>
          {holds === null ? <div className="text-sm text-muted-foreground">Loading…</div>
            : holdState.filter((h) => h.eventType === "PLACE").length === 0 ? <Empty>No entities are currently under hold.</Empty>
            : (
              <div className="rounded-md border border-border overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs text-muted-foreground">
                    <tr><th className="text-left px-3 py-2 font-medium">Entity</th><th className="text-left px-3 py-2 font-medium">State</th><th className="text-left px-3 py-2 font-medium">Reason</th><th className="text-left px-3 py-2 font-medium">Since</th></tr>
                  </thead>
                  <tbody>
                    {holdState.map((h) => (
                      <tr key={`${h.entityType}:${h.entityId}`} className="border-t border-border">
                        <td className="px-3 py-2 font-mono text-xs text-foreground break-all">{h.entityType}:{h.entityId}</td>
                        <td className="px-3 py-2">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${h.eventType === "PLACE" ? "bg-rose-100 text-rose-800" : "bg-emerald-100 text-emerald-800"}`}>
                            {h.eventType === "PLACE" ? "ON HOLD" : "RELEASED"}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{h.reason}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">{fmtTs(h.at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </div>
      </Panel>

      <Panel title="Case file" hint="Assembles a tamper-evident package for a load: every relevant record with a sha256 content hash, plus an integrity check that recomputes the manifest.">
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-[240px]">
            <Field label="Load id"><input className={INPUT} value={cfLoadId} onChange={(e) => setCfLoadId(e.target.value)} placeholder="load_..." /></Field>
          </div>
          <Button onClick={assemble} disabled={assembling || !cfLoadId.trim()}><Scale className="h-4 w-4 mr-1.5" aria-hidden /> {assembling ? "Assembling…" : "Assemble"}</Button>
        </div>
        {caseFile && (
          <div className="mt-4">
            <div className={`mb-3 rounded-md px-3 py-2 text-sm ${caseFile.integrity.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"}`}>
              Integrity: {caseFile.integrity.ok ? "OK - manifest matches all items" : `FAILED - ${caseFile.integrity.gaps.length} gap(s)`}
              {!caseFile.integrity.ok && <div className="mt-1 text-xs font-mono">{caseFile.integrity.gaps.join(", ")}</div>}
            </div>
            <div className="text-xs text-muted-foreground mb-2">{caseFile.caseFile.items.length} record(s), assembled {fmtTs(caseFile.caseFile.assembledAt)}</div>
            <div className="rounded-md border border-border overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground"><tr><th className="text-left px-3 py-2 font-medium">Kind</th><th className="text-left px-3 py-2 font-medium">Id</th><th className="text-left px-3 py-2 font-medium">Content hash</th></tr></thead>
                <tbody>
                  {caseFile.caseFile.manifest.map((m) => (
                    <tr key={`${m.kind}:${m.id}`} className="border-t border-border">
                      <td className="px-3 py-2 text-xs text-foreground">{m.kind}</td>
                      <td className="px-3 py-2 font-mono text-xs text-muted-foreground break-all">{m.id}</td>
                      <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">{m.contentHash.slice(0, 16)}…</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Panel>

      <Panel title="Admin audit log" hint="The append-only record of who did what across the compliance layer (audit-of-auditors). Reading it is itself audited.">
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-[240px]">
            <Field label="Filter by target ref (optional)"><input className={INPUT} value={auditRef} onChange={(e) => setAuditRef(e.target.value)} placeholder="LOAD:load_... / carrier_... / userId" /></Field>
          </div>
          <Button onClick={loadAudit}><Search className="h-4 w-4 mr-1.5" aria-hidden /> Load audit</Button>
        </div>
        {audit !== null && (
          <div className="mt-4">
            {audit.length === 0 ? <Empty>No audit entries.</Empty> : (
              <div className="rounded-md border border-border max-h-[420px] overflow-x-auto overflow-y-auto">
                <table className="w-full text-sm">
                  {/* D5: Targets (mono id list) collapses below lg; it re-appears
                      under Action so the decision columns fit narrow screens. */}
                  <thead className="bg-muted/50 text-xs text-muted-foreground sticky top-0"><tr><th className="text-left px-3 py-2 font-medium">When</th><th className="text-left px-3 py-2 font-medium">Actor role</th><th className="text-left px-3 py-2 font-medium">Action</th><th className="text-left px-3 py-2 font-medium hidden lg:table-cell">Targets</th><th className="text-left px-3 py-2 font-medium">Reason</th></tr></thead>
                  <tbody>
                    {audit.map((a) => (
                      <tr key={a.auditId} className="border-t border-border">
                        <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">{fmtTs(a.at)}</td>
                        <td className="px-3 py-2 text-xs text-foreground">{a.actorRole}</td>
                        <td className="px-3 py-2 text-xs font-medium text-foreground">{a.action}
                          {(a.targetRefs ?? []).length > 0 && <div className="mt-0.5 text-[11px] font-mono font-normal text-muted-foreground break-all lg:hidden">{(a.targetRefs ?? []).join(", ")}</div>}
                        </td>
                        <td className="px-3 py-2 text-[11px] font-mono text-muted-foreground break-all hidden lg:table-cell">{(a.targetRefs ?? []).join(", ") || "-"}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{a.reason ?? "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </Panel>
    </div>
  );
}

// ── Law enforcement (LAW_ENFORCEMENT_LIAISON) ────────────────────────────────
const LE_TYPES: LERequestType[] = ["SUBPOENA", "COURT_ORDER", "WARRANT", "GARNISHMENT", "LEVY", "LIEN", "OTHER"];

function LawEnforcementTab() {
  const today = new Date().toISOString().slice(0, 10);
  const [intake, setIntake] = useState({
    type: "SUBPOENA" as LERequestType, issuingAuthority: "", receivedDate: today,
    describedScope: "", scopeType: "LOAD", scopeId: "", nonDisclosure: false, nonDisclosureBasis: "",
  });
  const [lastIntake, setLastIntake] = useState<LERequestIntake | null>(null);

  async function submitIntake() {
    if (!intake.issuingAuthority.trim() || !intake.describedScope.trim() || !intake.scopeId.trim()) {
      toast.error("Issuing authority, described scope, and at least one in-scope entity are required"); return;
    }
    await guard(
      () => api.adminCompliance.intake({
        type: intake.type, issuingAuthority: intake.issuingAuthority.trim(), receivedDate: intake.receivedDate,
        describedScope: intake.describedScope.trim(),
        scopeEntities: [{ entityType: intake.scopeType, entityId: intake.scopeId.trim() }],
        nonDisclosure: intake.nonDisclosure, nonDisclosureBasis: intake.nonDisclosureBasis.trim() || undefined,
      }),
      { ok: "Intake recorded (legal hold auto-placed on in-scope entities)", onOk: (r) => { setLastIntake(r.intake); setLookupId(r.intake.requestId); } }
    );
  }

  // lookup + counsel + disclose
  const [lookupId, setLookupId] = useState("");
  const [detail, setDetail] = useState<{ intake: LERequestIntake; signOffs: CounselSignOff[]; counselSignedOff: boolean; disclosures: DisclosureRecord[] } | null>(null);
  async function lookup() {
    if (!lookupId.trim()) return;
    await guard(() => api.adminCompliance.getRequest(lookupId.trim()), { onOk: setDetail });
  }

  const [counsel, setCounsel] = useState({ counselId: "", validityDetermination: "VALID" as "VALID" | "INVALID" | "VALID_IN_PART", note: "" });
  async function signOff() {
    if (!lookupId.trim() || !counsel.counselId.trim()) { toast.error("Request id and counsel id are required"); return; }
    await guard(
      () => api.adminCompliance.counselSignOff(lookupId.trim(), { counselId: counsel.counselId.trim(), validityDetermination: counsel.validityDetermination, note: counsel.note.trim() || undefined }),
      { ok: "Counsel sign-off recorded", onOk: () => { setCounsel((c) => ({ ...c, note: "" })); lookup(); } }
    );
  }

  const [disclose, setDisclose] = useState({ recipient: "", recordRefs: "" });
  async function submitDisclose() {
    const refs = disclose.recordRefs.split(",").map((s) => s.trim()).filter(Boolean);
    if (!lookupId.trim() || !disclose.recipient.trim() || refs.length === 0) { toast.error("Request id, recipient, and at least one record ref are required"); return; }
    await guard(
      () => api.adminCompliance.disclose(lookupId.trim(), { recipient: disclose.recipient.trim(), recordRefs: refs }),
      { ok: "Scoped disclosure recorded", onOk: () => { setDisclose({ recipient: "", recordRefs: "" }); lookup(); } }
    );
  }

  // intercepts
  const [ic, setIc] = useState({
    requestId: "", targetType: "CARRIER" as "CARRIER" | "INVOICE", targetId: "", carrierId: "",
    instrumentRef: "", instruction: "REDIRECT" as "HOLD" | "REDIRECT", mode: "bps" as "bps" | "amount",
    bps: "", amount: "", redirectTo: "", priority: "",
  });
  async function createIntercept() {
    if (!ic.requestId.trim() || !ic.targetId.trim() || !ic.carrierId.trim() || !ic.instrumentRef.trim()) {
      toast.error("Request id, target id, carrier id, and instrument ref are required"); return;
    }
    const amountCents = ic.mode === "amount" && ic.amount.trim() ? Math.round(parseFloat(ic.amount) * 100) : undefined;
    const percentageBps = ic.mode === "bps" && ic.bps.trim() ? Math.round(parseFloat(ic.bps) * 100) : undefined;
    if (!amountCents && !percentageBps) { toast.error("Enter a percentage or a fixed amount"); return; }
    await guard(
      () => api.adminCompliance.createIntercept({
        requestId: ic.requestId.trim(), targetType: ic.targetType, targetId: ic.targetId.trim(), carrierId: ic.carrierId.trim(),
        instrumentRef: ic.instrumentRef.trim(), amountCents, percentageBps,
        priority: ic.priority.trim() ? parseInt(ic.priority, 10) : undefined,
        instruction: ic.instruction, redirectTo: ic.redirectTo.trim() || undefined,
      }),
      { ok: "Intercept created (applies at settlement, counsel-gated)", onOk: () => setIc((s) => ({ ...s, instrumentRef: "", bps: "", amount: "" })) }
    );
  }

  const [icList, setIcList] = useState<PayoutIntercept[] | null>(null);
  const [icLookup, setIcLookup] = useState({ invoiceId: "", carrierId: "" });
  async function listIntercepts() {
    if (!icLookup.invoiceId.trim() || !icLookup.carrierId.trim()) { toast.error("Invoice id and carrier id are required"); return; }
    await guard(() => api.adminCompliance.listIntercepts(icLookup.invoiceId.trim(), icLookup.carrierId.trim()), { onOk: (r) => setIcList(r.intercepts) });
  }

  const hasSignOff = detail?.counselSignedOff ?? false;

  return (
    <div className="space-y-5">
      <div className="rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-900 flex items-start gap-2">
        <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" aria-hidden />
        <span>This tool never decides whether a request is legally valid and never auto-discloses. Disclosure is blocked until counsel records a sign-off. Everything here is append-only and audited.</span>
      </div>

      <Panel title="Request intake" hint="Records a law-enforcement legal process (append-only) and auto-places a legal hold on the in-scope entities.">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Type">
            <select className={INPUT} value={intake.type} onChange={(e) => setIntake({ ...intake, type: e.target.value as LERequestType })}>
              {LE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Received date"><input type="date" className={INPUT} value={intake.receivedDate} onChange={(e) => setIntake({ ...intake, receivedDate: e.target.value })} /></Field>
          <div className="sm:col-span-2">
            <Field label="Issuing authority"><input className={INPUT} value={intake.issuingAuthority} onChange={(e) => setIntake({ ...intake, issuingAuthority: e.target.value })} placeholder="e.g. U.S. District Court, Northern District of Texas" /></Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Described scope"><textarea className={INPUT} rows={2} value={intake.describedScope} onChange={(e) => setIntake({ ...intake, describedScope: e.target.value })} placeholder="Exactly what the process requests" /></Field>
          </div>
          <Field label="In-scope entity type">
            <select className={INPUT} value={intake.scopeType} onChange={(e) => setIntake({ ...intake, scopeType: e.target.value })}>
              {HOLD_ENTITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="In-scope entity id"><input className={INPUT} value={intake.scopeId} onChange={(e) => setIntake({ ...intake, scopeId: e.target.value })} placeholder="load_... / carrier_..." /></Field>
          <div className="sm:col-span-2 flex items-center gap-2">
            <input id="nd" type="checkbox" checked={intake.nonDisclosure} onChange={(e) => setIntake({ ...intake, nonDisclosure: e.target.checked })} className="h-4 w-4" />
            <label htmlFor="nd" className="text-sm text-foreground">Non-disclosure order (suppresses routine notifications about the entity)</label>
          </div>
          {intake.nonDisclosure && (
            <div className="sm:col-span-2">
              <Field label="Non-disclosure basis"><input className={INPUT} value={intake.nonDisclosureBasis} onChange={(e) => setIntake({ ...intake, nonDisclosureBasis: e.target.value })} placeholder="statute / order reference" /></Field>
            </div>
          )}
        </div>
        <div className="mt-4"><Button onClick={submitIntake}><Landmark className="h-4 w-4 mr-1.5" aria-hidden /> Record intake</Button></div>
        {lastIntake && <p className="mt-2 text-xs text-emerald-700">Recorded request <span className="font-mono">{lastIntake.requestId}</span>. Loaded below for counsel review.</p>}
      </Panel>

      <Panel title="Request review - counsel sign-off & disclosure" hint="Look up a request, record counsel's validity determination, then (only after sign-off) record a scoped disclosure.">
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-[240px]"><Field label="Request id"><input className={INPUT} value={lookupId} onChange={(e) => setLookupId(e.target.value)} placeholder="lereq_..." /></Field></div>
          <Button variant="outline" onClick={lookup}><Search className="h-4 w-4 mr-1.5" aria-hidden /> Look up</Button>
        </div>

        {detail && (
          <div className="mt-4 rounded-md border border-border p-3 text-sm">
            <div className="flex flex-wrap gap-x-6 gap-y-1">
              <span><span className="text-muted-foreground">Type:</span> <span className="font-medium">{detail.intake.type}</span></span>
              <span><span className="text-muted-foreground">Authority:</span> {detail.intake.issuingAuthority}</span>
              <span><span className="text-muted-foreground">Received:</span> {detail.intake.receivedDate}</span>
              <span><span className="text-muted-foreground">Non-disclosure:</span> {detail.intake.nonDisclosure ? "yes" : "no"}</span>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{detail.intake.describedScope}</p>
            <div className="mt-2">
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${hasSignOff ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
                {hasSignOff ? "COUNSEL SIGNED OFF - disclosure permitted" : "PENDING COUNSEL - disclosure blocked"}
              </span>
            </div>
            {detail.disclosures.length > 0 && (
              <div className="mt-2 text-xs text-muted-foreground">
                Disclosures: {detail.disclosures.map((d) => `${d.recipient} (${d.recordRefs.length} record${d.recordRefs.length === 1 ? "" : "s"})`).join("; ")}
              </div>
            )}
          </div>
        )}

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="rounded-md border border-border p-3">
            <div className="text-xs font-semibold text-foreground mb-2">Counsel sign-off</div>
            <div className="space-y-2">
              <Field label="Counsel id"><input className={INPUT} value={counsel.counselId} onChange={(e) => setCounsel({ ...counsel, counselId: e.target.value })} placeholder="counsel user / bar id" /></Field>
              <Field label="Validity determination">
                <select className={INPUT} value={counsel.validityDetermination} onChange={(e) => setCounsel({ ...counsel, validityDetermination: e.target.value as any })}>
                  <option value="VALID">VALID</option><option value="VALID_IN_PART">VALID_IN_PART</option><option value="INVALID">INVALID</option>
                </select>
              </Field>
              <Field label="Note (optional)"><input className={INPUT} value={counsel.note} onChange={(e) => setCounsel({ ...counsel, note: e.target.value })} /></Field>
              <Button size="sm" onClick={signOff}>Record sign-off</Button>
            </div>
          </div>
          <div className="rounded-md border border-border p-3">
            <div className="text-xs font-semibold text-foreground mb-2">Scoped disclosure</div>
            <div className="space-y-2">
              <Field label="Recipient"><input className={INPUT} value={disclose.recipient} onChange={(e) => setDisclose({ ...disclose, recipient: e.target.value })} placeholder="requesting agency / officer" /></Field>
              <Field label="Record refs (comma separated)"><input className={INPUT} value={disclose.recordRefs} onChange={(e) => setDisclose({ ...disclose, recordRefs: e.target.value })} placeholder="only the in-scope record ids" /></Field>
              <Button size="sm" variant="outline" onClick={submitDisclose} disabled={!hasSignOff} title={hasSignOff ? undefined : "Counsel sign-off required first"}>Record disclosure</Button>
              {!hasSignOff && <p className="text-[11px] text-amber-700">Blocked until counsel sign-off is recorded.</p>}
            </div>
          </div>
        </div>
      </Panel>

      <Panel title="Payout intercept" hint="Garnishment / levy / lien recorded as a routing instruction only. It applies at settlement, is counsel-gated, and never mutates the underlying payout record.">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Authorizing request id"><input className={INPUT} value={ic.requestId} onChange={(e) => setIc({ ...ic, requestId: e.target.value })} placeholder="lereq_..." /></Field>
          <Field label="Instrument ref"><input className={INPUT} value={ic.instrumentRef} onChange={(e) => setIc({ ...ic, instrumentRef: e.target.value })} placeholder="writ / lien reference" /></Field>
          <Field label="Target type">
            <select className={INPUT} value={ic.targetType} onChange={(e) => setIc({ ...ic, targetType: e.target.value as "CARRIER" | "INVOICE" })}>
              <option value="CARRIER">CARRIER</option><option value="INVOICE">INVOICE</option>
            </select>
          </Field>
          <Field label="Target id"><input className={INPUT} value={ic.targetId} onChange={(e) => setIc({ ...ic, targetId: e.target.value })} placeholder="carrier_... / inv_..." /></Field>
          <Field label="Carrier id"><input className={INPUT} value={ic.carrierId} onChange={(e) => setIc({ ...ic, carrierId: e.target.value })} placeholder="carrier_..." /></Field>
          <Field label="Instruction">
            <select className={INPUT} value={ic.instruction} onChange={(e) => setIc({ ...ic, instruction: e.target.value as "HOLD" | "REDIRECT" })}>
              <option value="REDIRECT">REDIRECT</option><option value="HOLD">HOLD</option>
            </select>
          </Field>
          <Field label="Amount mode">
            <select className={INPUT} value={ic.mode} onChange={(e) => setIc({ ...ic, mode: e.target.value as "bps" | "amount" })}>
              <option value="bps">Percentage of payout</option><option value="amount">Fixed amount</option>
            </select>
          </Field>
          {ic.mode === "bps"
            ? <Field label="Percentage (%)"><input className={INPUT} value={ic.bps} onChange={(e) => setIc({ ...ic, bps: e.target.value })} placeholder="e.g. 25" inputMode="decimal" /></Field>
            : <Field label="Fixed amount (USD)"><input className={INPUT} value={ic.amount} onChange={(e) => setIc({ ...ic, amount: e.target.value })} placeholder="0.00" inputMode="decimal" /></Field>}
          {ic.instruction === "REDIRECT" && (
            <Field label="Redirect to"><input className={INPUT} value={ic.redirectTo} onChange={(e) => setIc({ ...ic, redirectTo: e.target.value })} placeholder="authority / lienholder" /></Field>
          )}
          <Field label="Priority (optional, lower first)"><input className={INPUT} value={ic.priority} onChange={(e) => setIc({ ...ic, priority: e.target.value })} placeholder="0" inputMode="numeric" /></Field>
        </div>
        <div className="mt-4"><Button onClick={createIntercept}><KeyRound className="h-4 w-4 mr-1.5" aria-hidden /> Create intercept</Button></div>
      </Panel>

      <Panel title="Active intercepts" hint="What would apply to a given invoice + carrier at settlement (supersession-aware).">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Invoice id"><input className={INPUT} value={icLookup.invoiceId} onChange={(e) => setIcLookup({ ...icLookup, invoiceId: e.target.value })} placeholder="inv_..." /></Field>
          <Field label="Carrier id"><input className={INPUT} value={icLookup.carrierId} onChange={(e) => setIcLookup({ ...icLookup, carrierId: e.target.value })} placeholder="carrier_..." /></Field>
        </div>
        <div className="mt-3"><Button variant="outline" onClick={listIntercepts}><Search className="h-4 w-4 mr-1.5" aria-hidden /> List active</Button></div>
        {icList !== null && (
          <div className="mt-4">
            {icList.length === 0 ? <Empty>No active intercepts for this invoice + carrier.</Empty> : (
              <div className="rounded-md border border-border overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs text-muted-foreground"><tr><th className="text-left px-3 py-2 font-medium">Instruction</th><th className="text-left px-3 py-2 font-medium">Amount</th><th className="text-left px-3 py-2 font-medium">Instrument</th><th className="text-left px-3 py-2 font-medium">Redirect</th><th className="text-left px-3 py-2 font-medium">Prio</th></tr></thead>
                  <tbody>
                    {icList.map((x) => (
                      <tr key={x.interceptId} className="border-t border-border">
                        <td className="px-3 py-2 text-xs text-foreground">{x.instruction}</td>
                        <td className="px-3 py-2 text-xs tabular-nums">{x.amountCents != null ? formatCents(x.amountCents) : x.percentageBps != null ? `${x.percentageBps / 100}%` : "-"}</td>
                        <td className="px-3 py-2 text-[11px] font-mono text-muted-foreground break-all">{x.instrumentRef}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{x.redirectTo ?? "-"}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{x.priority}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </Panel>
    </div>
  );
}

// ── Grants (STAFF_ADMIN) ─────────────────────────────────────────────────────
const COMPLIANCE_ROLES: ComplianceRole[] = ["DISPUTE_ADMIN", "LEGAL_ADMIN", "LAW_ENFORCEMENT_LIAISON"];

function GrantsTab() {
  const [userId, setUserId] = useState("");
  const [roles, setRoles] = useState<ComplianceRole[] | null>(null);
  const [role, setRole] = useState<ComplianceRole>("DISPUTE_ADMIN");

  async function lookup() {
    if (!userId.trim()) return;
    await guard(() => api.adminCompliance.getGrants(userId.trim()), { onOk: (r) => setRoles(r.roles) });
  }
  async function grant() {
    if (!userId.trim()) { toast.error("User id is required"); return; }
    await guard(() => api.adminCompliance.grant(userId.trim(), role), { ok: `Granted ${role}`, onOk: lookup });
  }
  async function revoke() {
    if (!userId.trim()) { toast.error("User id is required"); return; }
    await guard(() => api.adminCompliance.revoke(userId.trim(), role), { ok: `Revoked ${role}`, onOk: lookup });
  }

  return (
    <div className="space-y-5">
      <Panel title="Compliance role grants" hint="Grant or revoke a compliance role for an ADMIN user. Separation of duties: assign these to different people rather than concentrating all three. Every change is audited.">
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-[260px]"><Field label="User id (an ADMIN account)"><input className={INPUT} value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="user uuid" /></Field></div>
          <Button variant="outline" onClick={lookup}><Search className="h-4 w-4 mr-1.5" aria-hidden /> Look up grants</Button>
        </div>

        {roles !== null && (
          <div className="mt-4">
            <div className="text-xs font-medium text-muted-foreground mb-2">Current roles</div>
            {roles.length === 0 ? <Empty>No compliance roles granted to this user.</Empty> : (
              <div className="flex flex-wrap gap-2">
                {roles.map((r) => <span key={r} className="text-xs font-medium px-2.5 py-1 rounded-full bg-primary/10 text-primary">{r}</span>)}
              </div>
            )}
          </div>
        )}

        <div className="mt-5 flex flex-wrap items-end gap-2">
          <div className="min-w-[240px]">
            <Field label="Role">
              <select className={INPUT} value={role} onChange={(e) => setRole(e.target.value as ComplianceRole)}>
                {COMPLIANCE_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </Field>
          </div>
          <Button onClick={grant}>Grant</Button>
          <Button variant="outline" onClick={revoke}>Revoke</Button>
        </div>
      </Panel>
    </div>
  );
}

// ── Console shell ────────────────────────────────────────────────────────────
type TabKey = "disputes" | "legal" | "le" | "grants";

export default function ComplianceConsole() {
  const [me, setMe] = useState<ComplianceMe | null>(null);
  const [err, setErr] = useState("");
  const [tab, setTab] = useState<TabKey>("disputes");

  useEffect(() => {
    api.adminCompliance.me().then(setMe).catch((e) => setErr(e?.message ?? "Failed to load compliance context"));
  }, []);

  const tabs = useMemo(() => {
    if (!me) return [];
    const r = me.complianceRoles;
    const out: { key: TabKey; label: string; icon: typeof Scale }[] = [];
    if (r.includes("DISPUTE_ADMIN")) out.push({ key: "disputes", label: "Disputes", icon: Gavel });
    if (r.includes("LEGAL_ADMIN")) out.push({ key: "legal", label: "Legal", icon: Scale });
    if (r.includes("LAW_ENFORCEMENT_LIAISON")) out.push({ key: "le", label: "Law enforcement", icon: Landmark });
    if (me.isStaffAdmin) out.push({ key: "grants", label: "Grants", icon: KeyRound });
    return out;
  }, [me]);

  useEffect(() => {
    if (tabs.length && !tabs.some((t) => t.key === tab)) setTab(tabs[0].key);
  }, [tabs, tab]);

  return (
    <>
      <PageHeader
        eyebrow="Admin · Compliance"
        title="Compliance console"
        subtitle="Oversight only. Every action here is append-only and audited; nothing modifies or deletes an immutable pipeline record."
      />

      {err && <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{err}</div>}

      {me && tabs.length === 0 && (
        <Empty>
          You are signed in as an admin but hold no compliance role. Access to these surfaces requires a
          DISPUTE_ADMIN, LEGAL_ADMIN, or LAW_ENFORCEMENT_LIAISON grant from a STAFF_ADMIN.
        </Empty>
      )}

      {tabs.length > 0 && (
        <>
          <div className="flex flex-wrap gap-1 border-b border-border mb-5">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  tab === t.key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                <t.icon className="h-4 w-4" aria-hidden /> {t.label}
              </button>
            ))}
          </div>

          {tab === "disputes" && <DisputesTab />}
          {tab === "legal" && <LegalTab />}
          {tab === "le" && <LawEnforcementTab />}
          {tab === "grants" && <GrantsTab />}
        </>
      )}
    </>
  );
}
