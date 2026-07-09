/**
 * Explicit mapping from in-app W-9 inputs to the official Form W-9 (Rev. 3-2024)
 * AcroForm field names.
 *
 * These names were enumerated directly from the stored template
 * (assets/tax/fw9-rev-3-2024.pdf) with pdf-lib, not guessed. The fill service
 * (w9FillService) uses this map to place every value on the genuine template so
 * the stored and previewed document is the official form itself, field for
 * field. If a future revision changes the template, re-enumerate and update here.
 *
 * Enumerated field inventory (23 fields):
 *   f1_01  Line 1  Name of entity or individual
 *   f1_02  Line 2  Business name / disregarded entity / DBA
 *   c1_1[0..6]     Line 3a classification checkboxes (7, exactly one set)
 *   f1_03  Line 3a LLC tax-classification code entry (C, S, or P)
 *   f1_04  Line 3a "Other" classification text
 *   c1_2[0]        Line 3b foreign partners/owners/beneficiaries checkbox
 *   f1_05  Line 4  Exempt payee code
 *   f1_06  Line 4  FATCA exemption code
 *   f1_07  Line 5  Address (number, street, apt/suite)
 *   f1_08  Line 6  City, state, ZIP
 *   f1_09          Requester's name and address (optional)
 *   f1_10  Line 7  Account number(s)
 *   f1_11  Part I  SSN group 1 (3 digits, comb)
 *   f1_12  Part I  SSN group 2 (2 digits, comb)
 *   f1_13  Part I  SSN group 3 (4 digits, comb)
 *   f1_14  Part I  EIN group 1 (2 digits, comb)
 *   f1_15  Part I  EIN group 2 (7 digits, comb)
 */

const P = 'topmostSubform[0].Page1[0]';
const BOXES = `${P}.Boxes3a-b_ReadOrder[0]`;
const ADDR = `${P}.Address_ReadOrder[0]`;

/** The seven Line 3a federal tax classifications, in template checkbox order. */
export type W9Classification =
  | 'INDIVIDUAL_SOLE_PROPRIETOR'
  | 'C_CORPORATION'
  | 'S_CORPORATION'
  | 'PARTNERSHIP'
  | 'TRUST_ESTATE'
  | 'LLC'
  | 'OTHER';

/** Checkbox index (0-6) for each classification, matching c1_1[n] on the template. */
export const W9_CLASSIFICATION_CHECKBOX_INDEX: Record<W9Classification, number> = {
  INDIVIDUAL_SOLE_PROPRIETOR: 0,
  C_CORPORATION: 1,
  S_CORPORATION: 2,
  PARTNERSHIP: 3,
  TRUST_ESTATE: 4,
  LLC: 5,
  OTHER: 6,
};

/** LLC sub-classification code entered in the Line 3a LLC entry space. */
export type W9LlcCode = 'C' | 'S' | 'P';

export const W9_FIELD = {
  // Text fields
  line1_name: `${P}.f1_01[0]`,
  line2_businessName: `${P}.f1_02[0]`,
  line3a_llcCode: `${BOXES}.f1_03[0]`,
  line3a_otherText: `${BOXES}.f1_04[0]`,
  line4_exemptPayeeCode: `${P}.f1_05[0]`,
  line4_fatcaCode: `${P}.f1_06[0]`,
  line5_address: `${ADDR}.f1_07[0]`,
  line6_cityStateZip: `${ADDR}.f1_08[0]`,
  requesterNameAddress: `${P}.f1_09[0]`,
  line7_accountNumbers: `${P}.f1_10[0]`,
  // Part I TIN comb fields (one digit per box)
  ssn_group1: `${P}.f1_11[0]`, // 3 digits
  ssn_group2: `${P}.f1_12[0]`, // 2 digits
  ssn_group3: `${P}.f1_13[0]`, // 4 digits
  ein_group1: `${P}.f1_14[0]`, // 2 digits
  ein_group2: `${P}.f1_15[0]`, // 7 digits
  // Line 3b checkbox
  line3b_foreign: `${BOXES}.c1_2[0]`,
} as const;

/** Full checkbox field name for a Line 3a classification. */
export function classificationCheckboxName(cls: W9Classification): string {
  return `${BOXES}.c1_1[${W9_CLASSIFICATION_CHECKBOX_INDEX[cls]}]`;
}

/** All seven Line 3a checkbox field names, in order. */
export function allClassificationCheckboxNames(): string[] {
  return [0, 1, 2, 3, 4, 5, 6].map((i) => `${BOXES}.c1_1[${i}]`);
}
