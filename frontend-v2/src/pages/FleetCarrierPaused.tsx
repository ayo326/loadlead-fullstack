// Interstitial shown to fleet-carrier (CARRIER_ADMIN) accounts while the
// fleet-carrier PERSONA is muted (FLEET_CARRIER_PERSONA_ENABLED=false).
//
// It is friendly and reassuring by design: the account and its data are safe,
// nothing is deleted, and the persona returns with one config flip. It does
// NOT error, dead-end, or force-clear the session. Owner-operators never land
// here (they are a separate, active persona).

import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";

const SUPPORT_EMAIL = "support@inbound.loadleadapp.com";

export default function FleetCarrierPaused() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  const signOut = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-[#0b1b3a] to-[#0f2350] px-4">
      <div className="w-full max-w-lg rounded-2xl bg-white/95 backdrop-blur p-8 shadow-xl">
        <h1 className="text-2xl font-bold text-foreground">
          Fleet features are not open yet
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Our beta is currently focused on owner-operators, so fleet-carrier
          dashboards and multi-driver dispatch are paused for now. This is
          temporary.
        </p>

        <div className="mt-5 rounded-lg border border-border bg-secondary/50 p-4 text-sm text-foreground">
          <p className="font-medium">Your account and data are safe.</p>
          <p className="mt-1 text-muted-foreground">
            Nothing has been deleted or changed{user?.email ? ` on ${user.email}` : ""}.
            We will notify you the moment fleet features open up, and you can
            pick up right where you left off.
          </p>
        </div>

        <p className="mt-5 text-sm text-muted-foreground">
          Questions in the meantime? Reach us at{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="text-primary font-medium hover:underline">
            {SUPPORT_EMAIL}
          </a>
          .
        </p>

        <div className="mt-6 flex items-center gap-3">
          <Button variant="outline" onClick={signOut}>
            Sign out
          </Button>
          <a href={`mailto:${SUPPORT_EMAIL}`} className="text-sm text-muted-foreground hover:text-foreground">
            Contact support
          </a>
        </div>
      </div>
    </div>
  );
}
