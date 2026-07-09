import { useParams } from "react-router-dom";
import { CarrierComplianceView } from "@/components/CarrierComplianceView";

/** Shipper view of a specific carrier's compliance (badges + gated packet). */
export default function CarrierCompliance() {
  const { operatorId } = useParams<{ operatorId: string }>();
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-bold">Carrier compliance</h1>
        <p className="text-sm text-muted-foreground">
          Verification status is always visible. The full documents open once you have an active relationship with this carrier.
        </p>
      </div>
      {operatorId ? (
        <CarrierComplianceView operatorId={operatorId} />
      ) : (
        <p className="text-sm text-muted-foreground">No carrier selected.</p>
      )}
    </div>
  );
}
