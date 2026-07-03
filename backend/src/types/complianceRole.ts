/**
 * Compliance roles for the platform-admin oversight layer.
 *
 * These are a SEPARATE axis from the staff PlatformRole tier. A platform staffer
 * (a User with role ADMIN and a PlatformRole) may additionally be granted one or
 * more compliance roles. Each sensitive compliance action checks the specific
 * role, so even a super-admin must hold the exact grant. This enforces least
 * privilege and separation of duties (a dispute admin cannot touch a
 * law-enforcement matter, and vice versa).
 */

export enum ComplianceRole {
  /** Disputes and discrepancy adjudication. */
  DISPUTE_ADMIN = 'DISPUTE_ADMIN',
  /** Legal records, case files, and legal holds. */
  LEGAL_ADMIN = 'LEGAL_ADMIN',
  /** Law-enforcement matters. Restricted and always audited. */
  LAW_ENFORCEMENT_LIAISON = 'LAW_ENFORCEMENT_LIAISON',
}

export const ALL_COMPLIANCE_ROLES: ComplianceRole[] = [
  ComplianceRole.DISPUTE_ADMIN,
  ComplianceRole.LEGAL_ADMIN,
  ComplianceRole.LAW_ENFORCEMENT_LIAISON,
];

export function isComplianceRole(value: unknown): value is ComplianceRole {
  return typeof value === 'string' && ALL_COMPLIANCE_ROLES.includes(value as ComplianceRole);
}
