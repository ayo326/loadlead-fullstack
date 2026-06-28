// Live chat + click-to-call vendor embeds.
//
// Mounts a one-time vendor script when configured (Intercom or Crisp
// for chat; Twilio/Aircall use a plain tel: link, no script). When a
// vendor isn't configured we render a 'not connected' pill -- never
// a fake widget, never a spinner pretending to connect.
//
// All config comes from /api/support/integrations (server-rendered
// from env vars; no secrets shipped to the client).

import { useEffect, useState } from "react";
import { MessageCircle, Phone, AlertCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

type Integrations = {
  chat:  { connected: boolean; vendor: string | null; appId:  string | null };
  phone: { connected: boolean; vendor: string | null; number: string | null };
} | null;

// We never inject the same vendor script twice -- guard against
// React-strict-mode double-mount and against switching back to the
// inbox after a tab change.
const INJECTED_SCRIPTS = new Set<string>();

function injectIntercom(appId: string) {
  if (INJECTED_SCRIPTS.has(`intercom:${appId}`)) return;
  INJECTED_SCRIPTS.add(`intercom:${appId}`);
  (window as any).intercomSettings = { app_id: appId };
  const s = document.createElement("script");
  s.async = true;
  s.src   = `https://widget.intercom.io/widget/${appId}`;
  document.body.appendChild(s);
}

function injectCrisp(websiteId: string) {
  if (INJECTED_SCRIPTS.has(`crisp:${websiteId}`)) return;
  INJECTED_SCRIPTS.add(`crisp:${websiteId}`);
  (window as any).$crisp        = [];
  (window as any).CRISP_WEBSITE_ID = websiteId;
  const s = document.createElement("script");
  s.async = true;
  s.src   = "https://client.crisp.chat/l.js";
  document.head.appendChild(s);
}

export function SupportChannels() {
  const [cfg, setCfg]       = useState<Integrations>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr]       = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const c = await api.adminSupportIntegrations();
        if (cancelled) return;
        setCfg(c);
        if (c.chat.connected && c.chat.appId) {
          if (c.chat.vendor === "intercom") injectIntercom(c.chat.appId);
          if (c.chat.vendor === "crisp")    injectCrisp(c.chat.appId);
        }
      } catch (e: any) {
        if (!cancelled) setErr(e?.message ?? "Failed to load integrations");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="rounded-md border border-border bg-card overflow-hidden edge-info">
      <div className="px-5 py-3 border-b border-border flex items-center gap-2">
        <span className="text-sm font-semibold">Support channels</span>
        <span className="text-xs text-muted-foreground">chat + click-to-call</span>
      </div>

      {loading && (
        <div className="px-5 py-6 text-sm text-muted-foreground">Loading…</div>
      )}
      {err && (
        <div className="px-5 py-4 text-sm text-destructive flex items-center gap-2">
          <AlertCircle className="h-4 w-4" /> {err}
        </div>
      )}

      {cfg && (
        <div className="grid sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-border">
          {/* Chat */}
          <section className="p-5 space-y-2">
            <div className="flex items-center gap-2">
              <MessageCircle className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">Live chat</span>
              {cfg.chat.connected
                ? <Badge variant="default">{cfg.chat.vendor}</Badge>
                : <Badge variant="outline" className="text-muted-foreground">Not connected</Badge>}
            </div>
            {cfg.chat.connected ? (
              <p className="text-xs text-muted-foreground">
                Widget loaded from <code className="text-[11px]">{cfg.chat.vendor}</code>.
                Open it from the bottom-right corner of the page.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Set <code className="text-[11px]">SUPPORT_CHAT_VENDOR</code> and{" "}
                <code className="text-[11px]">SUPPORT_CHAT_APP_ID</code> on the backend env to
                enable. Supported vendors: intercom, crisp.
              </p>
            )}
          </section>

          {/* Phone */}
          <section className="p-5 space-y-2">
            <div className="flex items-center gap-2">
              <Phone className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">Click-to-call</span>
              {cfg.phone.connected
                ? <Badge variant="default">{cfg.phone.vendor}</Badge>
                : <Badge variant="outline" className="text-muted-foreground">Not connected</Badge>}
            </div>
            {cfg.phone.connected && cfg.phone.number ? (
              <Button asChild variant="outline" size="sm">
                <a href={`tel:${cfg.phone.number}`} aria-label={`Call ${cfg.phone.number}`}>
                  Call {cfg.phone.number}
                </a>
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground">
                Set <code className="text-[11px]">SUPPORT_PHONE_VENDOR</code> and{" "}
                <code className="text-[11px]">SUPPORT_PHONE_NUMBER</code> on the backend env to
                enable. Supported vendors: twilio, aircall.
              </p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
