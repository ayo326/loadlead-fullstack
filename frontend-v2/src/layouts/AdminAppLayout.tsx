// Internal-staff layout for admin.loadleadapp.com.
//
// Phase 5 independence: a deliberately separate module from
// layouts/AppLayout.tsx. The customer surfaces and the staff console
// share NO parameterised container -- this file imports zero customer-
// surface routes and customer pages import zero of this. The header
// row, sidebar, and footer are bespoke to the ops console (env badge,
// "Internal use only" copy, no marketing).
//
// Server-side enforcement is unchanged -- requireAdmin on /api/admin/*
// is the real gate; this layout's existence is convenience UX.

import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  ShieldCheck, Inbox, Truck, LogOut, ChevronRight, Rocket,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";

function envFromApi(): { label: string; tone: "prod" | "staging" | "dev" } {
  const api = (import.meta.env.VITE_API_URL as string | undefined) ?? "";
  if (api.includes("api.loadleadapp.com")) return { label: "PROD",    tone: "prod" };
  if (api.includes("staging"))             return { label: "STAGING", tone: "staging" };
  return                                          { label: "DEV",     tone: "dev" };
}

const ADMIN_NAV = [
  { title: "Operations console", url: "/admin",      icon: ShieldCheck, hint: "Orgs, fleet, support" },
  { title: "Beta Program",       url: "/admin/beta", icon: Rocket,      hint: "Applications, cohort, admit" },
] as const;

export default function AdminAppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const env = envFromApi();

  async function handleLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      {/* Top bar -- internal-only branding + env badge */}
      <header
        className="px-4 py-3 border-b border-border flex items-center justify-between gap-3 sticky top-0 z-30 bg-background"
        role="banner"
      >
        <div className="flex items-center gap-3">
          <img
            src="/loadlead-logo.png"
            alt="LoadLead"
            className="h-7 w-auto select-none"
            draggable={false}
          />
          <span className="text-xs font-medium text-muted-foreground hidden sm:inline">
            · Platform Operations
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={
              "text-[10px] font-bold tracking-widest px-2 py-1 rounded " +
              (env.tone === "prod"
                ? "bg-destructive/15 text-destructive"
                : env.tone === "staging"
                ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                : "bg-muted text-muted-foreground")
            }
            aria-label={`Environment: ${env.label}`}
          >
            {env.label}
          </span>
          {user?.email && (
            <span className="text-xs text-muted-foreground hidden sm:inline" aria-label={`Signed in as ${user.email}`}>
              {user.email}
            </span>
          )}
          <Button variant="ghost" size="sm" onClick={handleLogout} aria-label="Sign out">
            <LogOut className="h-3.5 w-3.5 mr-1.5" aria-hidden /> Sign out
          </Button>
        </div>
      </header>

      <div className="flex-1 flex">
        {/* Sidebar */}
        <nav
          className="hidden md:flex w-56 shrink-0 border-r border-border bg-card flex-col"
          aria-label="Operations console navigation"
        >
          <ul className="p-3 space-y-1">
            {ADMIN_NAV.map((item) => (
              <li key={item.url}>
                <NavLink
                  to={item.url}
                  className={({ isActive }) =>
                    `flex items-center gap-2 px-2 py-1.5 rounded text-sm font-medium transition-colors ${
                      isActive
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`
                  }
                  end
                >
                  <item.icon className="h-4 w-4" aria-hidden />
                  <span>{item.title}</span>
                  <ChevronRight className="h-3 w-3 ml-auto opacity-50" aria-hidden />
                </NavLink>
              </li>
            ))}
          </ul>
          <div className="mt-auto p-3 text-[11px] leading-relaxed text-muted-foreground border-t border-border">
            Internal use only. Activity is logged and audited.
          </div>
        </nav>

        {/* Main */}
        <main id="main" className="flex-1 min-w-0 p-4 md:p-6 overflow-x-auto" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
