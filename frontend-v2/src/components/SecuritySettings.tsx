/**
 * SecuritySettings — drop into any Settings page Tabs panel.
 *
 * Three cards:
 *   1. Change password (current + new + confirm)
 *   2. Two-factor auth (setup with QR, verify, disable with password)
 *   3. Push notifications (compact toggle re-using PushSubscriptionPrompt)
 */

import { useEffect, useState } from "react";
import { Shield, Smartphone, KeyRound, Loader2, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PushSubscriptionPrompt } from "@/components/PushSubscriptionPrompt";
import { api } from "@/lib/api";
import { toast } from "sonner";

function Card({ title, icon: Icon, children }: { title: string; icon: any; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-card p-6">
      <h3 className="text-sm font-semibold flex items-center gap-2 mb-5">
        <Icon className="h-4 w-4 text-primary" /> {title}
      </h3>
      {children}
    </div>
  );
}

function PasswordCard() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (next !== confirm) { toast.error("New passwords don't match."); return; }
    if (next.length < 8) { toast.error("Password must be at least 8 characters."); return; }
    setBusy(true);
    try {
      await api.changePassword(current, next);
      toast.success("Password updated.");
      setCurrent(""); setNext(""); setConfirm("");
    } catch (e: any) {
      toast.error(e.message ?? "Could not change password.");
    } finally { setBusy(false); }
  }

  return (
    <Card title="Change password" icon={KeyRound}>
      <form onSubmit={submit} className="space-y-3 max-w-md">
        <div className="space-y-1.5">
          <Label htmlFor="curr-pw">Current password</Label>
          <Input id="curr-pw" type="password" value={current} onChange={e => setCurrent(e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="new-pw">New password</Label>
          <Input id="new-pw" type="password" value={next} onChange={e => setNext(e.target.value)} required minLength={8} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="conf-pw">Confirm new password</Label>
          <Input id="conf-pw" type="password" value={confirm} onChange={e => setConfirm(e.target.value)} required minLength={8} />
        </div>
        <Button type="submit" disabled={busy}>
          {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Update password
        </Button>
      </form>
    </Card>
  );
}

function TwoFactorCard() {
  const [status, setStatus] = useState<"loading" | "off" | "enrolling" | "on">("loading");
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [pwd, setPwd] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.twoFactorStatus()
      .then(r => setStatus(r.enabled ? "on" : "off"))
      .catch(() => setStatus("off"));
  }, []);

  async function startEnrollment() {
    setBusy(true);
    try {
      const r = await api.twoFactorSetup();
      setQr(r.qrDataUrl);
      setSecret(r.secret);
      setStatus("enrolling");
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(false); }
  }

  async function confirmEnrollment() {
    if (!code) { toast.error("Enter the 6-digit code from your authenticator app."); return; }
    setBusy(true);
    try {
      await api.twoFactorVerify(code);
      setStatus("on");
      setQr(null); setSecret(null); setCode("");
      toast.success("Two-factor authentication enabled.");
    } catch (e: any) { toast.error(e.message ?? "Invalid code."); }
    finally { setBusy(false); }
  }

  async function disable() {
    if (!pwd) { toast.error("Enter your password to disable 2FA."); return; }
    setBusy(true);
    try {
      await api.twoFactorDisable(pwd);
      setStatus("off");
      setPwd("");
      toast.success("Two-factor authentication disabled.");
    } catch (e: any) { toast.error(e.message ?? "Could not disable 2FA."); }
    finally { setBusy(false); }
  }

  return (
    <Card title="Two-factor authentication" icon={Shield}>
      {status === "loading" && (
        <div className="text-xs text-muted-foreground"><Loader2 className="h-3 w-3 inline animate-spin mr-1" />Loading…</div>
      )}

      {status === "off" && (
        <div className="max-w-md">
          <p className="text-sm text-muted-foreground mb-4">
            Add a second factor when you log in. Compatible with Google Authenticator, 1Password, Authy, etc.
          </p>
          <Button onClick={startEnrollment} disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Set up 2FA
          </Button>
        </div>
      )}

      {status === "enrolling" && qr && (
        <div className="max-w-md space-y-4">
          <p className="text-sm text-muted-foreground">
            Scan this QR code with your authenticator app, then enter the 6-digit code it shows.
          </p>
          <img src={qr} alt="2FA QR code" className="rounded-lg border border-border bg-white p-2 max-w-[200px]" />
          {secret && (
            <details className="text-xs">
              <summary className="text-muted-foreground cursor-pointer">Can't scan? Enter secret manually</summary>
              <code className="block mt-2 p-2 bg-secondary rounded font-mono text-[11px] break-all">{secret}</code>
            </details>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="otp">6-digit code</Label>
            <Input id="otp" inputMode="numeric" maxLength={6} pattern="[0-9]{6}" value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ""))} placeholder="123456" />
          </div>
          <div className="flex gap-2">
            <Button onClick={confirmEnrollment} disabled={busy || code.length !== 6}>
              {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Enable
            </Button>
            <Button variant="outline" onClick={() => { setStatus("off"); setQr(null); setCode(""); }} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {status === "on" && (
        <div className="max-w-md space-y-4">
          <div className="flex items-center gap-2 text-sm text-green-600">
            <CheckCircle2 className="h-4 w-4" />
            <span className="font-medium">Two-factor authentication is on.</span>
          </div>
          <p className="text-xs text-muted-foreground">To disable, confirm your password.</p>
          <div className="space-y-1.5">
            <Label htmlFor="disable-pw">Password</Label>
            <Input id="disable-pw" type="password" value={pwd} onChange={e => setPwd(e.target.value)} />
          </div>
          <Button variant="outline" onClick={disable} disabled={busy || !pwd}>
            {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Disable 2FA
          </Button>
        </div>
      )}
    </Card>
  );
}

function PushCard() {
  return (
    <Card title="Push notifications" icon={Smartphone}>
      <PushSubscriptionPrompt compact />
    </Card>
  );
}

export function SecuritySettings() {
  return (
    <div className="space-y-4">
      <PasswordCard />
      <TwoFactorCard />
      <PushCard />
    </div>
  );
}
