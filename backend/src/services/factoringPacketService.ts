/**
 * Factoring submission packet assembler.
 *
 * Builds the documents a factor needs to fund an invoice, scoped to the selected
 * invoice, as a single combined PDF (pdfkit) plus a manifest. The packet draws
 * from the Phase 8 factoring-ready package and includes: the invoice with
 * linehaul and approved accessorials broken out, the rate confirmation, the
 * signed POD or BOL, the accessorial backup (stop-events evidence) for any
 * detention or layover, and the Notice of Assignment when an active assignment
 * exists.
 *
 * If a required document is missing (for example no POD yet), the assembler
 * reports what is missing rather than producing an incomplete packet silently.
 *
 * All money is integer cents. Applies equally to carriers and owner-operators.
 */

import PDFDocument from 'pdfkit';
import { formatCentsUsd } from '../utils/money';
import type { FactoringInvoicePackage } from './invoicePackageService';
import type { NoticeOfAssignment } from './noticeOfAssignmentService';
import type { StopEvent } from './stopEventService';

export type PacketSectionKind =
  | 'INVOICE'
  | 'RATE_CONFIRMATION'
  | 'POD'
  | 'BOL'
  | 'ACCESSORIAL_BACKUP'
  | 'NOTICE_OF_ASSIGNMENT';

export interface PacketSection {
  name: string;
  kind: PacketSectionKind;
  present: boolean;
  ref?: string;
}

export interface PacketManifest {
  invoiceId: string;
  loadId: string;
  carrierId: string;
  generatedAt: number;
  sections: PacketSection[];
  totals: {
    linehaulCents: number;
    approvedAccessorialCents: number;
    advanceableTotalCents: number;
  };
}

export interface PacketAssemblyContext {
  invoiceId: string;
  loadId: string;
  carrierId: string;
  pkg: FactoringInvoicePackage;
  moverName?: string;
  debtorName?: string;
  podRef?: string;
  bolRef?: string;
  rateConfRef?: string;
  stopEvents: StopEvent[];
  notice?: NoticeOfAssignment | null;
}

export type PacketResult =
  | { ok: true; manifest: PacketManifest; pdf: Buffer }
  | { ok: false; missing: string[] };

function renderPdf(build: (doc: PDFKit.PDFDocument) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, info: { Title: 'Factoring Submission Packet' } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    try {
      build(doc);
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

export class FactoringPacketService {
  /** Required documents that must be present before a packet can be produced. */
  static missingDocuments(ctx: PacketAssemblyContext): string[] {
    const missing: string[] = [];
    if (!ctx.podRef && !ctx.bolRef) missing.push('signed POD or BOL');
    if (!ctx.rateConfRef) missing.push('rate confirmation');
    // When the receivable is assigned, the Notice of Assignment must be included.
    if (ctx.pkg.activeAssignment && !ctx.notice) missing.push('Notice of Assignment');
    return missing;
  }

  static buildManifest(ctx: PacketAssemblyContext): PacketManifest {
    const linehaulCents = ctx.pkg.lines
      .filter((l) => l.kind === 'LINEHAUL')
      .reduce((s, l) => s + l.amountCents, 0);
    const approvedAccessorialCents = ctx.pkg.lines
      .filter((l) => l.kind === 'ACCESSORIAL' && l.factorable)
      .reduce((s, l) => s + l.amountCents, 0);

    const sections: PacketSection[] = [
      { name: 'Invoice', kind: 'INVOICE', present: true },
      { name: 'Rate confirmation', kind: 'RATE_CONFIRMATION', present: !!ctx.rateConfRef, ...(ctx.rateConfRef ? { ref: ctx.rateConfRef } : {}) },
    ];
    if (ctx.podRef) sections.push({ name: 'Proof of delivery', kind: 'POD', present: true, ref: ctx.podRef });
    if (ctx.bolRef) sections.push({ name: 'Signed BOL', kind: 'BOL', present: true, ref: ctx.bolRef });
    if (ctx.stopEvents.length > 0) {
      sections.push({ name: 'Accessorial backup (stop events)', kind: 'ACCESSORIAL_BACKUP', present: true });
    }
    if (ctx.notice) {
      sections.push({ name: 'Notice of Assignment', kind: 'NOTICE_OF_ASSIGNMENT', present: true, ref: ctx.notice.noaId });
    }

    return {
      invoiceId: ctx.invoiceId,
      loadId: ctx.loadId,
      carrierId: ctx.carrierId,
      generatedAt: Date.now(),
      sections,
      totals: { linehaulCents, approvedAccessorialCents, advanceableTotalCents: ctx.pkg.advanceableTotalCents },
    };
  }

  /** Assemble the combined PDF packet or report missing documents. */
  static async assemble(ctx: PacketAssemblyContext): Promise<PacketResult> {
    const missing = this.missingDocuments(ctx);
    if (missing.length > 0) {
      return { ok: false, missing };
    }
    const manifest = this.buildManifest(ctx);
    const pdf = await renderPdf((doc) => this.renderPacket(doc, ctx, manifest));
    return { ok: true, manifest, pdf };
  }

  private static renderPacket(doc: PDFKit.PDFDocument, ctx: PacketAssemblyContext, manifest: PacketManifest): void {
    doc.fontSize(18).text('Factoring Submission Packet', { align: 'left' });
    doc.moveDown(0.5);
    doc.fontSize(10).fillColor('#444')
      .text(`Invoice ${ctx.invoiceId}  -  Load ${ctx.loadId}`)
      .text(`Mover: ${ctx.moverName ?? ctx.carrierId}`)
      .text(`Debtor: ${ctx.debtorName ?? ctx.pkg.debtor.id}`)
      .text(`Generated: ${new Date(manifest.generatedAt).toISOString()}`);
    doc.fillColor('#000').moveDown();

    // Invoice line items.
    doc.fontSize(14).text('Invoice');
    doc.fontSize(10).moveDown(0.25);
    for (const line of ctx.pkg.lines) {
      const label = line.kind === 'LINEHAUL' ? 'Linehaul' : `Accessorial (${line.accessorialType})`;
      const flag = line.factorable ? 'factorable' : `not factorable: ${line.reason ?? ''}`;
      doc.text(`${label}: ${formatCentsUsd(line.amountCents)}  [${flag}]`);
    }
    doc.moveDown(0.25);
    doc.font('Helvetica-Bold').text(`Advanceable total: ${formatCentsUsd(manifest.totals.advanceableTotalCents)}`);
    doc.font('Helvetica').moveDown();

    // Supporting document references.
    doc.fontSize(14).text('Supporting documents');
    doc.fontSize(10).moveDown(0.25);
    doc.text(`Rate confirmation: ${ctx.rateConfRef}`);
    if (ctx.podRef) doc.text(`Proof of delivery: ${ctx.podRef}`);
    if (ctx.bolRef) doc.text(`Signed BOL: ${ctx.bolRef}`);
    doc.moveDown();

    // Accessorial backup (stop events evidence).
    if (ctx.stopEvents.length > 0) {
      doc.fontSize(14).text('Accessorial backup (stop events)');
      doc.fontSize(10).moveDown(0.25);
      for (const e of ctx.stopEvents) {
        const when = new Date(e.eventAt).toISOString();
        doc.text(`${e.stopId}  ${e.eventType}  ${when}${e.geofenceMatch ? '  (geofence match)' : ''}`);
      }
      doc.moveDown();
    }

    // Notice of Assignment.
    if (ctx.notice) {
      doc.addPage();
      doc.fontSize(14).text('Notice of Assignment');
      doc.fontSize(10).moveDown(0.5);
      doc.text(ctx.notice.noticeText, { align: 'left' });
    }
  }
}
