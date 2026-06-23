// Internal-only sign-in for admin.loadleadapp.com. Deliberately strips
// every customer affordance from the standard Login page: no signup,
// no marketing hero, no "back to home", no truck/fleet imagery. One
// column, neutral palette. Authorized-use notice + environment badge
// + IP-restricted note up top.
//
// Server-side enforcement (the real gate): all four PlatformRole tiers
// can sign in here, MFA is mandatory for any ADMIN-role user, and the
// IP allowlist sits at the edge (CloudFront WAF). This page is just
// the UX face of that.
//
// Generic error copy: a wrong-email and a wrong-password produce the
// SAME message ("Sign-in failed. Check your credentials and try again.")
// so an attacker can't enumerate which staff emails exist.

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ShieldCheck, Lock, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";

const GENERIC_AUTH_ERROR = "Sign-in failed. Check your credentials and try again.";
const GENERIC_MFA_ERROR  = "Invalid 2FA code. Try the next code from your authenticator.";

// PROD / STAGING / DEV badge derived from the API host the bundle was
// built against. No PII leakage: the host is already public.
function envFromApi(): { label: string; tone: "prod" | "staging" | "dev" } {
  const api = (import.meta.env.VITE_API_URL as string | undefined) ?? "";
  if (api.includes("api.loadleadapp.com")) return { label: "PROD",    tone: "prod" };
  if (api.includes("staging"))             return { label: "STAGING", tone: "staging" };
  return                                          { label: "DEV",     tone: "dev" };
}

export default function AdminLogin() {
  const navigate = useNavigate();
  const { login, twoFactorLogin } = useAuth();
  const env = envFromApi();

  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);

  const [mfaTicket, setMfaTicket] = useState<string | null>(null);
  const [mfaCode,   setMfaCode]   = useState("");
  const [mfaError,  setMfaError]  = useState<string | null>(null);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await login(email, password);
      if ("needsTwoFactor" in res && res.needsTwoFactor) {
        setMfaTicket(res.twoFactorTicket);
      } else {
        navigate("/admin", { replace: true });
      }
    } catch (err: any) {
      // Map every backend auth failure (wrong email, wrong password,
      // MFA_REQUIRED, lockout from too many attempts) to one generic
      // string. The MFA_REQUIRED case stays generic because the user
      // shouldn't be able to ENUMERATE which addresses have MFA on
      // by reading our error text.
      const code = err?.code ?? err?.status;
      if (code === 429 || /locked|too many/i.test(err?.message ?? "")) {
        setError("Too many failed attempts. Wait a few minutes, then try again.");
      } else {
        setError(GENERIC_AUTH_ERROR);
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleMfa(e: React.FormEvent) {
    e.preventDefault();
    if (!mfaTicket) return;
    setMfaError(null);
    setLoading(true);
    try {
      await twoFactorLogin(mfaTicket, mfaCode);
      navigate("/admin", { replace: true });
    } catch {
      setMfaError(GENERIC_MFA_ERROR);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      {/* Top bar — official logo + environment badge */}
      <header
        className="px-4 py-3 border-b border-border flex items-center justify-between gap-3"
        role="banner"
      >
        <div className="flex items-center gap-3">
          <img
            src="/loadlead-logo.png"
            alt="LoadLead"
            className="h-7 w-auto select-none"
            draggable={false}
          />
          <span className="text-xs font-medium text-muted-foreground hidden sm:inline">
            · Platform Operations
          </span>
        </div>
        <span
          className={
            "text-[10px] font-bold tracking-widest px-2 py-1 rounded " +
            (env.tone === "prod"
              ? "bg-destructive/15 text-destructive"
              : env.tone === "staging"
              ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
              : "bg-muted text-muted-foreground")
          }
          aria-label={`Environment: ${env.label}`}
        >
          {env.label}
        </span>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm space-y-6">

          <div className="space-y-1.5 text-center">
            <h1 className="text-lg font-semibold">Sign in</h1>
            <p className="text-xs text-muted-foreground">
              Internal use only. Access is IP-restricted and requires multi-factor authentication.
            </p>
          </div>

          {!mfaTicket ? (
            <form onSubmit={handleLogin} className="space-y-4" aria-label="Staff sign-in">
              <div className="space-y-1.5">
                <Label htmlFor="staff-email">Email</Label>
                <Input
                  id="staff-email" type="email" autoComplete="username"
                  value={email} onChange={(e) => setEmail(e.target.value)}
                  required disabled={loading}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="staff-pwd">Password</Label>
                <Input
                  id="staff-pwd" type="password" autoComplete="current-password"
                  value={password} onChange={(e) => setPassword(e.target.value)}
                  required disabled={loading}
                />
              </div>

              {error && (
                <div
                  role="alert"
                  className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2"
                >
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden />
                  <span>{error}</span>
                </div>
              )}

              <Button type="submit" className="w-full h-10" disabled={loading}>
                {loading ? "Signing in…" : "Sign in"}
              </Button>
            </form>
          ) : (
            <form onSubmit={handleMfa} className="space-y-4" aria-label="Two-factor challenge">
              <div className="rounded-md bg-muted/40 border border-border px-3 py-2 text-xs text-muted-foreground flex items-center gap-2">
                <Lock className="h-3.5 w-3.5" aria-hidden />
                Enter the 6-digit code from your authenticator app.
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="staff-mfa">6-digit code</Label>
                <Input
                  id="staff-mfa" type="text" inputMode="numeric" pattern="[0-9]{6}"
                  autoComplete="one-time-code" maxLength={6}
                  value={mfaCode} onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  required autoFocus disabled={loading}
                />
              </div>

              {mfaError && (
                <div
                  role="alert"
                  className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2"
                >
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden />
                  <span>{mfaError}</span>
                </div>
              )}

              <Button type="submit" className="w-full h-10" disabled={loading || mfaCode.length !== 6}>
                {loading ? "Verifying…" : "Verify code"}
              </Button>
              <button
                type="button"
                onClick={() => { setMfaTicket(null); setMfaCode(""); setMfaError(null); }}
                className="block mx-auto text-xs text-muted-foreground hover:text-foreground"
              >
                Use a different account
              </button>
            </form>
          )}

          <div className="border-t border-border pt-4 text-[11px] leading-relaxed text-muted-foreground">
            <strong className="text-foreground">Authorized use only.</strong>{" "}
            This system is restricted to LoadLead platform staff. Activity is
            monitored and audited. Unauthorized access or attempted access
            is prohibited and may be referred for prosecution. By signing in
            you agree to LoadLead's internal-use policy.
          </div>
        </div>
      </main>
    </div>
  );
}
