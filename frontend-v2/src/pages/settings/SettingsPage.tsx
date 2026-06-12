import { useEffect, useState } from "react";
import { Clock, Upload } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import { toast } from "sonner";

// ─── helpers ───────────────────────────────────────────────────────────────

function Field({
  label,
  id,
  required,
  children,
}: {
  label: string;
  id: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </Label>
      {children}
    </div>
  );
}

function SectionCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card shadow-[var(--shadow-soft)] p-6 space-y-5">
      {children}
    </div>
  );
}

const FREIGHT_TYPES = ["DRY_VAN", "REEFER", "FLATBED", "STEP_DECK", "BOX_TRUCK"];

function MultiCheckbox({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const toggle = (opt: string) =>
    onChange(value.includes(opt) ? value.filter((x) => x !== opt) : [...value, opt]);
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => toggle(opt)}
          className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
            value.includes(opt)
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-secondary text-foreground hover:bg-secondary/80"
          }`}
        >
          {opt.replace("_", " ")}
        </button>
      ))}
    </div>
  );
}

// ─── ID Verification ───────────────────────────────────────────────────────

function IDVerification({ userId }: { userId: string }) {
  const key = `ll_id_verif_${userId}`;
  const [status, setStatus] = useState<"NONE" | "PENDING" | "APPROVED">(
    () => (localStorage.getItem(key) as "NONE" | "PENDING" | "APPROVED" | null) ?? "NONE"
  );
  const [step, setStep] = useState(1);
  const [idFile, setIdFile] = useState<File | null>(null);
  const [selfieFile, setSelfieFile] = useState<File | null>(null);

  const submitId = () => {
    if (!idFile) { toast.error("Please upload an ID document."); return; }
    setStep(2);
  };

  const submitSelfie = () => {
    if (!selfieFile) { toast.error("Please upload a selfie."); return; }
    setStep(3);
    setStatus("PENDING");
    localStorage.setItem(key, "PENDING");
  };

  if (status === "PENDING") {
    return (
      <SectionCard>
        <div className="flex flex-col items-center gap-4 py-8 text-center">
          <Clock className="h-10 w-10 text-blue-500" />
          <div>
            <p className="font-semibold">Your ID is under review</p>
            <p className="text-sm text-muted-foreground mt-1">You'll be notified within 24 hours.</p>
          </div>
        </div>
      </SectionCard>
    );
  }

  if (status === "APPROVED") {
    return (
      <SectionCard>
        <div className="flex flex-col items-center gap-4 py-8 text-center">
          <div className="h-10 w-10 rounded-full bg-green-100 flex items-center justify-center text-green-600 text-xl">✓</div>
          <p className="font-semibold text-green-700">ID Verified</p>
        </div>
      </SectionCard>
    );
  }

  return (
    <SectionCard>
      {/* Stepper */}
      <div className="flex items-center gap-3 mb-4">
        {["Upload ID", "Selfie check", "Review"].map((label, i) => {
          const n = i + 1;
          const active = step === n;
          const done = step > n;
          return (
            <div key={label} className="flex items-center gap-2">
              <div
                className={`h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold border-2 ${
                  done
                    ? "border-green-500 bg-green-500 text-white"
                    : active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-secondary text-muted-foreground"
                }`}
              >
                {done ? "✓" : n}
              </div>
              <span className={`text-sm ${active ? "font-semibold" : "text-muted-foreground"}`}>{label}</span>
              {i < 2 && <div className="h-px w-6 bg-border" />}
            </div>
          );
        })}
      </div>

      {step === 1 && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">Upload a government-issued photo ID (driver's license, passport).</p>
          <label className="flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border bg-secondary/40 p-10 cursor-pointer hover:bg-secondary/60 transition-colors">
            <Upload className="h-8 w-8 text-muted-foreground" />
            {idFile ? (
              <span className="text-sm font-medium">{idFile.name}</span>
            ) : (
              <span className="text-sm text-muted-foreground">Click to upload ID (image or PDF)</span>
            )}
            <input
              type="file"
              accept="image/*,application/pdf"
              className="sr-only"
              onChange={(e) => setIdFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <Button onClick={submitId}>Submit for review</Button>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">Take a selfie or upload a recent photo of yourself to confirm your identity.</p>
          <label className="flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border bg-secondary/40 p-10 cursor-pointer hover:bg-secondary/60 transition-colors">
            <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center text-2xl">📷</div>
            {selfieFile ? (
              <span className="text-sm font-medium">{selfieFile.name}</span>
            ) : (
              <span className="text-sm text-muted-foreground">Take a selfie or upload a photo</span>
            )}
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(e) => setSelfieFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <Button onClick={submitSelfie}>Continue</Button>
        </div>
      )}

      {step === 3 && (
        <div className="flex flex-col items-center gap-4 py-8 text-center">
          <Clock className="h-10 w-10 text-blue-500" />
          <div>
            <p className="font-semibold">Your ID is under review</p>
            <p className="text-sm text-muted-foreground mt-1">You'll be notified within 24 hours.</p>
          </div>
        </div>
      )}
    </SectionCard>
  );
}

// ─── Business Verification ─────────────────────────────────────────────────

function BusinessVerification({
  userId,
  role,
  mcNumber,
  dotNumber,
}: {
  userId: string;
  role: string;
  mcNumber?: string;
  dotNumber?: string;
}) {
  const key = `ll_biz_verif_${userId}`;
  const [status, setStatus] = useState<"NONE" | "PENDING">(
    () => (localStorage.getItem(key) as "NONE" | "PENDING" | null) ?? "NONE"
  );
  const [form, setForm] = useState({
    legalBizName: "",
    ein: "",
    bizAddress: "",
    stateOfIncorporation: "",
    yearFounded: "",
    mcNumber: mcNumber ?? "",
    dotNumber: dotNumber ?? "",
  });
  const [file, setFile] = useState<File | null>(null);

  const set = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));

  const submit = () => {
    const missing: string[] = [];
    if (!form.legalBizName) missing.push("Legal Business Name");
    if (!form.ein) missing.push("EIN");
    if (!form.bizAddress) missing.push("Business Address");
    if (!form.stateOfIncorporation) missing.push("State of Incorporation");
    if (!form.yearFounded) missing.push("Year Founded");
    if (!file) missing.push("Business document");
    if (missing.length) { toast.error(`Required: ${missing.join(", ")}`); return; }
    localStorage.setItem(key, "PENDING");
    setStatus("PENDING");
    toast.success("Business verification submitted!");
  };

  if (status === "PENDING") {
    return (
      <SectionCard>
        <div className="flex flex-col items-center gap-4 py-8 text-center">
          <Clock className="h-10 w-10 text-blue-500" />
          <div>
            <p className="font-semibold">Business verification pending</p>
            <p className="text-sm text-muted-foreground mt-1">Usually 1–2 business days.</p>
          </div>
        </div>
      </SectionCard>
    );
  }

  return (
    <SectionCard>
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Legal Business Name" id="lbn" required>
          <Input id="lbn" required value={form.legalBizName} onChange={(e) => set("legalBizName", e.target.value)} />
        </Field>
        <Field label="EIN (XX-XXXXXXX)" id="ein" required>
          <Input id="ein" required placeholder="12-3456789" value={form.ein} onChange={(e) => set("ein", e.target.value)} />
        </Field>
        <Field label="Business Address" id="bizAddr" required>
          <Input id="bizAddr" required value={form.bizAddress} onChange={(e) => set("bizAddress", e.target.value)} />
        </Field>
        <Field label="State of Incorporation" id="soi" required>
          <Input id="soi" required value={form.stateOfIncorporation} onChange={(e) => set("stateOfIncorporation", e.target.value)} />
        </Field>
        <Field label="Year Founded" id="yf" required>
          <Input id="yf" required type="number" placeholder="2010" value={form.yearFounded} onChange={(e) => set("yearFounded", e.target.value)} />
        </Field>
        {role === "DRIVER" && (
          <>
            <Field label="MC Number" id="bizMc">
              <Input id="bizMc" value={form.mcNumber} onChange={(e) => set("mcNumber", e.target.value)} />
            </Field>
            <Field label="DOT Number" id="bizDot">
              <Input id="bizDot" value={form.dotNumber} onChange={(e) => set("dotNumber", e.target.value)} />
            </Field>
          </>
        )}
      </div>
      <div>
        <Label>Articles of Incorporation or Business License <span className="text-destructive">*</span></Label>
        <label className="mt-1.5 flex items-center gap-3 rounded-xl border-2 border-dashed border-border bg-secondary/40 p-6 cursor-pointer hover:bg-secondary/60 transition-colors">
          <Upload className="h-5 w-5 text-muted-foreground shrink-0" />
          {file ? (
            <span className="text-sm font-medium">{file.name}</span>
          ) : (
            <span className="text-sm text-muted-foreground">Upload document (image or PDF)</span>
          )}
          <input
            type="file"
            accept="image/*,application/pdf"
            className="sr-only"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
      </div>
      <Button onClick={submit}>Submit for review</Button>
    </SectionCard>
  );
}

// ─── Driver Settings ────────────────────────────────────────────────────────

function DriverSettings({ userId }: { userId: string }) {
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [profile, setProfile] = useState<Record<string, string>>({
    firstName: "", lastName: "", legalName: "", fullName: "", phone: "", dob: "", licenseNumber: "",
    licenseState: "", cdlClass: "", driverType: "", experienceYears: "", carrierId: "",
    truckMake: "", truckModel: "", truckYear: "", truckVIN: "", trailerType: "",
    maxCapacityLbs: "", mcNumber: "", dotNumber: "", authorityStartDate: "",
    mcIssueDate: "", medicalCertExpiration: "",
    insuranceProvider: "", policyNumber: "", autoLiabilityAmount: "",
    cargoCoverageAmount: "", policyExpirationDate: "",
  });

  useEffect(() => {
    api.getDriverProfile()
      .then((r) => {
        if (r.driver) {
          const d = r.driver;
          const merged = Object.fromEntries(Object.entries(d).map(([k, v]) => [k, String(v ?? "")]));
          // Split fullName back into firstName / lastName if not already stored separately
          if (!merged.firstName && merged.fullName) {
            const parts = merged.fullName.trim().split(" ");
            merged.firstName = parts[0] || "";
            merged.lastName = parts.slice(1).join(" ") || "";
          }
          setProfile((p) => ({ ...p, ...merged }));
        } else {
          setIsNew(true);
        }
      })
      .catch((e: any) => {
        if (e.message?.includes("404")) setIsNew(true);
        else toast.error(e.message);
      });
  }, []);

  const set = (k: string, v: string) => setProfile((p) => ({ ...p, [k]: v }));

  const save = async (fields: string[]) => {
    setSaving(true);
    try {
      const data: Record<string, string | number> = {};
      fields.forEach((f) => {
        const v = profile[f];
        if (v !== undefined && v !== "") data[f] = v;
      });
      // Derive fullName and legalName from firstName + lastName for backend compatibility
      if (profile.firstName || profile.lastName) {
        const full = [profile.firstName, profile.lastName].filter(Boolean).join(" ");
        data.fullName = full;
        data.legalName = full;
      }
      if (isNew) {
        await api.createDriverProfile(data);
        setIsNew(false);
        toast.success("Profile created!");
      } else {
        await api.updateDriverProfile(data);
        toast.success("Changes saved!");
      }
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  // required field lists per tab
  const REQUIRED_PROFILE = ["firstName", "lastName", "phone", "dob", "licenseNumber", "licenseState", "cdlClass", "driverType", "experienceYears", "carrierId"];
  const REQUIRED_EQUIP   = ["truckMake", "truckModel", "truckYear", "truckVIN", "trailerType", "maxCapacityLbs"];
  const REQUIRED_AUTH    = ["mcNumber", "dotNumber", "authorityStartDate", "mcIssueDate", "medicalCertExpiration"];

  const FIELD_LABELS: Record<string, string> = {
    firstName: "First Name", lastName: "Last Name", legalName: "Legal Name", fullName: "Full Name", phone: "Phone", dob: "Date of Birth",
    licenseNumber: "License Number", licenseState: "License State", cdlClass: "CDL Class",
    driverType: "Driver Type", experienceYears: "Years of Experience", carrierId: "Carrier ID",
    truckMake: "Truck Make", truckModel: "Truck Model", truckYear: "Truck Year", truckVIN: "Truck VIN",
    trailerType: "Trailer Type", maxCapacityLbs: "Max Capacity",
    mcNumber: "MC Number", dotNumber: "DOT Number", authorityStartDate: "Authority Start Date",
    mcIssueDate: "MC Issue Date", medicalCertExpiration: "Medical Cert Expiration",
  };

  const validate = (required: string[]) => {
    const missing = required.filter((f) => !profile[f] || profile[f] === "").map((f) => FIELD_LABELS[f] ?? f);
    if (missing.length) { toast.error(`Required fields missing: ${missing.join(", ")}`); return false; }
    return true;
  };

  const profileFields = [...REQUIRED_PROFILE];
  const equipFields   = [...REQUIRED_EQUIP];
  const authFields    = [...REQUIRED_AUTH, "insuranceProvider", "policyNumber", "autoLiabilityAmount", "cargoCoverageAmount", "policyExpirationDate"];

  const inp = (id: string, label: string, type = "text", placeholder = "", req = false) => (
    <Field label={label} id={id} required={req}>
      <Input id={id} type={type} placeholder={placeholder} required={req} value={profile[id] ?? ""} onChange={(e) => set(id, e.target.value)} />
    </Field>
  );

  return (
    <Tabs defaultValue="profile" orientation="vertical" className="flex gap-6">
      <TabsList className="flex flex-col h-auto w-48 shrink-0 rounded-xl bg-secondary p-1 gap-1">
        <TabsTrigger value="profile" className="w-full justify-start rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm">Profile</TabsTrigger>
        <TabsTrigger value="equipment" className="w-full justify-start rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm">Equipment</TabsTrigger>
        <TabsTrigger value="authority" className="w-full justify-start rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm">Authority & Insurance</TabsTrigger>
        <TabsTrigger value="id" className="w-full justify-start rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm">ID Verification</TabsTrigger>
        <TabsTrigger value="biz" className="w-full justify-start rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm">Business Verification</TabsTrigger>
      </TabsList>

      <div className="flex-1 min-w-0">
        <TabsContent value="profile">
          <SectionCard>
            <p className="text-xs text-muted-foreground">Fields marked <span className="text-destructive font-semibold">*</span> are required.</p>
            <div className="grid sm:grid-cols-2 gap-4">
              {inp("firstName", "First Name", "text", "", true)}
              {inp("lastName", "Last Name", "text", "", true)}
              {inp("phone", "Phone", "tel", "", true)}
              {inp("dob", "Date of Birth", "date", "", true)}
              {inp("licenseNumber", "License Number", "text", "", true)}
              {inp("licenseState", "License State (2-letter)", "text", "IL", true)}
              <Field label="CDL Class" id="cdlClass" required>
                <Select value={profile.cdlClass} onValueChange={(v) => set("cdlClass", v)}>
                  <SelectTrigger id="cdlClass"><SelectValue placeholder="Select class" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="A">Class A</SelectItem>
                    <SelectItem value="B">Class B</SelectItem>
                    <SelectItem value="C">Class C</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              {inp("driverType", "Driver Type", "text", "e.g. OTR, LOCAL", true)}
              {inp("experienceYears", "Years of Experience", "number", "", true)}
              {inp("carrierId", "Carrier ID", "text", "", true)}
            </div>
            <Button disabled={saving} onClick={() => { if (validate(REQUIRED_PROFILE)) save(profileFields); }}>
              {isNew ? "Create profile" : "Save changes"}
            </Button>
          </SectionCard>
        </TabsContent>

        <TabsContent value="equipment">
          <SectionCard>
            <p className="text-xs text-muted-foreground">Fields marked <span className="text-destructive font-semibold">*</span> are required.</p>
            <div className="grid sm:grid-cols-2 gap-4">
              {inp("truckMake", "Truck Make", "text", "", true)}
              {inp("truckModel", "Truck Model", "text", "", true)}
              {inp("truckYear", "Truck Year", "number", "", true)}
              {inp("truckVIN", "Truck VIN (17 chars)", "text", "1FUJGBDV1CLBA0001", true)}
              <Field label="Trailer Type" id="trailerType" required>
                <Select value={profile.trailerType} onValueChange={(v) => set("trailerType", v)}>
                  <SelectTrigger id="trailerType"><SelectValue placeholder="Select type" /></SelectTrigger>
                  <SelectContent>
                    {FREIGHT_TYPES.map((t) => <SelectItem key={t} value={t}>{t.replace("_", " ")}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              {inp("maxCapacityLbs", "Max Capacity (lbs)", "number", "", true)}
            </div>
            <Button disabled={saving} onClick={() => { if (validate(REQUIRED_EQUIP)) save(equipFields); }}>
              {isNew ? "Save equipment" : "Save changes"}
            </Button>
          </SectionCard>
        </TabsContent>

        <TabsContent value="authority">
          <SectionCard>
            <p className="text-xs text-muted-foreground">Fields marked <span className="text-destructive font-semibold">*</span> are required. Insurance fields are optional.</p>
            <div className="grid sm:grid-cols-2 gap-4">
              {inp("mcNumber", "MC Number", "text", "", true)}
              {inp("dotNumber", "DOT Number", "text", "", true)}
              {inp("authorityStartDate", "Authority Start Date", "date", "", true)}
              {inp("mcIssueDate", "MC Issue Date", "date", "", true)}
              {inp("medicalCertExpiration", "Medical Cert Expiration", "date", "", true)}
              {inp("insuranceProvider", "Insurance Provider")}
              {inp("policyNumber", "Policy Number")}
              {inp("autoLiabilityAmount", "Auto Liability ($)", "number")}
              {inp("cargoCoverageAmount", "Cargo Coverage ($)", "number")}
              {inp("policyExpirationDate", "Policy Expiration Date", "date")}
            </div>
            <Button disabled={saving} onClick={() => { if (validate(REQUIRED_AUTH)) save(authFields); }}>
              {isNew ? "Save authority" : "Save changes"}
            </Button>
          </SectionCard>
        </TabsContent>

        <TabsContent value="id">
          <IDVerification userId={userId} />
        </TabsContent>

        <TabsContent value="biz">
          <BusinessVerification
            userId={userId}
            role="DRIVER"
            mcNumber={profile.mcNumber}
            dotNumber={profile.dotNumber}
          />
        </TabsContent>
      </div>
    </Tabs>
  );
}

// ─── Shipper Settings ───────────────────────────────────────────────────────

function ShipperSettings({ userId }: { userId: string }) {
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [profile, setProfile] = useState<Record<string, any>>({
    companyName: "", companyAddress: "", legalName: "", city: "", state: "", zip: "",
    contactName: "", contactPhone: "", contactEmail: "", orgId: "", billingTerms: "",
    freightTypes: [] as string[], avgMonthlyVolume: "", preferredEquipment: [] as string[],
    defaultBroadcastRadius: "", defaultMinMcMaturity: "",
  });

  useEffect(() => {
    api.getShipperProfile()
      .then((r) => {
        if (r.shipper) {
          setProfile((p) => ({ ...p, ...r.shipper }));
        } else {
          setIsNew(true);
        }
      })
      .catch((e: any) => {
        if (e.message?.includes("404")) setIsNew(true);
        else toast.error(e.message);
      });
  }, []);

  const set = (k: string, v: unknown) => setProfile((p: Record<string, any>) => ({ ...p, [k]: v }));

  const REQUIRED_COMPANY = ["companyName", "companyAddress", "contactName", "contactPhone", "contactEmail", "orgId", "billingTerms"];
  const REQUIRED_OPS = ["freightTypes", "avgMonthlyVolume", "preferredEquipment"];

  const SHIPPER_LABELS: Record<string, string> = {
    companyName: "Company Name", companyAddress: "Address", contactName: "Contact Name",
    contactPhone: "Contact Phone", contactEmail: "Contact Email", orgId: "Org ID",
    billingTerms: "Billing Terms", freightTypes: "Freight Types",
    avgMonthlyVolume: "Avg Monthly Volume", preferredEquipment: "Preferred Equipment",
  };

  const validateShipper = (required: string[]) => {
    const missing = required.filter((f) => {
      const v = profile[f];
      if (Array.isArray(v)) return v.length === 0;
      return !v || v === "";
    }).map((f) => SHIPPER_LABELS[f] ?? f);
    if (missing.length) { toast.error(`Required fields missing: ${missing.join(", ")}`); return false; }
    return true;
  };

  const save = async (fields: string[]) => {
    setSaving(true);
    try {
      const data: Record<string, unknown> = {};
      fields.forEach((f) => { if (profile[f] !== undefined) data[f] = profile[f]; });
      if (isNew) {
        await api.createShipperProfile(data);
        setIsNew(false);
        toast.success("Profile created!");
      } else {
        await api.updateShipperProfile(data);
        toast.success("Changes saved!");
      }
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const inp = (id: string, label: string, type = "text", req = false) => (
    <Field label={label} id={id} required={req}>
      <Input id={id} type={type} required={req} value={profile[id] ?? ""} onChange={(e) => set(id, e.target.value)} />
    </Field>
  );

  const companyFields = ["companyName", "companyAddress", "legalName", "city", "state", "zip", "contactName", "contactPhone", "contactEmail", "orgId", "billingTerms"];
  const opsFields = ["freightTypes", "avgMonthlyVolume", "preferredEquipment", "defaultBroadcastRadius", "defaultMinMcMaturity"];

  return (
    <Tabs defaultValue="company" orientation="vertical" className="flex gap-6">
      <TabsList className="flex flex-col h-auto w-48 shrink-0 rounded-xl bg-secondary p-1 gap-1">
        <TabsTrigger value="company" className="w-full justify-start rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm">Company</TabsTrigger>
        <TabsTrigger value="operations" className="w-full justify-start rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm">Operations</TabsTrigger>
        <TabsTrigger value="id" className="w-full justify-start rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm">ID Verification</TabsTrigger>
        <TabsTrigger value="biz" className="w-full justify-start rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm">Business Verification</TabsTrigger>
      </TabsList>

      <div className="flex-1 min-w-0">
        <TabsContent value="company">
          <SectionCard>
            <p className="text-xs text-muted-foreground">Fields marked <span className="text-destructive font-semibold">*</span> are required.</p>
            <div className="grid sm:grid-cols-2 gap-4">
              {inp("companyName", "Company Name", "text", true)}
              {inp("legalName", "Legal Name")}
              {inp("companyAddress", "Address", "text", true)}
              {inp("city", "City")}
              {inp("state", "State (2-letter)")}
              {inp("zip", "ZIP")}
              {inp("contactName", "Contact Name", "text", true)}
              {inp("contactPhone", "Contact Phone", "tel", true)}
              {inp("contactEmail", "Contact Email", "email", true)}
              {inp("orgId", "Org ID", "text", true)}
              {inp("billingTerms", "Billing Terms", "text", true)}
            </div>
            <Button disabled={saving} onClick={() => { if (validateShipper(REQUIRED_COMPANY)) save(companyFields); }}>
              {isNew ? "Create profile" : "Save changes"}
            </Button>
          </SectionCard>
        </TabsContent>

        <TabsContent value="operations">
          <SectionCard>
            <p className="text-xs text-muted-foreground">Fields marked <span className="text-destructive font-semibold">*</span> are required.</p>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Freight Types <span className="text-destructive">*</span></Label>
                <MultiCheckbox
                  options={FREIGHT_TYPES}
                  value={profile.freightTypes ?? []}
                  onChange={(v) => set("freightTypes", v)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Preferred Equipment <span className="text-destructive">*</span></Label>
                <MultiCheckbox
                  options={FREIGHT_TYPES}
                  value={profile.preferredEquipment ?? []}
                  onChange={(v) => set("preferredEquipment", v)}
                />
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <Field label="Avg Monthly Volume (loads)" id="avgMonthlyVolume" required>
                  <Input id="avgMonthlyVolume" type="number" required value={profile.avgMonthlyVolume ?? ""} onChange={(e) => set("avgMonthlyVolume", e.target.value)} />
                </Field>
                <Field label="Default Broadcast Radius (mi)" id="defaultBroadcastRadius">
                  <Input id="defaultBroadcastRadius" type="number" value={profile.defaultBroadcastRadius ?? ""} onChange={(e) => set("defaultBroadcastRadius", e.target.value)} />
                </Field>
                <Field label="Min MC Maturity (months)" id="defaultMinMcMaturity">
                  <Input id="defaultMinMcMaturity" type="number" value={profile.defaultMinMcMaturity ?? ""} onChange={(e) => set("defaultMinMcMaturity", e.target.value)} />
                </Field>
              </div>
            </div>
            <Button disabled={saving} onClick={() => { if (validateShipper(REQUIRED_OPS)) save(opsFields); }}>
              {isNew ? "Save operations" : "Save changes"}
            </Button>
          </SectionCard>
        </TabsContent>

        <TabsContent value="id">
          <IDVerification userId={userId} />
        </TabsContent>

        <TabsContent value="biz">
          <BusinessVerification userId={userId} role="SHIPPER" />
        </TabsContent>
      </div>
    </Tabs>
  );
}

// ─── Receiver Settings ──────────────────────────────────────────────────────

function ReceiverSettings({ userId }: { userId: string }) {
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [profile, setProfile] = useState<Record<string, any>>({
    facilityName: "", facilityAddress: "", contactName: "", contactPhone: "",
    contactEmail: "", orgId: "", dockType: "", appointmentRequired: false,
    receivingHours: "",
  });

  useEffect(() => {
    api.getReceiverProfile()
      .then((r) => {
        if (r.receiver) {
          setProfile((p) => ({ ...p, ...r.receiver }));
        } else {
          setIsNew(true);
        }
      })
      .catch((e: any) => {
        if (e.message?.includes("404")) setIsNew(true);
        else toast.error(e.message);
      });
  }, []);

  const set = (k: string, v: unknown) => setProfile((p: Record<string, any>) => ({ ...p, [k]: v }));

  const REQUIRED_FACILITY = ["facilityName", "facilityAddress", "contactName", "contactPhone", "contactEmail", "orgId", "dockType", "receivingHours"];
  const RECEIVER_LABELS: Record<string, string> = {
    facilityName: "Facility Name", facilityAddress: "Facility Address", contactName: "Contact Name",
    contactPhone: "Contact Phone", contactEmail: "Contact Email", orgId: "Org ID",
    dockType: "Dock Type", receivingHours: "Receiving Hours",
  };

  const validateReceiver = () => {
    const missing = REQUIRED_FACILITY.filter((f) => !profile[f] || profile[f] === "").map((f) => RECEIVER_LABELS[f] ?? f);
    if (missing.length) { toast.error(`Required fields missing: ${missing.join(", ")}`); return false; }
    return true;
  };

  const save = async () => {
    if (!validateReceiver()) return;
    setSaving(true);
    try {
      const data = { ...profile };
      if (isNew) {
        await api.createReceiverProfile(data);
        setIsNew(false);
        toast.success("Profile created!");
      } else {
        await api.updateReceiverProfile(data);
        toast.success("Changes saved!");
      }
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const inp = (id: string, label: string, type = "text", req = false) => (
    <Field label={label} id={id} required={req}>
      <Input id={id} type={type} required={req} value={profile[id] ?? ""} onChange={(e) => set(id, e.target.value)} />
    </Field>
  );

  return (
    <Tabs defaultValue="facility" orientation="vertical" className="flex gap-6">
      <TabsList className="flex flex-col h-auto w-48 shrink-0 rounded-xl bg-secondary p-1 gap-1">
        <TabsTrigger value="facility" className="w-full justify-start rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm">Facility</TabsTrigger>
        <TabsTrigger value="id" className="w-full justify-start rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm">ID Verification</TabsTrigger>
        <TabsTrigger value="biz" className="w-full justify-start rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm">Business Verification</TabsTrigger>
      </TabsList>

      <div className="flex-1 min-w-0">
        <TabsContent value="facility">
          <SectionCard>
            <p className="text-xs text-muted-foreground">Fields marked <span className="text-destructive font-semibold">*</span> are required.</p>
            <div className="grid sm:grid-cols-2 gap-4">
              {inp("facilityName", "Facility Name", "text", true)}
              {inp("facilityAddress", "Facility Address", "text", true)}
              {inp("contactName", "Contact Name", "text", true)}
              {inp("contactPhone", "Contact Phone", "tel", true)}
              {inp("contactEmail", "Contact Email", "email", true)}
              {inp("orgId", "Org ID", "text", true)}
              {inp("dockType", "Dock Type", "text", true)}
            </div>
            <div className="flex items-center gap-3">
              <Switch
                id="appointmentRequired"
                checked={!!profile.appointmentRequired}
                onCheckedChange={(v) => set("appointmentRequired", v)}
              />
              <Label htmlFor="appointmentRequired">Appointment Required</Label>
            </div>
            <Field label="Receiving Hours" id="receivingHours" required>
              <Input id="receivingHours" required placeholder="e.g. Mon–Fri 7AM–5PM" value={profile.receivingHours ?? ""} onChange={(e) => set("receivingHours", e.target.value)} />
            </Field>
            <Button disabled={saving} onClick={save}>
              {isNew ? "Create profile" : "Save changes"}
            </Button>
          </SectionCard>
        </TabsContent>

        <TabsContent value="id">
          <IDVerification userId={userId} />
        </TabsContent>

        <TabsContent value="biz">
          <BusinessVerification userId={userId} role="RECEIVER" />
        </TabsContent>
      </div>
    </Tabs>
  );
}

// ─── Admin Settings ─────────────────────────────────────────────────────────

function AdminSettings({ email }: { email: string }) {
  return (
    <Tabs defaultValue="account" orientation="vertical" className="flex gap-6">
      <TabsList className="flex flex-col h-auto w-48 shrink-0 rounded-xl bg-secondary p-1 gap-1">
        <TabsTrigger value="account" className="w-full justify-start rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm">Account</TabsTrigger>
      </TabsList>
      <div className="flex-1 min-w-0">
        <TabsContent value="account">
          <SectionCard>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between py-2 border-b border-border">
                <span className="text-muted-foreground">Email</span>
                <span className="font-semibold">{email}</span>
              </div>
              <div className="flex justify-between py-2">
                <span className="text-muted-foreground">Role</span>
                <span className="font-semibold">ADMIN</span>
              </div>
            </div>
          </SectionCard>
        </TabsContent>
      </div>
    </Tabs>
  );
}

// ─── Main page ──────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const { user } = useAuth();

  if (!user) return null;

  return (
    <>
      <PageHeader eyebrow="Account" title="Settings" subtitle="Manage your profile, verification, and account preferences." />
      <div className="mt-6">
        {user.role === "DRIVER" && <DriverSettings userId={user.userId} />}
        {user.role === "SHIPPER" && <ShipperSettings userId={user.userId} />}
        {user.role === "RECEIVER" && <ReceiverSettings userId={user.userId} />}
        {user.role === "ADMIN" && <AdminSettings email={user.email} />}
      </div>
    </>
  );
}
