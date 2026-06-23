// Telematics provider gate.
//
// LIVE GPS comes from an ELD / telematics provider (Samsara, Motive,
// Geotab, etc). When no provider is configured we MUST NOT fabricate
// driver positions or pretend an ELD is feeding us. The fleet feed
// instead surfaces the last-known location (from the driver's own
// app heartbeat, which is NOT a telematics signal) and clearly
// labels it as such.
//
// Configuration is via TELEMATICS_PROVIDER env var. Any value means
// "wired up" (the actual integration would read a per-provider key);
// empty/unset means "not connected." The integrations adapter pattern
// in services/integrations/ would normally own this, but for the MVP
// fleet feed we read one env var directly -- there's no real provider
// yet to abstract.

export interface TelematicsStatus {
  /** True when a provider is configured and the backend can stream live GPS. */
  connected: boolean;
  /** Provider name when connected, null otherwise. */
  provider: string | null;
}

export function getTelematicsStatus(): TelematicsStatus {
  const provider = (process.env.TELEMATICS_PROVIDER ?? '').trim();
  return provider.length > 0
    ? { connected: true,  provider }
    : { connected: false, provider: null };
}
