// Carrier Members page (IAM-6).
//
// One page, one screen-worth of UX, driven by the existing org endpoints:
//   GET    /api/org/:orgId/members              -> roster
//   GET    /api/org/:orgId/invitations          -> pending invites
//   POST   /api/org/:orgId/invitations          -> create invite
//   DELETE /api/org/:orgId/invitations/:token   -> revoke invite
//   PATCH  /api/org/:orgId/members/:id          -> change role (also: transfer ownership)
//   DELETE /api/org/:orgId/members/:id          -> remove
//
// Every gate is also enforced server-side via hasPermission(role, ...).
// The UI hides controls the caller can't use, but that is convenience only.

import { useEffect, useMemo, useState } from "react";
import { Users, UserPlus, RefreshCw, Trash2, Mail, KeyRound, Crown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ConfirmWithReasonDialog } from "@/components/admin/ConfirmWithReasonDialog";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

// Canonical org roles (matches backend OrgRole; MANAGER replaces ORG_ADMIN).
const ORG_ROLE_OPTIONS = [
  { value: "OWNER",      label: "Owner",     hint: "Full control. Only an Owner can transfer ownership or change billing." },
  { value: "MANAGER",    label: "Manager",   hint: "Invite + manage members, change roles, manage operations. Cannot transfer ownership or billing." },
  { value: "DISPATCHER", label: "Dispatcher", hint: "Assign loads to drivers and manage day-to-day dispatch. Cannot invite or remove members." },
  { value: "ORG_DRIVER", label: "Driver",     hint: "Driver-tier member. Accepts loads and uploads POD. Cannot manage members." },
] as const;

const ROLE_LABEL: Record<string, string> = Object.fromEntries(
  ORG_ROLE_OPTIONS.map((o) => [o.value, o.label]),
);

type Member = {
  membershipId: string;
  userId: string;
  orgId: string;
  orgRole: string;
  status?: string;
  email?: string;
  fullName?: string;
  idvStatus?: string;
  createdAt?: number;
};

type Invite = {
  token: string;
  email: string;
  orgRole: string;
  userRole: string;
  expiresAt: number;
  acceptedAt?: number | null;
  revokedAt?: number | null;
};

function normalizeRole(r: string | undefined): string {
  if (!r) return "ORG_DRIVER";
  if (r === "ORG_ADMIN" || r === "ADMIN") return "MANAGER";
  if (r === "MEMBER" || r === "VIEWER") return "ORG_DRIVER";
  return r;
}

export function CarrierMembers() {
  const { user } = useAuth();
  const [orgId, setOrgId] = useState<string | null>(null);
  const [myRole, setMyRole] = useState<string>("ORG_DRIVER");
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [transfer, setTransfer]   = useState<Member | null>(null);
  const [removeTarget, setRemoveTarget] = useState<Member | null>(null);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const { orgs } = await api.getMyOrgs();
      const org = (orgs ?? []).find((o: any) => o?.capabilities?.includes("CARRIER")) ?? orgs?.[0];
      if (!org) { setErr("No organisation associated with this account."); return; }
      setOrgId(org.orgId);

      const [mRes, iRes] = await Promise.all([
        api.getOrgMembers(org.orgId),
        api.getOrgInvitations(org.orgId).catch(() => ({ invitations: [] as Invite[] })),
      ]);
      setMembers(mRes.members);
      setInvites(iRes.invitations ?? []);
      const me = mRes.members.find((m: Member) => m.userId === user?.userId);
      if (me) setMyRole(normalizeRole(me.orgRole));
    } catch (e: any) {
      setErr(e?.message ?? "Failed to load members");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const canInvite      = myRole === "OWNER" || myRole === "MANAGER";
  const canChangeRoles = canInvite;
  const canRemove      = canInvite;
  const canTransfer    = myRole === "OWNER";

  async function changeRole(m: Member, next: string) {
    if (!orgId) return;
    await api.updateMemberRole(orgId, m.membershipId, next);
    await load();
  }

  async function doTransfer(_reason: string) {
    if (!orgId || !transfer) return;
    // Promote target to OWNER. Backend will succeed only if caller is OWNER.
    await api.updateMemberRole(orgId, transfer.membershipId, "OWNER");
    await load();
  }

  async function doRemove(_reason: string) {
    if (!orgId || !removeTarget) return;
    await api.removeMember(orgId, removeTarget.membershipId);
    await load();
  }

  async function revokeInvite(token: string) {
    if (!orgId) return;
    if (!confirm("Revoke this invitation?")) return;
    await api.revokeInvitation(orgId, token);
    await load();
  }

  const sortedMembers = useMemo(
    () => [...members].sort((a, b) => {
      const order = ["OWNER", "MANAGER", "DISPATCHER", "ORG_DRIVER"];
      return order.indexOf(normalizeRole(a.orgRole)) - order.indexOf(normalizeRole(b.orgRole));
    }),
    [members],
  );

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Users className="h-6 w-6 text-primary" /> Members
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Invite teammates, change roles, and transfer ownership of your organisation.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
          {canInvite && (
            <Button size="sm" onClick={() => setInviteOpen(true)}>
              <UserPlus className="h-4 w-4 mr-1.5" /> Invite member
            </Button>
          )}
        </div>
      </div>

      {err && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {err}
        </div>
      )}

      {/* Roster */}
      <div className="rounded-md border border-border bg-card overflow-hidden">
        <div className="px-5 py-3 border-b border-border text-sm font-semibold">Roster</div>
        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground text-sm gap-2">
            <RefreshCw className="h-4 w-4 animate-spin" /> Loading members…
          </div>
        ) : sortedMembers.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">No members yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-widest text-muted-foreground bg-secondary/40">
                  <th className="px-5 py-3 font-medium">Member</th>
                  <th className="px-5 py-3 font-medium">Role</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-3 py-3" />
                </tr>
              </thead>
              <tbody>
                {sortedMembers.map((m) => {
                  const role = normalizeRole(m.orgRole);
                  const isMe = m.userId === user?.userId;
                  return (
                    <tr key={m.membershipId} className="border-t border-border hover:bg-secondary/20">
                      <td className="px-5 py-3">
                        <div className="font-semibold">{m.fullName || m.email || m.userId}{isMe && <span className="ml-1.5 text-xs text-muted-foreground">(you)</span>}</div>
                        {m.email && m.fullName && <div className="text-xs text-muted-foreground">{m.email}</div>}
                      </td>
                      <td className="px-5 py-3">
                        {canChangeRoles && !isMe ? (
                          <Select value={role} onValueChange={(v) => changeRole(m, v)}>
                            <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {ORG_ROLE_OPTIONS
                                .filter((o) => o.value !== "OWNER") // OWNER changes go through Transfer
                                .map((o) => (
                                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                                ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <Badge variant={role === "OWNER" ? "default" : "secondary"}>{ROLE_LABEL[role] ?? role}</Badge>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        {(m.status ?? "ACTIVE") === "SUSPENDED"
                          ? <Badge variant="destructive">Suspended</Badge>
                          : <Badge variant="outline">Active</Badge>}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <div className="flex items-center gap-1.5 justify-end">
                          {canTransfer && !isMe && role !== "OWNER" && (
                            <Button size="sm" variant="ghost" onClick={() => setTransfer(m)} title="Transfer ownership to this member">
                              <Crown className="h-3.5 w-3.5 mr-1" /> Make owner
                            </Button>
                          )}
                          {canRemove && !isMe && (
                            <Button size="sm" variant="ghost" onClick={() => setRemoveTarget(m)} title="Remove from organisation">
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pending invitations */}
      {canInvite && (
        <div className="rounded-md border border-border bg-card overflow-hidden">
          <div className="px-5 py-3 border-b border-border text-sm font-semibold flex items-center gap-2">
            <Mail className="h-4 w-4 text-primary" /> Pending invitations
            <span className="text-xs text-muted-foreground font-normal">({invites.length})</span>
          </div>
          {invites.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">No pending invitations.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-widest text-muted-foreground bg-secondary/40">
                    <th className="px-5 py-3 font-medium">Email</th>
                    <th className="px-5 py-3 font-medium">Role</th>
                    <th className="px-5 py-3 font-medium">Expires</th>
                    <th className="px-3 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {invites.map((inv) => (
                    <tr key={inv.token} className="border-t border-border">
                      <td className="px-5 py-3">{inv.email}</td>
                      <td className="px-5 py-3">
                        <Badge variant="outline">{ROLE_LABEL[normalizeRole(inv.orgRole)] ?? inv.orgRole}</Badge>
                      </td>
                      <td className="px-5 py-3 text-xs text-muted-foreground">
                        {new Date(inv.expiresAt).toLocaleString()}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <Button size="sm" variant="ghost" onClick={() => revokeInvite(inv.token)}>
                          <KeyRound className="h-3.5 w-3.5 mr-1" /> Revoke
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Invite dialog */}
      {orgId && (
        <InviteMemberDialog
          open={inviteOpen}
          onOpenChange={setInviteOpen}
          orgId={orgId}
          onInvited={load}
        />
      )}

      {/* Transfer ownership */}
      {transfer && (
        <ConfirmWithReasonDialog
          open={!!transfer}
          onOpenChange={(v) => { if (!v) setTransfer(null); }}
          title={`Transfer ownership to ${transfer.fullName || transfer.email || transfer.userId}?`}
          description="You will be demoted to Manager. The new Owner will have full control of the organisation, including billing and the ability to transfer ownership again."
          confirmLabel="Transfer ownership"
          destructive
          onConfirm={async (reason) => { await doTransfer(reason); setTransfer(null); }}
        />
      )}

      {/* Remove member */}
      {removeTarget && (
        <ConfirmWithReasonDialog
          open={!!removeTarget}
          onOpenChange={(v) => { if (!v) setRemoveTarget(null); }}
          title={`Remove ${removeTarget.fullName || removeTarget.email || removeTarget.userId}?`}
          description="They will lose access to this organisation immediately. Past activity is preserved in the audit log."
          confirmLabel="Remove member"
          destructive
          onConfirm={async (reason) => { await doRemove(reason); setRemoveTarget(null); }}
        />
      )}
    </div>
  );
}

function InviteMemberDialog({ open, onOpenChange, orgId, onInvited }: {
  open: boolean; onOpenChange: (v: boolean) => void; orgId: string; onInvited: () => void;
}) {
  const [email, setEmail] = useState("");
  const [orgRole, setOrgRole] = useState<string>("DISPATCHER");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const userRoleFor = (or: string) => or === "ORG_DRIVER" ? "DRIVER" : "CARRIER_ADMIN";

  async function send() {
    if (!email || !email.includes("@")) { setErr("Enter a valid email"); return; }
    setSubmitting(true);
    setErr(null);
    try {
      await api.sendInvitation(orgId, { email, orgRole, userRole: userRoleFor(orgRole) } as any);
      setEmail("");
      onInvited();
      onOpenChange(false);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to send invitation");
    } finally {
      setSubmitting(false);
    }
  }

  const hint = ORG_ROLE_OPTIONS.find((o) => o.value === orgRole)?.hint;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!submitting) onOpenChange(v); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite a member</DialogTitle>
          <DialogDescription>
            They'll receive an email with a link to join your organisation. The link expires in 7 days.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="invite-email">Email</Label>
            <Input id="invite-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@company.com" disabled={submitting} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="invite-role">Role</Label>
            <Select value={orgRole} onValueChange={setOrgRole}>
              <SelectTrigger id="invite-role"><SelectValue /></SelectTrigger>
              <SelectContent>
                {ORG_ROLE_OPTIONS.filter((o) => o.value !== "OWNER").map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
          </div>
          {err && <p className="text-xs text-destructive">{err}</p>}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
          <Button onClick={send} disabled={submitting || !email}>
            {submitting ? "Sending…" : "Send invitation"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default CarrierMembers;
