import React, { useEffect, useRef, useState, useCallback } from "react";
import { Camera, Clock, Upload, Building2, Users, Mail, CheckSquare, Square, Loader2, Plus, Trash2, Badge } from "lucide-react";
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
import { SecuritySettings } from "@/components/SecuritySettings";
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

const TRAILER_TYPES: { value: string; label: string; group: string }[] = [
  // Enclosed
  { value: "DRY_VAN",    label: "Dry Van",                  group: "Enclosed" },
  { value: "REEFER",     label: "Refrigerated (Reefer)",    group: "Enclosed" },
  { value: "BOX_TRUCK",  label: "Box Truck (Straight)",     group: "Enclosed" },
  // Open-deck
  { value: "FLATBED",    label: "Flatbed",                  group: "Open-Deck" },
  { value: "STEP_DECK",  label: "Step Deck (Drop Deck)",    group: "Open-Deck" },
  { value: "RGN",        label: "Removable Gooseneck (RGN)", group: "Open-Deck" },
  { value: "CONESTOGA",  label: "Conestoga",                group: "Open-Deck" },
  // Specialized
  { value: "TANKER",     label: "Tanker",                   group: "Specialized" },
  { value: "CAR_HAULER", label: "Car Hauler",               group: "Specialized" },
  { value: "POWER_ONLY", label: "Power Only",               group: "Specialized" },
];

/** Legacy list used by MultiCheckbox (shipper preferred equipment) */
const FREIGHT_TYPES = TRAILER_TYPES.map((t) => t.value);

const OPEN_DECK_TYPES = ["FLATBED", "STEP_DECK", "RGN", "CONESTOGA"];
const SECUREMENT_OPTIONS = ["TARPS", "STRAPS", "CHAINS", "BINDERS", "EDGE_PROTECTORS"];

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

// ─── Headshot Uploader ─────────────────────────────────────────────────────

function HeadshotUploader() {
  const { user, setHeadshotUrl } = useAuth();
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<string | null>(user?.headshotUrl ?? null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    if (!file.type.startsWith("image/")) { toast.error("Please select an image file."); return; }
    setUploading(true);
    try {
      const localPreview = URL.createObjectURL(file);
      setPreview(localPreview);
      const { uploadUrl, publicUrl } = await api.getHeadshotUploadUrl(file.type);
      await fetch(uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
      setHeadshotUrl(publicUrl);
      await api.updateDriverProfile({ headshotUrl: publicUrl });
      toast.success("Profile photo updated!");
    } catch (e: any) {
      toast.error("Upload failed: " + e.message);
      setPreview(user?.headshotUrl ?? null);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex flex-col items-center gap-3 pb-4 border-b border-border">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="relative group h-28 w-28 rounded-full overflow-hidden border-2 border-border bg-secondary hover:border-primary transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        aria-label="Upload profile photo"
      >
        {preview ? (
          <img src={preview} alt="Profile headshot" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            <Camera className="h-8 w-8" />
          </div>
        )}
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
          <Camera className="h-6 w-6 text-white" />
        </div>
        {uploading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60">
            <div className="h-5 w-5 rounded-full border-2 border-white border-t-transparent animate-spin" />
          </div>
        )}
      </button>
      <p className="text-xs text-muted-foreground text-center">Click to upload photo</p>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
      />
    </div>
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
  const LOADING_CAPS     = ["dockHeightCompatible","liftgateEquipped","palletJackOnboard","tempRangeMin","tempRangeMax","securementGear"];
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
      <div className="flex flex-col w-48 shrink-0 gap-3">
        <div className="rounded-xl bg-secondary p-3">
          <HeadshotUploader />
        </div>
        <TabsList className="flex flex-col h-auto w-full rounded-xl bg-secondary p-1 gap-1">
          <TabsTrigger value="profile" className="w-full justify-start rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm">Profile</TabsTrigger>
          <TabsTrigger value="equipment" className="w-full justify-start rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm">Equipment</TabsTrigger>
          <TabsTrigger value="authority" className="w-full justify-start rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm">Authority & Insurance</TabsTrigger>
          <TabsTrigger value="id" className="w-full justify-start rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm">ID Verification</TabsTrigger>
          <TabsTrigger value="biz" className="w-full justify-start rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm">Business Verification</TabsTrigger>
          <TabsTrigger value="organisation" className="w-full justify-start rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm">Organisation</TabsTrigger>
          <TabsTrigger value="security" className="w-full justify-start rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm">Security</TabsTrigger>
        </TabsList>
      </div>

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
                    {["Enclosed", "Open-Deck", "Specialized"].map((group) => (
                      <div key={group}>
                        <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{group}</div>
                        {TRAILER_TYPES.filter((t) => t.group === group).map((t) => (
                          <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                        ))}
                      </div>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              {inp("maxCapacityLbs", "Max Weight Capacity (lbs)", "number", "", true)}
            </div>

            {/* Interior dimensions for volume matching */}
            <div className="pt-2 border-t border-border space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Interior Cargo Dimensions (inches)</p>
              <p className="text-xs text-muted-foreground">Used for volume-based capacity matching alongside weight.</p>
              <div className="grid grid-cols-3 gap-3">
                {inp("interiorLengthIn", "Length (in)", "number", "636")}
                {inp("interiorWidthIn", "Width (in)", "number", "98")}
                {inp("interiorHeightIn", "Height (in)", "number", "110")}
              </div>
              {profile.interiorLengthIn && profile.interiorWidthIn && profile.interiorHeightIn && (
                <p className="text-xs text-muted-foreground">
                  Usable volume: <span className="font-medium text-foreground">
                    {((Number(profile.interiorLengthIn) * Number(profile.interiorWidthIn) * Number(profile.interiorHeightIn)) / 1728).toLocaleString(undefined, { maximumFractionDigits: 0 })} cu ft
                  </span>
                </p>
              )}
            </div>

            {/* Loading capability attributes (spec §11.1) */}
            <div className="pt-2 border-t border-border space-y-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Loading Capabilities</p>
              <div className="grid sm:grid-cols-2 gap-3">
                {[
                  { key: "dockHeightCompatible", label: "Dock-height compatible" },
                  { key: "liftgateEquipped",     label: "Liftgate equipped" },
                  { key: "palletJackOnboard",    label: "Pallet jack onboard" },
                ].map(({ key, label }) => (
                  <label key={key} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2 cursor-pointer hover:bg-secondary/50 transition-colors">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-primary"
                      checked={!!profile[key]}
                      onChange={(e) => set(key, String(e.target.checked))}
                    />
                    <span className="text-sm">{label}</span>
                  </label>
                ))}
              </div>

              {/* Reefer temp range */}
              {profile.trailerType === "REEFER" && (
                <div className="grid grid-cols-2 gap-3">
                  {inp("tempRangeMin", "Min Temp (°F)", "number", "-20")}
                  {inp("tempRangeMax", "Max Temp (°F)", "number", "70")}
                </div>
              )}

              {/* Open-deck securement gear */}
              {OPEN_DECK_TYPES.includes(profile.trailerType) && (
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Securement Gear</Label>
                  <div className="flex flex-wrap gap-2">
                    {SECUREMENT_OPTIONS.map((opt) => {
                      const current: string[] = Array.isArray(profile.securementGear)
                        ? profile.securementGear
                        : (profile.securementGear ? [profile.securementGear] : []);
                      const selected = current.includes(opt);
                      return (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => {
                            const next = selected
                              ? current.filter((x: string) => x !== opt)
                              : [...current, opt];
                            set("securementGear", next as any);
                          }}
                          className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                            selected
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border bg-secondary text-foreground hover:bg-secondary/80"
                          }`}
                        >
                          {opt.replace("_", " ")}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Safety buffer display (read-only for drivers) */}
            <div className="pt-2 border-t border-border space-y-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Safety Buffer</p>
              <p className="text-sm">
                Your effective safety buffer is{" "}
                <span className="font-semibold text-foreground">{profile.safetyBufferPct ?? 10}%</span>
                {" "}— {(profile as any).bufferSetByRole === "OWNER" ? "set by your owner" : "set by your admin"}. This keeps your bookable weight at{" "}
                <span className="font-semibold text-foreground">
                  {profile.maxCapacityLbs
                    ? `${(Number(profile.maxCapacityLbs) * (1 - (Number(profile.safetyBufferPct ?? 10) / 100))).toLocaleString()} lbs`
                    : "—"}
                </span>
                {" "}below your rated capacity.
              </p>
            </div>

            <Button disabled={saving} onClick={() => {
              if (validate(REQUIRED_EQUIP)) save([...equipFields, "interiorLengthIn", "interiorWidthIn", "interiorHeightIn", ...LOADING_CAPS]);
            }}>
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

        <TabsContent value="organisation">
          <OrgTabErrorBoundary><OrgTab callerUserRole="DRIVER" /></OrgTabErrorBoundary>
        </TabsContent>
        <TabsContent value="security">
          <SecuritySettings />
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
        <TabsTrigger value="organisation" className="w-full justify-start rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm">Organisation</TabsTrigger>
        <TabsTrigger value="id" className="w-full justify-start rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm">ID Verification</TabsTrigger>
        <TabsTrigger value="biz" className="w-full justify-start rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm">Business Verification</TabsTrigger>
        <TabsTrigger value="security" className="w-full justify-start rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm">Security</TabsTrigger>
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

        <TabsContent value="organisation">
          <OrgTabErrorBoundary><OrgTab callerUserRole="SHIPPER" /></OrgTabErrorBoundary>
        </TabsContent>

        <TabsContent value="biz">
          <BusinessVerification userId={userId} role="SHIPPER" />
        </TabsContent>
        <TabsContent value="security">
          <SecuritySettings />
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
        <TabsTrigger value="organisation" className="w-full justify-start rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm">Organisation</TabsTrigger>
        <TabsTrigger value="id" className="w-full justify-start rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm">ID Verification</TabsTrigger>
        <TabsTrigger value="biz" className="w-full justify-start rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm">Business Verification</TabsTrigger>
        <TabsTrigger value="security" className="w-full justify-start rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm">Security</TabsTrigger>
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

        <TabsContent value="organisation">
          <OrgTabErrorBoundary><OrgTab callerUserRole="RECEIVER" /></OrgTabErrorBoundary>
        </TabsContent>

        <TabsContent value="biz">
          <BusinessVerification userId={userId} role="RECEIVER" />
        </TabsContent>
        <TabsContent value="security">
          <SecuritySettings />
        </TabsContent>
      </div>
    </Tabs>
  );
}

// ─── Admin Settings ─────────────────────────────────────────────────────────

function AdminSettings({ email }: { email: string }) {
  const { user, updateUser } = useAuth();

  // Account
  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [phone, setPhone]             = useState(user?.phone ?? "");
  const [savingProfile, setSavingProfile] = useState(false);

  // Security
  const [resetSent, setResetSent] = useState(false);
  const [resetting, setResetting] = useState(false);

  // Notifications
  const [notifPending,  setNotifPending]  = useState(true);
  const [notifSignup,   setNotifSignup]   = useState(true);
  const [notifBroadcast,setNotifBroadcast]= useState(false);

  const initials = (user?.displayName ?? email)
    .split(/[\s@]+/).map(p => p[0]?.toUpperCase()).filter(Boolean).slice(0, 2).join("");

  const memberSince = user?.createdAt
    ? new Date(user.createdAt).toLocaleDateString("en-US", { month: "long", year: "numeric" })
    : "—";

  const saveProfile = async () => {
    setSavingProfile(true);
    try {
      const r = await api.updateMe({ displayName: displayName.trim(), phone: phone.trim() });
      updateUser({ displayName: r.user.displayName, phone: r.user.phone });
      toast.success("Profile updated");
    } catch (e: any) { toast.error(e.message ?? "Save failed"); }
    finally { setSavingProfile(false); }
  };

  const sendReset = async () => {
    setResetting(true);
    try {
      await api.forgotPassword(email);
      setResetSent(true);
      toast.success("Password reset link sent");
    } catch (e: any) { toast.error(e.message ?? "Failed to send reset email"); }
    finally { setResetting(false); }
  };

  return (
    <Tabs defaultValue="account" orientation="vertical" className="flex gap-6">

      {/* ── Left panel ── */}
      <div className="flex flex-col w-48 shrink-0 gap-3">
        {/* Avatar card */}
        <div className="rounded-xl bg-secondary p-4 flex flex-col items-center gap-3 text-center">
          <div className="h-16 w-16 rounded-full bg-gradient-to-br from-pink-500 to-violet-600 text-white flex items-center justify-center text-xl font-bold shadow-sm">
            {initials}
          </div>
          <div className="min-w-0 w-full">
            <div className="font-semibold text-sm truncate">
              {user?.displayName || email.split("@")[0]}
            </div>
            <div className="text-xs text-muted-foreground truncate">{email}</div>
            <span className="inline-flex mt-1.5 items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-pink-100 text-pink-700 dark:bg-pink-950/40 dark:text-pink-400">
              ADMIN
            </span>
          </div>
          <div className="text-[10px] text-muted-foreground w-full text-left border-t border-border pt-2 mt-1">
            Member since<br/><span className="font-medium text-foreground">{memberSince}</span>
          </div>
        </div>

        {/* Tab triggers */}
        <TabsList className="flex flex-col h-auto w-full rounded-xl bg-secondary p-1 gap-1">
          <TabsTrigger value="account"       className="w-full justify-start rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm">Account</TabsTrigger>
          <TabsTrigger value="security"      className="w-full justify-start rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm">Security</TabsTrigger>
          <TabsTrigger value="notifications" className="w-full justify-start rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm">Notifications</TabsTrigger>
          <TabsTrigger value="platform"      className="w-full justify-start rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm">Platform</TabsTrigger>
        </TabsList>
      </div>

      <div className="flex-1 min-w-0">

        {/* ── Account ── */}
        <TabsContent value="account">
          <SectionCard>
            <h3 className="text-sm font-semibold mb-4">Profile</h3>
            <div className="grid sm:grid-cols-2 gap-4 mb-6">
              <Field label="Display name" id="adminName">
                <Input id="adminName" placeholder="e.g. Operations Team"
                  value={displayName} onChange={e => setDisplayName(e.target.value)} />
              </Field>
              <Field label="Phone" id="adminPhone">
                <Input id="adminPhone" type="tel" placeholder="+1 (555) 000-0000"
                  value={phone} onChange={e => setPhone(e.target.value)} />
              </Field>
            </div>

            <div className="space-y-0 divide-y divide-border text-sm mb-6">
              <div className="flex justify-between items-center py-3">
                <span className="text-muted-foreground">Email</span>
                <span className="font-medium">{email}</span>
              </div>
              <div className="flex justify-between items-center py-3">
                <span className="text-muted-foreground">Role</span>
                <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-pink-100 text-pink-700 dark:bg-pink-950/40 dark:text-pink-400">ADMIN</span>
              </div>
              <div className="flex justify-between items-center py-3">
                <span className="text-muted-foreground">Access level</span>
                <span className="font-medium">Full platform</span>
              </div>
              <div className="flex justify-between items-center py-3">
                <span className="text-muted-foreground">Permissions</span>
                <div className="flex flex-wrap gap-1 justify-end max-w-xs">
                  {["Verify drivers","Set buffers","Suspend accounts","View all loads","Manage orgs"].map(p => (
                    <span key={p} className="text-[10px] px-2 py-0.5 rounded-full bg-secondary border border-border font-medium">{p}</span>
                  ))}
                </div>
              </div>
              <div className="flex justify-between items-center py-3">
                <span className="text-muted-foreground">Member since</span>
                <span className="font-medium">{memberSince}</span>
              </div>
            </div>

            <Button disabled={savingProfile} onClick={saveProfile} className="h-9">
              {savingProfile ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Saving…</> : "Save profile"}
            </Button>
          </SectionCard>
        </TabsContent>

        {/* ── Security ── */}
        <TabsContent value="security">
          <SecuritySettings />
        </TabsContent>

        {/* ── Notifications ── */}
        <TabsContent value="notifications">
          <SectionCard>
            <h3 className="text-sm font-semibold mb-1">Email notifications</h3>
            <p className="text-xs text-muted-foreground mb-6">
              Alerts sent to <strong>{email}</strong>. You can always manually review in the Operations console.
            </p>
            <div className="space-y-0 divide-y divide-border">
              {[
                { label: "Driver pending verification", desc: "Email me when a new driver signs up and needs review.", value: notifPending, set: setNotifPending },
                { label: "New shipper signup", desc: "Email me when a shipper creates an account.", value: notifSignup, set: setNotifSignup },
                { label: "Broadcast failures", desc: "Email me when a load broadcast reaches zero matched drivers.", value: notifBroadcast, set: setNotifBroadcast },
              ].map(({ label, desc, value, set }) => (
                <div key={label} className="flex items-start justify-between gap-4 py-4">
                  <div>
                    <div className="text-sm font-medium">{label}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{desc}</div>
                  </div>
                  <Switch checked={value} onCheckedChange={set} />
                </div>
              ))}
            </div>
            <div className="mt-4 pt-4 border-t border-border">
              <p className="text-xs text-muted-foreground bg-secondary rounded-lg px-3 py-2">
                Notification delivery requires <code className="font-mono text-[10px]">RESEND_API_KEY</code> to be set in the backend environment.
                Preferences are saved locally in this session — backend persistence coming soon.
              </p>
            </div>
          </SectionCard>
        </TabsContent>

        {/* ── Platform ── */}
        <TabsContent value="platform">
          <SectionCard>
            <h3 className="text-sm font-semibold mb-1">Broadcast matching — server constants</h3>
            <p className="text-xs text-muted-foreground mb-5">
              These values are enforced server-side in <code className="font-mono text-[10px]">broadcastService.ts</code>.
              Change them in the backend config and redeploy. Per-driver buffer overrides are set from the Operations console.
            </p>
            <div className="rounded-lg border border-border divide-y divide-border text-sm">
              {[
                { label: "Minimum cargo insurance", value: "$100,000", hint: "cargoInsuranceAmount threshold in broadcastService" },
                { label: "MC maturity floor", value: "0 days", hint: "Global minimum — individual loads can require more" },
                { label: "Default broadcast radius", value: "250 miles", hint: "Applied when shipper omits broadcastRadiusMiles" },
                { label: "Default safety buffer", value: "10%", hint: "Applied to new driver profiles (safetyBufferPct default)" },
                { label: "Offer TTL", value: "24 hours", hint: "Unaccepted offers expire and trigger rebroadcast" },
                { label: "Rebroadcast interval", value: "5 minutes", hint: "setInterval cadence for rebroadcastExpiredLoads" },
              ].map(({ label, value, hint }) => (
                <div key={label} className="px-4 py-3 flex items-start justify-between gap-4">
                  <div>
                    <div className="font-medium">{label}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{hint}</div>
                  </div>
                  <span className="font-semibold text-primary shrink-0">{value}</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-4 bg-secondary rounded-lg px-3 py-2">
              Per-load overrides (<code className="font-mono text-[10px]">minMcMaturityDays</code>, <code className="font-mono text-[10px]">broadcastRadiusMiles</code>) always take precedence over platform defaults. For production scale, replace the rebroadcast worker with an EventBridge rule or Lambda.
            </p>
          </SectionCard>
        </TabsContent>

      </div>
    </Tabs>
  );
}

// ─── Organisation Tab ────────────────────────────────────────────────────────

class OrgTabErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-5 text-sm text-destructive space-y-2">
          <p className="font-semibold">Organisation tab error</p>
          <p className="font-mono text-xs break-all">{this.state.error.message}</p>
          <p className="text-xs text-muted-foreground">{this.state.error.stack?.split("\n")[1]}</p>
          <button
            className="text-xs underline text-primary"
            onClick={() => this.setState({ error: null })}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const ALL_CAPABILITIES = [
  { key: "CARRIER",  label: "Carrier",  desc: "Move freight — trucks & drivers" },
  { key: "SHIPPER",  label: "Shipper",  desc: "Post loads and find drivers" },
  { key: "RECEIVER", label: "Receiver", desc: "Accept deliveries at facility" },
];

// Spec §3.2 roles — MEMBER/VIEWER are deprecated and excluded from invite dropdown
const ORG_ROLES = ["OWNER", "ORG_ADMIN", "DISPATCHER", "ORG_DRIVER", "SHIPPER_USER", "RECEIVER_USER"];
const ORG_ROLE_LABELS: Record<string, string> = {
  OWNER:         "Owner",
  ORG_ADMIN:     "Org Admin",
  DISPATCHER:    "Dispatcher",
  ORG_DRIVER:    "Driver",
  SHIPPER_USER:  "Shipper User",
  RECEIVER_USER: "Receiver User",
  // legacy
  ADMIN:  "Admin (legacy)",
  MEMBER: "Member (legacy)",
  VIEWER: "Viewer (legacy)",
};
const USER_ROLES = ["DRIVER", "SHIPPER", "RECEIVER", "ADMIN"];

function OrgRoleBadge({ role }: { role: string }) {
  const colours: Record<string, string> = {
    OWNER:         "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400",
    ORG_ADMIN:     "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400",
    DISPATCHER:    "bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-400",
    ORG_DRIVER:    "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400",
    SHIPPER_USER:  "bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-400",
    RECEIVER_USER: "bg-teal-100 text-teal-700 dark:bg-teal-950/40 dark:text-teal-400",
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${colours[role] ?? "bg-secondary text-muted-foreground"}`}>
      {ORG_ROLE_LABELS[role] ?? role}
    </span>
  );
}

function OrgTab({ callerUserRole }: { callerUserRole?: string }) {
  const [orgs, setOrgs] = useState<any[]>([]);
  const [selectedOrg, setSelectedOrg] = useState<any | null>(null);
  const [myMembership, setMyMembership] = useState<any | null>(null);
  const [members, setMembers] = useState<any[]>([]);
  const [invitations, setInvitations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();

  // invite form
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteOrgRole, setInviteOrgRole] = useState("ORG_DRIVER");
  const [inviteUserRole, setInviteUserRole] = useState("DRIVER");
  const [inviting, setInviting] = useState(false);

  // edit org
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editCaps, setEditCaps] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // owner self-buffer
  const [bufferPct, setBufferPct] = useState(10);
  const [savingBuffer, setSavingBuffer] = useState(false);

  const isAdminRole = (role: string) =>
    ["OWNER", "ORG_ADMIN", "ADMIN"].includes(role);

  const refreshMembers = async (orgId: string) => {
    const [mRes, iRes] = await Promise.all([
      api.getOrgMembers(orgId),
      api.getOrgInvitations(orgId),
    ]);
    const memberList: any[] = mRes?.members ?? [];
    const inviteList: any[] = iRes?.invitations ?? [];
    setMembers(memberList);
    setInvitations(inviteList.filter((inv: any) =>
      !inv.acceptedAt && !inv.revokedAt && inv.expiresAt > Date.now()
    ));
    // find my own membership
    if (user) {
      const mine = memberList.find((m: any) => m.userId === user.userId);
      setMyMembership(mine ?? null);
    }
  };

  const loadOrgs = useCallback(async () => {
    setLoading(true);
    try {
      const { orgs: list = [] } = await api.getMyOrgs();
      setOrgs(list);
      if (list.length > 0 && !selectedOrg) setSelectedOrg(list[0]);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadOrgs(); }, [loadOrgs]);

  useEffect(() => {
    if (!selectedOrg) return;
    setEditName(selectedOrg.legalName);
    setEditCaps(selectedOrg.capabilities ?? []);
    refreshMembers(selectedOrg.orgId).catch(() => {});
  }, [selectedOrg]);

  async function handleSaveOrg() {
    if (!selectedOrg) return;
    setSaving(true);
    try {
      await api.updateOrg(selectedOrg.orgId, { legalName: editName, capabilities: editCaps });
      setSelectedOrg((o: any) => ({ ...o, legalName: editName, capabilities: editCaps }));
      setEditing(false);
      toast.success("Organisation updated");
    } catch (e: any) { toast.error(e.message); }
    finally { setSaving(false); }
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedOrg) return;
    setInviting(true);
    try {
      await api.sendInvitation(selectedOrg.orgId, {
        email: inviteEmail, orgRole: inviteOrgRole, userRole: inviteUserRole,
      });
      toast.success(`Invitation sent to ${inviteEmail} — expires in 7 days`);
      setInviteEmail("");
      await refreshMembers(selectedOrg.orgId);
    } catch (e: any) { toast.error(e.message); }
    finally { setInviting(false); }
  }

  async function handleRemoveMember(membershipId: string, name: string) {
    if (!selectedOrg) return;
    if (!confirm(`Remove ${name} from this organisation?`)) return;
    try {
      await api.removeMember(selectedOrg.orgId, membershipId);
      setMembers(m => m.filter(x => x.membershipId !== membershipId));
      toast.success("Member removed");
    } catch (e: any) { toast.error(e.message); }
  }

  async function handleSuspendMember(membershipId: string, currentStatus: string) {
    if (!selectedOrg) return;
    try {
      if (currentStatus === "SUSPENDED") {
        await api.reinstateMember(selectedOrg.orgId, membershipId);
        setMembers(m => m.map(x => x.membershipId === membershipId ? { ...x, status: "ACTIVE" } : x));
        toast.success("Member reinstated");
      } else {
        await api.suspendMember(selectedOrg.orgId, membershipId);
        setMembers(m => m.map(x => x.membershipId === membershipId ? { ...x, status: "SUSPENDED" } : x));
        toast.success("Member suspended — access revoked without deleting history");
      }
    } catch (e: any) { toast.error(e.message); }
  }

  async function handleRevokeInvitation(token: string, email: string) {
    if (!selectedOrg) return;
    if (!confirm(`Revoke invitation to ${email}?`)) return;
    try {
      await api.revokeInvitation(selectedOrg.orgId, token);
      setInvitations(i => i.filter(x => x.token !== token));
      toast.success("Invitation revoked");
    } catch (e: any) { toast.error(e.message); }
  }

  async function handleSaveBuffer() {
    if (!selectedOrg) return;
    setSavingBuffer(true);
    try {
      const res = await api.orgOwnerSetBuffer(selectedOrg.orgId, bufferPct);
      toast.success(res.message);
    } catch (e: any) { toast.error(e.message); }
    finally { setSavingBuffer(false); }
  }

  if (loading) return (
    <div className="flex items-center gap-2 text-muted-foreground text-sm py-8">
      <Loader2 className="h-4 w-4 animate-spin" /> Loading…
    </div>
  );

  if (orgs.length === 0) {
    return (
      <SectionCard>
        <div className="text-center py-8 space-y-3">
          <Building2 className="h-10 w-10 text-muted-foreground mx-auto" />
          <p className="text-sm text-muted-foreground">You are not part of any organisation yet.</p>
          <p className="text-xs text-muted-foreground">Organisations are created automatically when you sign up as Shipper or Receiver, or you can be invited by an existing member.</p>
        </div>
      </SectionCard>
    );
  }

  const amOwner = myMembership?.orgRole === "OWNER";
  const amAdmin = myMembership && isAdminRole(myMembership.orgRole);

  return (
    <div className="space-y-5">
      {/* Org selector if multiple */}
      {orgs.length > 1 && (
        <div className="flex gap-2 flex-wrap">
          {orgs.map(o => (
            <button
              key={o.orgId}
              onClick={() => setSelectedOrg(o)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-all ${selectedOrg?.orgId === o.orgId ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground hover:border-primary/40"}`}
            >
              {o.legalName}
              {o.suspended && <span className="ml-1.5 text-xs text-destructive">(suspended)</span>}
            </button>
          ))}
        </div>
      )}

      {selectedOrg && (
        <>
          {/* Org suspended banner */}
          {selectedOrg.suspended && (
            <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              <span className="font-semibold">⛔ Organisation suspended</span>
              {selectedOrg.suspensionReason && <span className="text-muted-foreground">— {selectedOrg.suspensionReason}</span>}
            </div>
          )}

          {/* Org info card */}
          <SectionCard>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Building2 className="h-5 w-5 text-primary" />
                </div>
                <div>
                  {editing ? (
                    <Input value={editName} onChange={e => setEditName(e.target.value)} className="h-8 text-sm font-semibold w-60" />
                  ) : (
                    <div className="font-semibold">{selectedOrg.legalName}</div>
                  )}
                  <div className="text-xs text-muted-foreground">{selectedOrg.orgId}</div>
                </div>
              </div>
              {amAdmin && (!editing ? (
                <Button variant="outline" size="sm" onClick={() => setEditing(true)}>Edit</Button>
              ) : (
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setEditing(false)}>Cancel</Button>
                  <Button size="sm" onClick={handleSaveOrg} disabled={saving}>
                    {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
                  </Button>
                </div>
              ))}
            </div>

            {/* Capabilities */}
            <div>
              <Label className="text-xs text-muted-foreground uppercase tracking-wide mb-2 block">Capabilities</Label>
              <div className="flex gap-2 flex-wrap">
                {ALL_CAPABILITIES.map(cap => {
                  const active = (editing ? editCaps : selectedOrg.capabilities ?? []).includes(cap.key);
                  return (
                    <button
                      key={cap.key}
                      type="button"
                      disabled={!editing}
                      onClick={() => editing && setEditCaps(prev => prev.includes(cap.key) ? prev.filter(c => c !== cap.key) : [...prev, cap.key])}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${active ? "bg-primary/10 border-primary text-primary" : "border-border text-muted-foreground"} ${editing ? "cursor-pointer hover:border-primary/60" : "cursor-default"}`}
                    >
                      {active ? <CheckSquare className="h-3 w-3" /> : <Square className="h-3 w-3" />}
                      {cap.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </SectionCard>

          {/* Owner self-buffer (spec §5.1 — only for OWNER who is also a DRIVER) */}
          {amOwner && callerUserRole === "DRIVER" && (
            <SectionCard>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-sm">Safety Buffer (Owner override)</p>
                  <p className="text-xs text-muted-foreground mt-0.5">As org Owner, you can set your own buffer within the platform range (5–25%).</p>
                </div>
                <span className="text-2xl font-bold text-primary">{bufferPct}%</span>
              </div>
              <input
                type="range" min={5} max={25} step={1}
                value={bufferPct}
                onChange={e => setBufferPct(Number(e.target.value))}
                className="w-full accent-primary"
              />
              <div className="flex justify-between text-xs text-muted-foreground"><span>5% min</span><span>25% max</span></div>
              <Button size="sm" onClick={handleSaveBuffer} disabled={savingBuffer} className="mt-1">
                {savingBuffer ? <><Loader2 className="h-3 w-3 animate-spin mr-1.5" />Saving…</> : "Apply buffer"}
              </Button>
            </SectionCard>
          )}

          {/* Members */}
          <SectionCard>
            <div className="flex items-center gap-2 font-semibold text-sm">
              <Users className="h-4 w-4 text-primary" /> Members
              <span className="ml-auto text-xs font-normal text-muted-foreground">{members.filter(m => m.status !== "SUSPENDED").length} active</span>
            </div>
            <div className="divide-y divide-border">
              {members.map(m => {
                const isSuspended = m.status === "SUSPENDED";
                return (
                  <div key={m.membershipId} className={`flex items-center justify-between py-2.5 text-sm ${isSuspended ? "opacity-50" : ""}`}>
                    <div>
                      <span className="font-medium font-mono text-xs">{m.userId}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{m.userRole}</span>
                      {isSuspended && <span className="ml-2 text-xs text-destructive font-medium">suspended</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      <OrgRoleBadge role={m.orgRole} />
                      {amAdmin && m.orgRole !== "OWNER" && (
                        <>
                          <button
                            title={isSuspended ? "Reinstate member" : "Suspend member"}
                            onClick={() => handleSuspendMember(m.membershipId, m.status ?? "ACTIVE")}
                            className={`text-xs px-1.5 py-0.5 rounded border transition-colors ${isSuspended ? "border-green-400 text-green-600 hover:bg-green-50" : "border-amber-300 text-amber-600 hover:bg-amber-50"}`}
                          >
                            {isSuspended ? "Reinstate" : "Suspend"}
                          </button>
                          <button
                            title="Remove member"
                            onClick={() => handleRemoveMember(m.membershipId, m.userId)}
                            className="text-muted-foreground hover:text-destructive transition-colors"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
              {members.length === 0 && <p className="text-sm text-muted-foreground py-3">No members yet.</p>}
            </div>
          </SectionCard>

          {/* Pending invitations */}
          {invitations.length > 0 && (
            <SectionCard>
              <div className="flex items-center gap-2 font-semibold text-sm">
                <Mail className="h-4 w-4 text-primary" /> Pending invitations
                <span className="ml-auto text-xs font-normal text-muted-foreground">Expire 7 days after sending</span>
              </div>
              <div className="divide-y divide-border">
                {invitations.map((inv: any) => {
                  const daysLeft = Math.max(0, Math.ceil((inv.expiresAt - Date.now()) / 86_400_000));
                  return (
                    <div key={inv.token} className="flex items-center justify-between py-2.5 text-sm">
                      <div>
                        <span className="font-medium">{inv.email}</span>
                        <span className="ml-2 text-xs text-muted-foreground">
                          <OrgRoleBadge role={inv.orgRole} /> · {inv.userRole}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">{daysLeft}d left</span>
                        {amAdmin && (
                          <button
                            title="Revoke invitation"
                            onClick={() => handleRevokeInvitation(inv.token, inv.email)}
                            className="text-muted-foreground hover:text-destructive transition-colors"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </SectionCard>
          )}

          {/* Invite form (Owner / Org Admin only) */}
          {amAdmin && (
            <SectionCard>
              <div className="flex items-center gap-2 font-semibold text-sm">
                <Plus className="h-4 w-4 text-primary" /> Invite a team member
              </div>
              <form onSubmit={handleInvite} className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="inviteEmail">Email address</Label>
                  <Input
                    id="inviteEmail" type="email" placeholder="colleague@company.com"
                    value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} required
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Org role</Label>
                    <select
                      value={inviteOrgRole}
                      onChange={e => setInviteOrgRole(e.target.value)}
                      className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                    >
                      {ORG_ROLES.filter(r => r !== "OWNER").map(r => (
                        <option key={r} value={r}>{ORG_ROLE_LABELS[r] ?? r}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Account type</Label>
                    <select
                      value={inviteUserRole}
                      onChange={e => setInviteUserRole(e.target.value)}
                      className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                    >
                      {USER_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                </div>
                <Button type="submit" size="sm" disabled={inviting}>
                  {inviting ? <><Loader2 className="h-3 w-3 animate-spin mr-1.5" />Sending…</> : "Send invitation"}
                </Button>
              </form>
            </SectionCard>
          )}
        </>
      )}
    </div>
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
