import { Truck } from "lucide-react";

export function Logo({ variant = "dark" }: { variant?: "dark" | "light" }) {
  const text = variant === "light" ? "text-sidebar-foreground" : "text-foreground";
  return (
    <a href="https://loadleadapp.com" className="flex items-center gap-2 no-underline hover:opacity-80 transition-opacity">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-md">
        <Truck className="h-5 w-5" />
      </div>
      <div className="flex flex-col leading-none">
        <span className={`text-base font-bold tracking-tight ${text}`}>LoadLead</span>
        <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Freight, dispatched live</span>
      </div>
    </a>
  );
}