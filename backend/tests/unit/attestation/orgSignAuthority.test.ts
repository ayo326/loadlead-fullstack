// CONSTRAINT 1 extension — org-side sign authority follows the permissions matrix.
//
// `assertSignerIsLoadParty` no longer hard-codes ADMIN_ORG_ROLES (OWNER + MANAGER)
// for org-side fan-out. It now asks the existing permissions matrix
// (services/orgPermissions.ts) which roles hold the action's permission:
//
//   BOL_SUBMIT     → 'loads:create'
//   CARRIER_ACCEPT → 'loads:accept'
//
// Per the matrix: OWNER, MANAGER, and DISPATCHER all hold 'loads:accept',
// so a DISPATCHER member of a carrier org should now be allowed to sign
// CARRIER_ACCEPT. This is the test that catches a regression if anyone
// re-hard-codes ADMIN_ORG_ROLES into the resolver.

import { describe, it, expect } from 'vitest';
import { hasPermission } from '../../../src/services/orgPermissions';
import { OrgRole } from '../../../src/types';

describe('CONSTRAINT 1 extension — DISPATCHER may sign CARRIER_ACCEPT', () => {
  it('matrix grants loads:accept to OWNER + MANAGER + DISPATCHER', () => {
    expect(hasPermission(OrgRole.OWNER,         'loads:accept')).toBe(true);
    expect(hasPermission(OrgRole.MANAGER,       'loads:accept')).toBe(true);
    expect(hasPermission(OrgRole.DISPATCHER,    'loads:accept')).toBe(true);
  });

  it('matrix DENIES loads:accept to ORG_DRIVER / SHIPPER_USER / RECEIVER_USER', () => {
    expect(hasPermission(OrgRole.ORG_DRIVER,    'loads:accept')).toBe(false);
    expect(hasPermission(OrgRole.SHIPPER_USER,  'loads:accept')).toBe(false);
    expect(hasPermission(OrgRole.RECEIVER_USER, 'loads:accept')).toBe(false);
  });

  it('matrix grants loads:create to shipper-side personas (BOL_SUBMIT fan-out)', () => {
    expect(hasPermission(OrgRole.OWNER,        'loads:create')).toBe(true);
    expect(hasPermission(OrgRole.MANAGER,      'loads:create')).toBe(true);
    expect(hasPermission(OrgRole.DISPATCHER,   'loads:create')).toBe(true);
    expect(hasPermission(OrgRole.SHIPPER_USER, 'loads:create')).toBe(true);
    // and denies it to receiver-only members
    expect(hasPermission(OrgRole.RECEIVER_USER,'loads:create')).toBe(false);
    expect(hasPermission(OrgRole.ORG_DRIVER,   'loads:create')).toBe(false);
  });

  // Defensive regression: ensure the resolver source DOES NOT mention
  // ADMIN_ORG_ROLES — if someone reintroduces it the broader DISPATCHER
  // policy will quietly regress to OWNER + MANAGER only.
  it('assertSignerIsLoadParty.ts no longer imports ADMIN_ORG_ROLES', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(
      join(__dirname, '..', '..', '..', 'src', 'services', 'attestation', 'assertSignerIsLoadParty.ts'),
      'utf8',
    );
    // Only the doc/changelog header may mention it; actual code paths must not.
    const importLines = src.split('\n').filter((l) => /^import\s/.test(l.trim())).join(' | ');
    expect(importLines).not.toMatch(/ADMIN_ORG_ROLES/);
  });
});
