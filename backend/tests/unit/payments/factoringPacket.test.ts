/**
 * Phase 11: saved factor contact + packet assembler (pdfkit).
 *
 * Proves the saved factor contact validates/saves/updates; the packet assembler
 * produces a combined PDF + manifest including the Notice of Assignment when an
 * assignment is active; and reports missing documents instead of a partial packet.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { tables, putItem, getItem, scan, updateItem, deleteItem } = vi.hoisted(() => {
  const tables: Record<string, any[]> = {};
  return {
    tables,
    putItem: vi.fn(async (table: string, item: any) => {
      const arr = (tables[table] ??= []);
      const idx = arr.findIndex((x) => x.carrierId === item.carrierId);
      if (idx >= 0) arr[idx] = item;
      else arr.push(item);
    }),
    getItem: vi.fn(async (table: string, key: any) => {
      const arr = tables[table] ?? [];
      return arr.find((x) => Object.keys(key).every((k) => x[k] === key[k])) ?? null;
    }),
    scan: vi.fn(async (table: string) => [...(tables[table] ?? [])]),
    updateItem: vi.fn(async () => ({})),
    deleteItem: vi.fn(async () => ({})),
  };
});

vi.mock('../../../src/config/database', () => ({
  Database: { putItem, getItem, scan, updateItem, deleteItem },
  default: { putItem, getItem, scan, updateItem, deleteItem },
}));
vi.mock('../../../src/utils/logger', () => ({ Logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));

import { FactorContactService, isValidEmail } from '../../../src/services/factorContactService';
import { FactoringPacketService, PacketAssemblyContext } from '../../../src/services/factoringPacketService';
import type { FactoringInvoicePackage } from '../../../src/services/invoicePackageService';

function pkg(over: Partial<FactoringInvoicePackage> = {}): FactoringInvoicePackage {
  return {
    invoiceId: 'inv-1',
    loadId: 'load-1',
    debtor: { id: 'shipper-1', verified: true },
    mover: { id: 'carrier-1', verified: true },
    lines: [
      { kind: 'LINEHAUL', amountCents: 150000, factorable: true },
      { kind: 'ACCESSORIAL', chargeId: 'c1', accessorialType: 'DETENTION', amountCents: 7500, factorable: true },
    ],
    activeAssignment: null,
    advanceableTotalCents: 157500,
    ...over,
  };
}

function ctx(over: Partial<PacketAssemblyContext> = {}): PacketAssemblyContext {
  return {
    invoiceId: 'inv-1',
    loadId: 'load-1',
    carrierId: 'carrier-1',
    pkg: pkg(),
    podRef: 'pod-1',
    rateConfRef: 'rc-1',
    stopEvents: [
      { eventId: 'a1', loadId: 'load-1', stopId: 'PICKUP', eventType: 'ARRIVAL', eventAt: 0, actorId: 'd', createdAt: 0 },
      { eventId: 'd1', loadId: 'load-1', stopId: 'PICKUP', eventType: 'DEPARTURE', eventAt: 18000000, actorId: 'd', createdAt: 1 },
    ],
    notice: null,
    ...over,
  };
}

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  putItem.mockClear();
});

describe('saved factor contact', () => {
  it('validates the email', () => {
    expect(isValidEmail('factor@acme.com')).toBe(true);
    expect(isValidEmail('nope')).toBe(false);
    expect(isValidEmail('a@b')).toBe(false);
  });

  it('saves and then updates, keeping createdAt', async () => {
    const a = await FactorContactService.save('carrier-1', { factorName: 'Acme', factorEmail: 'ar@acme.com' });
    await new Promise((r) => setTimeout(r, 2));
    const b = await FactorContactService.save('carrier-1', { factorName: 'Acme Capital', factorEmail: 'remit@acme.com' });
    expect(b.factorName).toBe('Acme Capital');
    expect(b.createdAt).toBe(a.createdAt);
    expect(b.updatedAt).toBeGreaterThanOrEqual(a.updatedAt);
    expect((await FactorContactService.get('carrier-1'))?.factorEmail).toBe('remit@acme.com');
  });

  it('rejects an invalid email on save', async () => {
    await expect(FactorContactService.save('carrier-1', { factorName: 'X', factorEmail: 'bad' })).rejects.toThrow();
  });
});

describe('packet assembler', () => {
  it('produces a combined PDF and a manifest with the right totals', async () => {
    const res = await FactoringPacketService.assemble(ctx());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.pdf.subarray(0, 4).toString()).toBe('%PDF');
    expect(res.manifest.totals.linehaulCents).toBe(150000);
    expect(res.manifest.totals.approvedAccessorialCents).toBe(7500);
    expect(res.manifest.totals.advanceableTotalCents).toBe(157500);
    expect(res.manifest.sections.map((s) => s.kind)).toContain('ACCESSORIAL_BACKUP');
  });

  it('includes the Notice of Assignment section when an assignment is active', async () => {
    const res = await FactoringPacketService.assemble(
      ctx({
        pkg: pkg({ activeAssignment: { assignmentId: 'a1' } as any }),
        notice: { noaId: 'noa-1', noticeText: 'NOTICE OF ASSIGNMENT ...' } as any,
      })
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.manifest.sections.some((s) => s.kind === 'NOTICE_OF_ASSIGNMENT')).toBe(true);
  });

  it('reports missing documents instead of producing a partial packet', async () => {
    const res = await FactoringPacketService.assemble(ctx({ podRef: undefined, bolRef: undefined }));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.missing).toContain('signed POD or BOL');
  });

  it('requires the NoA when the invoice is assigned', async () => {
    const res = await FactoringPacketService.assemble(
      ctx({ pkg: pkg({ activeAssignment: { assignmentId: 'a1' } as any }), notice: null })
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.missing).toContain('Notice of Assignment');
  });
});
