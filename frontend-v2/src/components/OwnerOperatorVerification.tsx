/**
 * OwnerOperatorVerification — two-gate verification panel.
 *
 * Owner Operators clear two gates before they (or their fleet) can haul:
 *   1. CARRIER AUTHORITY — FMCSA active + KYB pass (company-level)
 *   2. DRIVER IDENTITY   — personal IDV via Didit (user-level)
 *
 * Both must be VERIFIED. An OO who's only completed KYB still can't accept a
 * load until they also pass IDV (they're acting as their own self-driver and
 * identity can't be inherited from the company).
 */

import { useEffect, useState } from "react";
import { Shield, UserCheck, CheckCircle2, AlertCircle, Loader2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { toast } from "sonner";

type Status = "UNVERIFIED" | "PENDING" | "VERIFIED" | "REJECTED" | "EXPIRED";

const STATUS_COLOR: Record<Status, string> = {
  UNVERIFIED: "bg-secondary text-muted-foreground",
  PENDING:    "bg-amber-100 text-amber-700",
  VERIFIED:   "bg-green-100 text-green-700",
  REJECTED:   "bg-red-100 text-red-700",
  EXPIRED:    "bg-red-100 text-red-700",
};

function Pill({ status }: { status?: string }) {
  const s = (status ?? "UNVERIFIED") as Status;
  return <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${STATUS_COLOR[s] ?? STATUS_COLOR.UNVERIFIED}`}>{s}</span>;
}

function Card({ icon: Icon, title, children }: { icon: any; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-card p-6">
      <h3 className="text-sm font-semibold flex items-center gap-2 mb-4">
        <Icon className="h-4 w-4 text-primary" /> {title}
      </h3>
      {children}
    </div>
  );
}

export function OwnerOperatorVerification() {
  const [authority, setAuthority] = useState<any>(null);
  const [identity, setIdentity] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busyAuth, setBusyAuth] = useState(false);
  const [busyIdv, setBusyIdv] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      const [a, i] = await Promise.all([
        api.getOoVerification().catch(() => ({ verification: null })),
        api.getOoIdv().catch(() => ({ verification: null })),
      ]);
      setAuthority(a.verification);
      setIdentity(i.verification);
    } finally { setLoading(false); }
  }

  useEffect(() => { refresh(); }, []);

  async function startAuth() {
    setBusyAuth(true);
    try {
      const r = await api.submitOoVerification();
      setAuthority(r.verification);
      toast.success("Carrier verification submitted. Complete KYB at the Didit link.");
    } catch (e: any) { toast.error(e.message); }
    finally { setBusyAuth(false); }
  }

  async function startIdv() {
    setBusyIdv(true);
    try {
      const r = await api.submitOoIdv();
      setIdentity(r.verification);
      toast.success("Identity verification started. Complete it at the Didit link.");
    } catch (e: any) { toast.error(e.message); }
    finally { setBusyIdv(false); }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 text-muted-foreground animate-spin" />
      </div>
    );
  }

  const authStatus  = authority?.verificationStatus ?? "UNVERIFIED";
  const idvStatus   = identity?.verificationStatus ?? "UNVERIFIED";
  const bothCleared = authStatus === "VERIFIED" && idvStatus === "VERIFIED";

  return (
    <div className="space-y-4">
      {/* Overall summary banner */}
      <div className={`rounded-xl border px-4 py-3 flex items-center gap-3 ${
        bothCleared
          ? "border-green-200 bg-green-50 dark:bg-green-950/20 dark:border-green-900"
          : "border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-900"
      }`}>
        {bothCleared ? <CheckCircle2 className="h-5 w-5 text-green-600" /> : <AlertCircle className="h-5 w-5 text-amber-600" />}
        <div className="text-sm">
          {bothCleared ? (
            <span className="font-medium text-green-700 dark:text-green-400">All gates cleared — you can accept loads.</span>
          ) : (
            <>
              <span className="font-medium">Two gates must be VERIFIED to accept loads.</span>
              <span className="text-muted-foreground ml-1">Authority + personal identity.</span>
            </>
          )}
        </div>
      </div>

      {/* Gate 1 — Carrier authority */}
      <Card icon={Shield} title="Gate 1 · Carrier authority (FMCSA + KYB)">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs text-muted-foreground">Validates your MC/DOT number and Know-Your-Business compliance.</p>
          <Pill status={authStatus} />
        </div>
        {authStatus === "UNVERIFIED" && (
          <Button onClick={startAuth} disabled={busyAuth}>
            {busyAuth && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Start carrier verification
          </Button>
        )}
        {authStatus === "PENDING" && authority?.diditKybUrl && (
          <a href={authority.diditKybUrl} target="_blank" rel="noopener noreferrer">
            <Button variant="outline">
              <ExternalLink className="h-4 w-4 mr-2" />Complete KYB at Didit
            </Button>
          </a>
        )}
        {authStatus === "REJECTED" && (
          <p className="text-xs text-red-600">Verification rejected. Contact support to resubmit.</p>
        )}
        {authStatus === "VERIFIED" && authority?.verifiedAt && (
          <p className="text-xs text-muted-foreground">Verified {new Date(authority.verifiedAt).toLocaleDateString()}.</p>
        )}
      </Card>

      {/* Gate 2 — Personal identity */}
      <Card icon={UserCheck} title="Gate 2 · Personal identity (IDV)">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs text-muted-foreground">Required because you're hauling personally. Done once, never inherited from the company.</p>
          <Pill status={idvStatus} />
        </div>
        {idvStatus === "UNVERIFIED" && (
          <Button onClick={startIdv} disabled={busyIdv}>
            {busyIdv && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Start identity verification
          </Button>
        )}
        {idvStatus === "PENDING" && identity?.diditIdvUrl && (
          <a href={identity.diditIdvUrl} target="_blank" rel="noopener noreferrer">
            <Button variant="outline">
              <ExternalLink className="h-4 w-4 mr-2" />Complete IDV at Didit
            </Button>
          </a>
        )}
        {idvStatus === "REJECTED" && (
          <p className="text-xs text-red-600">Identity verification rejected. Contact support to retry.</p>
        )}
        {idvStatus === "VERIFIED" && identity?.verifiedAt && (
          <p className="text-xs text-muted-foreground">Verified {new Date(identity.verifiedAt).toLocaleDateString()}.</p>
        )}
      </Card>
    </div>
  );
}
