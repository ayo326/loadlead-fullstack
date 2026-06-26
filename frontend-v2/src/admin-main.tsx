// Admin bundle entry. Mounted at admin.loadleadapp.com via dist-admin/.
//
// This file deliberately imports as little of the customer surface as
// possible: just AuthProvider, the AppLayout shell, the login page, and
// the AdminDashboard. There is no Landing, no signup, no driver/shipper/
// receiver/carrier routes. If an attacker reaches the admin host they get
// a bundle that can only render the admin console, and only after a
// successful ADMIN login (which is already MFA-gated server-side).
//
// Defence in depth -- the *real* enforcement remains the requireAdmin
// guard on /api/admin/* in the backend. This bundle is the public face
// of that gate, not the gate itself.

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";

import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import AdminAppLayout from "@/layouts/AdminAppLayout";
import AdminLogin from "@/pages/admin/AdminLogin";
import AdminDashboard from "@/pages/admin/AdminDashboard";
import BetaProgramDashboard from "@/pages/admin/BetaProgramDashboard";
import AdminSettings from "@/pages/admin/AdminSettings";
import AcceptStaffInvite from "@/pages/admin/AcceptStaffInvite";
import "./index.css";

const queryClient = new QueryClient();

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center text-muted-foreground text-sm">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  // Hard ADMIN-only gate. A non-ADMIN that somehow signed in here is
  // bounced to login. The server still 403s every /api/admin/* call,
  // so this is convenience, not security.
  if (user.role !== "ADMIN") return <Navigate to="/login" replace />;
  return <>{children}</>;
}

const AdminApp = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<AdminLogin />} />
            {/* Public staff-invite acceptance — no session yet; token-gated. */}
            <Route path="/accept-staff-invite" element={<AcceptStaffInvite />} />
            <Route element={<RequireAuth><AdminAppLayout /></RequireAuth>}>
              <Route path="/admin" element={<RequireAdmin><AdminDashboard /></RequireAdmin>} />
              <Route path="/admin/beta" element={<RequireAdmin><BetaProgramDashboard /></RequireAdmin>} />
              <Route path="/admin/settings" element={<RequireAdmin><AdminSettings /></RequireAdmin>} />
              <Route path="*" element={<Navigate to="/admin" replace />} />
            </Route>
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

createRoot(document.getElementById("root")!).render(
  <StrictMode><AdminApp /></StrictMode>,
);
