// LoadLead brand logo lockup.
//
// The official asset lives in frontend-v2/public/loadlead-logo.png
// (transparent background, 1036×213, suitable for both light and dark
// surfaces). On the dark sidebar surface we render the same asset --
// the truck mark is white-on-black so it reads correctly on either.
//
// The brand line "Where loads meet leads." sits under the wordmark
// per the brand voice slot rule. The primary motto
// "Connect. Load. Drop." is reserved for hero action lines.

export function Logo({
  variant = "dark",
  height = 32,
  withTagline = true,
}: {
  variant?: "dark" | "light";
  /** Wordmark height in pixels. Defaults to 32. */
  height?: number;
  /** When false, renders just the wordmark image; no tagline. */
  withTagline?: boolean;
}) {
  const tagline = variant === "light" ? "text-sidebar-foreground/60" : "text-muted-foreground";

  return (
    <a
      href="https://loadleadapp.com"
      className="flex items-center gap-3 no-underline transition-opacity duration-fast ease-soft hover:opacity-80 cursor-pointer"
      aria-label="LoadLead — Where loads meet leads."
    >
      <img
        src="/loadlead-logo.png"
        alt="LoadLead"
        height={height}
        style={{ height: `${height}px`, width: "auto" }}
        className="select-none"
        draggable={false}
      />
      {withTagline && (
        <span className={`text-overline font-mono leading-none ${tagline} hidden sm:inline`}>
          Where loads meet leads.
        </span>
      )}
    </a>
  );
}
