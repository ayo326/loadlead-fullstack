/**
 * Private-beta landing / wall. Shown to unauthenticated visitors when the
 * backend reports betaMode=true (and, on the apex, in place of the login
 * form). Captures email + name + persona interest into the public waitlist
 * endpoint, which also auto-emails the beta application form.
 *
 * Styled to match the main landing hero: navy (bg-primary) surface, the
 * LoadLead logo lockup top-left, the "Private beta" status pill with a
 * pulsing accent dot, brand display type, and an accent CTA — so the gate
 * feels like the product, not a generic holding page.
 *
 * This page deliberately does NOT mention how to bypass the beta — the only
 * paths in are (1) an invite token a staff member sent or (2) the email/
 * domain being on the allowlist. Both are enforced server-side.
 */

import { useState } from "react";
import { api } from "@/lib/api";
import { Link } from "react-router-dom";
import { Logo } from "@/components/Logo";

const PERSONA_OPTIONS = [
  { value: "SHIPPER", label: "Shipper (post freight)" },
  { value: "CARRIER_ADMIN", label: "Carrier (run a trucking company)" },
  { value: "OWNER_OPERATOR", label: "Owner Operator (drive my own truck)" },
  { value: "DRIVER", label: "Driver (employed by a carrier)" },
  { value: "RECEIVER", label: "Receiver (take delivery)" },
] as const;

/**
 * @param signInHref Where "Have an invite? Sign in" points. Defaults to the
 *   local /login. When this wall is rendered ON the apex (loadleadapp.com) as
 *   the beta gate, callers pass the beta subdomain so invite-holders are sent
 *   to where they actually sign in (beta.loadleadapp.com), not back to a loop.
 */
export default function PrivateBetaLanding({ signInHref = "/login" }: { signInHref?: string } = {}) {
  const external = /^https?:\/\//.test(signInHref);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [personaInterest, setPersonaInterest] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "done" | "error">("idle");
  const [errMsg, setErrMsg] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("submitting");
    setErrMsg("");
    try {
      await api.beta.joinWaitlist({
        email: email.trim(),
        name: name.trim() || undefined,
        personaInterest: personaInterest || undefined,
      });
      setStatus("done");
    } catch (err) {
      setStatus("error");
      setErrMsg((err as Error).message || "Could not join the waitlist. Please try again.");
    }
  }

  const SignIn = ({ className }: { className?: string }) =>
    external ? (
      <a href={signInHref} className={className}>Have an invite? Sign in</a>
    ) : (
      <Link to={signInHref} className={className}>Have an invite? Sign in</Link>
    );

  return (
    <div className="font-display-hangar min-h-screen bg-primary text-primary-foreground flex flex-col relative overflow-hidden">
      {/* Brand texture: dotted grid + accent glow, same as the main hero. */}
      <div
        className="absolute inset-0 opacity-[0.07] pointer-events-none"
        style={{ backgroundImage: "radial-gradient(circle at 1px 1px, white 1px, transparent 0)", backgroundSize: "32px 32px" }}
      />
      <div className="absolute -top-32 -right-32 h-96 w-96 rounded-full bg-accent/20 blur-3xl pointer-events-none" />

      <header className="relative z-10 border-b border-white/10">
        <div className="max-w-5xl mx-auto px-6 py-5 flex items-center justify-between">
          <Logo variant="light" height={36} />
          <SignIn className="text-sm text-primary-foreground/80 hover:text-primary-foreground transition-colors" />
        </div>
      </header>

      <main className="relative z-10 flex-1 flex items-center">
        <div className="max-w-3xl mx-auto px-6 py-16 w-full">
          <div className="mb-10">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/10 border border-white/15 px-3 py-1 text-xs mb-5">
              <span className="h-2 w-2 rounded-full bg-accent animate-pulse" />
              Private beta
            </div>
            <h1 className="text-4xl sm:text-5xl font-bold tracking-tight mb-4">
              LoadLead is invite-only right now.
            </h1>
            <p className="text-lg text-primary-foreground/75 max-w-xl">
              We are onboarding a small cohort of shippers and carriers — mostly Texas-focused —
              to make sure the matching, the documentation chain, and the payments work for real
              freight. Drop your email and we will reach out when the next wave opens.
            </p>
          </div>

          {status === "done" ? (
            <div className="rounded-lg bg-card text-card-foreground border border-border shadow-2xl p-6">
              <h2 className="text-lg font-semibold text-foreground mb-1">You are on the list.</h2>
              <p className="text-sm text-muted-foreground">
                We will email <span className="font-mono text-foreground">{email}</span> when your spot
                opens — check your inbox now for the beta application form. If you have an invite
                already, you can{" "}
                {external ? (
                  <a href={signInHref} className="text-primary font-medium underline">sign in here</a>
                ) : (
                  <Link to={signInHref} className="text-primary font-medium underline">sign in here</Link>
                )}.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4 bg-card text-card-foreground border border-border rounded-lg shadow-2xl p-6">
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-foreground mb-1">
                  Work email <span className="text-destructive">*</span>
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  autoComplete="email"
                />
              </div>
              <div>
                <label htmlFor="name" className="block text-sm font-medium text-foreground mb-1">
                  Full name <span className="text-muted-foreground font-normal">(optional)</span>
                </label>
                <input
                  id="name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  autoComplete="name"
                />
              </div>
              <div>
                <label htmlFor="persona" className="block text-sm font-medium text-foreground mb-1">
                  Which side are you on? <span className="text-muted-foreground font-normal">(optional)</span>
                </label>
                <select
                  id="persona"
                  value={personaInterest}
                  onChange={(e) => setPersonaInterest(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="">— Select one —</option>
                  {PERSONA_OPTIONS.map((p) => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
              </div>

              {errMsg ? (
                <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded px-3 py-2">
                  {errMsg}
                </div>
              ) : null}

              <button
                type="submit"
                disabled={status === "submitting"}
                className="w-full inline-flex items-center justify-center rounded-md bg-accent text-accent-foreground px-4 py-2.5 text-sm font-semibold hover:bg-accent/90 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
              >
                {status === "submitting" ? "Joining…" : "Join the waitlist"}
              </button>

              <p className="text-xs text-muted-foreground text-center pt-1">
                We use your email only to contact you about beta access. No marketing.
              </p>
            </form>
          )}
        </div>
      </main>

      <footer className="relative z-10 border-t border-white/10">
        <div className="max-w-5xl mx-auto px-6 py-4 text-xs text-primary-foreground/60 flex items-center justify-between">
          <div>© LoadLead</div>
          <div className="font-mono">Where loads meet leads.</div>
        </div>
      </footer>
    </div>
  );
}
