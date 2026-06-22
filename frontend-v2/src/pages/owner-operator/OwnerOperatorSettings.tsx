import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Truck, Users, Loader2, Send, Trash2 } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { SecuritySettings } from "@/components/SecuritySettings";
import { OwnerOperatorVerification } from "@/components/OwnerOperatorVerification";
import { Shield, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { toast } from "sonner";
// Persona-neutral taxonomy atoms — same primitives the Carrier settings screen uses.
import { Combobox, AsyncCombobox } from "@/components/ui/combobox";
import { useEquipmentClasses, taxonomyApi, toEquipmentItems } from "@/services/taxonomy";
import { useMemo } from "react";

// Equipment class code → legacy TrailerType (matches PostLoad's mapping).
const CLASS_CODE_TO_TRAILER_TYPE: Record<string, string> = {
  V: "DRY_VAN", V48: "DRY_VAN", R: "REEFER", R48: "REEFER", RM: "REEFER", RBOX: "REEFER",
  F: "FLATBED", F53: "FLATBED", SD: "FLATBED", CN: "FLATBED",
  RGN: "RGN", TF: "TANKER", TC: "TANKER", TFG: "TANKER",
  CH: "CAR_HAULER", PO: "POWER_ONLY",
  BOX26: "BOX_TRUCK", BOX24: "BOX_TRUCK", BOX16: "BOX_TRUCK",
};
// Reverse: legacy TrailerType → first canonical class code (for round-tripping).
const TRAILER_TYPE_TO_CLASS_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(CLASS_CODE_TO_TRAILER_TYPE).map(([k, v]) => [v, k])
);

// ── Reusable helpers ─────────────────────────────────────────────────────────

function SectionCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-card p-5 space-y-4">{children}</div>
  );
}

function Field({ label, id, required, children }: {
  label: string; id: string; required?: boolean; children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>
        {label}{required && <span className="text-destructive ml-0.5">*</span>}
      </Label>
      {children}
    </div>
  );
}

// ── Profile tab ───────────────────────────────────────────────────────────────

function ProfileTab() {
  const [profile, setProfile] = useState<Record<string, any>>({
    legalName: "", dba: "", phone: "", email: "", city: "", state: "", zip: "",
    mcNumber: "", dotNumber: "",
    cdlClass: "", truckMake: "", truckModel: "", truckYear: "", truckVIN: "",
    trailerType: "", trailerLength: "", maxCapacityLbs: "",
  });
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.getOwnerOperatorProfile()
      .then(r => { if (r.ownerOperator) setProfile((p) => ({ ...p, ...r.ownerOperator })); else setIsNew(true); })
      .catch((e: any) => { if (e.message?.includes("404")) setIsNew(true); });
  }, []);

  const set = (k: string, v: unknown) => setProfile(p => ({ ...p, [k]: v }));

  const save = async () => {
    const required = ["legalName", "phone"];
    const missing = required.filter(f => !profile[f]);
    if (missing.length) { toast.error(`Required: ${missing.join(", ")}`); return; }
    setSaving(true);
    try {
      if (isNew) {
        await api.createOwnerOperatorProfile(profile);
        setIsNew(false);
        toast.success("Profile created!");
      } else {
        await api.updateOwnerOperatorProfile(profile);
        toast.success("Changes saved!");
      }
    } catch (e: any) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  const inp = (id: string, label: string, req = false, type = "text") => (
    <Field label={label} id={id} required={req}>
      <Input id={id} type={type} value={profile[id] ?? ""} onChange={e => set(id, e.target.value)} />
    </Field>
  );

  return (
    <div className="space-y-5">
      {isNew && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/20 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
          Welcome! Complete your profile to start seeing loads and managing your fleet.
        </div>
      )}

      <SectionCard>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Personal / Business</p>
        <div className="grid sm:grid-cols-2 gap-4">
          {inp("legalName", "Legal Name", true)}
          {inp("dba", "DBA / Trade Name")}
          {inp("phone", "Phone", true)}
          {inp("email", "Email")}
          {inp("city", "City")}
          {inp("state", "State")}
          {inp("zip", "ZIP")}
        </div>
      </SectionCard>

      <SectionCard>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Authority &amp; Insurance</p>
        <div className="grid sm:grid-cols-2 gap-4">
          {inp("mcNumber", "MC Number")}
          {inp("dotNumber", "DOT Number")}
          {inp("cargoInsuranceAmount", "Cargo Insurance ($)", false, "number")}
          {inp("liabilityInsuranceAmount", "Liability Insurance ($)", false, "number")}
        </div>
      </SectionCard>

      <EquipmentSection profile={profile} set={set} inp={inp} />

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving}>
          {saving ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Saving…</> : "Save Profile"}
        </Button>
      </div>
    </div>
  );
}

// Persona-neutral equipment section: class + tractor + trailer model from the
// canonical taxonomy. Same primitives the Carrier and Driver settings use.
function EquipmentSection({ profile, set, inp }: {
  profile: Record<string, any>;
  set: (k: string, v: unknown) => void;
  inp: (id: string, label: string, req?: boolean, type?: string) => React.ReactElement;
}) {
  const eqClasses = useEquipmentClasses();
  const equipmentItems = useMemo(() => eqClasses.data ? toEquipmentItems(eqClasses.data) : [], [eqClasses.data]);

  // The persisted shape still uses TrailerType for backward compat; keep the
  // class code in form state and translate on save.
  const classCode: string | null = profile.equipment_class_code
    ?? (profile.trailerType ? TRAILER_TYPE_TO_CLASS_CODE[profile.trailerType] ?? null : null);

  const tractorValue = profile.truckMake && profile.truckModel
    ? { value: `${profile.truckMake}::${profile.truckModel}`, label: profile.truckModel }
    : null;

  const trailerModelValue = profile.trailer_model
    ? { value: profile.trailer_model, label: profile.trailer_model.split("::").pop() ?? profile.trailer_model }
    : null;

  return (
    <div className="rounded-xl border bg-card p-5 space-y-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Equipment (if you drive)</p>
      <div className="grid sm:grid-cols-2 gap-4">
        {inp("cdlClass", "CDL Class")}
        {inp("truckYear", "Truck Year", false, "number")}
        {inp("truckVIN", "VIN")}
        {inp("trailerLength", "Trailer Length (ft)", false, "number")}
        {inp("maxCapacityLbs", "Max Capacity (lbs)", false, "number")}

        <Field label="Equipment class" id="equipment_class_code">
          <Combobox
            items={equipmentItems}
            value={classCode}
            onChange={(v) => {
              set("equipment_class_code", v);
              if (v) set("trailerType", CLASS_CODE_TO_TRAILER_TYPE[v] ?? "DRY_VAN");
            }}
            placeholder="Pick an equipment class…"
          />
        </Field>

        <Field label="Tractor (manufacturer/model)" id="truck_model">
          <AsyncCombobox
            value={tractorValue}
            onChange={(sel) => {
              if (!sel) { set("truckMake", ""); set("truckModel", ""); return; }
              const [mfg, model] = sel.value.split("::");
              set("truckMake", mfg); set("truckModel", model);
            }}
            placeholder="Search tractors (Freightliner, Kenworth…)"
            fetchItems={async (q) => {
              const items = await taxonomyApi.searchEquipmentModels("PO", q || "", 25);
              return items.map(it => ({ value: `${it.manufacturer}::${it.model}`, label: it.model, group: it.manufacturer }));
            }}
          />
        </Field>

        <Field label="Trailer (manufacturer/model)" id="trailer_model">
          <AsyncCombobox
            value={trailerModelValue}
            onChange={(sel) => set("trailer_model", sel?.value ?? "")}
            disabled={!classCode}
            placeholder={classCode ? "Search trailer models…" : "Pick an equipment class first"}
            fetchItems={async (q) => {
              if (!classCode) return [];
              const items = await taxonomyApi.searchEquipmentModels(classCode, q || "", 25);
              return items.map(it => ({ value: `${it.manufacturer}::${it.model}`, label: it.model, group: it.manufacturer }));
            }}
          />
        </Field>
      </div>
    </div>
  );
}

// ── Fleet tab ─────────────────────────────────────────────────────────────────

function FleetTab() {
  const [drivers, setDrivers] = useState<any[]>([]);
  const [invites, setInvites] = useState<any[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const [fr, ir] = await Promise.all([
        api.getOwnerOperatorFleet().catch(() => ({ drivers: [] })),
        api.getFleetInvites().catch(() => ({ invites: [] })),
      ]);
      setDrivers(fr.drivers ?? []);
      setInvites(ir.invites ?? []);
    } catch (e: any) { toast.error(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const sendInvite = async () => {
    if (!inviteEmail.trim()) { toast.error("Enter an email address"); return; }
    setInviting(true);
    try {
      await api.inviteFleetDriver(inviteEmail.trim());
      toast.success(`Invite sent to ${inviteEmail.trim()}`);
      setInviteEmail("");
      load();
    } catch (e: any) { toast.error(e.message); }
    finally { setInviting(false); }
  };

  const removeDriver = async (driverId: string, name: string) => {
    if (!confirm(`Remove ${name} from your fleet?`)) return;
    try {
      await api.removeFleetDriver(driverId);
      toast.success(`${name} removed from fleet`);
      load();
    } catch (e: any) { toast.error(e.message); }
  };

  if (loading) return (
    <div className="flex items-center gap-2 text-muted-foreground text-sm py-8">
      <Loader2 className="h-4 w-4 animate-spin" /> Loading fleet…
    </div>
  );

  return (
    <div className="space-y-5">
      {/* Invite */}
      <SectionCard>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Invite a Driver</p>
        <p className="text-sm text-muted-foreground">
          Send a fleet invite to a driver's email. They sign up as a Driver and will be linked to your fleet.
        </p>
        <div className="flex gap-2">
          <Input
            placeholder="driver@example.com"
            type="email"
            value={inviteEmail}
            onChange={e => setInviteEmail(e.target.value)}
            onKeyDown={e => e.key === "Enter" && sendInvite()}
          />
          <Button onClick={sendInvite} disabled={inviting}>
            {inviting ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Send className="h-4 w-4 mr-2" />Invite</>}
          </Button>
        </div>

        {invites.length > 0 && (
          <div>
            <p className="text-xs text-muted-foreground mb-2">Pending invites</p>
            <div className="space-y-2">
              {invites.map((inv: any) => {
                const daysLeft = Math.max(0, Math.ceil((inv.expiresAt - Date.now()) / 86400000));
                return (
                  <div key={inv.inviteId} className="flex items-center justify-between text-sm rounded-lg border px-3 py-2">
                    <span>{inv.email}</span>
                    <span className="text-xs text-muted-foreground">{daysLeft}d remaining</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </SectionCard>

      {/* Roster */}
      <SectionCard>
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Fleet Drivers <span className="ml-1.5 text-muted-foreground font-normal normal-case">({drivers.length})</span>
          </p>
        </div>

        {drivers.length === 0 ? (
          <div className="flex flex-col items-center py-8 text-muted-foreground gap-2">
            <Users className="h-8 w-8 opacity-40" />
            <p className="text-sm">No drivers in your fleet yet.</p>
          </div>
        ) : (
          <div className="divide-y -mx-5 px-5">
            {drivers.map((driver: any) => (
              <div key={driver.driverId} className="py-3 flex items-center gap-3">
                {driver.headshotUrl ? (
                  <img src={driver.headshotUrl} className="h-9 w-9 rounded-full object-cover shrink-0" alt="" />
                ) : (
                  <div className="h-9 w-9 rounded-full bg-secondary flex items-center justify-center text-xs font-semibold shrink-0">
                    {driver.legalName?.[0] ?? "D"}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-sm">{driver.legalName}</p>
                  <p className="text-xs text-muted-foreground">{driver.cdlClass} · {driver.trailerType} · {driver.currentCity}, {driver.currentState}</p>
                </div>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                  driver.status === "ACTIVE" ? "bg-green-100 text-green-700 dark:bg-green-950/30 dark:text-green-400" :
                  "bg-secondary text-muted-foreground"
                }`}>
                  {driver.status ?? "PENDING"}
                </span>
                <Button
                  variant="ghost" size="icon"
                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={() => removeDriver(driver.driverId, driver.legalName)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}

// ── Main settings page ────────────────────────────────────────────────────────

export default function OwnerOperatorSettings() {
  const [searchParams] = useSearchParams();
  const defaultTab = searchParams.get("tab") ?? "profile";

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b bg-card">
        <div className="max-w-5xl mx-auto px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <Truck className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold">Owner Operator Settings</h1>
              <p className="text-sm text-muted-foreground">Manage your profile and fleet</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-6">
        <Tabs defaultValue={defaultTab} orientation="vertical" className="flex gap-6">
          <TabsList data-tour="settings-tabs" className="flex flex-col h-auto w-44 shrink-0 rounded-xl bg-secondary p-1 gap-1">
            <TabsTrigger data-tour="settings-tab-profile" value="profile" className="w-full justify-start rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm">
              <Truck className="h-4 w-4 mr-2" />Profile
            </TabsTrigger>
            <TabsTrigger data-tour="settings-tab-fleet" value="fleet" className="w-full justify-start rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm">
              <Users className="h-4 w-4 mr-2" />Fleet
            </TabsTrigger>
            <TabsTrigger value="verification" className="w-full justify-start rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm">
              <ShieldCheck className="h-4 w-4 mr-2" />Verification
            </TabsTrigger>
            <TabsTrigger value="security" className="w-full justify-start rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm">
              <Shield className="h-4 w-4 mr-2" />Security
            </TabsTrigger>
          </TabsList>

          <div className="flex-1 min-w-0">
            <TabsContent value="profile"><ProfileTab /></TabsContent>
            <TabsContent value="fleet"><FleetTab /></TabsContent>
            <TabsContent value="verification"><OwnerOperatorVerification /></TabsContent>
            <TabsContent value="security"><SecuritySettings /></TabsContent>
          </div>
        </Tabs>
      </div>
    </div>
  );
}
