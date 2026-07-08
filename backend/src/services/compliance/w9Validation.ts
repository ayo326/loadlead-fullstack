/**
 * Form W-9 validation, from the official instructions (Rev. 3-2024).
 *
 * The classification on Line 3a drives what is acceptable for the Line 1 name
 * and the TIN type:
 *   - Sole proprietor / individual: individual name on Line 1, business or DBA
 *     on Line 2; SSN or EIN acceptable.
 *   - Corporation, S corporation, partnership, LLC taxed as one of those: the
 *     entity's name on Line 1 and an EIN (never an SSN).
 *   - Trust or estate: name on Line 1; SSN or EIN acceptable (grantor trusts).
 *   - LLC: a C, S, or P sub-code is required.
 *   - Single-member disregarded entity: the OWNER'S name on Line 1 (never the
 *     disregarded entity), and the owner's classification, not LLC.
 *
 * Two gates that stop a W-9 from being accepted at all:
 *   - Not a US person: a W-9 does not apply; a Form W-8 does. We reject and flag.
 *   - Applied For TIN: accepted, rendered, but held at PENDING; it can never
 *     reach VERIFIED until a real TIN replaces it (a new version).
 */

import { W9Classification, W9LlcCode } from './w9FieldMap';

export type W9ValidationErrorCode =
  | 'LINE1_REQUIRED'
  | 'ADDRESS_REQUIRED'
  | 'CITY_STATE_ZIP_REQUIRED'
  | 'CLASSIFICATION_REQUIRED'
  | 'LLC_CODE_REQUIRED'
  | 'OTHER_TEXT_REQUIRED'
  | 'EIN_REQUIRED_FOR_ENTITY'
  | 'TIN_REQUIRED'
  | 'TIN_FORMAT_INVALID'
  | 'DISREGARDED_LINE1_MUST_BE_OWNER'
  | 'DISREGARDED_USE_OWNER_CLASSIFICATION'
  | 'NOT_US_PERSON_USE_W8';

export interface W9ValidationError {
  code: W9ValidationErrorCode;
  message: string;
}

export interface W9ValidationInput {
  line1Name?: string;
  line2BusinessName?: string;
  classification?: W9Classification;
  llcCode?: W9LlcCode;
  otherText?: string;
  tinType?: 'SSN' | 'EIN';
  tin?: string;
  tinAppliedFor?: boolean;
  address?: string;
  cityStateZip?: string;
  /** The certification includes "I am a U.S. citizen or other U.S. person." */
  isUsPerson?: boolean;
  /** The filer indicated the entity is a single-member disregarded entity. */
  singleMemberDisregarded?: boolean;
  /** The UI detected the disregarded entity's name (not the owner's) on Line 1. */
  line1IsDisregardedEntityName?: boolean;
}

export interface W9ValidationResult {
  ok: boolean;
  errors: W9ValidationError[];
  /** True when a Form W-8 applies instead of a W-9 (non-US person). */
  requiresW8: boolean;
  /** Non-null when the document must be held at PENDING and can never auto-verify. */
  hold: 'TIN_APPLIED_FOR' | null;
}

/** Classifications whose only acceptable TIN is an EIN. */
const EIN_ONLY: ReadonlySet<W9Classification> = new Set<W9Classification>([
  'C_CORPORATION',
  'S_CORPORATION',
  'PARTNERSHIP',
]);

const SSN_RE = /^\d{3}-?\d{2}-?\d{4}$/;
const EIN_RE = /^\d{2}-?\d{7}$/;

function requiresEin(input: W9ValidationInput): boolean {
  if (!input.classification) return false;
  if (EIN_ONLY.has(input.classification)) return true;
  // An LLC taxed as C, S, or a multi-member partnership uses an EIN.
  if (input.classification === 'LLC') return true;
  return false;
}

export function validateW9(input: W9ValidationInput): W9ValidationResult {
  const errors: W9ValidationError[] = [];
  const add = (code: W9ValidationErrorCode, message: string) => errors.push({ code, message });

  // Non-US person: a W-9 does not apply. This is a hard stop.
  const requiresW8 = input.isUsPerson === false;
  if (requiresW8) {
    add(
      'NOT_US_PERSON_USE_W8',
      'A Form W-9 applies only to a U.S. person. A Form W-8 series form applies instead; this requirement is marked unmet and flagged for follow-up.',
    );
  }

  if (!input.line1Name || !input.line1Name.trim()) {
    add('LINE1_REQUIRED', 'Line 1 (name) is required and must be the name shown on your tax return.');
  }
  if (!input.address || !input.address.trim()) {
    add('ADDRESS_REQUIRED', 'Line 5 (address) is required.');
  }
  if (!input.cityStateZip || !input.cityStateZip.trim()) {
    add('CITY_STATE_ZIP_REQUIRED', 'Line 6 (city, state, ZIP) is required.');
  }

  if (!input.classification) {
    add('CLASSIFICATION_REQUIRED', 'A Line 3a federal tax classification is required.');
  } else {
    if (input.classification === 'LLC' && !input.llcCode) {
      add('LLC_CODE_REQUIRED', 'When LLC is selected, a C, S, or P tax-classification code is required.');
    }
    if (input.classification === 'OTHER' && (!input.otherText || !input.otherText.trim())) {
      add('OTHER_TEXT_REQUIRED', 'When Other is selected, describe the classification.');
    }
  }

  // Single-member disregarded entity guidance (Line 1 must be the owner).
  if (input.singleMemberDisregarded) {
    if (input.classification === 'LLC') {
      add(
        'DISREGARDED_USE_OWNER_CLASSIFICATION',
        'A single-member LLC that is a disregarded entity should check the classification of its OWNER, not LLC.',
      );
    }
    if (input.line1IsDisregardedEntityName) {
      add(
        'DISREGARDED_LINE1_MUST_BE_OWNER',
        'Line 1 must be the owner\'s name, not the disregarded entity\'s name. Put the entity name on Line 2.',
      );
    }
  }

  // TIN rules. "Applied For" is accepted and held; skip format checks for it.
  const hold: W9ValidationResult['hold'] = input.tinAppliedFor ? 'TIN_APPLIED_FOR' : null;
  if (!input.tinAppliedFor) {
    if (!input.tin || !input.tin.trim()) {
      add('TIN_REQUIRED', 'A TIN (SSN or EIN) is required, or check Applied For.');
    } else if (input.tinType === 'SSN' && !SSN_RE.test(input.tin.trim())) {
      add('TIN_FORMAT_INVALID', 'SSN must be in the format XXX-XX-XXXX.');
    } else if (input.tinType === 'EIN' && !EIN_RE.test(input.tin.trim())) {
      add('TIN_FORMAT_INVALID', 'EIN must be in the format XX-XXXXXXX.');
    }

    if (requiresEin(input) && input.tinType !== 'EIN') {
      add(
        'EIN_REQUIRED_FOR_ENTITY',
        'This classification requires an EIN; an SSN is not acceptable for a corporation, S corporation, partnership, or LLC.',
      );
    }
  }

  return { ok: errors.length === 0, errors, requiresW8, hold };
}
