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
    api.beta
      .status()
      .then((s) => {
        if (!active) return;
        setCfg({
          fleetCarrierPersonaEnabled: !!s.fleetCarrierPersonaEnabled,
          betaMode: !!s.betaMode,
          loaded: true,
        });
      })
      .catch(() => {
        // Config unreachable: keep muted defaults, but mark loaded so gates
        // that wait on `loaded` do not hang.
        if (active) setCfg((c) => ({ ...c, loaded: true }));
      });
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
