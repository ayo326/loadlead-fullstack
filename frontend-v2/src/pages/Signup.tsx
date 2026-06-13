import { Link, useNavigate } from "react-router-dom";
import { useState } from "react";
import { ArrowRight, ShieldCheck, Truck, PackagePlus, Warehouse, Building2, CheckSquare, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/Logo";
import { useAuth } from "@/contexts/AuthContext";

// ─── Role definitions ────────────────────────────────────────────────────────

const roles = [
  { key: "DRIVER",   label: "Driver",   icon: Truck,       to: "/driver",   description: "Receive load offers matching your equipment" },
  { key: "SHIPPER",  label: "Shipper",  icon: PackagePlus, to: "/shipper",  description: "Post loads and broadcast to drivers instantly" },
  { key: "RECEIVER", label: "Receiver", icon: Warehouse,   to: "/receiver", description: "Track inbound deliveries to your facility" },
  { key: "ADMIN",    label: "Admin",    icon: ShieldCheck, to: "/admin",    description: "Manage platform users and operations" },
] as const;

// ─── Org capability options (shown for non-DRIVER, non-ADMIN) ────────────────

const CAPABILITIES = [
  { key: "CARRIER",  label: "Carrier",  description: "Move freight — trucks, drivers, equipment" },
  { key: "SHIPPER",  label: "Shipper",  description: "Post loads and find drivers" },
  { key: "RECEIVER", label: "Receiver", description: "Accept deliveries at your facility" },
];

function defaultCapabilitiesForRole(roleKey: string): string[] {
  if (roleKey === "SHIPPER")  return ["SHIPPER"];
  if (roleKey === "RECEIVER") return ["RECEIVER"];
  return [];
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function Signup() {
  const [role, setRole] = useState<typeof roles[number]>(roles[0]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Org fields (step 2 for non-DRIVER, non-ADMIN)
  const needsOrg = role.key !== "DRIVER" && role.key !== "ADMIN";
  const [legalName, setLegalName] = useState("");
  const [capabilities, setCapabilities] = useState<string[]>([]);
  const [dotNumber, setDotNumber] = useState("");
  const [mcNumber, setMcNumber] = useState("");
  const [city, setCity] = useState("");
  const [orgState, setOrgState] = useState("");

  const { signup } = useAuth();
  const navigate = useNavigate();

  // Auto-set capabilities when role changes
  function handleRoleChange(r: typeof roles[number]) {
    setRole(r);
    setCapabilities(defaultCapabilitiesForRole(r.key));
  }

  function toggleCapability(cap: string) {
    setCapabilities(prev =>
      prev.includes(cap) ? prev.filter(c => c !== cap) : [...prev, cap]
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password !== confirm) { setError("Passwords do not match"); return; }
    if (password.length < 8) { setError("Password must be at least 8 characters"); return; }
    if (needsOrg && !legalName.trim()) { setError("Business / legal name is required"); return; }
    if (needsOrg && capabilities.length === 0) { setError("Select at least one business capability"); return; }

    setLoading(true);
    try {
      const orgParams = needsOrg ? {
        legalName: legalName.trim(),
        capabilities,
        dotNumber: dotNumber || undefined,
        mcNumber: mcNumber || undefined,
        city: city || undefined,
        state: orgState || undefined,
      } : undefined;

      await signup(email, password, role.key, orgParams);
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
      <div className="flex items-center justify-center p-6 lg:p-12 bg-background overflow-y-auto">
        <div className="w-full max-w-md py-4">
          <div className="lg:hidden mb-8"><Logo /></div>
          <h1 className="text-3xl font-bold tracking-tight">Create account</h1>
          <p className="mt-2 text-muted-foreground text-sm">Choose your role, then enter your details.</p>

          {/* Role picker */}
          <div className="mt-8 grid grid-cols-2 gap-2">
            {roles.map((r) => (
              <button
                key={r.key}
                type="button"
                onClick={() => handleRoleChange(r)}
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

            {/* Org section (Shipper / Receiver only) */}
            {needsOrg && (
              <div className="rounded-xl border border-border bg-secondary/30 p-4 space-y-4">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Building2 className="h-4 w-4 text-primary" />
                  Organisation details
                </div>

                <div className="space-y-2">
                  <Label htmlFor="legalName">Business / legal name <span className="text-destructive">*</span></Label>
                  <Input
                    id="legalName"
                    placeholder="Acme Freight LLC"
                    value={legalName}
                    onChange={e => setLegalName(e.target.value)}
                    required={needsOrg}
                  />
                </div>

                {/* Capability checkboxes */}
                <div className="space-y-2">
                  <Label>Business capabilities <span className="text-destructive">*</span></Label>
                  <p className="text-xs text-muted-foreground">Select all that apply to your organisation.</p>
                  <div className="space-y-2">
                    {CAPABILITIES.map(cap => {
                      const checked = capabilities.includes(cap.key);
                      return (
                        <button
                          key={cap.key}
                          type="button"
                          onClick={() => toggleCapability(cap.key)}
                          className={`w-full flex items-start gap-3 rounded-lg border p-3 text-left transition-all ${checked ? "border-primary bg-primary/5" : "border-border hover:border-primary/30"}`}
                        >
                          {checked
                            ? <CheckSquare className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                            : <Square className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                          }
                          <div>
                            <div className="text-sm font-medium">{cap.label}</div>
                            <div className="text-xs text-muted-foreground">{cap.description}</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label htmlFor="dotNumber">DOT # (optional)</Label>
                    <Input id="dotNumber" placeholder="1234567" value={dotNumber} onChange={e => setDotNumber(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="mcNumber">MC # (optional)</Label>
                    <Input id="mcNumber" placeholder="MC-123456" value={mcNumber} onChange={e => setMcNumber(e.target.value)} />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label htmlFor="orgCity">City (optional)</Label>
                    <Input id="orgCity" placeholder="Chicago" value={city} onChange={e => setCity(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="orgState">State (optional)</Label>
                    <Input id="orgState" placeholder="IL" maxLength={2} value={orgState} onChange={e => setOrgState(e.target.value.toUpperCase())} />
                  </div>
                </div>
              </div>
            )}

            {/* Account credentials */}
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
