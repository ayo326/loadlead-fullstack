/**
 * /setup/admin?token=xxx
 * Reached via the one-time link emailed after a "Request Admin" submission.
 * Validates the token and lets the user set their password to complete setup.
 */

import { useEffect, useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { ShieldCheck, ArrowRight, CheckCircle2, XCircle } from "lucide-react";
import { Truck } from "lucide-react";

const API = (import.meta.env.VITE_API_URL ?? "https://api.loadleadapp.com") + "/api";

export default function SetupAdmin() {
  const [searchParams]    = useSearchParams();
  const navigate          = useNavigate();
  const token             = searchParams.get("token") ?? "";

  const [password, setPassword]   = useState("");
  const [confirm, setConfirm]     = useState("");
  const [loading, setLoading]     = useState(false);
  const [done, setDone]           = useState(false);
  const [error, setError]         = useState("");

  useEffect(() => {
    if (!token) setError("No setup token found in this link. Please request a new one.");
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password !== confirm) { setError("Passwords do not match."); return; }
    if (password.length < 8)  { setError("Password must be at least 8 characters."); return; }

    setLoading(true);
    try {
      const res = await fetch(`${API}/setup/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Setup failed.");
      setDone(true);
      setTimeout(() => navigate("/login"), 3000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="font-display-hangar min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md">

        {/* Card */}
        <div className="bg-white rounded-lg shadow-lg border border-gray-100 overflow-hidden">

          {/* Header */}
          <div className="px-8 py-6 flex items-center gap-3" style={{ background: "hsl(217 91% 32%)" }}>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15">
              <Truck className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="text-[15px] font-bold text-white leading-none">LoadLead</p>
              <p className="text-[10px] font-semibold tracking-[0.15em] text-white/50 uppercase mt-0.5">Admin Setup</p>
            </div>
          </div>

          <div className="px-8 py-8">
            {done ? (
              /* ── Success state ── */
              <div className="text-center space-y-4">
                <div className="flex justify-center">
                  <CheckCircle2 className="h-14 w-14 text-emerald-500" />
                </div>
                <h2 className="text-xl font-bold text-gray-900">Admin account created!</h2>
                <p className="text-sm text-gray-500">
                  Your admin account is active. Redirecting you to sign in…
                </p>
                <Link
                  to="/login"
                  className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white"
                  style={{ background: "hsl(217 91% 32%)" }}
                >
                  Sign in now <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            ) : (
              /* ── Setup form ── */
              <>
                <div className="flex items-center gap-2 mb-6">
                  <ShieldCheck className="h-5 w-5 text-primary shrink-0" />
                  <div>
                    <h2 className="text-lg font-bold text-gray-900 leading-tight">Complete your admin setup</h2>
                    <p className="text-xs text-gray-500 mt-0.5">Set a password to activate your account.</p>
                  </div>
                </div>

                {!token ? (
                  <div className="flex items-start gap-2 rounded-xl bg-red-50 border border-red-100 px-4 py-3 text-sm text-red-600">
                    <XCircle className="h-4 w-4 mt-0.5 shrink-0" />
                    No setup token found in this link. Please{" "}
                    <Link to="/" className="font-semibold underline ml-1">request a new one</Link>.
                  </div>
                ) : (
                  <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="space-y-1.5">
                      <label className="block text-[11px] font-semibold tracking-[0.12em] uppercase text-gray-500">
                        Password <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="password" required autoComplete="new-password"
                        placeholder="Min. 8 characters"
                        value={password} onChange={e => setPassword(e.target.value)}
                        className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-500/20 transition-all"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="block text-[11px] font-semibold tracking-[0.12em] uppercase text-gray-500">
                        Confirm Password <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="password" required autoComplete="new-password"
                        placeholder="Repeat password"
                        value={confirm} onChange={e => setConfirm(e.target.value)}
                        className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-500/20 transition-all"
                      />
                    </div>

                    {error && (
                      <div className="flex items-start gap-2 rounded-xl bg-red-50 border border-red-100 px-4 py-3 text-sm text-red-600">
                        <XCircle className="h-4 w-4 mt-0.5 shrink-0" />
                        {error}
                      </div>
                    )}

                    <button
                      type="submit" disabled={loading}
                      className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold text-white transition-all disabled:opacity-60"
                      style={{ background: "hsl(217 91% 32%)" }}
                    >
                      {loading ? "Creating account…" : <>Activate Admin Account <ArrowRight className="h-4 w-4" /></>}
                    </button>

                    <p className="text-center text-xs text-gray-400">
                      This link expires 24 hours after it was sent and can only be used once.
                    </p>
                  </form>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
