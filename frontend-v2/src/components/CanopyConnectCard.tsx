/**
 * Canopy Connect card (SCRUM-60, Phases 3 + 4).
 *
 * "Connect your insurance" is the primary action; the manual upload is the
 * explicit alternative. Behind CANOPY_UI_MODE the same journey renders as either
 * the hosted SDK widget or a fully custom Components flow in LoadLead's own UI;
 * both produce identical backend artifacts, so the pipeline cannot tell them
 * apart. The hauler's insurer login happens inside Canopy's flow and never
 * touches LoadLead servers. Sentence case throughout; no em or en dashes.
 */
import { useEffect, useRef, useState } from "react";
import { Loader2, ShieldCheck, PlugZap, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { api, type CanopyConnectSession, type CanopyStatus } from "@/lib/api";

// The Canopy web SDK exposes a global `CanopyConnect`. The exact script URL is a
// question for the Canopy contact (recon A2); it is overridable here and the
// component degrades to the manual path if the script cannot load.
const CANOPY_SDK_SRC = "https://cdn.usecanopy.com/v1/canopy-connect.js";

declare global {
  interface Window {
    CanopyConnect?: {
      create(options: Record<string, unknown>): { open: () => void; destroy?: () => void };
    };
  }
}

type Phase = "idle" | "connecting" | "verifying" | "done";

function loadCanopyScript(): Promise<void> {
  if (window.CanopyConnect) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[data-canopy]`);
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("sdk_load_failed")));
      return;
    }
    const s = document.createElement("script");
    s.src = CANOPY_SDK_SRC;
    s.async = true;
    s.dataset.canopy = "true";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("sdk_load_failed"));
    document.head.appendChild(s);
  });
}

export function CanopyConnectCard({ onChooseManual, onVerified }: { onChooseManual: () => void; onVerified: () => void }) {
  const [session, setSession] = useState<CanopyConnectSession | null>(null);
  const [status, setStatus] = useState<CanopyStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [phase, setPhase] = useState<Phase>("idle");
  const [componentsOpen, setComponentsOpen] = useState(false);
  const handlerRef = useRef<{ destroy?: () => void } | null>(null);

  const refresh = () =>
    api
      .canopyStatus()
      .then(setStatus)
      .catch(() => undefined);

  useEffect(() => {
    api
      .canopyConnectSession()
      .then((s) => {
        setSession(s);
        if (s.connectEnabled) return refresh();
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
    return () => handlerRef.current?.destroy?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function ingest(pullId: string) {
    setPhase("verifying");
    try {
      const r = await api.canopyCallback(pullId);
      await refresh();
      if (r.outcome === "VERIFIED") {
        toast.success("Your insurance is connected and verified.");
        setPhase("done");
        onVerified();
      } else if (r.outcome === "PENDING") {
        toast.message("Verifying your coverage", { description: r.reason ?? "We are reviewing your policy." });
        setPhase("done");
        onVerified();
      } else {
        toast.error(r.loginErrorMessage ?? "We could not read your policy. Please upload your certificate instead.");
        setPhase("idle");
        onChooseManual();
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Something went wrong. Please upload your certificate instead.");
      setPhase("idle");
      onChooseManual();
    }
  }

  async function startWidget() {
    if (!session?.nonce) return;
    setPhase("connecting");
    try {
      await loadCanopyScript();
      if (!window.CanopyConnect) throw new Error("sdk_unavailable");
      const handler = window.CanopyConnect.create({
        publicAlias: session.publicAlias,
        pullMetaData: { carrierId: session.carrierId, nonce: session.nonce, source: session.source },
        onAuthenticationSuccess: (data: any) => {
          const pullId = data?.pull?.pull_id || data?.pull_id;
          if (pullId) void ingest(pullId);
        },
        onExit: () => setPhase("idle"),
        onError: () => {
          toast.error("The insurance connection did not complete. You can upload your certificate instead.");
          setPhase("idle");
          onChooseManual();
        },
      });
      handlerRef.current = handler;
      handler.open();
    } catch {
      toast.error("The insurance connect experience could not load. Please upload your certificate below.");
      setPhase("idle");
      onChooseManual();
    }
  }

  function startConnect() {
    if (session?.uiMode === "components") {
      setComponentsOpen(true);
    } else {
      void startWidget();
    }
  }

  if (loading) {
    return (
      <section className="rounded-xl border bg-card p-5 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Checking insurance options...
      </section>
    );
  }

  // Connect not available (no Canopy credentials): the manual path always exists.
  if (!session?.connectEnabled) {
    return null;
  }

  const badgeLabels = status?.badge.labels ?? [];

  return (
    <section className="rounded-xl border bg-card p-5 space-y-4">
      <div className="flex items-center gap-2">
        <PlugZap className="h-4 w-4 text-primary" />
        <h2 className="font-semibold">Connect your insurance</h2>
      </div>
      <p className="text-sm text-muted-foreground -mt-1">
        Connect your insurer to verify your coverage instantly. Your insurer login happens securely inside the connection
        and is never shared with LoadLead.
      </p>

      {badgeLabels.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {badgeLabels.map((label) => (
            <span key={label} className="inline-flex items-center gap-1 rounded-full border bg-background px-3 py-1 text-xs">
              <ShieldCheck className="h-3.5 w-3.5 text-primary" />
              {label}
            </span>
          ))}
        </div>
      )}

      {status?.badge.crossReferenceUnderReview && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs">
          <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5" />
          <span>Your certificate does not match your insurer records and is under review. Your verification continues from your insurer connection.</span>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-3 pt-1">
        <button
          type="button"
          onClick={startConnect}
          disabled={phase === "connecting" || phase === "verifying"}
          className="inline-flex items-center justify-center gap-2 h-10 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-60"
        >
          {phase === "verifying" ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Verifying your coverage...
            </>
          ) : phase === "connecting" ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Opening...
            </>
          ) : (
            <>
              <PlugZap className="h-4 w-4" /> {status?.badge.connected ? "Reconnect insurance" : "Connect your insurance"}
            </>
          )}
        </button>
        <button
          type="button"
          onClick={onChooseManual}
          className="inline-flex items-center justify-center h-10 rounded-md border px-4 text-sm"
        >
          My insurer is not listed or I prefer to upload documents
        </button>
      </div>

      {componentsOpen && (
        <ComponentsFlow
          session={session}
          onClose={() => setComponentsOpen(false)}
          onManual={() => {
            setComponentsOpen(false);
            onChooseManual();
          }}
        />
      )}
    </section>
  );
}

/**
 * Components mode: LoadLead's own navy journey (insurer search, credentials, MFA,
 * progress). The live credential exchange requires the Canopy Components SDK,
 * which is plan-gated and not confirmed available (recon A3). Per the spec this
 * mode is built to the documented interface, keeps the journey visible, and is
 * disabled at the credential step with a clear config message rather than a
 * broken step. Widget remains the default until Components passes the suite.
 */
function ComponentsFlow({
  session,
  onClose,
  onManual,
}: {
  session: CanopyConnectSession;
  onClose: () => void;
  onManual: () => void;
}) {
  const [step, setStep] = useState<"insurer" | "credentials">("insurer");
  const [insurer, setInsurer] = useState("");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl border bg-card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Connect your insurance</h3>
          <button type="button" onClick={onClose} className="text-sm text-muted-foreground">
            Close
          </button>
        </div>

        {step === "insurer" ? (
          <div className="space-y-3">
            <label className="block text-sm">
              Find your insurer
              <input
                value={insurer}
                onChange={(e) => setInsurer(e.target.value)}
                placeholder="Search for your insurance company"
                className="mt-1 w-full h-10 rounded-md border bg-background px-3 text-sm"
              />
            </label>
            <button
              type="button"
              disabled={!insurer.trim()}
              onClick={() => setStep("credentials")}
              className="w-full h-10 rounded-md bg-primary text-sm font-medium text-primary-foreground disabled:opacity-60"
            >
              Continue
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs">
              <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5" />
              <span>
                The in-app connect experience for {insurer || "your insurer"} needs the Canopy Components module, which is
                not enabled on this plan yet. Please upload your certificate instead, or ask support to switch to the
                hosted connect experience.
              </span>
            </div>
            <button type="button" onClick={onManual} className="w-full h-10 rounded-md bg-primary text-sm font-medium text-primary-foreground">
              Upload my certificate instead
            </button>
            <p className="text-[11px] text-muted-foreground text-center">Config: CANOPY_UI_MODE=components (widget is the default until Components is enabled).</p>
            <p className="sr-only">public alias {session.publicAlias}</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default CanopyConnectCard;
