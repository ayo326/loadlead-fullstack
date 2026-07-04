import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// Dispatch badge / status pill. See design-system/MASTER.md §9.
//   - 20px height, 0/8px padding, sharp radius (4px)
//   - overline type (11/14, 600, uppercase, +0.06em tracking)
//   - status variants share the SAME shape; only the color band differs
//   - optional dot variant prefixes a 6px status-dot in the variant color
const badgeVariants = cva(
  [
    "inline-flex items-center gap-1.5",
    "h-5 px-2 rounded-sm",
    "text-overline uppercase",
    "transition-colors duration-fast ease-soft",
    "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
  ].join(" "),
  {
    variants: {
      variant: {
        // Surface variants
        neutral:     "bg-secondary text-secondary-foreground",
        outline:     "border border-border bg-card text-foreground",
        // Status variants - keep the band tonal (background tint + readable text)
        info:        "bg-primary/10 text-primary",
        success:     "bg-success/10 text-success",
        warning:     "bg-warning/15 text-[hsl(var(--warning))]",
        destructive: "bg-destructive/10 text-destructive",
        // Solid (use sparingly - primary CTA-adjacent counts)
        solid:       "bg-primary text-primary-foreground",
        // Aliases kept for back-compat with the old API (default/secondary)
        default:     "bg-primary text-primary-foreground",
        secondary:   "bg-secondary text-secondary-foreground",
      },
    },
    defaultVariants: {
      variant: "neutral",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {
  /** Show a 6px colored dot before the label. Useful for status pills. */
  dot?: boolean;
  /** When `dot` is set, pulse it (live state). Auto-stops under reduced motion. */
  pulse?: boolean;
}

function Badge({ className, variant, dot, pulse, children, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props}>
      {dot && (
        <span
          className={cn(
            "status-dot",
            pulse && "animate-status-pulse",
          )}
          aria-hidden
        />
      )}
      {children}
    </div>
  );
}

export { Badge, badgeVariants };
