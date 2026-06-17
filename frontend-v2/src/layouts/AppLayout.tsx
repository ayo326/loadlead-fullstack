import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Bell, History, LayoutDashboard, LogOut, PackagePlus, Search, Settings, ShieldCheck, ShipWheel, Truck, TruckIcon, Warehouse, BarChart3 } from "lucide-react";
import { NotificationBell } from "@/components/NotificationBell";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const allNav = [
  { title: "Driver",         url: "/driver",                 icon: ShipWheel,   label: "Live Offers",     role: "DRIVER",         exact: true  },
  { title: "Load History",   url: "/driver/history",         icon: History,     label: "Completed Loads", role: "DRIVER"                       },
  { title: "Analytics",      url: "/driver/analytics",       icon: BarChart3,   label: "Earnings & miles",role: "DRIVER"                       },
  { title: "Owner Operator", url: "/owner-operator",         icon: TruckIcon,   label: "Dashboard",       role: "OWNER_OPERATOR", exact: true  },
  { title: "Load History",   url: "/owner-operator/history", icon: History,     label: "Completed Loads", role: "OWNER_OPERATOR"               },
  { title: "Analytics",      url: "/owner-operator/analytics", icon: BarChart3, label: "Fleet metrics",   role: "OWNER_OPERATOR"               },
  { title: "Shipper",        url: "/shipper",                icon: PackagePlus, label: "Loads",           role: "SHIPPER"                      },
  { title: "Receiver",       url: "/receiver",               icon: Warehouse,   label: "Inbound",         role: "RECEIVER"                     },
  { title: "Admin",          url: "/admin",                  icon: ShieldCheck, label: "Operations",      role: "ADMIN"                        },
];

function AppSidebar({ onLogout }: { onLogout: () => void }) {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const { pathname } = useLocation();
  const { user } = useAuth();
  const nav = allNav.filter((item) => item.role === user?.role);
  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      <SidebarHeader className="px-3 pt-4 pb-3 border-b border-sidebar-border">
        {!collapsed ? (
          <Logo variant="light" />
        ) : (
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground mx-auto">
            <Truck className="h-5 w-5" />
          </div>
        )}
      </SidebarHeader>
      <SidebarContent className="px-2 pt-2">
        <SidebarGroup>
          <SidebarGroupLabel className="text-sidebar-foreground/50 text-[10px] uppercase tracking-widest">Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {nav.map((item) => {
                // exact items only highlight on their own URL or their /loads sub-pages
                const active = item.exact
                  ? pathname === item.url || pathname.startsWith(item.url + '/loads')
                  : pathname.startsWith(item.url);
                return (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton asChild isActive={active} className="data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-primary-foreground hover:bg-sidebar-accent/60">
                      <NavLink to={item.url} className="flex items-center gap-3">
                        <item.icon className="h-4 w-4 shrink-0" />
                        {!collapsed && (
                          <div className="flex flex-col leading-tight">
                            <span className="text-sm font-medium">{item.title}</span>
                            <span className="text-[10px] text-sidebar-foreground/50">{item.label}</span>
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
          <SidebarGroupLabel className="text-sidebar-foreground/50 text-[10px] uppercase tracking-widest">Account</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={pathname.startsWith("/settings") || pathname.startsWith("/owner-operator/settings")} className="data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-primary-foreground hover:bg-sidebar-accent/60">
                  <NavLink to={user?.role === "OWNER_OPERATOR" ? "/owner-operator/settings" : "/settings"} className="flex items-center gap-3">
                    <Settings className="h-4 w-4" />
                    {!collapsed && <span>Settings</span>}
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton className="hover:bg-sidebar-accent/60" onClick={onLogout}>
                  <LogOut className="h-4 w-4" />
                  {!collapsed && <span>Sign out</span>}
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}

export default function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => { logout().then(() => navigate("/login")); };

  const initials = user?.email?.slice(0, 2).toUpperCase() ?? "?";
  const headshotUrl = user?.headshotUrl;

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar onLogout={handleLogout} />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-16 flex items-center gap-3 border-b border-border bg-card/60 backdrop-blur px-4 sticky top-0 z-10">
            <SidebarTrigger />
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search loads, drivers, lanes…" className="pl-9 bg-secondary border-0 focus-visible:ring-1" />
            </div>
            <div className="text-xs text-muted-foreground hidden sm:block">{user?.email}</div>
            <NotificationBell />
            <div className="h-9 w-9 rounded-full overflow-hidden bg-gradient-to-br from-primary to-accent text-primary-foreground flex items-center justify-center text-sm font-semibold shrink-0">
              {headshotUrl
                ? <img src={headshotUrl} alt="Profile" className="h-full w-full object-cover" />
                : initials}
            </div>
          </header>
          <main className="flex-1 p-6 lg:p-8 overflow-x-hidden">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}