import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useState } from "react";
import { ArrowRight, ShieldCheck, Truck, PackagePlus, Warehouse, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/Logo";
import { useAuth } from "@/contexts/AuthContext";

// Role tiles — purely for branding on the left panel and submit button label.
// They do NOT pre-fill credentials. The backend determines the actual role from
// the account and the JWT; the tile selection has zero effect on auth outcome.
const roles = [
  {
    key: "DRIVER",
    label: "Driver",
    icon: Truck,
    to: "/driver",
    badge: "47s average time to first match",
    headline: "Find your next load and hit the road.",
    sub: "See available freight near you, accept offers instantly, and get moving — all from one dashboard.",
  },
  {
    key: "SHIPPER",
    label: "Shipper",
    icon: PackagePlus,
    to: "/shipper",
    badge: "Live driver matching",
    headline: "Sign in to dispatch freight in real time.",
    sub: "Post loads, broadcast to matched drivers, and track every shipment from pickup to delivery.",
  },
  {
    key: "RECEIVER",
    label: "Receiver",
    icon: Warehouse,
    to: "/receiver",
    badge: "Real-time inbound visibility",
    headline: "Know exactly when your freight arrives.",
    sub: "Track inbound shipments, get live ETAs, and coordinate dock scheduling — before the truck pulls up.",
  },
  {
    key: "ADMIN",
    label: "Admin",
    icon: ShieldCheck,
    to: "/admin",
    badge: "Full platform control",
    headline: "Manage operations across every role.",
    sub: "Oversee drivers, shippers, loads, and platform health from a single command center.",
  },
] as const;

const roleHome: Record<string, string> = {
  DRIVER: "/driver",
  SHIPPER: "/shipper",
  RECEIVER: "/receiver",
  ADMIN: "/admin",
};

export default function Login() {
  const [selectedTile, setSelectedTile] = useState<typeof roles[number]>(roles[0]);
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]       = useState("");
  const [roleMismatch, setRoleMismatch] = useState<string | null>(null);
  const [loading, setLoading]   = useState(false);

  const { login } = useAuth();
  const navigate  = useNavigate();
  const [searchParams] = useSearchParams();
  const redirectTo = searchParams.get("redirect");

  const handleTileSelect = (r: typeof roles[number]) => {
    setSelectedTile(r);
    setError("");
    setRoleMismatch(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setRoleMismatch(null);
    setLoading(true);
    try {
      const user = await login(email, password);

      // If the user signed in with a tile that doesn't match their actual role,
      // show a brief mismatch notice before redirecting to the correct dashboard.
      if (user.role !== selectedTile.key) {
        setRoleMismatch(
          `This account is registered as ${user.role}. Taking you to your dashboard…`
        );
        setTimeout(() => {
          navigate(redirectTo ?? roleHome[user.role] ?? "/");
        }, 1800);
        return;
      }

      navigate(redirectTo ?? roleHome[user.role] ?? "/");
    } catch (err: any) {
      setError(err.message ?? "Invalid email or password");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2">

      {/* ── Left brand panel ── */}
      <div
        className="relative hidden lg:flex flex-col justify-between p-12 text-primary-foreground overflow-hidden"
        style={{ background: "var(--gradient-hero)" }}
      >
        <div
          className="absolute inset-0 opacity-[0.08]"
          style={{
            backgroundImage: "radial-gradient(circle at 1px 1px, white 1px, transparent 0)",
            backgroundSize: "28px 28px",
          }}
        />
        <div className="relative"><Logo variant="light" /></div>
        <div className="relative space-y-6 max-w-md">
          <div className="inline-flex items-center gap-2 rounded-full bg-white/10 border border-white/15 px-3 py-1 text-xs">
            <span className="h-2 w-2 rounded-full bg-accent animate-pulse" />
            {selectedTile.badge}
          </div>
          <h2 className="text-4xl font-bold leading-tight tracking-tight">{selectedTile.headline}</h2>
          <p className="text-primary-foreground/75">{selectedTile.sub}</p>
        </div>
        <div className="relative text-xs text-primary-foreground/60">© {new Date().getFullYear()} LoadLead</div>
      </div>

      {/* ── Right form ── */}
      <div className="flex items-center justify-center p-6 lg:p-12 bg-background">
        <div className="w-full max-w-md">
          <div className="lg:hidden mb-8"><Logo /></div>
          <h1 className="text-3xl font-bold tracking-tight">Welcome back</h1>
          <p className="mt-2 text-muted-foreground text-sm">
            Select your role, then sign in with your account credentials.
          </p>

          {/* Role tiles — visual only, no credential pre-fill */}
          <div className="mt-8 grid grid-cols-2 gap-2">
            {roles.map((r) => {
              const active = selectedTile.key === r.key;
              return (
                <button
                  key={r.key}
                  type="button"
                  onClick={() => handleTileSelect(r)}
                  className={`flex items-center gap-2 rounded-xl border p-3 text-left transition-all ${
                    active
                      ? "border-primary bg-primary/5 ring-1 ring-primary"
                      : "border-border hover:border-primary/40"
                  }`}
                >
                  <div className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${
                    active ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground"
                  }`}>
                    <r.icon className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="text-sm font-medium">{r.label}</div>
                    <div className="text-[10px] text-muted-foreground">{r.to}</div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pwd">Password</Label>
              <Input
                id="pwd"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>

            {/* Auth error */}
            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}

            {/* Role mismatch — informational, not blocking */}
            {roleMismatch && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-3 py-2.5 text-sm text-amber-700 dark:text-amber-400">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                {roleMismatch}
              </div>
            )}

            <Button type="submit" className="w-full h-11" disabled={loading || !!roleMismatch}>
              {loading
                ? "Signing in…"
                : <>{`Sign in as ${selectedTile.label}`} <ArrowRight className="h-4 w-4 ml-1" /></>
              }
            </Button>
          </form>

          <div className="mt-6 text-sm text-muted-foreground text-center space-y-2">
            <div>
              <Link to="/forgot-password" className="hover:text-foreground hover:underline">
                Forgot your password?
              </Link>
            </div>
            <div>
              New to LoadLead?{" "}
              <Link to="/signup" className="text-primary font-medium hover:underline">
                Create an account
              </Link>
            </div>
            <div>
              <Link to="/" className="text-muted-foreground hover:underline">Back to home</Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
