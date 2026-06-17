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

function DispatchTab() {
  return (
    <SectionCard>
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Load Dispatch</p>
      <div className="flex flex-col items-center py-8 text-muted-foreground gap-2">
        <Truck className="h-8 w-8 opacity-40" />
        <p className="text-sm text-center max-w-sm">
          Loads broadcast to your verified drivers will appear here once your company verification is complete and
          drivers are onboarded.
        </p>
      </div>
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

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b bg-card">
        <div className="max-w-5xl mx-auto px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <Building2 className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold">{orgName || "Carrier Dashboard"}</h1>
              <p className="text-sm text-muted-foreground">Signed in as {user?.email}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-6">
        <Tabs defaultValue="overview" orientation="vertical" className="flex gap-6">
          <TabsList className="flex flex-col h-auto w-44 shrink-0 rounded-xl bg-secondary p-1 gap-1">
            <TabsTrigger value="overview" className="w-full justify-start rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm">
              <Activity className="h-4 w-4 mr-2" />Overview
            </TabsTrigger>
            <TabsTrigger value="verification" className="w-full justify-start rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm">
              <ShieldCheck className="h-4 w-4 mr-2" />Verification
            </TabsTrigger>
            <TabsTrigger value="drivers" className="w-full justify-start rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm">
              <Users className="h-4 w-4 mr-2" />Drivers
            </TabsTrigger>
            <TabsTrigger value="dispatch" className="w-full justify-start rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm">
              <Truck className="h-4 w-4 mr-2" />Dispatch
            </TabsTrigger>
          </TabsList>

          <div className="flex-1 min-w-0">
            <TabsContent value="overview"><CarrierDashboardView orgId={orgId} /></TabsContent>
            <TabsContent value="verification"><VerificationTab orgId={orgId} /></TabsContent>
            <TabsContent value="drivers"><DriversTab orgId={orgId} /></TabsContent>
            <TabsContent value="dispatch"><DispatchTab /></TabsContent>
          </div>
        </Tabs>
      </div>
    </div>
  );
}
