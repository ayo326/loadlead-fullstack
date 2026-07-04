import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import {
  BarChart3,
  Banknote,
  ChevronRight,
  History,
  LogOut,
  PackagePlus,
  Search,
  Settings,
  ShieldCheck,
  ShipWheel,
  Truck,
  TruckIcon,
  Users,
  Warehouse,
} from "lucide-react";
import { NotificationBell } from "@/components/NotificationBell";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { Logo } from "@/components/Logo";
import { Input } from "@/components/ui/input";
import { TourMount, TourReplayButton } from "@/tour/LoadLeadTour";

// ─── Navigation model ──────────────────────────────────────────────────────
// Operator-surface (Dispatch). Items are filtered by the signed-in role.
// Eyebrows render in the rail as JetBrains Mono uppercase per MASTER §8.
const allNav: {
  title: string;
  url: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number | string }>;
  hint: string;
  role: string;
  exact?: boolean;
}[] = [
  { title: "Live Offers",   url: "/driver",                    icon: ShipWheel,   hint: "Offered loads",            role: "DRIVER",         exact: true  },
  { title: "Load History",  url: "/driver/history",            icon: History,     hint: "Completed loads",          role: "DRIVER"                       },
  { title: "Analytics",     url: "/driver/analytics",          icon: BarChart3,   hint: "Earnings + miles",         role: "DRIVER"                       },
  { title: "Dashboard",     url: "/owner-operator",            icon: TruckIcon,   hint: "Live status",              role: "OWNER_OPERATOR", exact: true  },
  { title: "Load History",  url: "/owner-operator/history",    icon: History,     hint: "Completed loads",          role: "OWNER_OPERATOR"               },
  { title: "Analytics",     url: "/owner-operator/analytics",  icon: BarChart3,   hint: "Fleet metrics",            role: "OWNER_OPERATOR"               },
  { title: "Factoring",     url: "/owner-operator/factoring",  icon: Banknote,    hint: "Assign + export packet",   role: "OWNER_OPERATOR"               },
  { title: "Carrier",       url: "/carrier",                   icon: Truck,       hint: "Verification + roster",    role: "CARRIER_ADMIN",  exact: true  },
  { title: "Members",       url: "/carrier/members",           icon: Users,       hint: "Invite + manage team",     role: "CARRIER_ADMIN"                },
  { title: "Factoring",     url: "/carrier/factoring",         icon: Banknote,    hint: "Assign + export packet",   role: "CARRIER_ADMIN"                },
  { title: "Shipper",       url: "/shipper",                   icon: PackagePlus, hint: "Active loads",             role: "SHIPPER"                      },
  { title: "Receiver",      url: "/receiver",                  icon: Warehouse,   hint: "Inbound",                  role: "RECEIVER"                     },
  { title: "Admin",         url: "/admin",                     icon: ShieldCheck, hint: "Operations",               role: "ADMIN"                        },
];

/* ─── The rail ──────────────────────────────────────────────────────────── */

function AppSidebar({ onLogout }: { onLogout: () => void }) {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const { pathname } = useLocation();
  const { user } = useAuth();
  const nav = allNav.filter((item) => item.role === user?.role);

  const settingsHref = user?.role === "OWNER_OPERATOR" ? "/owner-operator/settings" : "/settings";
  const settingsActive = pathname.startsWith("/settings") || pathname.startsWith("/owner-operator/settings");
  const initials = user?.email?.slice(0, 2).toUpperCase() ?? "??";
  const personaLabel = (user?.role ?? "").replace("_", " ").toLowerCase();

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      <SidebarHeader className="px-4 pt-4 pb-3 border-b border-sidebar-border">
        {!collapsed ? (
          <Logo variant="light" />
        ) : (
          <div
            className="flex h-8 w-8 items-center justify-center rounded-sm bg-sidebar-accent text-sidebar-foreground mx-auto"
            aria-hidden
          >
            <Truck className="h-4 w-4" strokeWidth={1.75} />
          </div>
        )}
      </SidebarHeader>

      <SidebarContent className="px-2 pt-3">
        <SidebarGroup>
          {!collapsed && (
            <SidebarGroupLabel className="px-3 pb-1 text-overline font-mono text-sidebar-foreground/50">
              Workspace
            </SidebarGroupLabel>
          )}
          <SidebarGroupContent data-tour="rail-nav">
            <SidebarMenu>
              {nav.map((item) => {
                const active = item.exact
                  ? pathname === item.url || pathname.startsWith(item.url + "/loads")
                  : pathname.startsWith(item.url);
                return (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton
                      asChild
                      isActive={active}
                      className={[
                        "relative rounded-sm h-9 px-3 gap-3 cursor-pointer",
                        "text-sidebar-foreground/80 hover:text-sidebar-foreground hover:bg-sidebar-accent",
                        "transition-colors duration-fast ease-soft",
                        // Active state — left stripe (2px) + accent bg + white text + dot
                        "data-[active=true]:bg-sidebar-accent",
                        "data-[active=true]:text-sidebar-foreground",
                        "data-[active=true]:before:content-['']",
                        "data-[active=true]:before:absolute data-[active=true]:before:inset-y-1",
                        "data-[active=true]:before:left-0 data-[active=true]:before:w-[2px]",
                        "data-[active=true]:before:bg-sidebar-primary",
                        "data-[active=true]:before:rounded-sm",
                      ].join(" ")}
                    >
                      <NavLink to={item.url} className="flex items-center gap-3">
                        <item.icon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.75} />
                        {!collapsed && (
                          <div className="flex min-w-0 flex-col leading-tight">
                            <span className="text-body font-medium truncate flex items-center gap-2">
                              {item.title}
                              {active && (
                                <span
                                  className="h-1 w-1 rounded-full bg-sidebar-primary"
                                  aria-hidden
                                />
                              )}
                            </span>
                            <span className="text-overline font-mono text-sidebar-foreground/45">{item.hint}</span>
                          </div>
                        )}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="mt-4">
          {!collapsed && (
            <SidebarGroupLabel className="px-3 pb-1 text-overline font-mono text-sidebar-foreground/50">
              Account
            </SidebarGroupLabel>
          )}
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem data-tour="rail-settings">
                <SidebarMenuButton
                  asChild
                  isActive={settingsActive}
                  className={[
                    "relative rounded-sm h-9 px-3 gap-3 cursor-pointer",
                    "text-sidebar-foreground/80 hover:text-sidebar-foreground hover:bg-sidebar-accent",
                    "transition-colors duration-fast ease-soft",
                    "data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-foreground",
                    "data-[active=true]:before:content-['']",
                    "data-[active=true]:before:absolute data-[active=true]:before:inset-y-1",
                    "data-[active=true]:before:left-0 data-[active=true]:before:w-[2px]",
                    "data-[active=true]:before:bg-sidebar-primary",
                    "data-[active=true]:before:rounded-sm",
                  ].join(" ")}
                >
                  <NavLink to={settingsHref} className="flex items-center gap-3">
                    <Settings className="h-[18px] w-[18px]" strokeWidth={1.75} />
                    {!collapsed && <span className="text-body">Settings</span>}
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  onClick={onLogout}
                  className="rounded-sm h-9 px-3 gap-3 cursor-pointer text-sidebar-foreground/80 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors duration-fast ease-soft"
                >
                  <LogOut className="h-[18px] w-[18px]" strokeWidth={1.75} />
                  {!collapsed && <span className="text-body">Sign out</span>}
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-3">
        {!collapsed ? (
          <div className="flex flex-col gap-2">
            {/* Persona chip */}
            <div data-tour="rail-account" className="flex items-center gap-2 rounded-sm bg-sidebar-accent px-2 py-2">
              <div
                className="flex h-8 w-8 items-center justify-center rounded-sm bg-sidebar-primary text-sidebar-primary-foreground text-overline font-mono"
                aria-hidden
              >
                {initials}
              </div>
              <div className="flex min-w-0 flex-1 flex-col leading-tight">
                <span className="truncate text-body text-sidebar-foreground">{user?.email}</span>
                <span className="truncate text-overline font-mono text-sidebar-foreground/55 capitalize">
                  {personaLabel}
                </span>
              </div>
              <ChevronRight className="h-4 w-4 text-sidebar-foreground/40" aria-hidden />
            </div>
            {/* Replay tour — same nav-item language as other rail items. */}
            <TourReplayButton />
            {/* Primary motto — its quiet home */}
            <p className="px-1 text-overline font-mono text-sidebar-foreground/40">
              Connect. Load. Drop.
            </p>
          </div>
        ) : (
          <div
            className="mx-auto flex h-8 w-8 items-center justify-center rounded-sm bg-sidebar-primary text-sidebar-primary-foreground text-overline font-mono"
            aria-hidden
          >
            {initials}
          </div>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}

/* ─── Top bar ────────────────────────────────────────────────────────────── */

export default function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout().then(() => navigate("/login"));
  };

  const initials = user?.email?.slice(0, 2).toUpperCase() ?? "?";
  const headshotUrl = user?.headshotUrl;

  // Customer glass language (variant 2 "deeper tinted glass") — now applied
  // across all customer personas via the shared customer-glass tokens. The
  // frosted light content canvas keeps every routed surface AA regardless of
  // persona. (Rolled out from Owner Operator after review.)
  const glass = true;

  return (
    <SidebarProvider>
      <div className={`min-h-screen flex w-full bg-background${glass ? " cx-glass" : ""}`}>
        <AppSidebar onLogout={handleLogout} />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-page-header flex items-center gap-3 border-b border-border bg-card px-4 sticky top-0 z-10">
            <SidebarTrigger className="cursor-pointer" />
            <div className="relative flex-1 max-w-md">
              <Search
                className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
                aria-hidden
                strokeWidth={1.75}
              />
              <Input
                placeholder="Search loads, drivers, lanes"
                className="pl-9 h-9 bg-secondary border-border"
              />
            </div>
            {/* V8: truncate so a long email ellipsizes instead of clipping
                against the notification bell / avatar in the top bar. */}
            <div className="hidden text-label text-muted-foreground sm:block truncate max-w-[220px]">{user?.email}</div>
            <NotificationBell />
            <div
              className="h-8 w-8 rounded-sm overflow-hidden bg-secondary text-foreground flex items-center justify-center text-overline font-mono shrink-0"
              aria-hidden
            >
              {headshotUrl ? (
                <img src={headshotUrl} alt="Profile" className="h-full w-full object-cover" />
              ) : (
                initials
              )}
            </div>
          </header>
          <main className="flex-1 px-6 py-6 lg:px-8 lg:py-8 overflow-x-hidden">
            {/* Tour controller — mounts once; auto-starts the right persona's
                tour on first dashboard visit, persists completion locally. */}
            <TourMount />
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
