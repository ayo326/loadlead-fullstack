/**
 * Shared ingestion types (SCRUM-60).
 *
 * The INSURER_POLICY document meta shape lives here (not in the ingestion
 * service) so the verification decision can read it back without importing the
 * ingestion module, which would create a cycle (ingestion -> decision -> ...).
 */

import { CanopyInsuranceData } from './canopyMapper';

/** The INSURER_POLICY document meta shape (source CANOPY). */
export interface InsurerPolicyMeta {
  source: 'CANOPY';
  pullId: string;
  insurerName?: string;
  autoPolicyNumber?: string;
  cargoPolicyNumber?: string;
  autoLiabilityCents?: number;
  cargoCents?: number;
  generalLiabilityCents?: number;
  effectiveDate?: number;
  expiryDate?: number;
  /** The full mapped snapshot, for the cross-reference engine and audit. */
  insurance: CanopyInsuranceData;
}
