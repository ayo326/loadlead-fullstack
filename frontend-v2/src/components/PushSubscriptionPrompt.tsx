/**
 * PushSubscriptionPrompt - in-app UI for enabling browser push notifications.
 *
 * Lifecycle:
 *   1. Mount → check browser support + current Notification.permission + existing subscription
 *   2. Click "Enable" → Notification.requestPermission()
 *   3. If granted → registerServiceWorker, subscribe via PushManager, POST to backend
 *   4. Click "Disable" → unsubscribe locally + DELETE on backend
 *
 * Rendered as a dismissible banner on the driver/OO dashboard. Persists
 * dismissal in localStorage so it doesn't reappear on every page load - until
 * the user explicitly re-enables it from Settings (Feature 8).
 */

import { useEffect, useState } from "react";
import { Bell, BellOff, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { toast } from "sonner";

type State = "checking" | "unsupported" | "enabled" | "denied" | "available" | "dismissed";

const DISMISS_KEY = "ll_push_prompt_dismissed";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function PushSubscriptionPrompt({ compact = false }: { compact?: boolean }) {
  const [state, setState] = useState<State>("checking");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      if (typeof window === "undefined") return;
      if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
        setState("unsupported");
        return;
      }
      if (Notification.permission === "denied") { setState("denied"); return; }
      if (Notification.permission === "granted") {
        // Check whether a subscription already exists
        try {
          const reg = await navigator.serviceWorker.getRegistration();
          const sub = await reg?.pushManager.getSubscription();
          setState(sub ? "enabled" : "available");
        } catch {
          setState("available");
        }
        return;
      }
      // permission === "default"
      if (localStorage.getItem(DISMISS_KEY) === "1") { setState("dismissed"); return; }
      setState("available");
    })();
  }, []);

  async function enable() {
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "available");
        toast.message("Notifications not enabled.");
        return;
      }

      // Register SW (may already be registered)
      const reg = await navigator.serviceWorker.register("/sw.js");

      // Get VAPID public key from backend
      const { publicKey } = await api.getVapidKey();
      if (!publicKey) throw new Error("Server is missing the VAPID public key.");

      // Subscribe
      // PushManager.subscribe expects BufferSource. Newer TS lib.dom typings
      // narrow Uint8Array to a generic Uint8Array<ArrayBufferLike>; cast to
      // BufferSource so this stays portable across TS versions.
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      });

      await api.subscribePush(sub.toJSON());
      setState("enabled");
      toast.success("Push notifications enabled.");
    } catch (e: any) {
      toast.error(e.message ?? "Could not enable notifications.");
      setState("available");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) await sub.unsubscribe();
      await api.unsubscribePush();
      setState("available");
      toast.success("Push notifications disabled.");
    } catch (e: any) {
      toast.error(e.message ?? "Could not disable notifications.");
    } finally {
      setBusy(false);
    }
  }

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, "1");
    setState("dismissed");
  }

  if (state === "checking" || state === "dismissed" || state === "unsupported") return null;

  // Compact mode: small toggle in Settings page
  if (compact) {
    return (
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium">Push notifications</p>
          <p className="text-xs text-muted-foreground">
            {state === "enabled" ? "On - you'll get notified when a new load is offered." :
             state === "denied"  ? "Blocked by your browser. Update the site permission to re-enable." :
             "Get notified instantly when a new load is offered or accepted."}
          </p>
        </div>
        {state === "enabled" ? (
          <Button variant="outline" size="sm" onClick={disable} disabled={busy}>
            <BellOff className="h-3.5 w-3.5 mr-1.5" />Turn off
          </Button>
        ) : state === "denied" ? (
          <Button variant="outline" size="sm" disabled className="text-muted-foreground">Blocked</Button>
        ) : (
          <Button size="sm" onClick={enable} disabled={busy}>
            <Bell className="h-3.5 w-3.5 mr-1.5" />Enable
          </Button>
        )}
      </div>
    );
  }

  // Banner mode (dashboard)
  if (state === "enabled" || state === "denied") return null; // banner only for "available"
  return (
    <div className="rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 mb-6 flex items-center justify-between gap-4">
      <div className="flex items-center gap-3 min-w-0">
        <Bell className="h-5 w-5 text-primary shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-medium">Stay on top of new loads</p>
          <p className="text-xs text-muted-foreground">Enable browser notifications so you don't miss an offer.</p>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Button size="sm" onClick={enable} disabled={busy}>Enable</Button>
        <button onClick={dismiss} className="h-8 w-8 rounded-md hover:bg-secondary flex items-center justify-center" aria-label="Dismiss">
          <X className="h-4 w-4 text-muted-foreground" />
        </button>
      </div>
    </div>
  );
}
