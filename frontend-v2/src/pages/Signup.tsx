import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useEffect, useState } from "react";
import {
  ArrowRight, ArrowLeft, PackagePlus, Warehouse,
  Building2, TruckIcon, ShipWheel, Check, Truck, Phone, Mail, MapPin, User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";

// ── Role definitions ──────────────────────────────────────────────────────────

const roles = [
  {
    key: "OWNER_OPERATOR", label: "Owner Operator", icon: TruckIcon, to: "/owner-operator",
    description: "Drive yourself and manage your own fleet of drivers",
    color: "bg-amber-500",
  },
  {
    key: "DRIVER", label: "Driver", icon: ShipWheel, to: "/driver",
    description: "Receive load offers matched to your equipment and location",
    color: "bg-blue-500",
  },
  {
    key: "SHIPPER", label: "Shipper", icon: PackagePlus, to: "/shipper",
    description: "Post loads and broadcast to verified drivers instantly",
    color: "bg-violet-500",
  },
  {
    key: "RECEIVER", label: "Receiver", icon: Warehouse, to: "/receiver",
    description: "Track inbound deliveries to your facility in real time",
    color: "bg-teal-500",
  },
  {
    key: "CARRIER", label: "Carrier", icon: Building2, to: "/carrier",
    description: "Trucking company — onboard drivers and dispatch loads. Unlike an Owner Operator, you run the company and don't have to drive yourself.",
    color: "bg-indigo-600",
  },
] as const;

const CAPABILITIES = [
  { key: "CARRIER",  label: "Carrier",  description: "Move freight — trucks, drivers, equipment" },
  { key: "SHIPPER",  label: "Shipper",  description: "Post loads and find available drivers" },
  { key: "RECEIVER", label: "Receiver", description: "Accept and manage deliveries at your facility" },
];

function defaultCaps(roleKey: string): string[] {
  if (roleKey === "SHIPPER")  return ["SHIPPER"];
  if (roleKey === "RECEIVER") return ["RECEIVER"];
  return [];
}

// ── Step indicator ────────────────────────────────────────────────────────────

function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <div className="font-display-hangar flex items-center gap-0 mb-8">
      {steps.map((label, i) => {
        const done    = i < current;
        const active  = i === current;
        const last    = i === steps.length - 1;
        return (
          <div key={i} className="flex items-center flex-1 last:flex-none">
            <div className="flex items-center gap-2 shrink-0">
              <div className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold transition-all ${
                done   ? "bg-primary text-white" :
                active ? "bg-primary text-white ring-4 ring-primary/20" :
                         "bg-gray-100 text-gray-400"
              }`}>
                {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </div>
              <span className={`text-xs font-medium ${active ? "text-gray-900" : done ? "text-primary" : "text-gray-400"}`}>
                {label}
              </span>
            </div>
            {!last && (
              <div className={`flex-1 h-px mx-3 ${i < current ? "bg-primary" : "bg-gray-200"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Signup() {
  const { signup, signupCarrier } = useAuth();
  const navigate   = useNavigate();

  // Step state
  const [step, setStep] = useState(0);   // 0 = role, 1 = org (if needed), 2 = account

  // Step 1: role
  const [role, setRole] = useState<typeof roles[number]>(roles[0]);

  // Step 2: org
  const [legalName, setLegalName]   = useState("");
  const [capabilities, setCaps]     = useState<string[]>([]);
  const [dotNumber, setDotNumber]   = useState("");
  const [mcNumber, setMcNumber]     = useState("");
  const [orgCity, setOrgCity]       = useState("");
  const [orgState, setOrgState]     = useState("");

  // Step 1 (CARRIER only): company details — separate state from the
  // SHIPPER/RECEIVER org fields above so the two flows can never cross-pollute.
  const [carrierLegalName, setCarrierLegalName] = useState("");
  const [carrierDba, setCarrierDba]              = useState("");
  const [carrierMc, setCarrierMc]                = useState("");
  const [carrierDot, setCarrierDot]              = useState("");

  // Step 2b (SHIPPER only): shipper profile
  const [companyName, setCompanyName]       = useState("");
  const [companyAddress, setCompanyAddress] = useState("");
  const [contactName, setContactName]       = useState("");
  const [contactPhone, setContactPhone]     = useState("");
  const [contactEmail, setContactEmail]     = useState("");

  // Step 3: account
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm]   = useState("");

  const [error, setError]     = useState("");
  const [loading, setLoading] = useState(false);

  // Optional redirect target (e.g. /accept-invite?token=...) and email
  // prefill when the user lands here from an invite acceptance flow.
  const [searchParams] = useSearchParams();
  const redirectTo = searchParams.get("redirect");
  useEffect(() => {
    const inviteEmail = searchParams.get("email");
    if (inviteEmail) setEmail(inviteEmail);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // needsOrg covers ONLY the two existing personas with the generic
  // capabilities-picker org step (SHIPPER, RECEIVER) — unchanged from before.
  const needsOrg            = role.key === "SHIPPER" || role.key === "RECEIVER";
  const isCarrier            = role.key === "CARRIER";
  // Carrier gets its own dedicated company-details step at the same
  // position (step 1) — goesThroughOrgStep is what step routing keys off,
  // so it's additive: for the four existing personas it's identical to
  // needsOrg, behavior is unchanged.
  const goesThroughOrgStep  = needsOrg || isCarrier;
  const needsShipperProfile = role.key === "SHIPPER";
  // Account is always step 2 for non-shippers, step 3 for SHIPPER (who has an extra profile step)
  const accountStep = needsShipperProfile ? 3 : 2;
  const steps =
    needsShipperProfile
      ? ["Your role", "Organisation", "Shipper profile", "Account"]
      : goesThroughOrgStep
        ? ["Your role", "Organisation", "Account"]
        : ["Your role", "Account"];
  const lastStep = steps.length - 1;

  function pickRole(r: typeof roles[number]) {
    setRole(r);
    setCaps(defaultCaps(r.key));
    setError("");
  }

  function next() {
    setError("");
    if (step === 0) {
      setStep(goesThroughOrgStep ? 1 : accountStep);
      return;
    }
    if (step === 1 && needsOrg) {
      if (!legalName.trim()) { setError("Business / legal name is required"); return; }
      if (capabilities.length === 0) { setError("Select at least one business capability"); return; }
      if (needsShipperProfile) {
        // Pre-fill company name from org legal name when advancing to shipper profile step
        if (!companyName) setCompanyName(legalName.trim());
        setStep(2);
      } else {
        setStep(accountStep);
      }
      return;
    }
    if (step === 1 && isCarrier) {
      if (!carrierLegalName.trim()) { setError("Company legal name is required"); return; }
      setStep(accountStep);
      return;
    }
    if (step === 2 && needsShipperProfile) {
      if (!companyName.trim())    { setError("Company name is required"); return; }
      if (!companyAddress.trim()) { setError("Company address is required"); return; }
      if (!contactName.trim())    { setError("Contact name is required"); return; }
      if (!contactPhone.trim())   { setError("Contact phone is required"); return; }
      if (!contactEmail.trim() || !contactEmail.includes("@")) {
        setError("A valid contact email is required"); return;
      }
      setStep(accountStep);
    }
  }

  function back() {
    setError("");
    if (step === accountStep) {
      setStep(needsShipperProfile ? 2 : goesThroughOrgStep ? 1 : 0);
      return;
    }
    if (step === 2) { setStep(needsOrg ? 1 : 0); return; }
    setStep(step - 1);
  }

  function toggleCap(cap: string) {
    setCaps(prev => prev.includes(cap) ? prev.filter(c => c !== cap) : [...prev, cap]);
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password !== confirm) { setError("Passwords do not match"); return; }
    if (password.length < 8)  { setError("Password must be at least 8 characters"); return; }

    setLoading(true);
    try {
      if (isCarrier) {
        // Dedicated atomic carrier signup — separate call, separate backend
        // endpoint, never touches the generic signup() path below.
        await signupCarrier({
          email, password,
          legalName: carrierLegalName.trim(),
          dba:       carrierDba || undefined,
          mcNumber:  carrierMc  || undefined,
          dotNumber: carrierDot || undefined,
        });
        navigate(redirectTo ?? role.to);
        return;
      }

      const orgParams = needsOrg ? {
        legalName:    legalName.trim(),
        capabilities,
        dotNumber:    dotNumber  || undefined,
        mcNumber:     mcNumber   || undefined,
        city:         orgCity    || undefined,
        state:        orgState   || undefined,
      } : undefined;

      await signup(email, password, role.key, orgParams);

      // For SHIPPER: immediately create the shipper profile so the dashboard
      // and BOL routes never return "Shipper profile not found".
      if (needsShipperProfile) {
        await api.createShipperProfile({
          companyName:    companyName.trim(),
          companyAddress: companyAddress.trim(),
          contactName:    contactName.trim(),
          contactPhone:   contactPhone.trim(),
          contactEmail:   contactEmail.trim(),
        });
      }

      navigate(redirectTo ?? role.to);
    } catch (err: any) {
      setError(err.message ?? "Sign up failed");
    } finally {
      setLoading(false);
    }
  };

  // Map raw step number → visual stepper index
  // SHIPPER:  0→0, 1→1, 2→2, 3→3
  // RECEIVER: 0→0, 1→1, 2→2
  // DRIVER:   0→0, 2→1   (step 2 = account; no org/profile step)
  const visualStep =
    step === 0            ? 0 :
    step === 1            ? 1 :
    step === 2 && needsShipperProfile ? 2 :
    steps.length - 1;

  return (
    <div className="min-h-screen flex">

      {/* ── Left blue panel ── */}
      <div
        className="hidden lg:flex flex-col justify-between p-12 shrink-0 overflow-hidden relative"
        style={{ width: "40%", background: "hsl(217 91% 32%)" }}
      >
        <div className="absolute inset-0 opacity-[0.06]"
          style={{ backgroundImage: "radial-gradient(circle at 1px 1px, white 1px, transparent 0)", backgroundSize: "26px 26px" }} />

        {/* Logo mark */}
        <Link to="/" className="relative flex items-center gap-3 hover:opacity-80 transition-opacity">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15">
            <Truck className="h-5 w-5 text-white" />
          </div>
          <div>
            <p className="text-[15px] font-bold text-white leading-none">LoadLead</p>
            <p className="text-[10px] font-semibold tracking-[0.15em] text-white/50 uppercase mt-0.5">Where loads meet leads.</p>
          </div>
        </Link>

        {/* Copy */}
        <div className="relative space-y-5 max-w-xs">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs text-white/90">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Join thousands of carriers and shippers
          </div>
          <h2 className="text-3xl font-bold leading-tight text-white">
            Create your account and start moving freight.
          </h2>
          <p className="text-sm leading-relaxed text-white/60">
            Pick your role and we'll set up the right workspace in under 2 minutes.
          </p>

          {/* Feature bullets */}
          <ul className="space-y-2.5 pt-2">
            {[
              "Real-time load matching",
              "Verified driver network",
              "Live tracking & BOL",
              "Organisation & team roles",
            ].map(f => (
              <li key={f} className="flex items-center gap-2.5 text-sm text-white/75">
                <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/15">
                  <Check className="h-3 w-3 text-white" />
                </div>
                {f}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-[11px] text-white/30">© {new Date().getFullYear()} LoadLead Inc.</p>
      </div>

      {/* ── Right form panel ── */}
      <div className="flex flex-1 items-start justify-center bg-white overflow-y-auto">
        <div className="w-full max-w-lg px-8 py-12">

          {/* Header */}
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Create your account</h1>
            <p className="mt-1 text-sm text-gray-500">
              Step {visualStep + 1} of {steps.length} — {steps[visualStep]}
            </p>
          </div>

          {/* Stepper */}
          <Stepper steps={steps} current={visualStep} />

          {/* ── STEP 0: Role ── */}
          {step === 0 && (
            <div className="space-y-5">
              <div>
                <p className="text-sm font-semibold text-gray-700 mb-3">What best describes you?</p>
                <div className="grid grid-cols-1 gap-2.5">
                  {roles.map((r) => {
                    const active = role.key === r.key;
                    return (
                      <button
                        key={r.key}
                        type="button"
                        onClick={() => pickRole(r)}
                        className={`flex items-center gap-4 rounded-xl border-2 p-4 text-left transition-all ${
                          active
                            ? "border-primary bg-primary/4 shadow-sm"
                            : "border-gray-100 hover:border-gray-200 bg-gray-50"
                        }`}
                      >
                        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${active ? "bg-primary" : "bg-white border border-gray-200"}`}>
                          <r.icon className={`h-5 w-5 ${active ? "text-white" : "text-gray-500"}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-semibold ${active ? "text-primary" : "text-gray-800"}`}>{r.label}</p>
                          <p className="text-xs text-gray-500 mt-0.5 leading-snug">{r.description}</p>
                        </div>
                        <div className={`h-4 w-4 shrink-0 rounded-full border-2 transition-all ${active ? "border-primary bg-primary" : "border-gray-300"}`}>
                          {active && <div className="h-full w-full rounded-full scale-50 bg-white" />}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <button
                type="button"
                onClick={next}
                className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold text-white transition-all"
                style={{ background: "hsl(217 91% 32%)" }}
              >
                Continue as {role.label} <ArrowRight className="h-4 w-4" />
              </button>

              <p className="text-center text-sm text-gray-500">
                Already have an account?{" "}
                <Link to="/login" className="font-semibold hover:underline" style={{ color: "hsl(217 91% 42%)" }}>
                  Sign in
                </Link>
              </p>
            </div>
          )}

          {/* ── STEP 1: Organisation (Shipper / Receiver only) ── */}
          {step === 1 && needsOrg && (
            <div className="space-y-5">
              <div className="flex items-center gap-2 rounded-xl bg-primary/5 border border-primary/15 px-4 py-3">
                <Building2 className="h-4 w-4 text-primary shrink-0" />
                <p className="text-sm text-primary font-medium">
                  As a {role.label}, you'll be the Owner of your organisation. You can invite team members later.
                </p>
              </div>

              {/* Legal name */}
              <div className="space-y-1.5">
                <label className="block text-[11px] font-semibold tracking-[0.12em] uppercase text-gray-500">
                  Business / Legal Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  placeholder="Acme Freight LLC"
                  value={legalName}
                  onChange={e => setLegalName(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-500/20 transition-all"
                />
              </div>

              {/* Capabilities */}
              <div className="space-y-2">
                <label className="block text-[11px] font-semibold tracking-[0.12em] uppercase text-gray-500">
                  Business Capabilities <span className="text-red-500">*</span>
                </label>
                <p className="text-xs text-gray-400">Select all that apply to your organisation.</p>
                <div className="space-y-2">
                  {CAPABILITIES.map(cap => {
                    const checked = capabilities.includes(cap.key);
                    return (
                      <button
                        key={cap.key}
                        type="button"
                        onClick={() => toggleCap(cap.key)}
                        className={`w-full flex items-start gap-3 rounded-xl border-2 p-3.5 text-left transition-all ${
                          checked ? "border-primary bg-primary/4" : "border-gray-100 bg-gray-50 hover:border-gray-200"
                        }`}
                      >
                        <div className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded ${checked ? "bg-primary" : "border-2 border-gray-300"}`}>
                          {checked && <Check className="h-3 w-3 text-white" />}
                        </div>
                        <div>
                          <p className={`text-sm font-semibold ${checked ? "text-primary" : "text-gray-700"}`}>{cap.label}</p>
                          <p className="text-xs text-gray-500 mt-0.5">{cap.description}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* DOT / MC */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="block text-[11px] font-semibold tracking-[0.12em] uppercase text-gray-500">DOT # <span className="text-gray-300 normal-case font-normal">(optional)</span></label>
                  <input
                    type="text"
                    placeholder="1234567"
                    value={dotNumber}
                    onChange={e => setDotNumber(e.target.value)}
                    className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm outline-none placeholder:text-gray-400 focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-500/20 transition-all"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-[11px] font-semibold tracking-[0.12em] uppercase text-gray-500">MC # <span className="text-gray-300 normal-case font-normal">(optional)</span></label>
                  <input
                    type="text"
                    placeholder="MC-123456"
                    value={mcNumber}
                    onChange={e => setMcNumber(e.target.value)}
                    className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm outline-none placeholder:text-gray-400 focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-500/20 transition-all"
                  />
                </div>
              </div>

              {/* City / State */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="block text-[11px] font-semibold tracking-[0.12em] uppercase text-gray-500">City <span className="text-gray-300 normal-case font-normal">(optional)</span></label>
                  <input
                    type="text"
                    placeholder="Chicago"
                    value={orgCity}
                    onChange={e => setOrgCity(e.target.value)}
                    className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm outline-none placeholder:text-gray-400 focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-500/20 transition-all"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-[11px] font-semibold tracking-[0.12em] uppercase text-gray-500">State <span className="text-gray-300 normal-case font-normal">(optional)</span></label>
                  <input
                    type="text"
                    placeholder="IL"
                    maxLength={2}
                    value={orgState}
                    onChange={e => setOrgState(e.target.value.toUpperCase())}
                    className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm outline-none placeholder:text-gray-400 focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-500/20 transition-all"
                  />
                </div>
              </div>

              {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

              <div className="flex gap-3">
                <button type="button" onClick={back}
                  className="flex items-center gap-1.5 rounded-xl border border-gray-200 px-5 py-3 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-all">
                  <ArrowLeft className="h-4 w-4" /> Back
                </button>
                <button type="button" onClick={next}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold text-white transition-all"
                  style={{ background: "hsl(217 91% 32%)" }}>
                  Continue <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {/* ── STEP 1 (CARRIER only): Company details ── */}
          {step === 1 && isCarrier && (
            <div className="space-y-5">
              <div className="flex items-center gap-2 rounded-xl bg-indigo-50 border border-indigo-100 px-4 py-3">
                <Building2 className="h-4 w-4 text-indigo-600 shrink-0" />
                <p className="text-sm text-indigo-700 font-medium">
                  You'll be the Owner/admin of your carrier company. You can onboard drivers — directly or by
                  invite — once your account is set up.
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="block text-[11px] font-semibold tracking-[0.12em] uppercase text-gray-500">
                  Company Legal Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  placeholder="Acme Trucking LLC"
                  value={carrierLegalName}
                  onChange={e => setCarrierLegalName(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-500/20 transition-all"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-[11px] font-semibold tracking-[0.12em] uppercase text-gray-500">
                  DBA <span className="text-gray-300 normal-case font-normal">(optional)</span>
                </label>
                <input
                  type="text"
                  placeholder="Doing-business-as name, if different"
                  value={carrierDba}
                  onChange={e => setCarrierDba(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-500/20 transition-all"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="block text-[11px] font-semibold tracking-[0.12em] uppercase text-gray-500">
                    MC # <span className="text-gray-300 normal-case font-normal">(optional)</span>
                  </label>
                  <input
                    type="text"
                    placeholder="MC-123456"
                    value={carrierMc}
                    onChange={e => setCarrierMc(e.target.value)}
                    className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm outline-none placeholder:text-gray-400 focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-500/20 transition-all"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-[11px] font-semibold tracking-[0.12em] uppercase text-gray-500">
                    DOT # <span className="text-gray-300 normal-case font-normal">(optional)</span>
                  </label>
                  <input
                    type="text"
                    placeholder="1234567"
                    value={carrierDot}
                    onChange={e => setCarrierDot(e.target.value)}
                    className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm outline-none placeholder:text-gray-400 focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-500/20 transition-all"
                  />
                </div>
              </div>
              <p className="text-xs text-gray-400">
                MC/DOT can also be added later before submitting company verification.
              </p>

              {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

              <div className="flex gap-3">
                <button type="button" onClick={back}
                  className="flex items-center gap-1.5 rounded-xl border border-gray-200 px-5 py-3 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-all">
                  <ArrowLeft className="h-4 w-4" /> Back
                </button>
                <button type="button" onClick={next}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold text-white transition-all"
                  style={{ background: "hsl(217 91% 32%)" }}>
                  Continue <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {/* ── STEP 2b (SHIPPER only): Shipper profile ── */}
          {step === 2 && needsShipperProfile && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 rounded-xl bg-violet-50 border border-violet-100 px-4 py-3">
                <PackagePlus className="h-4 w-4 text-violet-600 shrink-0" />
                <p className="text-sm text-violet-700 font-medium">
                  This info lets drivers and receivers contact your operations team. It will appear on Bills of Lading.
                </p>
              </div>

              {/* Company name */}
              <div className="space-y-1.5">
                <label className="block text-[11px] font-semibold tracking-[0.12em] uppercase text-gray-500">
                  Company Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  placeholder="Acme Freight LLC"
                  value={companyName}
                  onChange={e => setCompanyName(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-500/20 transition-all"
                />
              </div>

              {/* Company address */}
              <div className="space-y-1.5">
                <label className="block text-[11px] font-semibold tracking-[0.12em] uppercase text-gray-500">
                  Company Address <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <MapPin className="absolute left-3 top-3.5 h-4 w-4 text-gray-400 pointer-events-none" />
                  <input
                    type="text"
                    placeholder="123 Main St, Chicago, IL 60601"
                    value={companyAddress}
                    onChange={e => setCompanyAddress(e.target.value)}
                    className="w-full rounded-xl border border-gray-200 bg-gray-50 pl-9 pr-4 py-3 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-500/20 transition-all"
                  />
                </div>
              </div>

              {/* Contact name */}
              <div className="space-y-1.5">
                <label className="block text-[11px] font-semibold tracking-[0.12em] uppercase text-gray-500">
                  Operations Contact Name <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <User className="absolute left-3 top-3.5 h-4 w-4 text-gray-400 pointer-events-none" />
                  <input
                    type="text"
                    placeholder="Jane Smith"
                    value={contactName}
                    onChange={e => setContactName(e.target.value)}
                    className="w-full rounded-xl border border-gray-200 bg-gray-50 pl-9 pr-4 py-3 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-500/20 transition-all"
                  />
                </div>
              </div>

              {/* Contact phone + email */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="block text-[11px] font-semibold tracking-[0.12em] uppercase text-gray-500">
                    Phone <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-3.5 h-4 w-4 text-gray-400 pointer-events-none" />
                    <input
                      type="tel"
                      placeholder="+1 (312) 555-0100"
                      value={contactPhone}
                      onChange={e => setContactPhone(e.target.value)}
                      className="w-full rounded-xl border border-gray-200 bg-gray-50 pl-9 pr-4 py-3 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-500/20 transition-all"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="block text-[11px] font-semibold tracking-[0.12em] uppercase text-gray-500">
                    Ops Email <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-3.5 h-4 w-4 text-gray-400 pointer-events-none" />
                    <input
                      type="email"
                      placeholder="ops@example.com"
                      value={contactEmail}
                      onChange={e => setContactEmail(e.target.value)}
                      className="w-full rounded-xl border border-gray-200 bg-gray-50 pl-9 pr-4 py-3 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-500/20 transition-all"
                    />
                  </div>
                </div>
              </div>

              {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

              <div className="flex gap-3 pt-1">
                <button type="button" onClick={back}
                  className="flex items-center gap-1.5 rounded-xl border border-gray-200 px-5 py-3 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-all">
                  <ArrowLeft className="h-4 w-4" /> Back
                </button>
                <button type="button" onClick={next}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold text-white transition-all"
                  style={{ background: "hsl(217 91% 32%)" }}>
                  Continue <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {/* ── STEP 3 (or 2 for non-SHIPPER): Account credentials ── */}
          {step === accountStep && (
            <form onSubmit={handleSubmit} className="space-y-4">

              {/* Summary card */}
              <div className="flex items-center gap-3 rounded-xl bg-gray-50 border border-gray-100 px-4 py-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary">
                  <role.icon className="h-4 w-4 text-white" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-800">{role.label} account</p>
                  {needsOrg && legalName && (
                    <p className="text-xs text-gray-500 truncate">{legalName}</p>
                  )}
                  {isCarrier && carrierLegalName && (
                    <p className="text-xs text-gray-500 truncate">{carrierLegalName}</p>
                  )}
                </div>
                <button type="button" onClick={() => setStep(0)}
                  className="ml-auto text-xs text-primary hover:underline shrink-0">
                  Change
                </button>
              </div>

              <div className="space-y-1.5">
                <label className="block text-[11px] font-semibold tracking-[0.12em] uppercase text-gray-500">
                  Email Address <span className="text-red-500">*</span>
                </label>
                <input
                  type="email" required autoComplete="email"
                  placeholder="you@example.com"
                  value={email} onChange={e => setEmail(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-500/20 transition-all"
                />
              </div>

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
                  placeholder="Repeat your password"
                  value={confirm} onChange={e => setConfirm(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-500/20 transition-all"
                />
              </div>

              {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

              <div className="flex gap-3 pt-1">
                <button type="button" onClick={back}
                  className="flex items-center gap-1.5 rounded-xl border border-gray-200 px-5 py-3 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-all">
                  <ArrowLeft className="h-4 w-4" /> Back
                </button>
                <button
                  type="submit" disabled={loading}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold text-white transition-all disabled:opacity-60"
                  style={{ background: "hsl(217 91% 32%)" }}>
                  {loading ? "Creating account…" : <>{`Create ${role.label} account`} <ArrowRight className="h-4 w-4" /></>}
                </button>
              </div>

              <p className="text-center text-sm text-gray-500">
                Already have an account?{" "}
                <Link to="/login" className="font-semibold hover:underline" style={{ color: "hsl(217 91% 42%)" }}>
                  Sign in
                </Link>
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
