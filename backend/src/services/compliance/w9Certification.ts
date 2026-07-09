/**
 * The Form W-9 (Rev. 3-2024) Part II certification, reproduced verbatim from the
 * official IRS form, with a content hash. This mirrors the SMS consent-disclosure
 * pattern: the exact text the signer affirms is pinned as a constant and hashed,
 * so a signature can be tied to the precise words that were certified.
 *
 * This text is reproduced exactly as published by the IRS (a US government work);
 * it is the one place the platform's "no em/en dashes" rule yields to fidelity.
 * Do not paraphrase, reformat, or "clean up" this text: the hash and the legal
 * meaning both depend on it being byte-for-byte the official wording.
 */

import { createHash } from 'node:crypto';

export const W9_FORM_REVISION = 'Rev. 3-2024';

/** The four numbered certification statements, verbatim. */
export const W9_CERTIFICATION_STATEMENTS: readonly string[] = [
  'The number shown on this form is my correct taxpayer identification number (or I am waiting for a number to be issued to me); and',
  'I am not subject to backup withholding because: (a) I am exempt from backup withholding, or (b) I have not been notified by the Internal Revenue Service (IRS) that I am subject to backup withholding as a result of a failure to report all interest or dividends, or (c) the IRS has notified me that I am no longer subject to backup withholding; and',
  'I am a U.S. citizen or other U.S. person (defined below); and',
  'The FATCA code(s) entered on this form (if any) indicating that I am exempt from FATCA reporting is correct.',
] as const;

/** The lead-in line above the four statements, verbatim. */
export const W9_CERTIFICATION_PREAMBLE = 'Under penalties of perjury, I certify that:';

/** The certification instruction about crossing out item 2, verbatim. */
export const W9_CERTIFICATION_INSTRUCTIONS =
  'Certification instructions. You must cross out item 2 above if you have been notified by the IRS that you are currently subject to backup withholding because you have failed to report all interest and dividends on your tax return. For real estate transactions, item 2 does not apply. For mortgage interest paid, acquisition or abandonment of secured property, cancellation of debt, contributions to an individual retirement arrangement (IRA), and, generally, payments other than interest and dividends, you are not required to sign the certification, but you must provide your correct TIN.';

/** The full certification block as one canonical string (preamble + numbered items + instructions). */
export const W9_CERTIFICATION_TEXT = [
  W9_CERTIFICATION_PREAMBLE,
  ...W9_CERTIFICATION_STATEMENTS.map((s, i) => `${i + 1}. ${s}`),
  W9_CERTIFICATION_INSTRUCTIONS,
].join('\n');

/** SHA-256 of the exact certification text, pinned to a signature at sign time. */
export const W9_CERTIFICATION_HASH = createHash('sha256')
  .update(W9_CERTIFICATION_TEXT, 'utf8')
  .digest('hex');
