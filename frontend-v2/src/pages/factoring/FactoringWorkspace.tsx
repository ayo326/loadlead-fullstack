/**
 * Factoring workspace — shared by BOTH carrier personas:
 *   /owner-operator/factoring  (OWNER_OPERATOR)
 *   /carrier/factoring         (CARRIER_ADMIN — fleet-carrier org managers)
 *
 * The backend resolves who the caller acts for (routes/factoring.ts
 * resolveCarrierIdForUser: OO profile first, else ACTIVE OWNER/MANAGER
 * membership in a CARRIER org), so this component is persona-neutral and
 * never needs to know which carrier kind it is serving.
 */
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, Send, FileText, Link2, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import {
  api,
  formatCents,
  type FactorContact,
  type InvoicePackageDTO,
  type FactoringAssignmentDTO,
  type FactoringSubmissionDTO,
  type PacketManifestDTO,
} from "@/lib/api";

function Card({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-card p-5 space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        {desc && <p className="text-sm text-muted-foreground">{desc}</p>}
      </div>
      {children}
    </div>
  );
}

function Badge({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
        ok ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
      }`}
    >
      {ok ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
      {children}
    </span>
  );
}

export default function FactoringWorkspace() {
  // Saved factor contact
  const [contact, setContact] = useState<FactorContact | null>(null);
  const [factorName, setFactorName] = useState("");
  const [factorEmail, setFactorEmail] = useState("");
  const [savingContact, setSavingContact] = useState(false);

  // Invoice workflow
  const [invoiceId, setInvoiceId] = useState("");
  const [pkg, setPkg] = useState<InvoicePackageDTO | null>(null);
  const [payee, setPayee] = useState<{ type: string; destination: string; reason: string } | null>(null);
  const [loadingPkg, setLoadingPkg] = useState(false);

  // Export flow (two-step: review then confirm)
  const [review, setReview] = useState<{ manifest: PacketManifestDTO; recipient: string } | null>(null);
  const [missing, setMissing] = useState<string[] | null>(null);
  const [recipientOverride, setRecipientOverride] = useState("");
  const [sending, setSending] = useState(false);

  // Assignments + submissions
  const [assignments, setAssignments] = useState<FactoringAssignmentDTO[]>([]);
  const [submissions, setSubmissions] = useState<FactoringSubmissionDTO[]>([]);
  const [newAssign, setNewAssign] = useState({
    factorName: "", payoutDestination: "", recourseType: "RECOURSE", scope: "FULL_INVOICE", debtorId: "",
  });

  async function loadContact() {
    try {
      const { contact } = await api.factoring.getContact();
      setContact(contact);
      if (contact) { setFactorName(contact.factorName); setFactorEmail(contact.factorEmail); }
    } catch (e: any) { /* no contact yet */ }
  }
  async function loadAssignments() {
    try { setAssignments((await api.factoring.listAssignments()).assignments ?? []); } catch { /* ignore */ }
  }
  async function loadSubmissions() {
    try { setSubmissions((await api.factoring.listSubmissions()).submissions ?? []); } catch { /* ignore */ }
  }

  useEffect(() => { loadContact(); loadAssignments(); loadSubmissions(); }, []);

  async function saveContact() {
    setSavingContact(true);
    try {
      const { contact } = await api.factoring.saveContact(factorName.trim(), factorEmail.trim());
      setContact(contact);
      toast.success("Factor contact saved");
    } catch (e: any) { toast.error(e.message ?? "Could not save contact"); }
    finally { setSavingContact(false); }
  }

  async function loadPackage() {
    if (!invoiceId.trim()) return;
    setLoadingPkg(true); setPkg(null); setPayee(null); setReview(null); setMissing(null);
    try {
      const [{ package: p }, { payee }] = await Promise.all([
        api.factoring.getPackage(invoiceId.trim()),
        api.factoring.getPayee(invoiceId.trim()),
      ]);
      setPkg(p); setPayee(payee);
    } catch (e: any) { toast.error(e.message ?? "Could not load invoice"); }
    finally { setLoadingPkg(false); }
  }

  async function startExport() {
    setReview(null); setMissing(null);
    try {
      const res = await api.factoring.exportReview(invoiceId.trim(), recipientOverride.trim() || undefined);
      if ("ok" in res && res.ok === false) { setMissing(res.missing); return; }
      if ("requiresConfirmation" in res) { setReview({ manifest: res.manifest, recipient: res.recipient }); }
    } catch (e: any) { toast.error(e.message ?? "Could not assemble packet"); }
  }

  async function confirmSend() {
    if (!review) return;
    setSending(true);
    try {
      const res = await api.factoring.exportSend({
        invoiceId: invoiceId.trim(),
        recipientEmail: recipientOverride.trim() || review.recipient,
      });
      if ("ok" in res && res.ok === false) { setMissing(res.missing); setReview(null); return; }
      if ("submission" in res) {
        if (res.submission.status === "SENT") toast.success(`Sent to ${res.submission.recipientEmail}`);
        else toast.error(`Send failed: ${res.submission.error ?? "unknown"}`);
        setReview(null);
        loadSubmissions();
      }
    } catch (e: any) { toast.error(e.message ?? "Send failed"); }
    finally { setSending(false); }
  }

  async function createAssignment() {
    if (!newAssign.factorName.trim() || !newAssign.payoutDestination.trim()) {
      toast.error("Factor name and payout destination are required"); return;
    }
    try {
      await api.factoring.createAssignment({
        invoiceId: invoiceId.trim() || undefined,
        factorName: newAssign.factorName.trim(),
        recourseType: newAssign.recourseType as "RECOURSE" | "NON_RECOURSE",
        scope: newAssign.scope as "FULL_INVOICE" | "LINEHAUL_ONLY",
        payoutDestination: newAssign.payoutDestination.trim(),
        debtorId: newAssign.debtorId.trim() || undefined,
      });
      toast.success("Assignment created" + (newAssign.debtorId ? " with Notice of Assignment" : ""));
      setNewAssign({ factorName: "", payoutDestination: "", recourseType: "RECOURSE", scope: "FULL_INVOICE", debtorId: "" });
      loadAssignments();
    } catch (e: any) { toast.error(e.message ?? "Could not create assignment"); }
  }

  async function releaseAssignment(id: string) {
    try { await api.factoring.releaseAssignment(id); toast.success("Assignment released"); loadAssignments(); }
    catch (e: any) { toast.error(e.message ?? "Could not release"); }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-bold">Factoring</h1>
        <p className="text-sm text-muted-foreground">
          Assign an invoice to your factor, review the factoring-ready package, and export the submission packet.
        </p>
      </div>

      <Card title="Saved factor contact" desc="Pre-fills the recipient when you export a packet. Only you can set this.">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="fname">Factor name</Label>
            <Input id="fname" value={factorName} onChange={(e) => setFactorName(e.target.value)} placeholder="Acme Factoring" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="femail">Factor email</Label>
            <Input id="femail" type="email" value={factorEmail} onChange={(e) => setFactorEmail(e.target.value)} placeholder="ar@acmefactoring.com" />
          </div>
        </div>
        <Button onClick={saveContact} disabled={savingContact}>
          {savingContact ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save contact"}
        </Button>
        {contact && <p className="text-xs text-muted-foreground">Saved: {contact.factorName} ({contact.factorEmail})</p>}
      </Card>

      <Card title="Invoice" desc="Enter a delivered load / invoice id to see its factoring-ready breakdown.">
        <div className="flex gap-2">
          <Input value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)} placeholder="load / invoice id" />
          <Button variant="secondary" onClick={loadPackage} disabled={loadingPkg || !invoiceId.trim()}>
            {loadingPkg ? <Loader2 className="h-4 w-4 animate-spin" /> : "Load"}
          </Button>
        </div>

        {pkg && (
          <div className="space-y-3">
            {payee && (
              <div className="flex items-center gap-2 text-sm">
                <Link2 className="h-4 w-4" />
                <span>Payment routes to <b>{payee.type}</b></span>
                <span className="text-muted-foreground">({payee.reason})</span>
              </div>
            )}
            <div className="overflow-hidden rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left">
                  <tr>
                    <th className="p-2">Line</th><th className="p-2">Amount</th><th className="p-2">Factorable</th>
                  </tr>
                </thead>
                <tbody>
                  {pkg.lines.map((l, i) => (
                    <tr key={i} className="border-t">
                      <td className="p-2">{l.kind === "LINEHAUL" ? "Linehaul" : `Accessorial (${l.accessorialType})`}</td>
                      <td className="p-2 tabular-nums">{formatCents(l.amountCents)}</td>
                      <td className="p-2"><Badge ok={l.factorable}>{l.factorable ? "yes" : (l.reason ?? "no")}</Badge></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t bg-muted/30 font-medium">
                    <td className="p-2">Advanceable total</td>
                    <td className="p-2 tabular-nums" colSpan={2}>{formatCents(pkg.advanceableTotalCents)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="recip">Recipient (optional override)</Label>
                <Input id="recip" value={recipientOverride} onChange={(e) => setRecipientOverride(e.target.value)}
                  placeholder={contact?.factorEmail ?? "factor email"} className="w-72" />
              </div>
              <Button onClick={startExport}><FileText className="mr-1 h-4 w-4" /> Export for factoring</Button>
            </div>

            {missing && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                <b>Cannot export yet.</b> Missing: {missing.join(", ")}
              </div>
            )}

            {review && (
              <div className="rounded-lg border-2 border-primary/40 bg-primary/5 p-4 space-y-3">
                <h3 className="font-semibold">Review before sending</h3>
                <p className="text-sm">To: <b>{recipientOverride.trim() || review.recipient}</b></p>
                <ul className="list-disc pl-5 text-sm">
                  {review.manifest.sections.map((s, i) => (
                    <li key={i}>{s.name}{s.present ? "" : " (missing)"}</li>
                  ))}
                </ul>
                <p className="text-sm text-muted-foreground">
                  Advanceable {formatCents(review.manifest.totals.advanceableTotalCents)} - sent from LoadLead on your
                  authenticated domain, reply-to you. Nothing is sent until you confirm.
                </p>
                <div className="flex gap-2">
                  <Button onClick={confirmSend} disabled={sending}>
                    {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Send className="mr-1 h-4 w-4" /> Confirm and send</>}
                  </Button>
                  <Button variant="ghost" onClick={() => setReview(null)}>Cancel</Button>
                </div>
              </div>
            )}
          </div>
        )}
      </Card>

      <Card title="Factoring assignments" desc="Assign a receivable to your factor. A debtor id also serves the Notice of Assignment.">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5"><Label>Factor name</Label>
            <Input value={newAssign.factorName} onChange={(e) => setNewAssign({ ...newAssign, factorName: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>Payout destination</Label>
            <Input value={newAssign.payoutDestination} onChange={(e) => setNewAssign({ ...newAssign, payoutDestination: e.target.value })} placeholder="remittance ref / account" /></div>
          <div className="space-y-1.5"><Label>Recourse</Label>
            <select className="h-10 w-full rounded-md border bg-background px-3" value={newAssign.recourseType}
              onChange={(e) => setNewAssign({ ...newAssign, recourseType: e.target.value })}>
              <option value="RECOURSE">Recourse</option><option value="NON_RECOURSE">Non-recourse</option></select></div>
          <div className="space-y-1.5"><Label>Scope</Label>
            <select className="h-10 w-full rounded-md border bg-background px-3" value={newAssign.scope}
              onChange={(e) => setNewAssign({ ...newAssign, scope: e.target.value })}>
              <option value="FULL_INVOICE">Full invoice</option><option value="LINEHAUL_ONLY">Linehaul only</option></select></div>
          <div className="space-y-1.5"><Label>Debtor id (optional, for NoA)</Label>
            <Input value={newAssign.debtorId} onChange={(e) => setNewAssign({ ...newAssign, debtorId: e.target.value })} /></div>
        </div>
        <p className="text-xs text-muted-foreground">Applies to the invoice id above when set, otherwise account-level.</p>
        <Button onClick={createAssignment}>Create assignment</Button>

        {assignments.length > 0 && (
          <div className="space-y-2 pt-2">
            {assignments.map((a) => (
              <div key={a.assignmentId} className="flex items-center justify-between rounded-lg border p-2 text-sm">
                <div>
                  <b>{a.factorName}</b> - {a.scope} - {a.recourseType} -{" "}
                  {a.accountLevel ? "account-level" : `invoice ${a.invoiceId}`}
                  <span className={`ml-2 ${a.status === "ACTIVE" ? "text-emerald-700" : "text-muted-foreground"}`}>{a.status}</span>
                </div>
                {a.status === "ACTIVE" && (
                  <Button variant="ghost" size="sm" onClick={() => releaseAssignment(a.assignmentId)}>Release</Button>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="Submitted to your factor" desc="The record of what left the platform, to whom, and when.">
        {submissions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No submissions yet.</p>
        ) : (
          <div className="space-y-2">
            {submissions.map((s) => (
              <div key={s.submissionId} className="flex items-center gap-2 rounded-lg border p-2 text-sm">
                {s.status === "SENT" ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <XCircle className="h-4 w-4 text-destructive" />}
                <span>Invoice {s.invoiceIds.join(", ")} to <b>{s.recipientEmail}</b></span>
                <span className="text-muted-foreground">{new Date(s.sentAt).toLocaleString()}</span>
                {s.status === "FAILED" && <span className="text-destructive">({s.error})</span>}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
