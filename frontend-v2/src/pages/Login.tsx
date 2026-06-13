import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useState } from "react";
import { ArrowRight, ShieldCheck, Truck, PackagePlus, Warehouse } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/Logo";
import { useAuth } from "@/contexts/AuthContext";

const roles = [
  {
    key: "DRIVER",
    label: "Driver",
    icon: Truck,
    to: "/driver",
    email: "driver1@loadlead.dev",
    badge: "47s average time to first match",
    headline: "Find your next load and hit the road.",
    sub: "See available freight near you, accept offers instantly, and get moving — all from one dashboard.",
  },
  {
    key: "SHIPPER",
    label: "Shipper",
    icon: PackagePlus,
    to: "/shipper",
    email: "shipper@loadlead.dev",
    badge: "Live driver matching",
    headline: "Sign in to dispatch freight in real time.",
    sub: "Pick your role and we'll drop you straight into the right workspace.",
  },
  {
    key: "RECEIVER",
    label: "Receiver",
    icon: Warehouse,
    to: "/receiver",
    email: "receiver@loadlead.dev",
    badge: "Real-time inbound visibility",
    headline: "Know exactly when your freight arrives.",
    sub: "Track inbound shipments, get live ETAs, and coordinate dock scheduling — before the truck pulls up.",
  },
  {
    key: "ADMIN",
    label: "Admin",
    icon: ShieldCheck,
    to: "/admin",
    email: "admin@loadlead.dev",
    badge: "Full platform control",
    headline: "Manage operations across every role.",
    sub: "Oversee drivers, shippers, loads, and platform health from a single command center.",
  },
] as const;

export default function Login() {
  const [role, setRole] = useState<typeof roles[number]>(roles[0]);
  const [email, setEmail] = useState(roles[0].email);
  const [password, setPassword] = useState("Password1!");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirectTo = searchParams.get("redirect");

  const handleRoleSelect = (r: typeof roles[number]) => {
    setRole(r);
    setEmail(r.email);
    setError("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const user = await login(email, password);
      const dest = redirectTo ?? roles.find((r) => r.key === user.role)?.to ?? "/driver";
      navigate(dest);
    } catch (err: any) {
      setError(err.message ?? "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      {/* Left brand panel */}
      <div className="relative hidden lg:flex flex-col justify-between p-12 text-primary-foreground overflow-hidden" style={{ background: "var(--gradient-hero)" }}>
        <div className="absolute inset-0 opacity-[0.08]" style={{ backgroundImage: "radial-gradient(circle at 1px 1px, white 1px, transparent 0)", backgroundSize: "28px 28px" }} />
        <div className="relative"><Logo variant="light" /></div>
        <div className="relative space-y-6 max-w-md">
          <div className="inline-flex items-center gap-2 rounded-full bg-white/10 border border-white/15 px-3 py-1 text-xs">
            <span className="h-2 w-2 rounded-full bg-accent animate-pulse" /> {role.badge}
          </div>
          <h2 className="text-4xl font-bold leading-tight tracking-tight">{role.headline}</h2>
          <p className="text-primary-foreground/75">{role.sub}</p>
        </div>
        <div className="relative text-xs text-primary-foreground/60">© {new Date().getFullYear()} LoadLead</div>
      </div>

      {/* Right form */}
      <div className="flex items-center justify-center p-6 lg:p-12 bg-background">
        <div className="w-full max-w-md">
          <div className="lg:hidden mb-8"><Logo /></div>
          <h1 className="text-3xl font-bold tracking-tight">Welcome back</h1>
          <p className="mt-2 text-muted-foreground text-sm">Select a role to pre-fill credentials, or type your own.</p>

          <div className="mt-8 grid grid-cols-2 gap-2">
            {roles.map((r) => (
              <button
                key={r.key}
                type="button"
                onClick={() => handleRoleSelect(r)}
                className={`flex items-center gap-2 rounded-xl border p-3 text-left transition-all ${role.key === r.key ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border hover:border-primary/40"}`}
              >
                <div className={`h-9 w-9 rounded-lg flex items-center justify-center ${role.key === r.key ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground"}`}>
                  <r.icon className="h-4 w-4" />
                </div>
                <div>
                  <div className="text-sm font-medium">{r.label}</div>
                  <div className="text-[10px] text-muted-foreground">{r.to}</div>
                </div>
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pwd">Password</Label>
              <Input id="pwd" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full h-11" disabled={loading}>
              {loading ? "Signing in…" : <>{`Sign in as ${role.label}`} <ArrowRight className="h-4 w-4" /></>}
            </Button>
          </form>

          <div className="mt-6 text-sm text-muted-foreground text-center space-y-2">
            <div><Link to="/forgot-password" className="hover:text-foreground hover:underline">Forgot your password?</Link></div>
            <div>New to LoadLead? <Link to="/signup" className="text-primary font-medium hover:underline">Create an account</Link></div>
            <div><Link to="/" className="text-muted-foreground hover:underline">Back to home</Link></div>
          </div>
        </div>
      </div>
    </div>
  );
}
