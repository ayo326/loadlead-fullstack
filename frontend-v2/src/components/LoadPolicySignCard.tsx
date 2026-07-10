import { useEffect, useState } from "react";
import { FileSignature, ExternalLink, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { toast } from "sonner";

/**
 * Hauler-facing shipper-policy card on the load detail. Shows the policy the
 * shipper attached at acceptance, lets the hauler view/print it, and captures
 * the e-signature (attestation). Renders nothing when no policy is attached.
 */
export function LoadPolicySignCard({ loadId }: { loadId: string }) {
  const [att, setAtt] = useState<any | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const refresh = () =>
    api
      .getLoadPolicy(loadId)
      .then((r) => {
        setAtt(r.attachment);
        setUrl(r.url ?? null);
      })
      .catch(() => undefined)
      .finally(() => setLoaded(true));

  useEffect(() => {
    refresh();
  }, [loadId]);

  if (!loaded || !att) return null;

  const signed = !!att.signedAt;

  const sign = async () => {
    if (!consent) {
      toast.error("Please affirm to sign the policy.");
      return;
    }
    setBusy(true);
    try {
      await api.signLoadPolicy(loadId, { signatureName: name, consentGiven: true });
      toast.success("Policy signed.");
      refresh();
    } catch (e: any) {
      // Distinguish business-state failures from network noise (audit v4 M2)
      // by branching on the HTTP status the api client now attaches.
      if (e.status === 409) {
        toast.error("The shipper updated this policy after acceptance. Refreshing to show the latest version - please review and sign again.");
        refresh();
      } else if (e.status === 404 || e.status === 410) {
        toast.error("This policy is no longer available to sign. Refreshing - if it does not reappear, contact the shipper.");
        refresh();
      } else {
        toast.error(e.message);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border bg-card p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileSignature className="h-4 w-4 text-primary" />
          <h3 className="font-semibold text-sm">Shipper policy (version {att.version})</h3>
        </div>
        {url && (
          <a href={url} target="_blank" rel="noopener" className="text-xs text-primary flex items-center gap-1">
            View / print <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>

      {signed ? (
        <div className="flex items-center gap-2 text-sm text-green-700">
          <CheckCircle2 className="h-4 w-4" />
          Signed by {att.signatureName} on {new Date(att.signedAt).toLocaleDateString()}
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Review the attached policy, then sign to acknowledge it.
          </p>
          <Input placeholder="Type your name to sign" value={name} onChange={(e) => setName(e.target.value)} />
          <label className="flex items-start gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5" />
            I have read and agree to this shipper policy, and sign electronically.
          </label>
          <Button size="sm" onClick={sign} disabled={busy || !name.trim()}>
            Sign policy
          </Button>
        </div>
      )}
    </div>
  );
}
