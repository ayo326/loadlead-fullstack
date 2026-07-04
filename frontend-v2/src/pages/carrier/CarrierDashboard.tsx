import { useEffect, useState } from "react";
import { Building2, ShieldCheck, Users, Loader2, Send, UserPlus, Truck, Activity } from "lucide-react";
import { CarrierDashboardView } from "@/components/dashboard/CarrierDashboardView";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { RouteMapCard } from "@/components/RouteMapCard";
import { AttestationChain } from "@/components/attestation/AttestationChain";
import { AttestationDialog, ATTESTATION_TEXT, ATTESTATION_VERSION } from "@/components/attestation/AttestationDialog";

// ── Reusable helpers (matches the Owner Operator settings pattern) ───────────

function SectionCard({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border bg-card p-5 space-y-4">{children}</div>;
}

function Field({ label, id, required, children }: {
  label: string; id: string; required?: boolean; children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>
        {label}{required && <span className="text-destructive ml-0.5">*</span>}
      </Label>
      {children}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    VERIFIED: "bg-green-100 text-green-700 dark:bg-green-950/30 dark:text-green-400",
    PENDING: "bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400",
    REJECTED: "bg-red-100 text-red-700 dark:bg-red-950/30 dark:text-red-400",
    EXPIRED: "bg-red-100 text-red-700 dark:bg-red-950/30 dark:text-red-400",
    UNVERIFIED: "bg-secondary text-muted-foreground",
  };
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${map[status] ?? map.UNVERIFIED}`}>
      {status}
    </span>
  );
}

// ── Company verification tab (FMCSA + Didit KYB, keyed on orgId) ─────────────
// Same submitCarrierDocs/getVerification backend functions the Owner
// Operator verification flow uses — just pointed at an orgId instead of an
// operatorId. See backend routes/org.ts.

function VerificationTab({ orgId }: { orgId: string }) {
  const [verification, setVerification] = useState<any>(null);
  const [mcNumber, setMcNumber] = useState("");
  const [dotNumber, setDotNumber] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.getOrgVerification(orgId);
      setVerification(r.verification);
    } catch (e: any) { toast.error(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [orgId]);

  const submit = async () => {
    if (!mcNumber.trim() && !dotNumber.trim()) {
      toast.error("Enter at least an MC or DOT number");
      return;
    }
    setSubmitting(true);
    try {
      const r = await api.submitOrgVerification(orgId, {
        mcNumber: mcNumber || undefined,
        dotNumber: dotNumber || undefined,
      });
      setVerification(r.verification);
      toast.success("Verification submitted — FMCSA + KYB checks are running");
    } catch (e: any) { toast.error(e.message); }
    finally { setSubmitting(false); }
  };

  if (loading) return (
    <div className="flex items-center gap-2 text-muted-foreground text-sm py-8">
      <Loader2 className="h-4 w-4 animate-spin" /> Loading verification status…
    </div>
  );

  const status = verification?.verificationStatus ?? "UNVERIFIED";

  return (
    <div className="space-y-5">
      <SectionCard>
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Company Authority Status</p>
          <StatusBadge status={status} />
        </div>
        <div className="grid sm:grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-muted-foreground text-xs">FMCSA authority</p>
            <p className="font-medium">{verification?.fmcsaAuthorityActive === true ? "Active" : verification?.fmcsaAuthorityActive === false ? "Inactive" : "—"}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">KYB (company identity)</p>
            <p className="font-medium">{verification?.kybStatus ?? "—"}</p>
          </div>
        </div>
        {verification?.diditKybUrl && status !== "VERIFIED" && (
          <a href={verification.diditKybUrl} target="_blank" rel="noreferrer">
            <Button variant="outline" className="w-full">Continue KYB verification</Button>
          </a>
        )}
      </SectionCard>

      <SectionCard>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Submit / Update MC &amp; DOT</p>
        <p className="text-sm text-muted-foreground">
          Runs an FMCSA authority check and starts a Didit KYB session for your company.
        </p>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="MC Number" id="mc">
            <Input id="mc" value={mcNumber} onChange={e => setMcNumber(e.target.value)} placeholder="MC-123456" />
          </Field>
          <Field label="DOT Number" id="dot">
            <Input id="dot" value={dotNumber} onChange={e => setDotNumber(e.target.value)} placeholder="1234567" />
          </Field>
        </div>
        <div className="flex justify-end">
          <Button onClick={submit} disabled={submitting}>
            {submitting ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Submitting…</> : <><ShieldCheck className="h-4 w-4 mr-2" />Submit for Verification</>}
          </Button>
        </div>
      </SectionCard>
    </div>
  );
}

// ── Drivers tab — direct setup AND invite, both wired to the existing routes ─

function DriversTab({ orgId }: { orgId: string }) {
  const [members, setMembers] = useState<any[]>([]);
  const [invites, setInvites] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Direct setup form
  const [directEmail, setDirectEmail] = useState("");
  const [directName, setDirectName] = useState("");
  const [directPhone, setDirectPhone] = useState("");
  const [creatingDirect, setCreatingDirect] = useState(false);

  // Invite form
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [mr, ir] = await Promise.all([
        api.getOrgMembers(orgId).catch(() => ({ members: [] })),
        api.getOrgInvitations(orgId).catch(() => ({ invitations: [] })),
      ]);
      setMembers((mr.members ?? []).filter((m: any) => m.orgRole === "ORG_DRIVER"));
      setInvites((ir.invitations ?? []).filter((i: any) => i.orgRole === "ORG_DRIVER" && !i.acceptedAt && !i.revokedAt));
    } catch (e: any) { toast.error(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [orgId]);

  const createDirect = async () => {
    if (!directEmail.trim() || !directName.trim()) {
      toast.error("Email and legal name are required");
      return;
    }
    setCreatingDirect(true);
    try {
      await api.createOrgDriver(orgId, { email: directEmail.trim(), legalName: directName.trim(), phone: directPhone || undefined });
      toast.success(`${directName.trim()} added — activation email sent`);
      setDirectEmail(""); setDirectName(""); setDirectPhone("");
      load();
    } catch (e: any) { toast.error(e.message); }
    finally { setCreatingDirect(false); }
  };

  const revoke = async (token: string) => {
    if (!confirm("Revoke this pending invite?")) return;
    try {
      await api.revokeInvitation(orgId, token);
      toast.success("Invite revoked");
      load();
    } catch (e: any) { toast.error(e.message); }
  };

  const remove = async (membershipId: string) => {
    if (!confirm("Remove this driver from your carrier company? Their account stays active but they'll lose access to your loads.")) return;
    try {
      await api.removeMember(orgId, membershipId);
      toast.success("Driver removed");
      load();
    } catch (e: any) { toast.error(e.message); }
  };

  const toggleSuspend = async (m: any) => {
    try {
      if (m.status === "SUSPENDED") {
        await api.reinstateMember(orgId, m.membershipId);
        toast.success("Driver reinstated");
      } else {
        await api.suspendMember(orgId, m.membershipId);
        toast.success("Driver suspended");
      }
      load();
    } catch (e: any) { toast.error(e.message); }
  };

  const sendInvite = async () => {
    if (!inviteEmail.trim()) { toast.error("Enter an email address"); return; }
    setInviting(true);
    try {
      await api.sendInvitation(orgId, { email: inviteEmail.trim(), orgRole: "ORG_DRIVER", userRole: "DRIVER" });
      toast.success(`Invite sent to ${inviteEmail.trim()}`);
      setInviteEmail("");
      load();
    } catch (e: any) { toast.error(e.message); }
    finally { setInviting(false); }
  };

  if (loading) return (
    <div className="flex items-center gap-2 text-muted-foreground text-sm py-8">
      <Loader2 className="h-4 w-4 animate-spin" /> Loading drivers…
    </div>
  );

  return (
    <div className="space-y-5">
      <SectionCard>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Direct Driver Setup</p>
        <p className="text-sm text-muted-foreground">
          Creates the driver profile and an active membership immediately. They'll get an activation email to set a
          password, and still complete their own identity verification (IDV) before their first load.
        </p>
        <div className="grid sm:grid-cols-3 gap-3">
          <Field label="Email" id="de" required>
            <Input id="de" type="email" value={directEmail} onChange={e => setDirectEmail(e.target.value)} placeholder="driver@example.com" />
          </Field>
          <Field label="Legal Name" id="dn" required>
            <Input id="dn" value={directName} onChange={e => setDirectName(e.target.value)} placeholder="Jane Smith" />
          </Field>
          <Field label="Phone" id="dp">
            <Input id="dp" value={directPhone} onChange={e => setDirectPhone(e.target.value)} placeholder="+1 (312) 555-0100" />
          </Field>
        </div>
        <div className="flex justify-end">
          <Button onClick={createDirect} disabled={creatingDirect}>
            {creatingDirect ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Creating…</> : <><UserPlus className="h-4 w-4 mr-2" />Add Driver</>}
          </Button>
        </div>
      </SectionCard>

      <SectionCard>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Invite a Driver</p>
        <p className="text-sm text-muted-foreground">
          They sign up themselves from the invite link and land as an active ORG_DRIVER member.
        </p>
        <div className="flex gap-2">
          <Input
            placeholder="driver@example.com" type="email"
            value={inviteEmail} onChange={e => setInviteEmail(e.target.value)}
            onKeyDown={e => e.key === "Enter" && sendInvite()}
          />
          <Button onClick={sendInvite} disabled={inviting}>
            {inviting ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Send className="h-4 w-4 mr-2" />Invite</>}
          </Button>
        </div>
        {invites.length > 0 && (
          <div>
            <p className="text-xs text-muted-foreground mb-2">Pending invites</p>
            <div className="space-y-2">
              {invites.map((inv: any) => {
                const daysLeft = Math.max(0, Math.ceil((inv.expiresAt - Date.now()) / 86400000));
                return (
                  <div key={inv.token} className="flex items-center justify-between gap-3 text-sm rounded-lg border px-3 py-2">
                    <span className="truncate">{inv.email}</span>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs text-muted-foreground">{daysLeft}d remaining</span>
                      <Button variant="outline" size="sm" onClick={() => revoke(inv.token)}>Revoke</Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </SectionCard>

      <SectionCard>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Driver Roster <span className="ml-1.5 text-muted-foreground font-normal normal-case">({members.length})</span>
        </p>
        {members.length === 0 ? (
          <div className="flex flex-col items-center py-8 text-muted-foreground gap-2">
            <Users className="h-8 w-8 opacity-40" />
            <p className="text-sm">No drivers onboarded yet.</p>
          </div>
        ) : (
          <div className="divide-y -mx-5 px-5">
            {members.map((m: any) => (
              <div key={m.membershipId} className="py-3 flex items-center gap-3">
                <div className="h-9 w-9 rounded-full bg-secondary flex items-center justify-center text-xs font-semibold shrink-0">
                  <Truck className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-sm truncate">{m.userId}</p>
                  <p className="text-xs text-muted-foreground">ORG_DRIVER</p>
                </div>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full shrink-0 ${
                  m.status === "ACTIVE" ? "bg-green-100 text-green-700 dark:bg-green-950/30 dark:text-green-400" : "bg-amber-100 text-amber-700"
                }`}>
                  {m.status}
                </span>
                <div className="flex items-center gap-2 shrink-0">
                  <Button variant="outline" size="sm" onClick={() => toggleSuspend(m)}>
                    {m.status === "SUSPENDED" ? "Reinstate" : "Suspend"}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => remove(m.membershipId)}>Remove</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}

// ── Dispatch tab — placeholder, no load-posting logic exists for carriers yet ─

// ── Dispatch tab — real implementation ───────────────────────────────────────
// Lists the org's loads (tendered offers + assigned/in-transit) so a
// carrier-admin / dispatcher can see at a glance what's in flight. Each row
// opens a detail dialog with a RouteMapCard so the lane is visible without
// leaving the dashboard. The dialog also wires through to the read-only
// AttestationChain panel — handy for confirming the carrier signing chain
// is complete before paying.

function DispatchTab({ orgId }: { orgId: string }) {
  const [data, setData]       = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [openLoad, setOpenLoad] = useState<null | {
    loadId: string;
    origin?: { city?: string; state?: string };
    dest?:   { city?: string; state?: string };
    commodity?: string; equipment?: string; payout?: number; status?: string;
  }>(null);
  // Phase-1b: which driverId the carrier-admin is about to assign + the
  // AttestationDialog open flag. The driver dropdown reads from data.fleet.drivers.
  const [assignDriverId, setAssignDriverId] = useState<string>("");
  const [acceptOpen, setAcceptOpen] = useState(false);
  const [dispatching, setDispatching] = useState(false);

  function refresh() {
    api.getCarrierDashboard(orgId).then(setData).catch(() => {});
  }

  useEffect(() => {
    setLoading(true);
    api.getCarrierDashboard(orgId)
      .then(setData)
      .catch(() => toast.error("Could not load dispatch board."))
      .finally(() => setLoading(false));
  }, [orgId]);

  if (loading) {
    return (
      <SectionCard>
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading dispatch board…
        </div>
      </SectionCard>
    );
  }

  const tendered: any[]   = data?.loadboard?.tendered ?? [];
  const unassigned: any[] = data?.alerts?.unassigned ?? [];
  const activeCounts      = data?.alerts?.activeLoads ?? {};
  const drivers: any[]    = data?.fleet?.drivers ?? [];

  // Build the per-row dispatch list. Tendered offers + unassigned loads.
  // We avoid double-listing if a loadId appears in both arrays.
  const rows = [
    ...tendered.map((t) => ({
      kind: 'TENDERED' as const,
      loadId: t.loadId,
      origin: t.origin,
      dest:   t.dest,
      commodity: t.commodity,
      equipment: t.equipment,
      payout: t.payout,
      driverId: t.driverId,
      expiresAt: t.expiresAt,
    })),
    ...unassigned
      .filter((u) => !tendered.find((t) => t.loadId === u.loadId))
      .map((u) => ({
        kind: 'UNASSIGNED' as const,
        loadId: u.loadId,
        origin: u.pickup,
        dest:   u.delivery,
        payout: u.rate,
      })),
  ];

  return (
    <SectionCard>
      <div className="flex items-baseline justify-between mb-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Dispatch</p>
          <p className="text-sm text-muted-foreground mt-0.5">
            {drivers.length} driver{drivers.length === 1 ? '' : 's'} ·{" "}
            {activeCounts.BOOKED ?? 0} booked ·{" "}
            {activeCounts.IN_TRANSIT ?? 0} in transit ·{" "}
            {activeCounts.DELIVERED ?? 0} delivered
          </p>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center py-8 text-muted-foreground gap-2">
          <Truck className="h-8 w-8 opacity-40" />
          <p className="text-sm text-center max-w-sm">
            No tendered loads. Loads broadcast to your verified drivers will
            appear here as they arrive.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border rounded border border-border">
          {rows.map((r) => (
            <li key={`${r.kind}-${r.loadId}-${(r as any).driverId ?? ''}`}>
              <button
                onClick={() => setOpenLoad({
                  loadId: r.loadId,
                  origin: r.origin, dest: r.dest,
                  commodity: (r as any).commodity, equipment: (r as any).equipment,
                  payout: r.payout, status: r.kind,
                })}
                className="w-full text-left px-3 py-2.5 hover:bg-muted/40 transition-colors flex items-center gap-3"
              >
                <span className={`text-[10px] font-bold tracking-wider px-1.5 py-0.5 rounded ${
                  r.kind === 'TENDERED'
                    ? 'bg-blue-500/10 text-blue-700 dark:text-blue-300'
                    : 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                }`}>
                  {r.kind}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">
                    {r.origin?.city ?? '—'}, {r.origin?.state ?? '—'}{' → '}
                    {r.dest?.city ?? '—'}, {r.dest?.state ?? '—'}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {(r as any).commodity ?? 'commodity TBD'}
                    {(r as any).equipment ? ` · ${(r as any).equipment}` : ''}
                    {r.payout ? ` · $${Number(r.payout).toLocaleString()}` : ''}
                  </div>
                </div>
                <span className="text-xs text-muted-foreground font-mono">
                  {r.loadId.slice(-6)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Load detail dialog — map + key fields + read-only attestation chain */}
      <Dialog open={openLoad !== null} onOpenChange={(o) => { if (!o) setOpenLoad(null); }}>
        <DialogContent className="max-w-3xl">
          {openLoad && (
            <div className="space-y-4">
              <div className="flex items-baseline justify-between">
                <h2 className="text-lg font-semibold">
                  {openLoad.origin?.city ?? '—'} → {openLoad.dest?.city ?? '—'}
                </h2>
                <span className="text-xs text-muted-foreground font-mono">{openLoad.loadId}</span>
              </div>

              {/* Route preview — uses the same RouteMapCard the rest of the app
                  uses. The expand button opens its own fullscreen modal. */}
              <RouteMapCard
                pickupAddress={openLoad.origin?.city
                  ? `${openLoad.origin.city}, ${openLoad.origin.state ?? ''}`
                  : null}
                deliveryAddress={openLoad.dest?.city
                  ? `${openLoad.dest.city}, ${openLoad.dest.state ?? ''}`
                  : null}
                currentCity={openLoad.origin?.city ?? null}
                currentState={openLoad.origin?.state ?? null}
                mapsApiKey={import.meta.env.VITE_GOOGLE_MAPS_API_KEY}
              />

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <div className="text-xs text-muted-foreground">Status</div>
                  <div className="font-medium">{openLoad.status}</div>
                </div>
                {openLoad.commodity && (
                  <div>
                    <div className="text-xs text-muted-foreground">Commodity</div>
                    <div className="font-medium">{openLoad.commodity}</div>
                  </div>
                )}
                {openLoad.equipment && (
                  <div>
                    <div className="text-xs text-muted-foreground">Equipment</div>
                    <div className="font-medium">{openLoad.equipment}</div>
                  </div>
                )}
                {openLoad.payout && (
                  <div>
                    <div className="text-xs text-muted-foreground">Payout</div>
                    <div className="font-medium">${Number(openLoad.payout).toLocaleString()}</div>
                  </div>
                )}
              </div>

              {/* Dispatcher path — pick a driver + sign CARRIER_ACCEPT.
                  Only shown for TENDERED rows (UNASSIGNED rows don't
                  have offer infrastructure to accept against). */}
              {openLoad.status === 'TENDERED' && drivers.length > 0 && (
                <div className="rounded-md border border-border bg-card p-4 space-y-3">
                  <div className="text-sm font-semibold">Assign + sign acceptance</div>
                  <div className="text-xs text-muted-foreground">
                    Sign CARRIER_ACCEPT for this load. The chosen driver is
                    bound into the signature's documentHash; bookings can't
                    reuse a sig signed for a different driver.
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <select
                      className="rounded border border-border bg-background px-2 py-1.5 text-sm flex-1 min-w-[200px]"
                      value={assignDriverId}
                      onChange={(e) => setAssignDriverId(e.target.value)}
                      disabled={dispatching}
                    >
                      <option value="">— pick a driver —</option>
                      {drivers.map((d: any) => (
                        <option key={d.driverId} value={d.driverId}>
                          {d.name ?? d.driverId} · {d.availability ?? 'unknown'} · IDV: {d.idvStatus}
                        </option>
                      ))}
                    </select>
                    <Button
                      disabled={!assignDriverId || dispatching}
                      onClick={() => setAcceptOpen(true)}
                    >
                      Sign acceptance
                    </Button>
                  </div>
                </div>
              )}

              {/* Attestation chain — read-only, shows who has signed what */}
              <AttestationChain loadId={openLoad.loadId} />
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* CARRIER_ACCEPT attestation dialog. On signed → POST dispatch. */}
      <AttestationDialog
        open={acceptOpen}
        onOpenChange={(o) => { if (!o) setAcceptOpen(false); }}
        title="Sign carrier acceptance"
        subtitle={openLoad ? `${openLoad.loadId.slice(-8)} · driver ${assignDriverId.slice(-6)}` : undefined}
        loadId={openLoad?.loadId ?? ""}
        action="CARRIER_ACCEPT"
        attestationText={ATTESTATION_TEXT.CARRIER_ACCEPT}
        attestationVersion={ATTESTATION_VERSION}
        assignedDriverId={assignDriverId}
        onSigned={async () => {
          if (!openLoad) return;
          setDispatching(true);
          try {
            const r = await api.dispatchLoad(openLoad.loadId);
            toast.success("Dispatched", { description: `Assigned to driver ${r.assignedDriverId.slice(-6)}` });
            setAcceptOpen(false);
            setOpenLoad(null);
            setAssignDriverId("");
            refresh();
          } catch (e: any) {
            toast.error(e?.message ?? "Dispatch failed");
          } finally {
            setDispatching(false);
          }
        }}
      />
    </SectionCard>
  );
}

// ── Main carrier dashboard ────────────────────────────────────────────────────

export default function CarrierDashboard() {
  const { user } = useAuth();
  const [orgId, setOrgId] = useState<string | null>(null);
  const [orgName, setOrgName] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getMyOrgs()
      .then(r => {
        // A CARRIER_ADMIN has exactly one org — the carrier company created
        // atomically at signup.
        const org = (r.orgs ?? []).find((o: any) => o.capabilities?.includes("CARRIER")) ?? r.orgs?.[0];
        if (org) { setOrgId(org.orgId); setOrgName(org.legalName); }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading your company…
      </div>
    );
  }

  if (!orgId) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        No carrier organisation found for this account.
      </div>
    );
  }

  // Horizontal-tab pill style. Shared across the four triggers so the
  // active state stays consistent. `data-tour` anchors preserved so the
  // onboarding walkthrough + Cypress selectors continue to resolve.
  const tabPill =
    "inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium " +
    "text-muted-foreground hover:text-foreground transition-colors " +
    "data-[state=active]:bg-card data-[state=active]:text-foreground " +
    "data-[state=active]:shadow-sm data-[state=active]:ring-1 data-[state=active]:ring-border";

  return (
    <div className="min-h-screen bg-background">
      {/* D2: Dispatch is the dispatcher's primary job, so it is the landing tab.
          Overview / Verification / Drivers remain one click away. */}
      <Tabs defaultValue="dispatch" className="flex flex-col">
        {/* Header: title + subtitle + horizontal tab rail. The tabs sit
            directly above the dashboard content so the page reclaims the
            horizontal space the old vertical rail occupied. */}
        <div className="border-b bg-card">
          <div className="max-w-7xl mx-auto px-6 pt-5 pb-3 flex items-start gap-3">
            <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              <Building2 className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-xl font-bold truncate">{orgName || "Carrier"}</h1>
              <p className="text-sm text-muted-foreground truncate">Verification + roster</p>
            </div>
          </div>
          <div className="max-w-7xl mx-auto px-6 pb-3">
            <TabsList
              data-tour="carrier-company"
              className="inline-flex h-auto items-center gap-1 rounded-full bg-secondary p-1"
            >
              <TabsTrigger value="overview" className={tabPill}>
                <Activity className="h-4 w-4" />Overview
              </TabsTrigger>
              <TabsTrigger data-tour="verification-panel" value="verification" className={tabPill}>
                <ShieldCheck className="h-4 w-4" />Verification
              </TabsTrigger>
              <TabsTrigger data-tour="onboard-drivers" value="drivers" className={tabPill}>
                <Users className="h-4 w-4" />Drivers
              </TabsTrigger>
              <TabsTrigger data-tour="load-board" value="dispatch" className={tabPill}>
                <Truck className="h-4 w-4" />Dispatch
              </TabsTrigger>
            </TabsList>
          </div>
        </div>

        {/* Tab content area — full width minus the page gutters. The
            Dispatcher/Exec toggle + Refresh button live inside
            CarrierDashboardView and remain at the top of the Overview tab. */}
        <div className="max-w-7xl w-full mx-auto px-6 py-6 flex-1 min-w-0">
          <TabsContent value="overview"><CarrierDashboardView orgId={orgId} /></TabsContent>
          <TabsContent value="verification"><VerificationTab orgId={orgId} /></TabsContent>
          <TabsContent value="drivers"><DriversTab orgId={orgId} /></TabsContent>
          <TabsContent value="dispatch"><DispatchTab orgId={orgId} /></TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
