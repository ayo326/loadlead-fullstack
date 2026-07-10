// Runtime config: the single frontend source for persona/feature flags.
//
// The backend exposes flags on GET /api/beta/status (the existing runtime-
// config path). This provider fetches that once at app start and hands the
// flags to every gate through one hook, so no surface reads config ad hoc.
//
// Fail-safe: until the fetch resolves, and if it fails, a muted persona stays
// muted (fleetCarrierPersonaEnabled defaults to false). `loaded` lets a gate
// wait for the real value before making an irreversible choice (e.g. a login
// redirect) instead of flashing the wrong state.

import { createContext, useContext, useEffect, useState } from "react";
import { api } from "@/lib/api";

interface RuntimeConfig {
  /** Fleet-carrier PERSONA enabled. Default false = persona muted. Owner-
   *  operator flows are never affected by this. */
  fleetCarrierPersonaEnabled: boolean;
  betaMode: boolean;
  /** True once /beta/status has resolved (success or failure). */
  loaded: boolean;
}

const DEFAULT: RuntimeConfig = {
  fleetCarrierPersonaEnabled: false,
  betaMode: false,
  loaded: false,
};

const RuntimeConfigContext = createContext<RuntimeConfig>(DEFAULT);

export function RuntimeConfigProvider({ children }: { children: React.ReactNode }) {
  const [cfg, setCfg] = useState<RuntimeConfig>(DEFAULT);

  useEffect(() => {
    let active = true;
    // Retry with backoff (audit v4 M8): a single transient failure at app
    // boot used to pin the muted defaults for the whole session (a gated
    // persona stayed on the "unavailable" page until a hard refresh). Try a
    // few times before settling; still fail-closed if all attempts fail, and
    // keep retrying quietly in the background so a recovered network heals
    // the session without a refresh.
    const fetchConfig = async (attempts: number, delayMs: number): Promise<boolean> => {
      for (let i = 1; i <= attempts; i++) {
        try {
          const s = await api.beta.status();
          if (!active) return true;
          setCfg({
            fleetCarrierPersonaEnabled: !!s.fleetCarrierPersonaEnabled,
            betaMode: !!s.betaMode,
            loaded: true,
          });
          return true;
        } catch {
          if (!active) return false;
          if (i < attempts) await new Promise((r) => setTimeout(r, delayMs * i));
        }
      }
      return false;
    };

    (async () => {
      const ok = await fetchConfig(3, 1000);
      if (!active) return;
      if (!ok) {
        // Config unreachable: keep muted defaults, mark loaded so gates that
        // wait on `loaded` do not hang, and heal in the background.
        setCfg((c) => ({ ...c, loaded: true }));
        void fetchConfig(5, 15_000);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  return <RuntimeConfigContext.Provider value={cfg}>{children}</RuntimeConfigContext.Provider>;
}

export function useRuntimeConfig(): RuntimeConfig {
  return useContext(RuntimeConfigContext);
}

/** Single source for the fleet-carrier persona gate on the frontend. */
export function useFleetCarrierPersonaEnabled(): boolean {
  return useContext(RuntimeConfigContext).fleetCarrierPersonaEnabled;
}
