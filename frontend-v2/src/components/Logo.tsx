// LoadLead brand logo lockup.
//
// The official asset lives in frontend-v2/public/loadlead-logo.png
// (transparent background, 1036×213). The art is pure BLACK (the circle
// badge + the "LoadLead" wordmark) with a white truck inside the badge -
// so on a DARK surface the black circle and black wordmark disappear into
// the background. To fix that without shipping a second asset, `variant="light"`
// (used on dark hero / sidebar surfaces) inverts the PNG via CSS: black→white,
// white→black, transparent stays transparent. Result on navy: a white badge
// with a black truck + a white wordmark - the exact logo art, recolored to
// read on dark. `variant="dark"` (default) renders the original black art
// for light surfaces.
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
  const onDark = variant === "light";
  const tagline = onDark ? "text-sidebar-foreground/60" : "text-muted-foreground";
  // Intrinsic aspect ratio of the source art (1036x213) so the browser
  // reserves the correct box (no layout shift) and the lockup can never be
  // compressed inside a tight flex row, e.g. the mobile landing header.
  const width = Math.round(height * (1036 / 213));

  return (
    <a
      href="https://loadleadapp.com"
      className="flex items-center gap-3 shrink-0 no-underline transition-opacity duration-fast ease-soft hover:opacity-80 cursor-pointer"
      aria-label="LoadLead - Where loads meet leads."
    >
      <img
        src="/loadlead-logo.png"
        alt="LoadLead"
        width={width}
        height={height}
        style={{
          height: `${height}px`,
          width: "auto",
          // Invert the black logo art to white on dark surfaces so the
          // badge + wordmark don't vanish into the background.
          filter: onDark ? "invert(1)" : undefined,
        }}
        className="select-none shrink-0"
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
