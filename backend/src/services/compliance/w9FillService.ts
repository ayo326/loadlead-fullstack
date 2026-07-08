/**
 * Fill the official Form W-9 (Rev. 3-2024) template from in-app inputs.
 *
 * Hard requirement: the stored and previewed document is the genuine official
 * form, filled field for field, never an HTML recreation. This module loads the
 * stored template, sets each AcroForm field through the explicit w9FieldMap,
 * combs the TIN one digit per box, sets exactly one Line 3a classification
 * checkbox, draws the signature and date on the signature line, strikes out
 * certification item 2 when backup withholding applies, flattens the form so the
 * document is immutable, and returns the bytes with a content hash.
 *
 * Determinism: render is a pure function of its input (including the signature
 * name and signed date). Creation and modification dates are pinned to the
 * signed date, so the same input yields byte-identical output. That is what lets
 * a pre-sign preview hash equal the stored document hash: the route renders the
 * final signed document, shows it, and on confirmation re-renders the identical
 * bytes to store.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import {
  W9_FIELD,
  classificationCheckboxName,
  W9Classification,
  W9LlcCode,
} from './w9FieldMap';

const TEMPLATE_PATH = join(__dirname, '../../../assets/tax/fw9-rev-3-2024.pdf');

// Calibrated for the Rev. 3-2024 US-Letter template (page 612 x 792). The TIN
// comb fields sit at y ~348-420; Part II and the Sign Here box are below. Tune
// via visual QA if a future revision shifts the layout.
const LAYOUT = {
  signatureXY: { x: 150, y: 120 },
  dateXY: { x: 470, y: 120 },
  appliedForXY: { x: 300, y: 404 },
  // Certification item 2 is a multi-line block; strike through its middle.
  item2StrikeFrom: { x: 70, y: 268 },
  item2StrikeTo: { x: 560, y: 268 },
} as const;

export interface W9FormInput {
  line1Name: string;
  line2BusinessName?: string;
  classification: W9Classification;
  llcCode?: W9LlcCode; // required when classification is LLC
  otherText?: string; // when classification is OTHER
  foreignPartners3b?: boolean;
  exemptPayeeCode?: string;
  fatcaCode?: string;
  address: string; // Line 5
  cityStateZip: string; // Line 6
  accountNumbers?: string; // Line 7
  requesterNameAddress?: string;
  tinType: 'SSN' | 'EIN';
  /** Raw TIN digits (with or without separators). Ignored when tinAppliedFor. */
  tin?: string;
  tinAppliedFor?: boolean;
  /** When true, item 2 is struck out on the form (the IRS backup-withholding rule). */
  backupWithholdingNotified?: boolean;
  /** Typed signature (the hauler's legal name) and the signed date. */
  signatureName: string;
  signedDateISO: string; // e.g. '2026-07-07'
}

export interface RenderedW9 {
  bytes: Uint8Array;
  contentHash: string; // sha256 hex of bytes
}

function digitsOnly(s: string): string {
  return (s || '').replace(/\D/g, '');
}

/** Split a TIN into the template's comb groups. */
function tinGroups(tinType: 'SSN' | 'EIN', tin: string): Record<string, string> {
  const d = digitsOnly(tin);
  if (tinType === 'SSN') {
    return {
      [W9_FIELD.ssn_group1]: d.slice(0, 3),
      [W9_FIELD.ssn_group2]: d.slice(3, 5),
      [W9_FIELD.ssn_group3]: d.slice(5, 9),
    };
  }
  return {
    [W9_FIELD.ein_group1]: d.slice(0, 2),
    [W9_FIELD.ein_group2]: d.slice(2, 9),
  };
}

/**
 * Fill the template (fields + drawn overlays) but do NOT flatten. Exposed so
 * tests and previews can introspect field and checkbox state before the form is
 * baked into the page. Callers that need the immutable stored document use
 * renderW9, which flattens.
 */
export async function fillW9Fields(input: W9FormInput): Promise<PDFDocument> {
  const templateBytes = readFileSync(TEMPLATE_PATH);
  const pdf = await PDFDocument.load(templateBytes);
  const form = pdf.getForm();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.getPage(0);

  const setText = (name: string, value?: string) => {
    if (value === undefined || value === null || value === '') return;
    try {
      form.getTextField(name).setText(value);
    } catch {
      /* field absent on this revision; skip rather than fail the fill */
    }
  };

  // Lines 1, 2
  setText(W9_FIELD.line1_name, input.line1Name);
  setText(W9_FIELD.line2_businessName, input.line2BusinessName);

  // Line 3a: exactly one classification checkbox.
  try {
    form.getCheckBox(classificationCheckboxName(input.classification)).check();
  } catch {
    /* checkbox absent; skip */
  }
  if (input.classification === 'LLC' && input.llcCode) {
    setText(W9_FIELD.line3a_llcCode, input.llcCode);
  }
  if (input.classification === 'OTHER' && input.otherText) {
    setText(W9_FIELD.line3a_otherText, input.otherText);
  }

  // Line 3b
  if (input.foreignPartners3b) {
    try {
      form.getCheckBox(W9_FIELD.line3b_foreign).check();
    } catch {
      /* skip */
    }
  }

  // Line 4 exemption codes
  setText(W9_FIELD.line4_exemptPayeeCode, input.exemptPayeeCode);
  setText(W9_FIELD.line4_fatcaCode, input.fatcaCode);

  // Lines 5, 6, 7 and requester
  setText(W9_FIELD.line5_address, input.address);
  setText(W9_FIELD.line6_cityStateZip, input.cityStateZip);
  setText(W9_FIELD.line7_accountNumbers, input.accountNumbers);
  setText(W9_FIELD.requesterNameAddress, input.requesterNameAddress);

  // Part I: TIN comb boxes, or "Applied For" drawn across the TIN area.
  if (input.tinAppliedFor || !input.tin) {
    page.drawText('Applied For', {
      x: LAYOUT.appliedForXY.x,
      y: LAYOUT.appliedForXY.y,
      size: 11,
      font,
      color: rgb(0, 0, 0),
    });
  } else {
    for (const [name, digits] of Object.entries(tinGroups(input.tinType, input.tin))) {
      setText(name, digits);
    }
  }

  // Part II signature + date drawn on the Sign Here line.
  page.drawText(input.signatureName, {
    x: LAYOUT.signatureXY.x,
    y: LAYOUT.signatureXY.y,
    size: 12,
    font,
    color: rgb(0, 0, 0),
  });
  page.drawText(input.signedDateISO, {
    x: LAYOUT.dateXY.x,
    y: LAYOUT.dateXY.y,
    size: 11,
    font,
    color: rgb(0, 0, 0),
  });

  // Backup-withholding: strike out certification item 2 on the rendered form.
  if (input.backupWithholdingNotified) {
    page.drawLine({
      start: LAYOUT.item2StrikeFrom,
      end: LAYOUT.item2StrikeTo,
      thickness: 1.2,
      color: rgb(0, 0, 0),
    });
  }

  return pdf;
}

/**
 * Render the final, signed, flattened W-9 as immutable bytes with a content
 * hash. Deterministic in its input, so a pre-sign preview and the stored
 * document hash to the same value.
 */
export async function renderW9(input: W9FormInput): Promise<RenderedW9> {
  const pdf = await fillW9Fields(input);

  // Flatten so the fields are baked into the page and cannot be edited.
  pdf.getForm().flatten();

  // Deterministic metadata so identical input yields byte-identical output.
  const pinned = new Date(`${input.signedDateISO}T00:00:00.000Z`);
  pdf.setCreationDate(pinned);
  pdf.setModificationDate(pinned);
  pdf.setProducer('LoadLead');
  pdf.setCreator('LoadLead');

  const bytes = await pdf.save({ useObjectStreams: false });
  const contentHash = createHash('sha256').update(bytes).digest('hex');
  return { bytes, contentHash };
}
