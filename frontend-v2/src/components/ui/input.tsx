import * as React from "react";

import { cn } from "@/lib/utils";

// Dispatch input. See design-system/MASTER.md §9.
//   - 36px height (matches buttons + table rows)
//   - sharp radius (4px / rounded-sm)
//   - focus: 1px primary border + 3px outer ring at 18% — no shadow glow
//   - placeholder uses muted-foreground; never primary tint
const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-9 w-full rounded-sm border border-border bg-card px-3 text-body text-foreground",
          "placeholder:text-muted-foreground",
          "transition-colors duration-fast ease-soft",
          "file:border-0 file:bg-transparent file:text-body file:font-medium file:text-foreground",
          "focus-visible:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-0",
          "aria-[invalid=true]:border-destructive aria-[invalid=true]:focus-visible:ring-destructive/30",
          "disabled:cursor-not-allowed disabled:bg-secondary/60 disabled:opacity-70",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
