import { Truck } from "lucide-react";

// LoadLead logo lockup. See design-system/MASTER.md.
// The brand line "Where loads meet leads." lives here under the wordmark
// (per the brand voice slot rule). The primary motto "Connect. Load. Drop."
// is reserved for hero action lines and the rail footer; do not stack
// both lines in the same place.
export function Logo({ variant = "dark" }: { variant?: "dark" | "light" }) {
  const isLight = variant === "light";
  const wordmark   = isLight ? "text-sidebar-foreground" : "text-foreground";
  const tagline    = isLight ? "text-sidebar-foreground/60" : "text-muted-foreground";
  const markBg     = isLight ? "bg-sidebar-accent" : "bg-primary";
  const markFg     = isLight ? "text-sidebar-foreground" : "text-primary-foreground";

  return (
    <a
      href="https://loadleadapp.com"
      className="flex items-center gap-2 no-underline transition-opacity duration-fast ease-soft hover:opacity-80 cursor-pointer"
    >
      <div
        className={`flex h-8 w-8 items-center justify-center rounded-sm ${markBg} ${markFg}`}
        aria-hidden
      >
        <Truck className="h-4 w-4" strokeWidth={1.75} />
      </div>
      <div className="flex flex-col leading-none">
        <span className={`text-h3 font-display tracking-tight ${wordmark}`}>LoadLead</span>
        <span className={`text-overline font-mono ${tagline}`}>Where loads meet leads.</span>
      </div>
    </a>
  );
}
