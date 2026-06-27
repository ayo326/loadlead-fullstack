/**
 * Host awareness for the dual-surface beta setup.
 *
 * The SAME customer bundle is served from two CloudFront distributions:
 *   - loadleadapp.com        (apex)  → public surface. While BETA_MODE is on,
 *                                      the login page shows ONLY the private-
 *                                      beta wall (no sign-in form).
 *   - beta.loadleadapp.com   (beta)  → exact copy of prod where ADMITTED
 *                                      testers actually sign in / use the app.
 *
 * isBetaHost() lets the bundle decide which surface it's rendering. The wall
 * is additionally gated on the backend's betaMode flag, so flipping
 * BETA_MODE=false reverts the apex to a normal login with no redeploy.
 */

export const BETA_ORIGIN = "https://beta.loadleadapp.com";

/** True when the bundle is being served from the beta subdomain. */
export function isBetaHost(): boolean {
  if (typeof window === "undefined") return false;
  return window.location.hostname.startsWith("beta.");
}
