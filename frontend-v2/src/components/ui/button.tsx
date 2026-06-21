import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// Dispatch button. See design-system/MASTER.md §9.
//   - sharp radius (4px / rounded-sm)
//   - 36px default height, matching form fields + table rows
//   - cursor-pointer when interactive; opacity-60 when disabled (no cursor)
//   - focus ring uses the app-wide hsl(ring/0.18) — no shadow, no glow
//   - tap targets >= 44x44 honored via icon size variant
const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap",
    "rounded-sm text-body font-medium",
    "cursor-pointer",
    "transition-colors duration-fast ease-soft",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
    "disabled:cursor-not-allowed disabled:opacity-60 disabled:pointer-events-none",
    "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  ].join(" "),
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90 active:bg-destructive",
        outline:
          "border border-border bg-card text-foreground hover:bg-secondary active:bg-secondary",
        secondary:
          "bg-secondary text-secondary-foreground border border-border hover:bg-secondary/80",
        ghost:
          "text-foreground hover:bg-secondary active:bg-secondary",
        link:
          "text-primary underline-offset-4 hover:underline rounded-none cursor-pointer",
      },
      size: {
        sm:     "h-7 px-3 text-[0.8125rem]",   // 28px
        default:"h-9 px-4",                    // 36px — Dispatch default
        lg:     "h-11 px-6 text-body-md",      // 44px — primary CTA / hero
        icon:   "h-9 w-9",                     // 36x36 — meets tap target with padding
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
