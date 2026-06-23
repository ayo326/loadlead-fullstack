// Platform admin org table.
//
// Lists every Organization with member count + suspension state. Each row
// exposes Suspend / Reinstate (asks for a reason) and Revoke admin on the
// org's OWNER (asks for a reason). All four actions are backed by
// /api/admin/* which is requireAdmin-gated server-side; this UI is
// convenience only - the spec calls out explicitly that hiding a button
// is never a security control.

import { useEffect, useState } from "react";
import { Building2, ShieldOff, ShieldCheck, RefreshCw, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import { ConfirmWithReasonDialog } from "./ConfirmWithReasonDialog";

type StatusFilter = "all" | "active" | "suspended";

interface OrgRow {
  orgId: string;
  legalName: string;
  dba?: string;
  capabilities?: string[];
  suspended: boolean;
  suspendedAt: number | null;
  suspendedBy: string | null;
  memberCount: number;
  ownerUserId: string | null;
  createdAt: number;
}

type PendingAction =
  | { kind: "suspend"; org: OrgRow }
  | { kind: "reinstate"; org: OrgRow }
  | { kind: "revoke-admin"; org: OrgRow };

export function OrgManagementPanel() {
  const [orgs, setOrgs] = useState<OrgRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [pending, setPending] = useState<PendingAction | null>(null);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const res = await api.adminListOrgs({ status: filter, limit: 100 });
      setOrgs(res.items as OrgRow[]);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to load organisations");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filter]);

  async function executePending(reason: string) {
    if (!pending) return;
    if (pending.kind === "suspend") {
      await api.adminSuspendOrg(pending.org.orgId, reason);
    } else if (pending.kind === "reinstate") {
      await api.adminReinstateOrg(pending.org.orgId, reason);
    } else if (pending.kind === "revoke-admin") {
      const ownerId = pending.org.ownerUserId;
      if (!ownerId) throw new Error("Org has no recorded OWNER");
      await api.adminRevokeUserAdmin(ownerId, reason);
    }
    await load();
  }

  const dialogConfig = pending && {
    title:
      pending.kind === "suspend" ? `Suspend ${pending.org.legalName}?`
      : pending.kind === "reinstate" ? `Reinstate ${pending.org.legalName}?`
      : `Revoke admin from ${pending.org.legalName}'s owner?`,
    description:
      pending.kind === "suspend"
        ? "All members will lose access until reinstated. Active dispatch and tracking will be paused."
        : pending.kind === "reinstate"
        ? "Members will regain access immediately."
        : "Demotes the owner to ORG_DRIVER across all their memberships. If they are the sole owner of any org, that org is suspended (not orphaned).",
    confirmLabel:
      pending.kind === "suspend" ? "Suspend org"
      : pending.kind === "reinstate" ? "Reinstate org"
      : "Revoke admin",
    destructive: pending.kind !== "reinstate",
  };

  return (
    <div className="rounded-md border border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-border">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold">Organisations</h2>
          </div>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={load} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>

        <div className="flex gap-1.5 flex-wrap">
          {(["all", "active", "suspended"] as StatusFilter[]).map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                filter === s
                  ? "border-primary bg-primary/5 text-primary"
                  : "border-border text-muted-foreground hover:border-primary/40"
              }`}
            >
              {s === "all" ? "All" : s === "active" ? "Active" : "Suspended"}
            </button>
          ))}
        </div>
      </div>

      {/* Body */}
      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground text-sm gap-2">
          <RefreshCw className="h-4 w-4 animate-spin" /> Loading organisations…
        </div>
      ) : err ? (
        <div className="flex flex-col items-center justify-center py-12 text-destructive text-sm gap-2">
          <p>{err}</p>
          <Button size="sm" variant="outline" onClick={load}>Retry</Button>
        </div>
      ) : orgs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
          <Building2 className="h-8 w-8 opacity-30" />
          <p className="text-sm">No organisations match this filter</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm" aria-label="Organisations">
            <thead>
              <tr className="text-left text-xs uppercase tracking-widest text-muted-foreground bg-secondary/40">
                <th className="px-5 py-3 font-medium">Organisation</th>
                <th className="px-5 py-3 font-medium">Capabilities</th>
                <th className="px-5 py-3 font-medium">Members</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-3 py-3" />
              </tr>
            </thead>
            <tbody>
              {orgs.map((o) => (
                <tr key={o.orgId} className="border-t border-border hover:bg-secondary/20">
                  <td className="px-5 py-3">
                    <div className="font-semibold">{o.legalName}</div>
                    {o.dba && <div className="text-xs text-muted-foreground">DBA: {o.dba}</div>}
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex flex-wrap gap-1">
                      {(o.capabilities ?? []).map((c) => (
                        <Badge key={c} variant="outline" className="text-[10px]">{c}</Badge>
                      ))}
                    </div>
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">{o.memberCount}</td>
                  <td className="px-5 py-3">
                    {o.suspended ? (
                      <Badge variant="destructive">Suspended</Badge>
                    ) : (
                      <Badge variant="secondary">Active</Badge>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-1.5 justify-end">
                      {o.suspended ? (
                        <Button size="sm" variant="outline"
                          onClick={() => setPending({ kind: "reinstate", org: o })}>
                          <ShieldCheck className="h-3.5 w-3.5 mr-1" /> Reinstate
                        </Button>
                      ) : (
                        <Button size="sm" variant="outline"
                          onClick={() => setPending({ kind: "suspend", org: o })}>
                          <ShieldOff className="h-3.5 w-3.5 mr-1" /> Suspend
                        </Button>
                      )}
                      {o.ownerUserId && (
                        <Button size="sm" variant="ghost"
                          onClick={() => setPending({ kind: "revoke-admin", org: o })}>
                          <UserX className="h-3.5 w-3.5 mr-1" /> Revoke admin
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dialogConfig && pending && (
        <ConfirmWithReasonDialog
          open={!!pending}
          onOpenChange={(v) => { if (!v) setPending(null); }}
          title={dialogConfig.title}
          description={dialogConfig.description}
          confirmLabel={dialogConfig.confirmLabel}
          destructive={dialogConfig.destructive}
          onConfirm={executePending}
        />
      )}
    </div>
  );
}
