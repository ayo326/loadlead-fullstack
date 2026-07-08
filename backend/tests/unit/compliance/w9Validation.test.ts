/**
 * W-9 validation: classification-dependent name and TIN rules, the LLC code
 * requirement, the disregarded-entity guidance, the non-US-person gate, and the
 * Applied For hold. From the official Form W-9 (Rev. 3-2024) instructions.
 */
import { describe, it, expect } from 'vitest';
import { validateW9, W9ValidationInput } from '../../../src/services/compliance/w9Validation';

const okBase: W9ValidationInput = {
  line1Name: 'Jordan Hauler',
  classification: 'INDIVIDUAL_SOLE_PROPRIETOR',
  address: '100 Main St',
  cityStateZip: 'Dallas, TX 75201',
  isUsPerson: true,
  tinType: 'SSN',
  tin: '123-45-6789',
};

const codes = (r: { errors: { code: string }[] }) => r.errors.map((e) => e.code);

describe('validateW9', () => {
  it('accepts a sole proprietor with an SSN', () => {
    const r = validateW9(okBase);
    expect(r.ok).toBe(true);
    expect(r.hold).toBeNull();
  });

  it('accepts a sole proprietor with an EIN too', () => {
    expect(validateW9({ ...okBase, tinType: 'EIN', tin: '12-3456789' }).ok).toBe(true);
  });

  it('rejects an SSN for a C corporation (EIN required)', () => {
    const r = validateW9({ ...okBase, classification: 'C_CORPORATION', tinType: 'SSN', tin: '123-45-6789' });
    expect(r.ok).toBe(false);
    expect(codes(r)).toContain('EIN_REQUIRED_FOR_ENTITY');
  });

  it('accepts an EIN for a partnership', () => {
    expect(
      validateW9({ ...okBase, classification: 'PARTNERSHIP', tinType: 'EIN', tin: '12-3456789' }).ok,
    ).toBe(true);
  });

  it('rejects LLC without a C, S, or P code', () => {
    const r = validateW9({ ...okBase, classification: 'LLC', tinType: 'EIN', tin: '12-3456789' });
    expect(codes(r)).toContain('LLC_CODE_REQUIRED');
  });

  it('accepts LLC with a code and an EIN', () => {
    expect(
      validateW9({ ...okBase, classification: 'LLC', llcCode: 'S', tinType: 'EIN', tin: '12-3456789' }).ok,
    ).toBe(true);
  });

  it('guides a single-member disregarded entity away from LLC and off Line 1', () => {
    const r = validateW9({
      ...okBase,
      classification: 'LLC',
      llcCode: 'C',
      singleMemberDisregarded: true,
      line1IsDisregardedEntityName: true,
    });
    expect(codes(r)).toContain('DISREGARDED_USE_OWNER_CLASSIFICATION');
    expect(codes(r)).toContain('DISREGARDED_LINE1_MUST_BE_OWNER');
  });

  it('blocks a non-US person and signals a W-8 applies', () => {
    const r = validateW9({ ...okBase, isUsPerson: false });
    expect(r.ok).toBe(false);
    expect(r.requiresW8).toBe(true);
    expect(codes(r)).toContain('NOT_US_PERSON_USE_W8');
  });

  it('holds an Applied For TIN at PENDING and skips TIN format checks', () => {
    const r = validateW9({ ...okBase, tin: undefined, tinAppliedFor: true });
    expect(r.ok).toBe(true);
    expect(r.hold).toBe('TIN_APPLIED_FOR');
  });

  it('requires Line 1 and the address', () => {
    const r = validateW9({ ...okBase, line1Name: '', address: '' });
    expect(codes(r)).toEqual(expect.arrayContaining(['LINE1_REQUIRED', 'ADDRESS_REQUIRED']));
  });
});
