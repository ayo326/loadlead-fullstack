import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { RuntimeConfigProvider, useRuntimeConfig } from "@/contexts/RuntimeConfigContext";
// Eager: the public entry surface (first paint) + the app shell.
import Landing from "./pages/Landing.tsx";
import Login from "./pages/Login.tsx";
import Signup from "./pages/Signup.tsx";
import AppLayout from "./layouts/AppLayout.tsx";
import { ErrorBoundary } from "./components/ErrorBoundary.tsx";
// D6: every persona dashboard and secondary page is route-level code-split
// so a signed-in shipper never downloads the driver/admin/carrier bundles.
// react-router only mounts the matched element, so the chunk loads on demand.
const PrivateBetaLanding = lazy(() => import("./pages/PrivateBetaLanding.tsx"));
const DriverDashboard = lazy(() => import("./pages/driver/DriverDashboard.tsx"));
const DriverLoadDetail = lazy(() => import("./pages/driver/LoadDetail.tsx"));
const ShipperDashboard = lazy(() => import("./pages/shipper/ShipperDashboard.tsx"));
const ShipperPostLoad = lazy(() => import("./pages/shipper/PostLoad.tsx"));
const ShipperLoadDetail = lazy(() => import("./pages/shipper/LoadDetail.tsx"));
const ReceiverDashboard = lazy(() => import("./pages/receiver/ReceiverDashboard.tsx"));
const ReceiverLoadDetail = lazy(() => import("./pages/receiver/LoadDetail.tsx"));
const AdminDashboard = lazy(() => import("./pages/admin/AdminDashboard.tsx"));
const SettingsPage = lazy(() => import("./pages/settings/SettingsPage.tsx"));
const BillOfLadingPage = lazy(() => import("./pages/bol/BillOfLadingPage.tsx"));
const ResetPassword = lazy(() => import("./pages/ResetPassword.tsx"));
const AcceptInvite = lazy(() => import("./pages/AcceptInvite.tsx"));
const SetupAdmin = lazy(() => import("./pages/SetupAdmin.tsx"));
const OwnerOperatorDashboard = lazy(() => import("./pages/owner-operator/OwnerOperatorDashboard.tsx"));
const OwnerOperatorSettings = lazy(() => import("./pages/owner-operator/OwnerOperatorSettings.tsx"));
const OwnerOperatorHistory = lazy(() => import("./pages/owner-operator/OwnerOperatorHistory.tsx"));
const OwnerOperatorLoadDetail = lazy(() => import("./pages/owner-operator/OwnerOperatorLoadDetail.tsx"));
const OwnerOperatorAnalytics = lazy(() => import("./pages/owner-operator/OwnerOperatorAnalytics.tsx"));
const FactoringWorkspace = lazy(() => import("./pages/factoring/FactoringWorkspace.tsx"));
const DriverAnalytics = lazy(() => import("./pages/driver/DriverAnalytics.tsx"));
const CarrierDashboard = lazy(() => import("./pages/carrier/CarrierDashboard.tsx"));
const CarrierMembers = lazy(() => import("./pages/carrier/CarrierMembers.tsx").then((m) => ({ default: m.CarrierMembers })));
const DriverHistory = lazy(() => import("./pages/driver/DriverHistory.tsx"));
const DriverVerification = lazy(() => import("./pages/driver/DriverVerification.tsx"));
const NotFound = lazy(() => import("./pages/NotFound.tsx"));
const FleetCarrierPaused = lazy(() => import("./pages/FleetCarrierPaused.tsx"));
const TaxonomySandbox = lazy(() => import("./pages/sandbox/TaxonomySandbox.tsx"));

const queryClient = new QueryClient();

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center text-muted-foreground text-sm">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

const roleHome: Record<string, string> = {
  DRIVER:         "/driver",
  OWNER_OPERATOR: "/owner-operator",
  SHIPPER:        "/shipper",
  RECEIVER:       "/receiver",
  ADMIN:          "/admin",
  CARRIER_ADMIN:  "/carrier",
};

function RequireRole({ role, children }: { role: string; children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== role) return <Navigate to={roleHome[user.role] ?? "/login"} replace />;
  return <>{children}</>;
}

// Gates the fleet-carrier PERSONA routes. While the persona is muted (flag
// off), direct navigation lands on the friendly interstitial instead of a
// broken/half-working page. When the flag is on, the route renders normally.
// The code is preserved either way. RequireRole still protects role as today.
function FleetCarrierGate({ children }: { children: React.ReactNode }) {
  const { fleetCarrierPersonaEnabled, loaded } = useRuntimeConfig();
  if (!loaded) return null; // wait for config so we do not flash the wrong state
  if (!fleetCarrierPersonaEnabled) return <Navigate to="/carrier-unavailable" replace />;
  return <>{children}</>;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <RuntimeConfigProvider>
        <AuthProvider>
          <ErrorBoundary>
          <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-muted-foreground text-sm">Loading…</div>}>
          <Routes>
            <Route path="/" element={<Landing />} />
            {/* Private-beta surface - public, no auth. The Landing page
                can fetch /api/beta/status and link visitors here when
                betaMode=true; gated signups still hit /signup with an
                invite token. */}
            <Route path="/private-beta" element={<PrivateBetaLanding />} />
            {/* Dev-only - taxonomy dropdown sandbox. No auth wrapper. */}
            <Route path="/sandbox/taxonomy" element={<TaxonomySandbox />} />
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
            {/* Interstitial for fleet-carrier accounts while the persona is
                muted. Standalone (no AppLayout) so a muted fleet user never
                sees a half-working carrier shell. Session is preserved. */}
            <Route path="/carrier-unavailable" element={<FleetCarrierPaused />} />
            <Route path="/forgot-password" element={<ResetPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/accept-invite" element={<AcceptInvite />} />
            <Route path="/setup/admin" element={<SetupAdmin />} />
            <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
              <Route path="/driver"                element={<RequireRole role="DRIVER"><DriverDashboard /></RequireRole>} />
              <Route path="/driver/history"       element={<RequireRole role="DRIVER"><DriverHistory /></RequireRole>} />
              <Route path="/driver/loads/:loadId" element={<RequireRole role="DRIVER"><DriverLoadDetail /></RequireRole>} />
              <Route path="/driver/verification/idv" element={<RequireRole role="DRIVER"><DriverVerification /></RequireRole>} />
              <Route path="/shipper"                  element={<RequireRole role="SHIPPER"><ShipperDashboard /></RequireRole>} />
              <Route path="/shipper/post"             element={<RequireRole role="SHIPPER"><ShipperPostLoad /></RequireRole>} />
              <Route path="/shipper/loads/:loadId"   element={<RequireRole role="SHIPPER"><ShipperLoadDetail /></RequireRole>} />
              <Route path="/receiver"            element={<RequireRole role="RECEIVER"><ReceiverDashboard /></RequireRole>} />
              <Route path="/receiver/loads/:loadId" element={<RequireRole role="RECEIVER"><ReceiverLoadDetail /></RequireRole>} />
              <Route path="/admin"        element={<RequireRole role="ADMIN"><AdminDashboard /></RequireRole>} />
              <Route path="/owner-operator"          element={<RequireRole role="OWNER_OPERATOR"><OwnerOperatorDashboard /></RequireRole>} />
              <Route path="/owner-operator/history"  element={<RequireRole role="OWNER_OPERATOR"><OwnerOperatorHistory /></RequireRole>} />
              <Route path="/owner-operator/loads/:loadId" element={<RequireRole role="OWNER_OPERATOR"><OwnerOperatorLoadDetail /></RequireRole>} />
              <Route path="/owner-operator/analytics" element={<RequireRole role="OWNER_OPERATOR"><OwnerOperatorAnalytics /></RequireRole>} />
              <Route path="/owner-operator/factoring" element={<RequireRole role="OWNER_OPERATOR"><FactoringWorkspace /></RequireRole>} />
              {/* Same workspace for fleet-carrier org managers - the backend resolves the org as the carrier (resolveCarrierIdForUser). */}
              <Route path="/carrier/factoring" element={<RequireRole role="CARRIER_ADMIN"><FleetCarrierGate><FactoringWorkspace /></FleetCarrierGate></RequireRole>} />
              <Route path="/driver/analytics" element={<RequireRole role="DRIVER"><DriverAnalytics /></RequireRole>} />
              <Route path="/owner-operator/settings" element={<RequireRole role="OWNER_OPERATOR"><OwnerOperatorSettings /></RequireRole>} />
              <Route path="/carrier" element={<RequireRole role="CARRIER_ADMIN"><FleetCarrierGate><CarrierDashboard /></FleetCarrierGate></RequireRole>} />
              <Route path="/carrier/members" element={<RequireRole role="CARRIER_ADMIN"><FleetCarrierGate><CarrierMembers /></FleetCarrierGate></RequireRole>} />
              <Route path="/settings"    element={<SettingsPage />} />
              {/* Bill of Lading - all roles, accessed via their load detail */}
              <Route path="/bol/:loadId" element={<BillOfLadingPage />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
          </Suspense>
          </ErrorBoundary>
        </AuthProvider>
        </RuntimeConfigProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
