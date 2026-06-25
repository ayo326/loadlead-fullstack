import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import Landing from "./pages/Landing.tsx";
import PrivateBetaLanding from "./pages/PrivateBetaLanding.tsx";
import Login from "./pages/Login.tsx";
import Signup from "./pages/Signup.tsx";
import AppLayout from "./layouts/AppLayout.tsx";
import DriverDashboard from "./pages/driver/DriverDashboard.tsx";
import DriverLoadDetail from "./pages/driver/LoadDetail.tsx";
import ShipperDashboard from "./pages/shipper/ShipperDashboard.tsx";
import ShipperPostLoad from "./pages/shipper/PostLoad.tsx";
import ShipperLoadDetail from "./pages/shipper/LoadDetail.tsx";
import ReceiverDashboard from "./pages/receiver/ReceiverDashboard.tsx";
import ReceiverLoadDetail from "./pages/receiver/LoadDetail.tsx";
import AdminDashboard from "./pages/admin/AdminDashboard.tsx";
import SettingsPage from "./pages/settings/SettingsPage.tsx";
import BillOfLadingPage from "./pages/bol/BillOfLadingPage.tsx";
import ResetPassword from "./pages/ResetPassword.tsx";
import AcceptInvite from "./pages/AcceptInvite.tsx";
import SetupAdmin from "./pages/SetupAdmin.tsx";
import OwnerOperatorDashboard from "./pages/owner-operator/OwnerOperatorDashboard.tsx";
import OwnerOperatorSettings from "./pages/owner-operator/OwnerOperatorSettings.tsx";
import OwnerOperatorHistory from "./pages/owner-operator/OwnerOperatorHistory.tsx";
import OwnerOperatorLoadDetail from "./pages/owner-operator/OwnerOperatorLoadDetail.tsx";
import OwnerOperatorAnalytics from "./pages/owner-operator/OwnerOperatorAnalytics.tsx";
import DriverAnalytics from "./pages/driver/DriverAnalytics.tsx";
import CarrierDashboard from "./pages/carrier/CarrierDashboard.tsx";
import { CarrierMembers } from "./pages/carrier/CarrierMembers.tsx";
import DriverHistory from "./pages/driver/DriverHistory.tsx";
import DriverVerification from "./pages/driver/DriverVerification.tsx";
import NotFound from "./pages/NotFound.tsx";
import { ErrorBoundary } from "./components/ErrorBoundary.tsx";
import TaxonomySandbox from "./pages/sandbox/TaxonomySandbox.tsx";

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

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <ErrorBoundary>
          <Routes>
            <Route path="/" element={<Landing />} />
            {/* Private-beta surface — public, no auth. The Landing page
                can fetch /api/beta/status and link visitors here when
                betaMode=true; gated signups still hit /signup with an
                invite token. */}
            <Route path="/private-beta" element={<PrivateBetaLanding />} />
            {/* Dev-only — taxonomy dropdown sandbox. No auth wrapper. */}
            <Route path="/sandbox/taxonomy" element={<TaxonomySandbox />} />
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
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
              <Route path="/driver/analytics" element={<RequireRole role="DRIVER"><DriverAnalytics /></RequireRole>} />
              <Route path="/owner-operator/settings" element={<RequireRole role="OWNER_OPERATOR"><OwnerOperatorSettings /></RequireRole>} />
              <Route path="/carrier" element={<RequireRole role="CARRIER_ADMIN"><CarrierDashboard /></RequireRole>} />
              <Route path="/carrier/members" element={<RequireRole role="CARRIER_ADMIN"><CarrierMembers /></RequireRole>} />
              <Route path="/settings"    element={<SettingsPage />} />
              {/* Bill of Lading — all roles, accessed via their load detail */}
              <Route path="/bol/:loadId" element={<BillOfLadingPage />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
          </ErrorBoundary>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
