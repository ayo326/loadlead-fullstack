import { useEffect, useState } from "react";
import { Loader2, FileText, ShieldCheck, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { CanopyConnectCard } from "@/components/CanopyConnectCard";

// The seven official Line 3a federal tax classifications.
const CLASSIFICATIONS: { value: string; label: string }[] = [
  { value: "INDIVIDUAL_SOLE_PROPRIETOR", label: "Individual / sole proprietor" },
  { value: "C_CORPORATION", label: "C corporation" },
  { value: "S_CORPORATION", label: "S corporation" },
  { value: "PARTNERSHIP", label: "Partnership" },
  { value: "TRUST_ESTATE", label: "Trust / estate" },
  { value: "LLC", label: "LLC" },
  { value: "OTHER", label: "Other" },
];

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === "VERIFIED"
      ? "bg-green-100 text-green-700"
      : status === "EXPIRED" || status === "REJECTED" || status === "MISSING"
      ? "bg-red-100 text-red-700"
      : "bg-amber-100 text-amber-700";
  return <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${tone}`}>{status}</span>;
}

export default function OwnerOperatorCompliance() {
  const [badges, setBadges] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = () =>
    api
      .getComplianceStatus()
      .then((r) => setBadges(r.badges ?? []))
      .catch((e: any) => toast.error(e.message))
      .finally(() => setLoading(false));

  useEffect(() => {
    refresh();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-bold">Compliance documents</h1>
        <p className="text-sm text-muted-foreground">
          Your W-9, insurance, and operating authority. Shippers see the status; the documents open only for carriers you are working with.
        </p>
      </div>

      {/* Badges */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {badges.map((b) => (
          <div key={b.documentType} className="rounded-xl border bg-card p-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">
                {b.documentType === "LETTER_OF_AUTHORITY" ? "Authority" : b.documentType}
              </span>
            </div>
            <StatusPill status={b.status} />
          </div>
        ))}
      </div>

      <W9Section onSaved={refresh} />
      {/* Canopy Connect: primary path to verify insurance; the manual COI upload
          below is the explicit alternative and always exists end to end. */}
      <CanopyConnectCard
        onChooseManual={() => document.getElementById("coi-upload")?.scrollIntoView({ behavior: "smooth", block: "start" })}
        onVerified={refresh}
      />
      <CoiSection onSaved={refresh} />
      <LoaSection onSaved={refresh} />
    </div>
  );
}

// ── W-9 ───────────────────────────────────────────────────────────────────────

// Pristine W-9 form state. A factory (not a constant) so each reset gets a
// fresh signedDateISO and no shared object references.
const emptyW9Form = () => ({
  classification: "INDIVIDUAL_SOLE_PROPRIETOR",
  tinType: "SSN",
  isUsPerson: true,
  signedDateISO: new Date().toISOString().slice(0, 10),
});

function W9Section({ onSaved }: { onSaved: () => void }) {
  const [f, setF] = useState<any>(emptyW9Form());
  const set = (k: string, v: unknown) => setF((p: any) => ({ ...p, [k]: v }));
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const preview = async () => {
    setBusy(true);
    try {
      const r = await api.previewW9(f);
      // Show the genuine filled official form (the same bytes that get stored).
      setPreviewUrl(`data:application/pdf;base64,${r.pdfBase64}`);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!f.consentGiven) {
      toast.error("Please affirm the certification to sign.");
      return;
    }
    setBusy(true);
    try {
      const r = await api.submitW9(f);
      if (r.requiresW8) {
        toast.error("A W-9 does not apply to a non-U.S. person; a Form W-8 applies. Our team will follow up.");
      } else if (r.errors?.length) {
        toast.error(r.errors.map((e: any) => e.message).join(" "));
      } else {
        toast.success("W-9 signed and submitted.");
        // PII hygiene (audit v4 M1): never retain the TIN (SSN/EIN) in client
        // state after a successful submit. Reset the form to pristine and drop
        // the preview data-URL (the filled PDF embeds the full TIN too). The
        // stored W-9 re-renders masked (last 4 only) via onSaved().
        setF(emptyW9Form());
        setPreviewUrl(null);
        onSaved();
      }
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-xl border bg-card p-5 space-y-4">
      <div className="flex items-center gap-2">
        <FileText className="h-4 w-4 text-primary" />
        <h2 className="font-semibold">Form W-9 (Rev. 3-2024)</h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label="Line 1 - Name (as on your tax return)" req>
          <Input value={f.line1Name ?? ""} onChange={(e) => set("line1Name", e.target.value)} />
        </Field>
        <Field label="Line 2 - Business name / DBA">
          <Input value={f.line2BusinessName ?? ""} onChange={(e) => set("line2BusinessName", e.target.value)} />
        </Field>
      </div>

      <Field label="Line 3a - Federal tax classification" req>
        <select
          className="w-full h-10 rounded-md border bg-background px-3 text-sm"
          value={f.classification}
          onChange={(e) => set("classification", e.target.value)}
        >
          {CLASSIFICATIONS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </Field>
      <p className="text-xs text-muted-foreground -mt-2">
        An LLC that is a disregarded entity does not check LLC; it checks the classification of its owner.
      </p>

      {f.classification === "LLC" && (
        <Field label="LLC tax code (C, S, or P)" req>
          <Input value={f.llcCode ?? ""} maxLength={1} onChange={(e) => set("llcCode", e.target.value.toUpperCase())} />
        </Field>
      )}
      {f.classification === "OTHER" && (
        <Field label="Describe the classification" req>
          <Input value={f.otherText ?? ""} onChange={(e) => set("otherText", e.target.value)} />
        </Field>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label="Line 5 - Address" req>
          <Input value={f.address ?? ""} onChange={(e) => set("address", e.target.value)} />
        </Field>
        <Field label="Line 6 - City, state, ZIP" req>
          <Input value={f.cityStateZip ?? ""} onChange={(e) => set("cityStateZip", e.target.value)} />
        </Field>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Field label="TIN type">
          <select
            className="w-full h-10 rounded-md border bg-background px-3 text-sm"
            value={f.tinType}
            onChange={(e) => set("tinType", e.target.value)}
          >
            <option value="SSN">SSN</option>
            <option value="EIN">EIN</option>
          </select>
        </Field>
        <Field label={f.tinType === "SSN" ? "SSN (XXX-XX-XXXX)" : "EIN (XX-XXXXXXX)"}>
          <Input
            value={f.tin ?? ""}
            disabled={f.tinAppliedFor}
            onChange={(e) => set("tin", e.target.value)}
            placeholder={f.tinType === "SSN" ? "123-45-6789" : "12-3456789"}
          />
        </Field>
        <label className="flex items-center gap-2 text-sm mt-6">
          <input type="checkbox" checked={!!f.tinAppliedFor} onChange={(e) => set("tinAppliedFor", e.target.checked)} />
          Applied For
        </label>
      </div>

      <div className="space-y-2 pt-2 border-t">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={!!f.isUsPerson} onChange={(e) => set("isUsPerson", e.target.checked)} />
          I am a U.S. citizen or other U.S. person.
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={!!f.backupWithholdingNotified}
            onChange={(e) => set("backupWithholdingNotified", e.target.checked)}
          />
          I have been notified by the IRS that I am subject to backup withholding (crosses out item 2).
        </label>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label="Signature (type your name)" req>
          <Input value={f.signatureName ?? ""} onChange={(e) => set("signatureName", e.target.value)} />
        </Field>
        <Field label="Date">
          <Input type="date" value={f.signedDateISO} onChange={(e) => set("signedDateISO", e.target.value)} />
        </Field>
      </div>

      <label className="flex items-start gap-2 text-xs text-muted-foreground">
        <input type="checkbox" checked={!!f.consentGiven} onChange={(e) => set("consentGiven", e.target.checked)} className="mt-0.5" />
        Under penalties of perjury, I certify the statements on Form W-9 and sign electronically.
      </label>

      <div className="flex gap-2">
        <Button variant="outline" onClick={preview} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Preview filled W-9"}
        </Button>
        <Button onClick={submit} disabled={busy}>
          Sign &amp; submit
        </Button>
      </div>

      {previewUrl && (
        <div className="rounded-lg overflow-hidden border" style={{ height: 520 }}>
          <iframe title="W-9 preview" src={previewUrl} className="w-full h-full border-0" />
        </div>
      )}
    </section>
  );
}

// ── COI ─────────────────────────────────────────────────────────────────────

function CoiSection({ onSaved }: { onSaved: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [f, setF] = useState<any>({});
  const set = (k: string, v: unknown) => setF((p: any) => ({ ...p, [k]: v }));
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!file) {
      toast.error("Attach the COI file.");
      return;
    }
    setBusy(true);
    try {
      const fileBase64 = await fileToBase64(file);
      await api.uploadCoi({
        fileBase64,
        originalFilename: file.name,
        contentType: file.type || "application/pdf",
        fields: {
          insurerName: f.insurerName,
          policyNumber: f.policyNumber,
          autoLiabilityCents: f.autoLiability ? Math.round(Number(f.autoLiability) * 100) : undefined,
          cargoCents: f.cargo ? Math.round(Number(f.cargo) * 100) : undefined,
          effectiveDate: f.effectiveDate ? new Date(f.effectiveDate).getTime() : undefined,
          expiryDate: f.expiryDate ? new Date(f.expiryDate).getTime() : undefined,
          mcNumber: f.mcNumber,
          dotNumber: f.dotNumber,
        },
      });
      toast.success("COI uploaded; verification pending.");
      onSaved();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section id="coi-upload" className="rounded-xl border bg-card p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Upload className="h-4 w-4 text-primary" />
        <h2 className="font-semibold">Certificate of Insurance</h2>
      </div>
      <input type="file" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label="Insurer"><Input onChange={(e) => set("insurerName", e.target.value)} /></Field>
        <Field label="Policy number"><Input onChange={(e) => set("policyNumber", e.target.value)} /></Field>
        <Field label="Auto liability ($)"><Input type="number" onChange={(e) => set("autoLiability", e.target.value)} /></Field>
        <Field label="Cargo ($)"><Input type="number" onChange={(e) => set("cargo", e.target.value)} /></Field>
        <Field label="Effective date"><Input type="date" onChange={(e) => set("effectiveDate", e.target.value)} /></Field>
        <Field label="Expiry date"><Input type="date" onChange={(e) => set("expiryDate", e.target.value)} /></Field>
        <Field label="MC number"><Input onChange={(e) => set("mcNumber", e.target.value)} /></Field>
        <Field label="DOT number"><Input onChange={(e) => set("dotNumber", e.target.value)} /></Field>
      </div>
      <Button onClick={submit} disabled={busy}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Upload COI"}
      </Button>
    </section>
  );
}

// ── Letter of Authority ───────────────────────────────────────────────────────

function LoaSection({ onSaved }: { onSaved: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [f, setF] = useState<any>({});
  const set = (k: string, v: unknown) => setF((p: any) => ({ ...p, [k]: v }));
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!file) {
      toast.error("Attach the authority letter.");
      return;
    }
    setBusy(true);
    try {
      const fileBase64 = await fileToBase64(file);
      await api.uploadLetterOfAuthority({
        fileBase64,
        originalFilename: file.name,
        contentType: file.type || "application/pdf",
        mcNumber: f.mcNumber,
        dotNumber: f.dotNumber,
      });
      toast.success("Authority letter uploaded; verification pending.");
      onSaved();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-xl border bg-card p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Upload className="h-4 w-4 text-primary" />
        <h2 className="font-semibold">Letter of Authority</h2>
      </div>
      <input type="file" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label="MC number"><Input onChange={(e) => set("mcNumber", e.target.value)} /></Field>
        <Field label="DOT number"><Input onChange={(e) => set("dotNumber", e.target.value)} /></Field>
      </div>
      <Button onClick={submit} disabled={busy}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Upload authority letter"}
      </Button>
    </section>
  );
}

function Field({ label, req, children }: { label: string; req?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">
        {label} {req && <span className="text-red-500">*</span>}
      </Label>
      {children}
    </div>
  );
}
