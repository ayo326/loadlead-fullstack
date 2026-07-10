import { useEffect, useState } from "react";
import { Loader2, ShieldCheck, Lock, FileText, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { toast } from "sonner";

/**
 * Shipper-facing view of a hauler's compliance. Badges (presence, verification
 * state, expiry) are always visible; the full packet and its documents open
 * only when the relationship resolver allows it (an active negotiation, an
 * assigned load, or a recently completed load). A 403 explains what unlocks it.
 */

const DOC_LABEL: Record<string, string> = {
  W9: "W-9",
  COI: "Certificate of Insurance",
  LETTER_OF_AUTHORITY: "Letter of Authority",
};
const DOC_PATH: Record<string, "w9" | "coi" | "loa"> = {
  W9: "w9",
  COI: "coi",
  LETTER_OF_AUTHORITY: "loa",
};

function StatusPill({ status }: { status: string }) {
  const tone =
    status === "VERIFIED"
      ? "bg-green-100 text-green-700"
      : status === "EXPIRED" || status === "REJECTED" || status === "MISSING"
      ? "bg-red-100 text-red-700"
      : "bg-amber-100 text-amber-700";
  return <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${tone}`}>{status}</span>;
}

export function CarrierComplianceView({ operatorId }: { operatorId: string }) {
  const [badges, setBadges] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [packet, setPacket] = useState<any | null>(null);
  const [basis, setBasis] = useState<string | null>(null);
  const [locked, setLocked] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    api
      .getHaulerComplianceBadges(operatorId)
      .then((r) => setBadges(r.badges ?? []))
      .catch((e: any) => toast.error(e.message))
      .finally(() => setLoading(false));
  }, [operatorId]);

  const viewPacket = async () => {
    setOpening(true);
    setLocked(null);
    try {
      const r = await api.getHaulerCompliancePacket(operatorId);
      setPacket(r.packet);
      setBasis(r.basis);
    } catch (e: any) {
      // Branch on the structured code the backend now sends (audit v4 L6);
      // the message regex stays as a fallback for older backends only.
      const relationshipRequired =
        e.code === "RELATIONSHIP_REQUIRED" ||
        e.message?.includes("RELATIONSHIP") ||
        /negotiation|assigned|completed/i.test(e.message ?? "");
      setLocked(
        relationshipRequired
          ? "The full compliance packet opens once you have an active negotiation, an assigned load, or a recently completed load with this carrier."
          : e.message,
      );
    } finally {
      setOpening(false);
    }
  };

  const openDoc = async (documentType: string) => {
    try {
      const r = await api.openHaulerDocument(operatorId, DOC_PATH[documentType]);
      window.open(r.url, "_blank", "noopener");
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <h3 className="font-semibold text-sm">Carrier compliance</h3>
        </div>
        {!packet && (
          <Button size="sm" variant="outline" onClick={viewPacket} disabled={opening}>
            {opening ? <Loader2 className="h-4 w-4 animate-spin" /> : "View compliance packet"}
          </Button>
        )}
      </div>

      {/* Badges (always visible) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {badges.map((b) => (
          <div key={b.documentType} className="flex items-center justify-between rounded-lg border px-3 py-2">
            <span className="text-xs font-medium">{DOC_LABEL[b.documentType] ?? b.documentType}</span>
            <StatusPill status={b.status} />
          </div>
        ))}
      </div>

      {locked && (
        <div className="flex items-start gap-2 rounded-lg bg-secondary/40 p-3 text-xs text-muted-foreground">
          <Lock className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{locked}</span>
        </div>
      )}

      {packet && (
        <div className="space-y-2">
          <p className="text-[11px] text-muted-foreground">
            Packet {packet.packetHash?.slice(0, 12)} - access basis: {basis}
          </p>
          {packet.entries?.length ? (
            packet.entries.map((e: any) => (
              <div key={e.documentId} className="flex items-center justify-between rounded-lg border px-3 py-2">
                <div className="flex items-center gap-2 min-w-0">
                  <FileText className="h-4 w-4 text-primary shrink-0" />
                  <span className="text-sm truncate">{DOC_LABEL[e.documentType] ?? e.documentType}</span>
                  <StatusPill status={e.status} />
                </div>
                <Button size="sm" variant="ghost" onClick={() => openDoc(e.documentType)}>
                  Open <ExternalLink className="h-3.5 w-3.5 ml-1" />
                </Button>
              </div>
            ))
          ) : (
            <p className="text-xs text-muted-foreground">No documents on file yet.</p>
          )}
        </div>
      )}
    </div>
  );
}
