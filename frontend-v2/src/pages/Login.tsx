import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useState } from "react";
import {
  ArrowRight, ShieldCheck, Truck, PackagePlus, Warehouse, AlertTriangle, Briefcase, ShipWheel,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/AuthContext";

// ── Role definitions ──────────────────────────────────────────────────────────

const roles = [
  {
    key:      "OWNER_OPERATOR",
    label:    "Owner Operator",
    portal:   "owner operator portal",
    icon:     Briefcase,
    to:       "/owner-operator",
    roleTag:  "OWNER OPERATOR ACCOUNT",
    badge:    "94.2% average fleet utilization this week",
    headline: "Maximize your fleet's earning potential.",
    sub:      "Dispatch drivers, assign high-margin loads, and keep every truck moving — all from one command center.",
  },
  {
    key:      "DRIVER",
    label:    "Driver",
    portal:   "driver portal",
    icon:     ShipWheel,
    to:       "/driver",
    roleTag:  "DRIVER ACCOUNT",
    badge:    "47s average time to first match",
    headline: "Find your next load and hit the road.",
    sub:      "See available freight near you, accept offers instantly, and get moving — all from one dashboard.",
  },
  {
    key:      "SHIPPER",
    label:    "Shipper",
    portal:   "shipper portal",
    icon:     PackagePlus,
    to:       "/shipper",
    roleTag:  "SHIPPER ACCOUNT",
    badge:    "Live driver matching in under 60s",
    headline: "Dispatch freight to verified drivers instantly.",
    sub:      "Post loads, broadcast to matched drivers, and track every shipment from pickup to delivery.",
  },
  {
    key:      "RECEIVER",
    label:    "Receiver",
    portal:   "receiver portal",
    icon:     Warehouse,
    to:       "/receiver",
    roleTag:  "RECEIVER ACCOUNT",
    badge:    "Real-time inbound visibility",
    headline: "Know exactly when your freight arrives.",
    sub:      "Track inbound shipments, get live ETAs, and coordinate dock scheduling — before the truck pulls up.",
  },
] as const;

const roleHome: Record<string, string> = {
  DRIVER:         "/driver",
  OWNER_OPERATOR: "/owner-operator",
  SHIPPER:        "/shipper",
  RECEIVER:       "/receiver",
  ADMIN:          "/admin",
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function Login() {
  const [selected, setSelected]     = useState<typeof roles[number]>(roles[0]);
  const [email, setEmail]           = useState("");
  const [password, setPassword]     = useState("");
  const [remember, setRemember]     = useState(false);
  const [error, setError]           = useState("");
  const [roleMismatch, setRoleMismatch] = useState<string | null>(null);
  const [loading, setLoading]       = useState(false);

  const { login, twoFactorLogin }  = useAuth();
  const navigate   = useNavigate();
  const [searchParams] = useSearchParams();
  const redirectTo = searchParams.get("redirect");

  // 2FA second step state
  const [twoFactorTicket, setTwoFactorTicket] = useState<string | null>(null);
  const [twoFactorCode, setTwoFactorCode] = useState("");

  const pick = (r: typeof roles[number]) => {
    setSelected(r);
    setError("");
    setRoleMismatch(null);
  };

  function completeLoginRedirect(user: any) {
    if (user.role !== selected.key) {
      setRoleMismatch(`This account is registered as ${user.role}. Taking you to your dashboard…`);
      setTimeout(() => navigate(redirectTo ?? roleHome[user.role] ?? "/"), 1800);
      return;
    }
    navigate(redirectTo ?? roleHome[user.role] ?? "/");
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setRoleMismatch(null);
    setLoading(true);
    try {
      const result: any = await login(email, password);
      if (result?.needsTwoFactor) {
        setTwoFactorTicket(result.twoFactorTicket);
        return;
      }
      completeLoginRedirect(result);
    } catch (err: any) {
      setError(err.message ?? "Invalid email or password");
    } finally {
      setLoading(false);
    }
  };

  const handleTwoFactorSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!twoFactorTicket) return;
    setError("");
    setLoading(true);
    try {
      const user = await twoFactorLogin(twoFactorTicket, twoFactorCode);
      completeLoginRedirect(user);
    } catch (err: any) {
      setError(err.message ?? "Invalid 2FA code");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex">

      {/* ── Left: blue brand panel + icon sidebar ──────────────────────────── */}
      <div className="hidden lg:flex shrink-0" style={{ width: "52%" }}>

        {/* Narrow icon sidebar */}
        <div
          className="flex flex-col items-center py-6 gap-3 shrink-0"
          style={{ width: 72, background: "hsl(217 91% 26%)" }}
        >
          {/* Logo mark */}
          <Link to="/" className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 hover:bg-white/25 transition-colors" title="Back to home">
            <Truck className="h-5 w-5 text-white" />
          </Link>

          {/* Role icon buttons */}
          {roles.map((r) => {
            const active = selected.key === r.key;
            return (
              <button
                key={r.key}
                type="button"
                title={r.label}
                onClick={() => pick(r)}
                className={`flex h-11 w-11 items-center justify-center rounded-xl transition-all ${
                  active
                    ? "bg-white/20 text-white ring-1 ring-white/30"
                    : "text-white/50 hover:bg-white/10 hover:text-white/80"
                }`}
              >
                <r.icon className="h-5 w-5" />
              </button>
            );
          })}
        </div>

        {/* Main panel — photo background with blue overlay */}
        <div className="relative flex flex-1 flex-col overflow-hidden">

          {/* Background photo — royalty-free from Unsplash (truck drivers, freight industry) */}
          <img
            src="https://images.unsplash.com/photo-1519003722824-194d4455a60c?auto=format&fit=crop&w=1200&q=80"
            alt=""
            aria-hidden="true"
            className="absolute inset-0 h-full w-full object-cover object-center"
            draggable={false}
          />

          {/* Brand blue overlay — preserves color identity, keeps text readable */}
          <div
            className="absolute inset-0"
            style={{ background: "hsl(217 91% 22% / 0.82)" }}
          />

          {/* Subtle dot grid on top of overlay */}
          <div
            className="absolute inset-0 opacity-[0.05]"
            style={{
              backgroundImage: "radial-gradient(circle at 1px 1px, white 1px, transparent 0)",
              backgroundSize: "26px 26px",
            }}
          />

          {/* Bottom gradient fade for a polished edge */}
          <div
            className="absolute bottom-0 left-0 right-0 h-32 pointer-events-none"
            style={{ background: "linear-gradient(to top, hsl(217 91% 16% / 0.6), transparent)" }}
          />

          {/* ── Messaging — vertically centered, left-aligned ── */}
          <div className="relative z-10 flex flex-1 flex-col justify-center px-12">
            <div className="space-y-5 max-w-sm">
              <p className="text-[11px] font-semibold tracking-[0.2em] text-white/60 uppercase">
                {selected.roleTag}
              </p>
              <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs text-white/90">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                {selected.badge}
              </div>
              <h2 className="text-[2.25rem] font-bold leading-[1.15] tracking-tight text-white">
                {selected.headline}
              </h2>
              <p className="text-sm leading-relaxed text-white/65">{selected.sub}</p>
            </div>
          </div>

          <p className="absolute bottom-3 left-12 text-[11px] text-white/30 z-10">
            © {new Date().getFullYear()} LoadLead Inc.
          </p>
        </div>
      </div>

      {/* ── Right: form panel ────────────────────────────────────────────────── */}
      <div className="flex flex-1 items-center justify-center bg-white px-8 py-12">
        <div className="w-full max-w-[380px]">

          {/* Logo */}
          <Link to="/" className="mb-8 flex items-center gap-3 hover:opacity-80 transition-opacity">
            <div
              className="flex h-10 w-10 items-center justify-center rounded-xl"
              style={{ background: "hsl(217 91% 32%)" }}
            >
              <Truck className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="text-[15px] font-bold leading-none tracking-tight text-gray-900">LoadLead</p>
              <p className="mt-0.5 text-[10px] font-semibold tracking-[0.15em] text-gray-400 uppercase">
                Freight, Dispatched Live
              </p>
            </div>
          </Link>

          {/* Heading */}
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">Welcome back</h1>
          <p className="mt-1 text-sm text-gray-500">
            Sign in to your{" "}
            <span style={{ color: "hsl(217 91% 42%)" }} className="font-medium">
              {selected.portal}
            </span>
          </p>

          {/* Mobile role picker */}
          <div className="mt-5 flex flex-wrap gap-2 lg:hidden">
            {roles.map((r) => {
              const active = selected.key === r.key;
              return (
                <button
                  key={r.key}
                  type="button"
                  onClick={() => pick(r)}
                  className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
                    active
                      ? "border-primary bg-primary text-white"
                      : "border-gray-200 text-gray-600 hover:border-primary/40"
                  }`}
                >
                  <r.icon className="h-3.5 w-3.5" />
                  {r.label}
                </button>
              );
            })}
          </div>

          {/* 2FA step (shown after a successful password login when the account has 2FA on) */}
          {twoFactorTicket && (
            <form onSubmit={handleTwoFactorSubmit} className="mt-7 space-y-4">
              <div>
                <h3 className="text-base font-semibold">Two-factor authentication</h3>
                <p className="text-xs text-gray-500 mt-1">Enter the 6-digit code from your authenticator app.</p>
              </div>
              <div className="space-y-1.5">
                <label htmlFor="otp" className="block text-[11px] font-semibold tracking-[0.12em] uppercase text-gray-500">
                  6-digit code
                </label>
                <input
                  id="otp"
                  inputMode="numeric"
                  maxLength={6}
                  pattern="[0-9]{6}"
                  required
                  autoFocus
                  value={twoFactorCode}
                  onChange={(e) => setTwoFactorCode(e.target.value.replace(/\D/g, ""))}
                  placeholder="123456"
                  className="w-full h-12 rounded-xl border border-gray-300 px-4 text-base bg-white focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              {error && <p className="text-sm text-red-600">{error}</p>}
              <button
                type="submit"
                disabled={loading || twoFactorCode.length !== 6}
                className="w-full h-12 rounded-xl bg-primary text-primary-foreground font-semibold disabled:opacity-50"
              >
                {loading ? "Verifying…" : "Verify and sign in"}
              </button>
              <button
                type="button"
                onClick={() => { setTwoFactorTicket(null); setTwoFactorCode(""); setError(""); }}
                className="text-xs text-gray-500 hover:text-gray-700 underline"
              >
                ← Back to sign in
              </button>
            </form>
          )}

          {/* Password form (hidden once 2FA step is active) */}
          {!twoFactorTicket && (
          <form onSubmit={handleSubmit} className="mt-7 space-y-4">
            {/* Email */}
            <div className="space-y-1.5">
              <label
                htmlFor="email"
                className="block text-[11px] font-semibold tracking-[0.12em] uppercase text-gray-500"
              >
                Email Address
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-500/20 transition-all"
              />
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <label
                htmlFor="pwd"
                className="block text-[11px] font-semibold tracking-[0.12em] uppercase text-gray-500"
              >
                Password
              </label>
              <input
                id="pwd"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••"
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-500/20 transition-all"
              />
            </div>

            {/* Remember + Forgot */}
            <div className="flex items-center justify-between">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-600 select-none">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 accent-blue-600"
                />
                Remember me
              </label>
              <Link
                to="/forgot-password"
                className="text-sm font-medium hover:underline"
                style={{ color: "hsl(217 91% 42%)" }}
              >
                Forgot password?
              </Link>
            </div>

            {/* Error */}
            {error && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
            )}

            {/* Role mismatch */}
            {roleMismatch && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-700">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                {roleMismatch}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading || !!roleMismatch}
              className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold text-white transition-all disabled:opacity-60"
              style={{ background: "hsl(217 91% 32%)" }}
              onMouseEnter={(e) => { if (!loading) (e.currentTarget as HTMLButtonElement).style.background = "hsl(217 91% 26%)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "hsl(217 91% 32%)"; }}
            >
              {loading ? "Signing in…" : (
                <>Sign in as {selected.label} <ArrowRight className="h-4 w-4" /></>
              )}
            </button>
          </form>
          )}

          {/* Footer links */}
          <div className="mt-6 space-y-2 text-center text-sm text-gray-500">
            <p>
              New to LoadLead?{" "}
              <Link
                to="/signup"
                className="font-semibold hover:underline"
                style={{ color: "hsl(217 91% 42%)" }}
              >
                Join the network
              </Link>
            </p>
            <p>
              <Link to="/" className="text-xs text-gray-400 hover:text-gray-600 hover:underline">
                ← Back to home
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
