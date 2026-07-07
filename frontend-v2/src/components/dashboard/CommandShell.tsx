/**
 * CommandShell - the shared command-center dashboard composition.
 *
 * Renders inside AppLayout's <main> (which already provides the slim icon
 * sidebar and the top bar), so this owns only the content zones:
 *
 *   desktop (lg+):            mobile (priority stack):
 *   +------+--------+------+   1. rail (offers are P1)
 *   | rail |  MAP   | act. |   2. map
 *   +------+--------+------+   3. earnings
 *   |     earnings strip   |   4. activity
 *   +---------------------+    5. p3
 *   |        P3           |
 *   +---------------------+
 *
 * On desktop the three zones sit in one row (rail 3 / map 6 / activity 3 of a
 * 12-col grid), then the earnings strip and P3 span full width. On mobile it
 * collapses to a single column in the priority order above via `order-*`
 * utilities, reset with `lg:order-none` so the desktop grid flows by DOM order.
 * Both dashboards consume this shell so the two surfaces stay in lockstep.
 */

import { ReactNode } from "react";

interface CommandShellProps {
  /** Slim page-title row (the top-bar "page title" from the wireframe). */
  title?: ReactNode;
  /** Status rail: My haul (one-line), OFFERS (P1), verification badges. */
  rail: ReactNode;
  /** The live map canvas (dominant zone). */
  map: ReactNode;
  /** Right column: recent activity, fleet health (non-zero only), shortcuts. */
  activity?: ReactNode;
  /** Full-width earnings strip below the map (real settlement data only). */
  earnings?: ReactNode;
  /** Full-width P3 overflow: available-loads list, financial, SLA, history. */
  p3?: ReactNode;
}

export function CommandShell({ title, rail, map, activity, earnings, p3 }: CommandShellProps) {
  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-5 p-4 lg:grid lg:grid-cols-12 lg:p-6">
      {title && (
        <div className="order-0 lg:col-span-12">{title}</div>
      )}
      {/* DOM order (rail, map, activity, earnings, p3) is what the lg grid flows
          by; mobile order-* re-sequences to the priority stack. */}
      <section
        aria-label="Status and offers"
        className="order-1 flex flex-col gap-4 lg:order-none lg:col-span-3"
      >
        {rail}
      </section>

      <section
        aria-label="Operating area map"
        className="order-2 min-w-0 lg:order-none lg:col-span-6"
      >
        {map}
      </section>

      <section
        aria-label="Activity and health"
        className="order-4 flex flex-col gap-4 lg:order-none lg:col-span-3"
      >
        {activity}
      </section>

      {earnings && (
        <section
          aria-label="Earnings"
          className="order-3 lg:order-none lg:col-span-12"
        >
          {earnings}
        </section>
      )}

      {p3 && (
        <section
          aria-label="More"
          className="order-5 flex flex-col gap-5 lg:order-none lg:col-span-12"
        >
          {p3}
        </section>
      )}
    </div>
  );
}

/**
 * Card - the one surface treatment for command-shell panels, matching the
 * visual-finish token layer (bg-card, hairline border, single soft shadow via
 * the shared .cx-glass .bg-card rule). Optional accent left-edge and loud
 * variant for a live-offer panel.
 */
export function CommandCard({
  children,
  className,
  accent,
  loud,
  ...rest
}: {
  children: ReactNode;
  className?: string;
  /** Left-edge accent color (hex or css color). */
  accent?: string;
  /** Loud = a live-offer panel: accent ring so it is the loudest thing on the page. */
  loud?: boolean;
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`relative rounded-md border border-border bg-card ${loud ? "ring-1 ring-amber-400/40" : ""} ${className ?? ""}`}
      style={accent ? { boxShadow: undefined, borderLeft: `3px solid ${accent}` } : undefined}
      {...rest}
    >
      {children}
    </div>
  );
}
