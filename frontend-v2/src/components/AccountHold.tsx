import { Link } from "react-router-dom";
import { AlertTriangle, Info } from "lucide-react";
import { Button } from "@/components/ui/button";

type VerificationStatus = "NONE" | "PENDING" | "APPROVED";

interface AccountHoldProps {
  profileComplete: boolean;
  verificationStatus: VerificationStatus;
  children?: React.ReactNode;
}

export function AccountHold({ profileComplete, verificationStatus, children }: AccountHoldProps) {
  const showHold = !profileComplete || verificationStatus === "NONE" || verificationStatus === "PENDING";

  if (verificationStatus === "APPROVED" && profileComplete) return <>{children}</>;

  return (
    <div>
      {!profileComplete && (
        <div className="mb-4 flex items-center gap-3 rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 text-orange-800">
          <AlertTriangle className="h-5 w-5 shrink-0 text-orange-500" />
          <div className="flex-1 text-sm">
            <span className="font-semibold">Your profile is incomplete.</span>{" "}
            Complete your profile in Settings to activate your account.
          </div>
          <Button asChild size="sm" variant="outline" className="border-orange-300 text-orange-800 hover:bg-orange-100">
            <Link to="/settings">Go to Settings</Link>
          </Button>
        </div>
      )}
      {profileComplete && (verificationStatus === "NONE" || verificationStatus === "PENDING") && (
        <div className="mb-4 flex items-center gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-blue-800">
          <Info className="h-5 w-5 shrink-0 text-blue-500" />
          <div className="flex-1 text-sm">
            <span className="font-semibold">Your account is pending verification.</span>{" "}
            You can still browse, but some features are limited until verified.
          </div>
        </div>
      )}
      <div className={showHold ? "opacity-75 pointer-events-none select-none" : ""}>
        {children}
      </div>
    </div>
  );
}
