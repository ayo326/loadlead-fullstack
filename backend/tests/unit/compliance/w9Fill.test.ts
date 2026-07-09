/**
 * w9FillService: the in-app form fills the genuine official template, field for
 * field. Asserts the known field mapping (Line 1, address, comb TIN groups),
 * exactly one classification checkbox set, deterministic output (preview hash ==
 * stored hash), and that renderW9 flattens the form.
 */
import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { fillW9Fields, renderW9, W9FormInput } from '../../../src/services/compliance/w9FillService';
import { W9_FIELD, allClassificationCheckboxNames, classificationCheckboxName } from '../../../src/services/compliance/w9FieldMap';

const soleProp: W9FormInput = {
  line1Name: 'Jordan Hauler',
  line2BusinessName: 'JH Trucking',
  classification: 'INDIVIDUAL_SOLE_PROPRIETOR',
  address: '100 Main St',
  cityStateZip: 'Dallas, TX 75201',
  tinType: 'SSN',
  tin: '123-45-6789',
  signatureName: 'Jordan Hauler',
  signedDateISO: '2026-07-07',
};

describe('w9FillService', () => {
  it('fills Line 1, Line 2, and the address on the official fields', async () => {
    const pdf = await fillW9Fields(soleProp);
    const form = pdf.getForm();
    expect(form.getTextField(W9_FIELD.line1_name).getText()).toBe('Jordan Hauler');
    expect(form.getTextField(W9_FIELD.line2_businessName).getText()).toBe('JH Trucking');
    expect(form.getTextField(W9_FIELD.line5_address).getText()).toBe('100 Main St');
    expect(form.getTextField(W9_FIELD.line6_cityStateZip).getText()).toBe('Dallas, TX 75201');
  });

  it('places the SSN digits into the comb groups (3-2-4), one group per field', async () => {
    const pdf = await fillW9Fields(soleProp);
    const form = pdf.getForm();
    expect(form.getTextField(W9_FIELD.ssn_group1).getText()).toBe('123');
    expect(form.getTextField(W9_FIELD.ssn_group2).getText()).toBe('45');
    expect(form.getTextField(W9_FIELD.ssn_group3).getText()).toBe('6789');
    // EIN groups stay empty for an SSN filing.
    expect(form.getTextField(W9_FIELD.ein_group1).getText() ?? '').toBe('');
  });

  it('sets exactly one Line 3a classification checkbox', async () => {
    const pdf = await fillW9Fields(soleProp);
    const form = pdf.getForm();
    const checked = allClassificationCheckboxNames().filter((n) => form.getCheckBox(n).isChecked());
    expect(checked).toHaveLength(1);
    expect(checked[0]).toBe(classificationCheckboxName('INDIVIDUAL_SOLE_PROPRIETOR'));
  });

  it('combs an EIN into the 2-7 groups for a corporation', async () => {
    const pdf = await fillW9Fields({
      ...soleProp,
      classification: 'C_CORPORATION',
      line2BusinessName: undefined,
      tinType: 'EIN',
      tin: '12-3456789',
    });
    const form = pdf.getForm();
    expect(form.getTextField(W9_FIELD.ein_group1).getText()).toBe('12');
    expect(form.getTextField(W9_FIELD.ein_group2).getText()).toBe('3456789');
  });

  it('renders deterministically: preview hash equals a re-render hash', async () => {
    const a = await renderW9(soleProp);
    const b = await renderW9(soleProp);
    expect(a.contentHash).toBe(b.contentHash);
    // A change in input changes the document.
    const c = await renderW9({ ...soleProp, line1Name: 'Someone Else' });
    expect(c.contentHash).not.toBe(a.contentHash);
  });

  it('renderW9 flattens the form (no fillable fields remain) and yields a valid PDF', async () => {
    const { bytes } = await renderW9(soleProp);
    const reloaded = await PDFDocument.load(bytes);
    expect(reloaded.getForm().getFields()).toHaveLength(0);
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe('%PDF-');
  });
});
