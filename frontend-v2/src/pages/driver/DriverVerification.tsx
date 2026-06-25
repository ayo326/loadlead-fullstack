/**
 * DriverVerification — onboarding page for the DRIVER role.
 *
 * A driver clears two gates before accepting loads:
 *   1. AFFILIATION  — must belong to a CARRIER org (or be an OO self-driver).
 *                     Cannot self-serve; a carrier admin must invite them.
 *   2. IDENTITY     — personal IDV via Didit, keyed by userId.
 *
 * Different from OO verification because:
 *   - There's no carrier-authority gate for the driver themselves; the
 *     carrier (org or OO) owns that record.
 *   - Affiliation is a passive wait state — the driver can only watch for
 *     the invite to land, not act on it.
 */

import { useEffect, useState } from "react";
import { UserCheck, Building2, CheckCircle2, AlertCircle, Loader2, ExternalLink, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";
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

export default function DriverVerification() {
  const [identity, setIdentity] = useState<any>(null);
  const [affiliation, setAffiliation] = useState<{ status: string; carrier: any } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyIdv, setBusyIdv] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      const [i, a] = await Promise.all([
        api.getDriverIdv().catch(() => ({ verification: null })),
        api.getDriverAffiliation().catch(() => ({ status: "NO_PROFILE", carrier: null })),
      ]);
      setIdentity(i.verification);
      setAffiliation(a);
    } finally { setLoading(false); }
  }
  useEffect(() => { refresh(); }, []);

  async function startIdv() {
    setBusyIdv(true);
    try {
      const r = await api.submitDriverIdv();
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

  const idvStatus     = (identity?.verificationStatus ?? "UNVERIFIED") as Status;
  const isAffiliated  = affiliation?.status === "AFFILIATED";
  const bothCleared   = isAffiliated && idvStatus === "VERIFIED";

  return (
    <>
      <PageHeader
        eyebrow="Driver"
        title="Onboarding"
        subtitle="Both gates must clear before loads are matched to you. Identity is your move; affiliation is your carrier's move."
      />

      <div className="space-y-4 max-w-2xl">
        {/* Overall summary */}
        <div className={`rounded-xl border px-4 py-3 flex items-center gap-3 ${
          bothCleared
            ? "border-green-200 bg-green-50 dark:bg-green-950/20 dark:border-green-900"
            : "border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-900"
        }`}>
          {bothCleared ? <CheckCircle2 className="h-5 w-5 text-green-600" /> : <AlertCircle className="h-5 w-5 text-amber-600" />}
          <div className="text-sm">
            {bothCleared
              ? <span className="font-medium text-green-700 dark:text-green-400">Both gates cleared — you'll start seeing matched loads.</span>
              : <><span className="font-medium">Two gates must clear to receive loads.</span> <span className="text-muted-foreground ml-1">Affiliation + personal identity.</span></>
            }
          </div>
        </div>

        {/* Gate 1 — Affiliation */}
        <Card icon={Building2} title="Gate 1 · Carrier affiliation">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs text-muted-foreground">
              You need to be on a carrier's roster to get matched loads. Carrier admins invite drivers via email.
            </p>
            <Pill status={isAffiliated ? "VERIFIED" : "UNVERIFIED"} />
          </div>
          {isAffiliated ? (
            <p className="text-xs text-muted-foreground">
              Affiliated with {affiliation?.carrier?.entityType === "OWNER_OPERATOR" ? "owner operator" : "carrier organization"}
              {" "}
              <code className="text-[10px] bg-secondary px-1.5 py-0.5 rounded">{affiliation?.carrier?.entityId}</code>.
            </p>
          ) : (
            <div className="rounded-md border border-border bg-secondary/50 px-3 py-2 text-xs text-muted-foreground flex items-start gap-2">
              <Mail className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <div>
                <p className="font-medium text-foreground mb-1">Awaiting carrier invitation.</p>
                <p>
                  Watch your inbox (the address you signed up with) for an invite from a carrier admin. Once you accept it, this gate clears automatically.
                </p>
              </div>
            </div>
          )}
        </Card>

        {/* Gate 2 — Identity */}
        <Card icon={UserCheck} title="Gate 2 · Personal identity (IDV)">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs text-muted-foreground">Required for any driver who hauls a load. One-time; never inherited from a carrier.</p>
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
          {idvStatus === "PENDING" && !identity?.diditIdvUrl && (
            <p className="text-xs text-muted-foreground">
              IDV submitted — awaiting Didit session URL. Refresh in a moment.
            </p>
          )}
          {idvStatus === "REJECTED" && (
            <p className="text-xs text-red-600">Identity verification rejected. Contact support to retry.</p>
          )}
          {idvStatus === "EXPIRED" && (
            <Button onClick={startIdv} disabled={busyIdv}>
              {busyIdv && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Restart identity verification
            </Button>
          )}
          {idvStatus === "VERIFIED" && identity?.verifiedAt && (
            <p className="text-xs text-muted-foreground">Verified {new Date(identity.verifiedAt).toLocaleDateString()}.</p>
          )}
        </Card>
      </div>
    </>
  );
}
