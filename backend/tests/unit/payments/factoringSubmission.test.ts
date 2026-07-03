/**
 * Phase 12: export, confirmed send, and the append-only submission record.
 *
 * Proves: nothing sends without explicit confirmation; the recipient comes only
 * from the mover (typed or saved, never silently replaced); a confirmed send goes
 * to exactly the confirmed address with reply-to the mover and the PDF attached;
 * a failure is recorded as FAILED and surfaced with no retry; a successful send
 * writes a SENT record and a resend writes a second; and the same path works for
 * an owner-operator.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { tables, putItem, getItem, scan, sendRawEmail } = vi.hoisted(() => {
  const tables: Record<string, any[]> = {};
  return {
    tables,
    putItem: vi.fn(async (table: string, item: any) => {
      const arr = (tables[table] ??= []);
      if (item.carrierId && item.factorEmail && !item.submissionId) {
        // factor contact upsert by carrierId
        const idx = arr.findIndex((x) => x.carrierId === item.carrierId);
        if (idx >= 0) { arr[idx] = item; return; }
      }
      arr.push(item);
    }),
    getItem: vi.fn(async (table: string, key: any) => {
      const arr = tables[table] ?? [];
      return arr.find((x) => Object.keys(key).every((k) => x[k] === key[k])) ?? null;
    }),
    scan: vi.fn(async (table: string) => [...(tables[table] ?? [])]),
    sendRawEmail: vi.fn(async () => undefined),
  };
});

vi.mock('../../../src/config/database', () => ({
  Database: { putItem, getItem, scan, updateItem: vi.fn(), deleteItem: vi.fn() },
  default: { putItem, getItem, scan, updateItem: vi.fn(), deleteItem: vi.fn() },
}));
vi.mock('../../../src/utils/logger', () => ({ Logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock('../../../src/services/integrations/email', () => ({ sendRawEmail }));

import config from '../../../src/config/environment';
import { FactoringSubmissionService } from '../../../src/services/factoringSubmissionService';
import { FactorContactService } from '../../../src/services/factorContactService';
import type { PacketManifest } from '../../../src/services/factoringPacketService';

const SUBS = config.dynamodb.factoringSubmissionsTable;

const manifest: PacketManifest = {
  invoiceId: 'inv-1', loadId: 'load-1', carrierId: 'carrier-1', generatedAt: 1,
  sections: [], totals: { linehaulCents: 150000, approvedAccessorialCents: 0, advanceableTotalCents: 150000 },
};

function submitArgs(over: Partial<Parameters<typeof FactoringSubmissionService.submit>[0]> = {}) {
  return {
    carrierId: 'carrier-1',
    invoiceIds: ['inv-1'],
    recipientEmail: 'factor@acme.com',
    confirmed: true,
    manifest,
    pdf: Buffer.from('%PDF-1.4 fake'),
    actorId: 'mover-1',
    moverReplyTo: 'mover@example.com',
    moverName: 'Owner Op LLC',
    ...over,
  };
}

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  putItem.mockClear();
  sendRawEmail.mockClear();
  sendRawEmail.mockResolvedValue(undefined);
});

describe('recipient resolution (mover-only)', () => {
  it('uses a typed valid address', async () => {
    expect(await FactoringSubmissionService.resolveRecipient('carrier-1', 'typed@acme.com')).toBe('typed@acme.com');
  });
  it('does not silently replace a typed-but-invalid address', async () => {
    expect(await FactoringSubmissionService.resolveRecipient('carrier-1', 'bad')).toBeNull();
  });
  it('falls back to the saved factor contact when nothing is typed', async () => {
    await FactorContactService.save('carrier-1', { factorName: 'Acme', factorEmail: 'saved@acme.com' });
    expect(await FactoringSubmissionService.resolveRecipient('carrier-1')).toBe('saved@acme.com');
  });
  it('returns null when there is no typed and no saved contact', async () => {
    expect(await FactoringSubmissionService.resolveRecipient('carrier-x')).toBeNull();
  });
});

describe('confirmation gate', () => {
  it('does not send and throws without explicit confirmation', async () => {
    await expect(FactoringSubmissionService.submit(submitArgs({ confirmed: false }))).rejects.toThrow(/SEND_NOT_CONFIRMED/);
    expect(sendRawEmail).not.toHaveBeenCalled();
    expect(tables[SUBS] ?? []).toHaveLength(0);
  });
  it('rejects an invalid recipient', async () => {
    await expect(FactoringSubmissionService.submit(submitArgs({ recipientEmail: 'bad' }))).rejects.toThrow(/INVALID_RECIPIENT/);
  });
});

describe('confirmed send', () => {
  it('sends to exactly the confirmed address, reply-to the mover, with the PDF attached', async () => {
    const sub = await FactoringSubmissionService.submit(submitArgs());
    expect(sub.status).toBe('SENT');
    expect(sendRawEmail).toHaveBeenCalledTimes(1);
    const call = sendRawEmail.mock.calls[0][0] as any;
    expect(call.to).toBe('factor@acme.com');
    expect(call.replyTo).toBe('mover@example.com');
    expect(call.from).toMatch(/loadleadapp\.com/);
    expect(call.attachments[0].contentType).toBe('application/pdf');
    expect(call.attachments[0].content.subarray(0, 4).toString()).toBe('%PDF');
    expect(tables[SUBS]).toHaveLength(1);
  });

  it('records FAILED and surfaces it without retrying to a different address', async () => {
    sendRawEmail.mockRejectedValueOnce(new Error('SES bounce'));
    const sub = await FactoringSubmissionService.submit(submitArgs());
    expect(sub.status).toBe('FAILED');
    expect(sub.error).toMatch(/SES bounce/);
    expect(sendRawEmail).toHaveBeenCalledTimes(1); // no silent retry
    expect(tables[SUBS]).toHaveLength(1);
  });

  it('a resend writes a second submission record', async () => {
    await FactoringSubmissionService.submit(submitArgs());
    await FactoringSubmissionService.submit(submitArgs());
    expect(await FactoringSubmissionService.listForInvoice('inv-1')).toHaveLength(2);
  });

  it('optionally saves the factor contact on success', async () => {
    await FactoringSubmissionService.submit(submitArgs({ saveContact: { factorName: 'Acme' } }));
    expect((await FactorContactService.get('carrier-1'))?.factorEmail).toBe('factor@acme.com');
  });

  it('works the same for an owner-operator account', async () => {
    const sub = await FactoringSubmissionService.submit(submitArgs({ carrierId: 'oo-77', moverName: 'Solo Driver' }));
    expect(sub.status).toBe('SENT');
    expect(sub.carrierId).toBe('oo-77');
  });
});
