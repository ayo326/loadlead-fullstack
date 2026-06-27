/**
 * Private-beta landing page. Shown to unauthenticated visitors when
 * the backend reports betaMode=true. Captures email + name + persona
 * interest into the public waitlist endpoint.
 *
 * This page deliberately does NOT mention how to bypass the beta —
 * the only paths in are (1) an invite token a staff member sent or
 * (2) the email/domain being on the allowlist. Both are enforced
 * server-side; this page is the UX surface for everyone else.
 */

import { useState } from "react";
import { api } from "@/lib/api";
import { Link } from "react-router-dom";

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

  return (
    <div className="min-h-screen bg-zinc-50 flex flex-col">
      <header className="border-b border-zinc-200 bg-white">
        <div className="max-w-5xl mx-auto px-6 py-5 flex items-center justify-between">
          <Link to="/" className="text-lg font-semibold text-zinc-900">LoadLead</Link>
          {external ? (
            <a href={signInHref} className="text-sm text-zinc-600 hover:text-zinc-900">
              Have an invite? Sign in
            </a>
          ) : (
            <Link to={signInHref} className="text-sm text-zinc-600 hover:text-zinc-900">
              Have an invite? Sign in
            </Link>
          )}
        </div>
      </header>

      <main className="flex-1 flex items-center">
        <div className="max-w-3xl mx-auto px-6 py-16 w-full">
          <div className="mb-10">
            <div className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800 mb-4">
              Private beta
            </div>
            <h1 className="text-4xl font-bold tracking-tight text-zinc-900 mb-4">
              LoadLead is invite-only right now.
            </h1>
            <p className="text-lg text-zinc-600">
              We are onboarding a small cohort of shippers and carriers — mostly Texas-focused —
              to make sure the matching, the documentation chain, and the payments work for real
              freight. Drop your email and we will reach out when the next wave opens.
            </p>
          </div>

          {status === "done" ? (
            <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-6">
              <h2 className="text-lg font-semibold text-emerald-900 mb-1">You are on the list.</h2>
              <p className="text-sm text-emerald-800">
                We will email <span className="font-mono">{email}</span> when your spot opens. If
                you have an invite already, you can{" "}
                {external ? (
                  <a href={signInHref} className="underline">sign in here</a>
                ) : (
                  <Link to={signInHref} className="underline">sign in here</Link>
                )}.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4 bg-white border border-zinc-200 rounded-lg p-6">
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-zinc-900 mb-1">
                  Work email <span className="text-rose-600">*</span>
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900"
                  autoComplete="email"
                />
              </div>
              <div>
                <label htmlFor="name" className="block text-sm font-medium text-zinc-900 mb-1">
                  Full name <span className="text-zinc-400 font-normal">(optional)</span>
                </label>
                <input
                  id="name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900"
                  autoComplete="name"
                />
              </div>
              <div>
                <label htmlFor="persona" className="block text-sm font-medium text-zinc-900 mb-1">
                  Which side are you on? <span className="text-zinc-400 font-normal">(optional)</span>
                </label>
                <select
                  id="persona"
                  value={personaInterest}
                  onChange={(e) => setPersonaInterest(e.target.value)}
                  className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900"
                >
                  <option value="">— Select one —</option>
                  {PERSONA_OPTIONS.map((p) => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
              </div>

              {errMsg ? (
                <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2">
                  {errMsg}
                </div>
              ) : null}

              <button
                type="submit"
                disabled={status === "submitting"}
                className="w-full inline-flex items-center justify-center rounded-md bg-zinc-900 text-white px-4 py-2 text-sm font-medium hover:bg-zinc-800 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {status === "submitting" ? "Joining…" : "Join the waitlist"}
              </button>

              <p className="text-xs text-zinc-500 text-center pt-2">
                We use your email only to contact you about beta access. No marketing.
              </p>
            </form>
          )}
        </div>
      </main>

      <footer className="border-t border-zinc-200 bg-white">
        <div className="max-w-5xl mx-auto px-6 py-4 text-xs text-zinc-500 flex items-center justify-between">
          <div>© LoadLead</div>
          <div>Private beta</div>
        </div>
      </footer>
    </div>
  );
}
