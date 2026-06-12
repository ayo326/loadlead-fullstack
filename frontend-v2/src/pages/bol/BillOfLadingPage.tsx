import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import { SignaturePad } from "@/components/SignaturePad";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import {
  FileText, Clock, CheckCircle2, AlertTriangle, Truck,
  Package, Building2, User, ArrowLeft, Printer, Database,
  ChevronDown, ChevronUp, Shield, Info
} from "lucide-react";

const STATUS_COLORS: Record<string, string> = {
  DRAFT:      "bg-gray-100 text-gray-700",
  ISSUED:     "bg-blue-100 text-blue-700",
  PICKED_UP:  "bg-yellow-100 text-yellow-700",
  IN_TRANSIT: "bg-orange-100 text-orange-700",
  DELIVERED:  "bg-green-100 text-green-700",
  DISPUTED:   "bg-red-100 text-red-700",
};

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft", ISSUED: "Issued", PICKED_UP: "Picked Up",
  IN_TRANSIT: "In Transit", DELIVERED: "Delivered", DISPUTED: "Disputed",
};

function Field({ label, value, className = "" }: { label: string; value?: string | number | null; className?: string }) {
  return (
    <div className={`${className}`}>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">{label}</p>
      <p className="text-sm font-medium text-foreground border-b border-dashed border-border pb-1 min-h-[22px]">
        {value ?? <span className="text-muted-foreground/50 italic">—</span>}
      </p>
    </div>
  );
}

function Section({ title, icon: Icon, children, collapsible = false }: { title: string; icon: any; children: React.ReactNode; collapsible?: boolean }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="border rounded-xl overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-4 py-3 bg-muted/40 hover:bg-muted/60 transition-colors"
        onClick={() => collapsible && setOpen(o => !o)}
      >
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-primary" />
          <span className="font-semibold text-sm">{title}</span>
        </div>
        {collapsible && (open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />)}
      </button>
      {open && <div className="p-4">{children}</div>}
    </div>
  );
}

function SignatureBlock({ label, sig, role, userRole, bolStatus, onSign }: {
  label: string; sig?: any; role: string; userRole: string; bolStatus: string; onSign: (data: string) => void;
}) {
  const canSign = userRole === role && !sig && bolStatus !== 'DELIVERED' && bolStatus !== 'DISPUTED';
  return (
    <div className="border rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="font-semibold text-sm">{label}</p>
        {sig ? (
          <Badge className="bg-green-100 text-green-700 text-xs">
            <CheckCircle2 className="h-3 w-3 mr-1" /> Signed
          </Badge>
        ) : (
          <Badge variant="outline" className="text-xs text-muted-foreground">Awaiting Signature</Badge>
        )}
      </div>
      {sig ? (
        <div className="space-y-1">
          <img src={sig.signatureData} alt="signature" className="h-16 border rounded bg-white w-full object-contain" />
          <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground mt-1">
            <span><strong>Signed by:</strong> {sig.signedBy}</span>
            <span><strong>Time:</strong> {new Date(sig.signedAt).toLocaleString()}</span>
            {sig.location && <span><strong>Location:</strong> {sig.location}</span>}
          </div>
        </div>
      ) : canSign ? (
        <SignaturePad label="Draw your signature below" onSave={onSign} />
      ) : (
        <div className="h-16 flex items-center justify-center bg-muted/30 rounded border-dashed border text-xs text-muted-foreground">
          {userRole === role ? "Complete prior steps first" : "Pending"}
        </div>
      )}
    </div>
  );
}

export default function BillOfLadingPage() {
  const { loadId } = useParams<{ loadId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [bol, setBol] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [disputeReason, setDisputeReason] = useState("");
  const [showDispute, setShowDispute] = useState(false);
  const [signerName, setSignerName] = useState(user?.email || "");
  const [wmsOpen, setWmsOpen] = useState(false);
  const [wmsFields, setWmsFields] = useState<any>({});

  const role = user?.role || "";

  useEffect(() => {
    if (!loadId) return;
    api.getBOLByLoadId(loadId)
      .then((r: any) => setBol(r.bol))
      .catch(() => setBol(null))
      .finally(() => setLoading(false));
  }, [loadId]);

  const createBOL = async () => {
    setCreating(true);
    try {
      const r = await api.createBOL(loadId!);
      setBol(r.bol);
      toast({ title: "BOL created", description: `BOL ${r.bol.bolNumber} issued` });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  const sign = async (signatureData: string) => {
    try {
      const r = await api.signBOL(bol.bolId, { signatureData, signedBy: signerName });
      setBol(r.bol);
      toast({ title: "Signed successfully", description: `Signature recorded at ${new Date().toLocaleString()}` });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  const dispute = async () => {
    if (!disputeReason.trim()) return;
    try {
      const r = await api.disputeBOL(bol.bolId, disputeReason);
      setBol(r.bol);
      setShowDispute(false);
      toast({ title: "Dispute filed", variant: "destructive" });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  const saveWMS = async () => {
    try {
      const r = await api.updateBOLWMS(bol.bolId, { ...wmsFields, enabled: true });
      setBol(r.bol);
      toast({ title: "WMS integration saved" });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  const print = () => window.print();

  const backPath = role === "SHIPPER" ? `/shipper/loads/${loadId}`
    : role === "DRIVER" ? `/driver/loads/${loadId}`
    : role === "RECEIVER" ? `/receiver/loads/${loadId}`
    : "/admin";

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" />
    </div>
  );

  // Shipper can create BOL if none exists
  if (!bol && role === "SHIPPER") {
    return (
      <div className="max-w-2xl mx-auto py-16 text-center space-y-4">
        <FileText className="h-16 w-16 mx-auto text-muted-foreground/40" />
        <h2 className="text-2xl font-bold">No Bill of Lading Yet</h2>
        <p className="text-muted-foreground">Issue a digital BOL for this shipment. Party details will be auto-populated from profiles.</p>
        <Button onClick={createBOL} disabled={creating} size="lg">
          {creating ? "Creating..." : "Issue Bill of Lading"}
        </Button>
      </div>
    );
  }

  if (!bol) {
    return (
      <div className="max-w-2xl mx-auto py-16 text-center space-y-4">
        <FileText className="h-16 w-16 mx-auto text-muted-foreground/40" />
        <h2 className="text-xl font-semibold">BOL not available yet</h2>
        <p className="text-muted-foreground">The shipper has not issued a Bill of Lading for this shipment.</p>
      </div>
    );
  }

  const totalWeight = bol.commodities?.reduce((s: number, c: any) => s + (c.weight || 0), 0) || 0;
  const totalPkgs   = bol.commodities?.reduce((s: number, c: any) => s + (c.pkgs || 0), 0) || 0;

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-12">
      {/* Header */}
      <div className="flex items-center gap-3 no-print">
        <Button variant="ghost" size="sm" onClick={() => navigate(backPath)}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={print}><Printer className="h-4 w-4 mr-1" /> Print</Button>
      </div>

      {/* BOL Header */}
      <div className="border-2 rounded-xl p-5 bg-white shadow-sm">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-black tracking-tight uppercase">Bill of Lading</h1>
            <p className="text-xs text-muted-foreground uppercase tracking-wider mt-0.5">ORIGINAL — NOT NEGOTIABLE</p>
          </div>
          <div className="text-right space-y-1">
            <Badge className={`${STATUS_COLORS[bol.status]} text-xs px-3 py-1`}>
              {STATUS_LABELS[bol.status]}
            </Badge>
            <p className="text-xs text-muted-foreground">BOL #</p>
            <p className="font-mono font-bold text-sm">{bol.bolNumber}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
          <Field label="Date Issued" value={new Date(bol.issuedAt).toLocaleDateString()} />
          <Field label="Shipper #" value={bol.shipperNumber} />
          <Field label="PRO #" value={bol.proNumber} />
          <Field label="SCAC" value={bol.scac} />
        </div>
      </div>

      {/* Carrier */}
      <Section title="Carrier Information" icon={Truck}>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <Field label="Carrier Name" value={bol.carrier?.name} />
          <Field label="Carrier #" value={bol.carrier?.carrierNumber} />
          <Field label="Route" value={bol.carrier?.route} />
          <Field label="MC Number" value={bol.carrier?.mcNumber} />
          <Field label="DOT Number" value={bol.carrier?.dotNumber} />
          <Field label="Driver Name" value={bol.carrier?.driverName} />
          <Field label="Trailer #" value={bol.trailerNumber || bol.carrier?.trailerNumber} />
          <Field label="Emergency Phone" value={bol.carrier?.emergencyPhone} />
          <Field label="Piece Count" value={bol.pieceCount} />
        </div>
      </Section>

      {/* Origin / Destination */}
      <div className="grid md:grid-cols-2 gap-4">
        {/* ORIGIN */}
        <div className="border rounded-xl overflow-hidden">
          <div className="bg-primary text-primary-foreground px-4 py-2 font-bold text-sm uppercase tracking-wider">
            ORIGIN — FROM (Consignor)
          </div>
          <div className="p-4 space-y-3">
            <Field label="Company / Name" value={bol.consignor?.name} />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Attention" value={bol.consignor?.attn} />
              <Field label="Phone" value={bol.consignor?.phone} />
            </div>
            <Field label="Address" value={bol.consignor?.address} />
            <div className="grid grid-cols-3 gap-3">
              <Field label="City" value={bol.consignor?.city} className="col-span-1" />
              <Field label="State" value={bol.consignor?.state} />
              <Field label="Zip" value={bol.consignor?.zip} />
            </div>
            <Separator />
            <div className="flex flex-wrap gap-4 text-xs">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={bol.originLiftGate} readOnly className="rounded" />
                <span>Lift Gate</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={bol.originInsidePickup} readOnly className="rounded" />
                <span>Inside Pickup</span>
              </label>
              {bol.pickupHours && <span><strong>Pickup Hours:</strong> {bol.pickupHours}</span>}
            </div>
          </div>
        </div>

        {/* DESTINATION */}
        <div className="border rounded-xl overflow-hidden">
          <div className="bg-slate-700 text-white px-4 py-2 font-bold text-sm uppercase tracking-wider">
            DESTINATION — TO (Consignee)
          </div>
          <div className="p-4 space-y-3">
            <Field label="Company / Name" value={bol.consignee?.name} />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Attention" value={bol.consignee?.attn} />
              <Field label="Phone" value={bol.consignee?.phone} />
            </div>
            <Field label="Address" value={bol.consignee?.address} />
            <div className="grid grid-cols-3 gap-3">
              <Field label="City" value={bol.consignee?.city} className="col-span-1" />
              <Field label="State" value={bol.consignee?.state} />
              <Field label="Zip" value={bol.consignee?.zip} />
            </div>
            <Separator />
            <div className="flex flex-wrap gap-4 text-xs">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={bol.destinationLiftGate} readOnly className="rounded" />
                <span>Lift Gate</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={bol.destinationInsideDelivery} readOnly className="rounded" />
                <span>Inside Delivery</span>
              </label>
              {bol.deliveryHours && <span><strong>Delivery Hours:</strong> {bol.deliveryHours}</span>}
            </div>
          </div>
        </div>
      </div>

      {/* Special Instructions */}
      {(bol.specialInstructions || role === "SHIPPER") && (
        <div className="border rounded-xl p-4 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Special Instructions</p>
          <p className="text-sm">{bol.specialInstructions || <span className="italic text-muted-foreground">None</span>}</p>
        </div>
      )}

      {/* Freight / Financial */}
      <div className="border rounded-xl overflow-hidden">
        <div className="bg-muted/40 px-4 py-2 flex items-center gap-2 border-b">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Freight Charges are <strong className={bol.freightChargesPrepaid ? "text-primary" : "text-orange-600"}>
              {bol.freightChargesPrepaid ? "PREPAID" : "COLLECT"}
            </strong>
          </span>
          <div className="flex-1" />
          <div className="flex gap-6 text-xs">
            <span><strong>C.O.D. Amt:</strong> {bol.codAmount ? `$${bol.codAmount}` : "—"}</span>
            <span><strong>C.O.D. Fee:</strong> {bol.codFee ? `$${bol.codFee}` : "—"}</span>
            <span className="font-bold"><strong>Total Charges:</strong> {bol.totalCharges ? `$${bol.totalCharges.toLocaleString()}` : "—"}</span>
          </div>
        </div>
        {bol.remitCODTo?.address && (
          <div className="px-4 py-2 text-xs border-b">
            <strong>Remit C.O.D. to:</strong> {bol.remitCODTo.name}, {bol.remitCODTo.address}, {bol.remitCODTo.city}, {bol.remitCODTo.state} {bol.remitCODTo.zip} — {bol.remitCODTo.phone}
          </div>
        )}
      </div>

      {/* Commodities Table */}
      <Section title="Commodities / Articles" icon={Package}>
        <div className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
          <Info className="h-3 w-3" />
          Mark HM column for Hazardous Materials per DOT regulations
        </div>
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted text-xs uppercase tracking-wider">
              <tr>
                <th className="px-3 py-2 text-left font-semibold"># Pkgs</th>
                <th className="px-3 py-2 text-center font-semibold">HM</th>
                <th className="px-3 py-2 text-left font-semibold">Description of Articles, Special Marks & Exceptions</th>
                <th className="px-3 py-2 text-right font-semibold">Weight (LBS)</th>
                <th className="px-3 py-2 text-center font-semibold">Class/Rate</th>
                <th className="px-3 py-2 text-right font-semibold">Volume</th>
              </tr>
            </thead>
            <tbody>
              {bol.commodities?.map((c: any, i: number) => (
                <tr key={i} className={`border-t ${c.hazmat ? "bg-red-50" : i % 2 === 1 ? "bg-muted/20" : ""}`}>
                  <td className="px-3 py-2 font-medium">{c.pkgs}</td>
                  <td className="px-3 py-2 text-center">
                    {c.hazmat && <span className="font-bold text-red-600">X</span>}
                  </td>
                  <td className="px-3 py-2">
                    <p className="font-medium">{c.description}</p>
                    {c.nmfcCode && <p className="text-xs text-muted-foreground">NMFC: {c.nmfcCode}</p>}
                  </td>
                  <td className="px-3 py-2 text-right font-medium">{c.weight?.toLocaleString()}</td>
                  <td className="px-3 py-2 text-center text-muted-foreground">{c.freightClass || "—"}</td>
                  <td className="px-3 py-2 text-right text-muted-foreground">{c.volume || "—"}</td>
                </tr>
              ))}
              <tr className="border-t bg-muted/30 font-bold">
                <td className="px-3 py-2">{totalPkgs} total</td>
                <td />
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  *Weight subject to correction. {bol.declaredValue && `Declared value: $${bol.declaredValue} per ${bol.declaredValueUnit}`}
                </td>
                <td className="px-3 py-2 text-right">{totalWeight.toLocaleString()} LBS</td>
                <td /><td />
              </tr>
            </tbody>
          </table>
        </div>
        {bol.customsInstructions && (
          <div className="mt-3 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm">
            <strong>Customs Instructions:</strong> {bol.customsInstructions}
          </div>
        )}
      </Section>

      {/* Legal Notice */}
      <div className="bg-muted/30 rounded-xl p-4 text-xs text-muted-foreground leading-relaxed border">
        <p><strong>NOTICE:</strong> Received, subject to the classifications and tariffs in effect on the date of this Bill of Lading, the property described above, in apparent good order, except as noted (contents and condition of contents of packages unknown), marked, consigned, and destined as indicated above. Liability limitation for loss or damage may be applicable per 49 USC §14706(c)(1)(A) and (B). Commodities requiring special or additional care must be so marked and packaged as to ensure safe transportation with ordinary care. See Section 2(e) of National Motor Freight Classification, Item 360.</p>
        {!bol.freightChargesPrepaid && (
          <p className="mt-2 font-medium text-foreground">FREIGHT COLLECT: Subject to Section 7 of conditions, if this shipment is to be delivered to the consignee without recourse on the consignor, the consignor shall sign below. The carrier shall not make delivery of this shipment without payment of freight and all other lawful charges.</p>
        )}
      </div>

      {/* Signer Name */}
      {!bol.shipperSignature && role === "SHIPPER" ||
       !bol.carrierSignature && role === "DRIVER" ||
       !bol.consigneeSignature && role === "RECEIVER" ? (
        <div className="space-y-1">
          <p className="text-sm font-medium">Your full name (for signature record)</p>
          <Input value={signerName} onChange={e => setSignerName(e.target.value)} placeholder="Full legal name" className="max-w-xs" />
        </div>
      ) : null}

      {/* Certifications & Signatures */}
      <div className="grid md:grid-cols-2 gap-4">
        {/* Shipper Certification */}
        {(role === "SHIPPER" || role === "ADMIN" || bol.shipperSignature) && (
          <div className="border rounded-xl overflow-hidden">
            <div className="bg-slate-100 px-4 py-2 font-bold text-sm uppercase tracking-wider border-b">
              Shipper Certification
            </div>
            <div className="p-4 space-y-3">
              <p className="text-xs text-muted-foreground">
                Shipper certifies that the contents of this consignment are properly classified, packaged, marked, and labeled/placarded, and are in all respects in proper condition for transport according to applicable DOT regulations.
              </p>
              <SignatureBlock
                label="Consignor Signature"
                sig={bol.shipperSignature}
                role="SHIPPER"
                userRole={role}
                bolStatus={bol.status}
                onSign={sign}
              />
            </div>
          </div>
        )}

        {/* Carrier Certification */}
        {(role === "DRIVER" || role === "ADMIN" || bol.carrierSignature) && (
          <div className="border rounded-xl overflow-hidden">
            <div className="bg-slate-100 px-4 py-2 font-bold text-sm uppercase tracking-wider border-b">
              Carrier Certification
            </div>
            <div className="p-4 space-y-3">
              <p className="text-xs text-muted-foreground">
                Carrier acknowledges receipt of packages and required placards. Carrier certifies emergency response information was made available and/or Carrier has the U.S. DOT emergency response guidebook. Property received in good order, except as noted.
              </p>
              <SignatureBlock
                label="Carrier Signature (Pickup)"
                sig={bol.carrierSignature}
                role="DRIVER"
                userRole={role}
                bolStatus={bol.status}
                onSign={sign}
              />
            </div>
          </div>
        )}
      </div>

      {/* Consignee Delivery Receipt */}
      {(role === "RECEIVER" || role === "ADMIN" || bol.consigneeSignature) && (
        <div className="border rounded-xl overflow-hidden">
          <div className="bg-slate-100 px-4 py-2 font-bold text-sm uppercase tracking-wider border-b flex items-center justify-between">
            <span>Consignee Delivery Receipt</span>
            {bol.deliveryExceptions && (
              <Badge className="bg-red-100 text-red-700 text-xs">
                <AlertTriangle className="h-3 w-3 mr-1" /> Exceptions Noted
              </Badge>
            )}
          </div>
          <div className="p-4 space-y-4">
            <SignatureBlock
              label="Consignee Signature (Delivery)"
              sig={bol.consigneeSignature}
              role="RECEIVER"
              userRole={role}
              bolStatus={bol.status}
              onSign={sign}
            />
            {bol.deliveryExceptions && (
              <div className="p-3 bg-red-50 border border-red-200 rounded text-sm">
                <strong>Exceptions / Damage Notes:</strong> {bol.deliveryExceptions}
              </div>
            )}
            {/* Receiver can dispute after signing */}
            {role === "RECEIVER" && bol.status !== "DISPUTED" && bol.consigneeSignature && (
              <div className="space-y-2">
                {showDispute ? (
                  <div className="space-y-2">
                    <Textarea
                      placeholder="Describe the exception, damage, or shortage..."
                      value={disputeReason}
                      onChange={e => setDisputeReason(e.target.value)}
                      rows={3}
                    />
                    <div className="flex gap-2">
                      <Button variant="destructive" size="sm" onClick={dispute}>File Dispute</Button>
                      <Button variant="outline" size="sm" onClick={() => setShowDispute(false)}>Cancel</Button>
                    </div>
                  </div>
                ) : (
                  <Button variant="outline" size="sm" className="text-red-600 border-red-200" onClick={() => setShowDispute(true)}>
                    <AlertTriangle className="h-3 w-3 mr-1" /> Note Exception / File Dispute
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* WMS Integration (Receiver + Admin) */}
      {(role === "RECEIVER" || role === "ADMIN") && (
        <div className="border rounded-xl overflow-hidden">
          <button
            className="w-full flex items-center justify-between px-4 py-3 bg-muted/40 hover:bg-muted/60 transition-colors"
            onClick={() => setWmsOpen(o => !o)}
          >
            <div className="flex items-center gap-2">
              <Database className="h-4 w-4 text-primary" />
              <span className="font-semibold text-sm">WMS Integration</span>
              <Badge variant="outline" className="text-xs ml-1">Future Integration</Badge>
              {bol.wmsIntegration?.enabled && (
                <Badge className="bg-green-100 text-green-700 text-xs">Active</Badge>
              )}
            </div>
            {wmsOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          {wmsOpen && (
            <div className="p-4 space-y-4">
              <p className="text-xs text-muted-foreground">
                Connect this BOL to your Warehouse Management System. These fields are reserved for future WMS integration via webhook or API.
              </p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {[
                  { key: "wmsProvider", label: "WMS Provider", placeholder: "e.g. SAP, Manhattan, Oracle" },
                  { key: "warehouseCode", label: "Warehouse Code", placeholder: "WHC-001" },
                  { key: "dockDoor", label: "Dock Door", placeholder: "Door 4B" },
                  { key: "appointmentTime", label: "Appointment Time", placeholder: "09:00 AM" },
                  { key: "poNumber", label: "PO Number", placeholder: "PO-12345" },
                  { key: "soNumber", label: "SO Number", placeholder: "SO-67890" },
                  { key: "receiptNumber", label: "Receipt Number", placeholder: "REC-001" },
                  { key: "externalBolId", label: "External BOL ID", placeholder: "WMS-BOL-XYZ" },
                  { key: "webhookUrl", label: "Webhook URL", placeholder: "https://wms.example.com/webhook" },
                ].map(f => (
                  <div key={f.key} className="space-y-1">
                    <p className="text-xs font-medium text-muted-foreground">{f.label}</p>
                    <Input
                      placeholder={bol.wmsIntegration?.[f.key] || f.placeholder}
                      defaultValue={bol.wmsIntegration?.[f.key] || ""}
                      onChange={e => setWmsFields((p: any) => ({ ...p, [f.key]: e.target.value }))}
                      className="text-sm"
                    />
                  </div>
                ))}
              </div>
              {bol.wmsIntegration?.syncedAt && (
                <p className="text-xs text-muted-foreground">Last synced: {new Date(bol.wmsIntegration.syncedAt).toLocaleString()}</p>
              )}
              <Button size="sm" onClick={saveWMS}>
                <Database className="h-3 w-3 mr-1" /> Save WMS Integration
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Shipment Timeline */}
      <Section title="Shipment Timeline" icon={Clock} collapsible>
        <div className="space-y-3">
          {bol.timeline?.map((ev: any, i: number) => (
            <div key={i} className="flex gap-3">
              <div className="flex flex-col items-center">
                <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                </div>
                {i < bol.timeline.length - 1 && <div className="w-0.5 flex-1 bg-border mt-1" />}
              </div>
              <div className="flex-1 pb-3">
                <div className="flex items-center justify-between">
                  <p className="font-semibold text-sm">{ev.event.replace(/_/g, " ")}</p>
                  <Badge variant="outline" className="text-xs">{ev.actorRole}</Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {new Date(ev.timestamp).toLocaleString()}
                  {ev.location && ` · ${ev.location}`}
                </p>
                {ev.notes && <p className="text-xs text-muted-foreground mt-0.5 italic">{ev.notes}</p>}
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* Legal footer (print only) */}
      <div className="hidden print:block text-xs text-center text-muted-foreground pt-4 border-t">
        LoadLead Digital Bill of Lading · {bol.bolNumber} · Generated {new Date().toLocaleString()} · loadleadapp.com
      </div>
    </div>
  );
}
