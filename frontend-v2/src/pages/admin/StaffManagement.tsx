/**
 * Staff / Team — platform-staff IAM. STAFF_ADMIN only (the server 403s lower
 * tiers; the Settings page also hides this for non-STAFF_ADMIN). Invite by
 * email + role, list staff with role/status, change role, deactivate/
 * reactivate, view + revoke pending invites.
 *
 * Platform-staff roles are a SEPARATE enum from carrier-org roles — the
 * staff "Manager" is not the tenant "Manager".
 */

import { useEffect, useState, useCallback } from "react";
import { api, type StaffMember, type PendingStaffInvite, type PlatformRole } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

const ROLE_OPTIONS: { value: PlatformRole; label: string }[] = [
  { value: "STAFF_ADMIN", label: "Admin" },
  { value: "STAFF_MANAGER", label: "Manager" },
  { value: "STAFF_SUPERVISOR", label: "Supervisor" },
  { value: "STAFF_TEAM_LEAD", label: "Team Lead" },
];
const roleLabel = (r: PlatformRole) => ROLE_OPTIONS.find(o => o.value === r)?.label ?? r;

export default function StaffManagement() {
  const { user } = useAuth();
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [invites, setInvites] = useState<PendingStaffInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // invite form
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<PlatformRole>("STAFF_MANAGER");
  const [lastAcceptUrl, setLastAcceptUrl] = useState<string | null>(null);

  const reload = useCallback(() => {
    setLoading(true);
    Promise.all([api.adminStaff.list(), api.adminStaff.listInvites()])
      .then(([s, i]) => { setStaff(s.staff); setInvites(i.invites); })
      .catch((e) => toast.error(e.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { reload(); }, [reload]);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setLastAcceptUrl(null);
    try {
      const r = await api.adminStaff.invite(email.trim(), role);
      toast.success(`Invited ${r.email} as ${roleLabel(role)}`);
      setLastAcceptUrl(r.acceptUrl);
      setEmail("");
      reload();
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(false); }
  }

  async function changeRole(m: StaffMember, next: PlatformRole) {
    if (next === m.platformRole) return;
    setBusy(true);
    try {
      await api.adminStaff.changeRole(m.userId, next);
      toast.success(`${m.email} → ${roleLabel(next)}`);
      reload();
    } catch (e: any) { toast.error(e.message); reload(); }
    finally { setBusy(false); }
  }

  async function toggleActive(m: StaffMember) {
    setBusy(true);
    try {
      if (m.status === "SUSPENDED") { await api.adminStaff.reactivate(m.userId); toast.success(`${m.email} reactivated`); }
      else { await api.adminStaff.deactivate(m.userId); toast.success(`${m.email} deactivated`); }
      reload();
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(false); }
  }

  async function revoke(token: string, inviteEmail: string) {
    setBusy(true);
    try { await api.adminStaff.revokeInvite(token); toast.success(`Revoked invite for ${inviteEmail}`); reload(); }
    catch (e: any) { toast.error(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-6">
      {/* Invite form */}
      <section className="rounded-lg border border-border bg-card p-5">
        <h3 className="text-sm font-semibold text-foreground mb-1">Invite a staff member</h3>
        <p className="text-xs text-muted-foreground mb-3">
          Sends a one-time, expiring invite (reuses the platform Invitation flow). Accepting it creates an internal
          staff account with the chosen role — never a customer account.
        </p>
        <form onSubmit={invite} className="flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-[220px]">
            <label htmlFor="staff-email" className="block text-xs text-muted-foreground mb-1">Work email</label>
            <input id="staff-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm" placeholder="name@loadlead.com" />
          </div>
          <div>
            <label htmlFor="staff-role" className="block text-xs text-muted-foreground mb-1">Role</label>
            <select id="staff-role" value={role} onChange={(e) => setRole(e.target.value as PlatformRole)}
              className="rounded border border-border bg-background px-2 py-1.5 text-sm">
              {ROLE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <button type="submit" disabled={busy}
            className="rounded-md bg-primary text-primary-foreground px-4 py-1.5 text-sm font-medium disabled:opacity-50">
            Send invite
          </button>
        </form>
        {lastAcceptUrl && (
          <div className="mt-3 text-xs bg-muted rounded px-3 py-2 break-all">
            <span className="text-foreground font-medium">Invite sent by email.</span>{" "}
            You can also copy this one-time link to share directly (it expires in 7 days):{" "}
            <span className="font-mono text-foreground">{location.origin}{lastAcceptUrl}</span>
          </div>
        )}
      </section>

      {/* Staff list */}
      <section>
        <h3 className="text-sm font-semibold text-foreground mb-2">Current staff</h3>
        {loading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : (
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Member</th>
                  <th className="text-left px-3 py-2 font-medium">Role</th>
                  <th className="text-left px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {staff.map((m) => {
                  const isSelf = m.userId === user?.userId;
                  return (
                    <tr key={m.userId} className="border-t border-border">
                      <td className="px-3 py-2">
                        <div className="font-medium text-foreground">{m.fullName || m.email}{isSelf && <span className="ml-1 text-xs text-muted-foreground">(you)</span>}</div>
                        <div className="text-xs text-muted-foreground">{m.email}</div>
                      </td>
                      <td className="px-3 py-2">
                        <select
                          aria-label={`Role for ${m.email}`}
                          value={m.platformRole}
                          disabled={busy}
                          onChange={(e) => changeRole(m, e.target.value as PlatformRole)}
                          className="rounded border border-border bg-background px-2 py-1 text-xs"
                        >
                          {ROLE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${m.status === "ACTIVE" ? "bg-emerald-100 text-emerald-800" : "bg-zinc-200 text-zinc-700"}`}>
                          {m.status === "ACTIVE" ? "Active" : "Suspended"}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        {!isSelf && (
                          <button onClick={() => toggleActive(m)} disabled={busy}
                            className={`text-xs hover:underline ${m.status === "SUSPENDED" ? "text-emerald-700" : "text-rose-600"}`}>
                            {m.status === "SUSPENDED" ? "Reactivate" : "Deactivate"}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {staff.length === 0 && (
                  <tr><td colSpan={4} className="px-3 py-6 text-center text-sm text-muted-foreground">No staff yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Pending invites */}
      <section>
        <h3 className="text-sm font-semibold text-foreground mb-2">Pending invites</h3>
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Email</th>
                <th className="text-left px-3 py-2 font-medium">Role</th>
                <th className="text-left px-3 py-2 font-medium">Expires</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {invites.map((i) => (
                <tr key={i.token} className="border-t border-border">
                  <td className="px-3 py-2 font-mono text-xs">{i.email}</td>
                  <td className="px-3 py-2">{roleLabel(i.platformRole)}</td>
                  <td className="px-3 py-2 text-muted-foreground text-xs">{new Date(i.expiresAt).toLocaleString()}</td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => revoke(i.token, i.email)} disabled={busy} className="text-xs text-rose-600 hover:underline">Revoke</button>
                  </td>
                </tr>
              ))}
              {invites.length === 0 && (
                <tr><td colSpan={4} className="px-3 py-6 text-center text-sm text-muted-foreground">No pending invites.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
