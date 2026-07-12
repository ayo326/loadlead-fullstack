/**
 * Canopy Connect configuration loader (SCRUM-60).
 *
 * Mirrors the integrations config pattern: secrets are read from the
 * environment, server-side, and never logged. The client_id and client_secret
 * authenticate LoadLead's backend to Canopy over HTTP Basic; the webhook secret
 * verifies inbound webhook signatures. The hauler's insurer login happens inside
 * Canopy's own flow (widget or Components) and never touches LoadLead servers, so
 * none of these secrets ever reach the browser.
 *
 * The single mode knob is CANOPY_ENV (sandbox|production), wired through
 * modeResolver so every boot guard covers Canopy for free:
 *   - production locks CANOPY_ENV to 'production' unconditionally;
 *   - CANOPY_ENV=production outside production refuses boot (never-live guard);
 *   - a stray CANOPY_ENV in a production environment that isn't 'production'
 *     refuses boot (contamination guard).
 *
 * Two more knobs, neither a secret, both safe to expose to the browser:
 *   - CANOPY_UI_MODE (widget|components): which connect experience is live. One
 *     at a time; both produce identical backend artifacts.
 *   - COMPLIANCE_EVALUATOR (local|policy_check|shadow): which evaluator decides
 *     the minimums. Default local (unchanged behavior).
 */

import { resolveMode, isLive } from '../services/integrations/modeResolver';

export type CanopyEnv = 'sandbox' | 'production';
export type CanopyUiMode = 'widget' | 'components';
export type ComplianceEvaluatorMode = 'local' | 'policy_check' | 'shadow';

function readUiMode(): CanopyUiMode {
  const raw = (process.env.CANOPY_UI_MODE || 'widget').trim().toLowerCase();
  return raw === 'components' ? 'components' : 'widget';
}

function readEvaluator(): ComplianceEvaluatorMode {
  const raw = (process.env.COMPLIANCE_EVALUATOR || 'local').trim().toLowerCase();
  if (raw === 'policy_check' || raw === 'shadow') return raw;
  return 'local';
}

/**
 * The Canopy config, resolved once at import. `env` and `live` come from the
 * production-locked mode resolver; the rest are read straight from the
 * environment. Secrets are present here but must never be logged or serialized.
 */
export const canopyConfig = {
  /** 'sandbox' | 'production'. Production-locked to 'production' in prod. */
  get env(): CanopyEnv {
    return (resolveMode('canopy') as CanopyEnv) === 'production' ? 'production' : 'sandbox';
  },
  /** True only when Canopy runs against production (real policyholder data). */
  get live(): boolean {
    return isLive('canopy');
  },

  /** HTTP Basic credentials (username=clientId, password=clientSecret). Secret. */
  clientId: process.env.CANOPY_CLIENT_ID || '',
  clientSecret: process.env.CANOPY_CLIENT_SECRET || '',
  /** Shared secret for verifying inbound webhook signatures. Secret. */
  webhookSecret: process.env.CANOPY_WEBHOOK_SECRET || '',

  /**
   * The widget/link public alias the SDK opens (options.publicAlias) and the
   * Components flow uses. Safe to expose to the browser. CANOPY_WIDGET_ID is the
   * dashboard widget id used by the widgets/monitoring APIs (server-side).
   */
  publicAlias: process.env.CANOPY_PUBLIC_ALIAS || '',
  widgetId: process.env.CANOPY_WIDGET_ID || '',

  /** Pulls/policyChecks/monitorings API base. Same host for sandbox + prod. */
  apiBaseUrl: process.env.CANOPY_API_BASE_URL || 'https://app.usecanopy.com/api/v1.0.0',

  /** Which connect experience is live. One at a time; identical backend artifacts. */
  get uiMode(): CanopyUiMode {
    return readUiMode();
  },

  /** Which evaluator decides the minimums. Default local (unchanged behavior). */
  get evaluator(): ComplianceEvaluatorMode {
    return readEvaluator();
  },

  /**
   * True when Canopy is usable end to end (credentials + a link present). The
   * connect experience is only offered when this is true; the manual path always
   * exists regardless, so a missing config degrades to manual-only, never a
   * broken step.
   */
  get connectEnabled(): boolean {
    return Boolean(this.clientId && this.clientSecret && this.publicAlias);
  },
};

/**
 * The browser-safe subset of the Canopy config: never any secret. Surfaced
 * through the runtime-config endpoint so the frontend knows which connect
 * experience to render and whether it is available at all.
 */
export interface CanopyPublicConfig {
  connectEnabled: boolean;
  uiMode: CanopyUiMode;
  env: CanopyEnv;
  publicAlias: string;
}

export function canopyPublicConfig(): CanopyPublicConfig {
  return {
    connectEnabled: canopyConfig.connectEnabled,
    uiMode: canopyConfig.uiMode,
    env: canopyConfig.env,
    // The public alias is not a secret (it is embedded in the widget snippet on
    // the client), so it is safe to hand the browser.
    publicAlias: canopyConfig.publicAlias,
  };
}

export default canopyConfig;
