/**
 * Phase 2: compliance roles + admin audit log.
 *
 * Proves least-privilege grants (grant/revoke/hasRole, idempotent), the
 * append-only admin audit log, and that the audit write is non-optional: when it
 * cannot be written, record() throws and withAudit() never runs the action
 * (fail closed).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { tables, putItem, getItem, scan } = vi.hoisted(() => {
  const tables: Record<string, any[]> = {};
  return {
    tables,
    putItem: vi.fn(async (table: string, item: any) => {
      const arr = (tables[table] ??= []);
      if (item.auditId) { arr.push(item); return; } // audit append-only
      const idx = arr.findIndex((x) => x.userId === item.userId); // grants upsert
      if (idx >= 0) arr[idx] = item; else arr.push(item);
    }),
    getItem: vi.fn(async (table: string, key: any) => {
      const arr = tables[table] ?? [];
      return arr.find((x) => Object.keys(key).every((k) => x[k] === key[k])) ?? null;
    }),
    scan: vi.fn(async (table: string) => [...(tables[table] ?? [])]),
  };
});

vi.mock('../../../src/config/database', () => ({
  Database: { putItem, getItem, scan, updateItem: vi.fn(), deleteItem: vi.fn() },
  default: { putItem, getItem, scan, updateItem: vi.fn(), deleteItem: vi.fn() },
}));
vi.mock('../../../src/utils/logger', () => ({ Logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));

import config from '../../../src/config/environment';
import { ComplianceRole } from '../../../src/types/complianceRole';
import { ComplianceRoleService } from '../../../src/services/complianceRoleService';
import { AdminAuditService } from '../../../src/services/adminAuditService';

const AUDIT = config.dynamodb.adminAuditLogTable;

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  putItem.mockClear();
});

describe('compliance-role grants (least privilege + separation)', () => {
  it('grants and revokes specific roles, idempotently', async () => {
    await ComplianceRoleService.grant('super-1', 'user-1', ComplianceRole.DISPUTE_ADMIN);
    await ComplianceRoleService.grant('super-1', 'user-1', ComplianceRole.DISPUTE_ADMIN); // idempotent
    expect(await ComplianceRoleService.hasRole('user-1', ComplianceRole.DISPUTE_ADMIN)).toBe(true);
    expect(await ComplianceRoleService.hasRole('user-1', ComplianceRole.LAW_ENFORCEMENT_LIAISON)).toBe(false);

    await ComplianceRoleService.grant('super-1', 'user-1', ComplianceRole.LEGAL_ADMIN);
    expect((await ComplianceRoleService.getRoles('user-1')).sort()).toEqual(['DISPUTE_ADMIN', 'LEGAL_ADMIN']);

    await ComplianceRoleService.revoke('super-1', 'user-1', ComplianceRole.DISPUTE_ADMIN);
    expect(await ComplianceRoleService.hasRole('user-1', ComplianceRole.DISPUTE_ADMIN)).toBe(false);
    expect(await ComplianceRoleService.hasRole('user-1', ComplianceRole.LEGAL_ADMIN)).toBe(true);
  });

  it('a user with no grant holds nothing', async () => {
    expect(await ComplianceRoleService.getRoles('nobody')).toEqual([]);
  });
});

describe('admin audit log (append-only, fail closed)', () => {
  it('records an entry with actor, role, action, target refs, reason, authority, and timestamp', async () => {
    const e = await AdminAuditService.record({
      actorId: 'admin-1', actorRole: 'LEGAL_ADMIN', action: 'READ_CASE_FILE',
      targetRefs: ['load-1', 'inv-1'], reason: 'subpoena review', authorityRef: 'req-9',
    });
    expect(e.auditId.startsWith('aud_')).toBe(true);
    expect(e.targetRefs).toEqual(['load-1', 'inv-1']);
    expect(e.authorityRef).toBe('req-9');
    expect(typeof e.at).toBe('number');
    expect(tables[AUDIT]).toHaveLength(1);
    expect((await AdminAuditService.list({ targetRef: 'inv-1' }))[0].auditId).toBe(e.auditId);
  });

  it('requires actor, role, and action', async () => {
    await expect(AdminAuditService.record({ actorId: '', actorRole: 'X', action: 'A' })).rejects.toThrow();
    await expect(AdminAuditService.record({ actorId: 'a', actorRole: '', action: 'A' })).rejects.toThrow();
    await expect(AdminAuditService.record({ actorId: 'a', actorRole: 'X', action: '' })).rejects.toThrow();
  });

  it('fails closed: when the audit write fails, record throws and withAudit never runs the action', async () => {
    putItem.mockImplementationOnce(async () => { throw new Error('audit store unavailable'); });
    const action = vi.fn(async () => 'did the sensitive thing');
    await expect(
      AdminAuditService.withAudit({ actorId: 'a', actorRole: 'LEGAL_ADMIN', action: 'DISCLOSE' }, action)
    ).rejects.toThrow(/audit store unavailable/);
    expect(action).not.toHaveBeenCalled();
  });

  it('withAudit records first, then runs the action', async () => {
    const result = await AdminAuditService.withAudit(
      { actorId: 'a', actorRole: 'DISPUTE_ADMIN', action: 'ADJUDICATE_REVERSE', targetRefs: ['charge-1'] },
      async () => 42
    );
    expect(result).toBe(42);
    expect(tables[AUDIT]).toHaveLength(1);
  });
});
