/**
 * Money primitives. Every monetary amount that this pipeline stores or computes
 * is an integer number of US cents (minor units). Floating point is never used
 * for money: it is only tolerated at the boundary with the legacy Load model,
 * whose rateAmount is still stored in dollars (a float). dollarsToCents is that
 * one-way boundary; everything downstream stays in integer cents.
 *
 * Rounding is deterministic half-up (Math.round) so the same inputs always
 * produce the same cents. All helpers assert their inputs so a stray float can
 * never silently corrupt a stored amount.
 */

/** Throw unless value is a safe integer count of cents. */
export function assertIntegerCents(cents: number, label = 'amount'): number {
  if (!Number.isInteger(cents)) {
    throw new Error(`money: ${label} must be integer cents, got ${cents}`);
  }
  if (!Number.isSafeInteger(cents)) {
    throw new Error(`money: ${label} exceeds safe integer range: ${cents}`);
  }
  return cents;
}

/**
 * Convert a dollar amount (float, from the legacy Load model) to integer cents.
 * This is the single sanctioned float-to-cents boundary. Rounds half-up to the
 * nearest cent.
 */
export function dollarsToCents(dollars: number): number {
  if (!Number.isFinite(dollars)) {
    throw new Error(`money: dollarsToCents needs a finite number, got ${dollars}`);
  }
  // Round at the cent so 12.345 dollars resolves deterministically to 1235 cents.
  return assertIntegerCents(Math.round(dollars * 100), 'dollarsToCents');
}

/** Convert integer cents back to a dollar number, for display or the legacy boundary. */
export function centsToDollars(cents: number): number {
  assertIntegerCents(cents, 'centsToDollars');
  return cents / 100;
}

/**
 * Apply a basis-point rate (1 bps = 0.01%) to a cents amount, rounding half-up
 * to the nearest cent. Used for the linehaul take rate and any future rate math.
 * Pure and deterministic: same amount and bps always yield the same cents.
 */
export function applyBps(amountCents: number, bps: number): number {
  assertIntegerCents(amountCents, 'applyBps amount');
  if (!Number.isInteger(bps) || bps < 0) {
    throw new Error(`money: applyBps needs a non-negative integer bps, got ${bps}`);
  }
  return assertIntegerCents(Math.round((amountCents * bps) / 10000), 'applyBps result');
}

/** Format integer cents as a USD string for human-facing copy, e.g. 123456 -> "$1,234.56". */
export function formatCentsUsd(cents: number): string {
  assertIntegerCents(cents, 'formatCentsUsd');
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const rem = abs % 100;
  const grouped = dollars.toLocaleString('en-US');
  return `${negative ? '-' : ''}$${grouped}.${rem.toString().padStart(2, '0')}`;
}
