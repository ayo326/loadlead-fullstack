import { Link, useNavigate } from "react-router-dom";
import { useState } from "react";
import { ArrowRight, ShieldCheck, Truck, PackagePlus, Warehouse } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/Logo";
import { useAuth } from "@/contexts/AuthContext";

const roles = [
  { key: "DRIVER",   label: "Driver",   icon: Truck,       to: "/driver",   description: "Receive load offers matching your equipment" },
  { key: "SHIPPER",  label: "Shipper",  icon: PackagePlus, to: "/shipper",  description: "Post loads and broadcast to drivers instantly" },
  { key: "RECEIVER", label: "Receiver", icon: Warehouse,   to: "/receiver", description: "Track inbound deliveries to your facility" },
  { key: "ADMIN",    label: "Admin",    icon: ShieldCheck, to: "/admin",    description: "Manage platform users and operations" },
] as const;

export default function Signup() {
  const [role, setRole] = useState<typeof roles[number]>(roles[0]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { signup } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password !== confirm) { setError("Passwords do not match"); return; }
    if (password.length < 8) { setError("Password must be at least 8 characters"); return; }
    setLoading(true);
    try {
      await signup(email, password, role.key);
      navigate(role.to);
    } catch (err: any) {
      setError(err.message ?? "Sign up failed");
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
            <span className="h-2 w-2 rounded-full bg-accent animate-pulse" /> Join thousands of carriers and shippers
          </div>
          <h2 className="text-4xl font-bold leading-tight tracking-tight">Create your account and start moving freight.</h2>
          <p className="text-primary-foreground/75">Pick your role and we'll set up the right workspace for you.</p>
        </div>
        <div className="relative text-xs text-primary-foreground/60">© {new Date().getFullYear()} LoadLead</div>
      </div>

      {/* Right form */}
      <div className="flex items-center justify-center p-6 lg:p-12 bg-background">
        <div className="w-full max-w-md">
          <div className="lg:hidden mb-8"><Logo /></div>
          <h1 className="text-3xl font-bold tracking-tight">Create account</h1>
          <p className="mt-2 text-muted-foreground text-sm">Choose your role, then enter your details.</p>

          <div className="mt-8 grid grid-cols-2 gap-2">
            {roles.map((r) => (
              <button
                key={r.key}
                type="button"
                onClick={() => setRole(r)}
                className={`flex items-center gap-2 rounded-xl border p-3 text-left transition-all ${role.key === r.key ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border hover:border-primary/40"}`}
              >
                <div className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${role.key === r.key ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground"}`}>
                  <r.icon className="h-4 w-4" />
                </div>
                <div>
                  <div className="text-sm font-medium">{r.label}</div>
                  <div className="text-[10px] text-muted-foreground leading-tight">{r.description}</div>
                </div>
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pwd">Password</Label>
              <Input id="pwd" type="password" placeholder="Min. 8 characters" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm">Confirm password</Label>
              <Input id="confirm" type="password" placeholder="Repeat password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full h-11" disabled={loading}>
              {loading ? "Creating account…" : <>{`Sign up as ${role.label}`} <ArrowRight className="h-4 w-4" /></>}
            </Button>
          </form>

          <div className="mt-6 text-sm text-muted-foreground text-center">
            Already have an account? <Link to="/login" className="text-primary font-medium hover:underline">Sign in</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
