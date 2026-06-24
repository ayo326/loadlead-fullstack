// Canonical serializer for attestation documentHash.
//
// JCS-style: keys sorted recursively; no insignificant whitespace; numbers
// follow JSON.stringify; strings UTF-8; arrays preserve order (the
// projection already sorts the ones that need sorting).
//
// The output is bytes; we sha256 the bytes. Same projection ⇒ same bytes
// ⇒ same hash, across renders, processes, and Node versions. This is the
// stability acceptance proof for CONSTRAINT 2.

import { createHash } from 'node:crypto';
import { project, canonicalSchemaVersion, ProjectionInput } from './projections/v1';
import type { AttestationAction } from '../../types/signatures';

/** Recursive key-sorting JSON stringify. No spaces, no quirks. */
function canonicalStringify(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number') {
    // Reject non-finite numbers explicitly so callers fail loud.
    if (!Number.isFinite(value)) throw new Error('CANONICALIZE_NONFINITE_NUMBER');
    return JSON.stringify(value);
  }
  if (typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalStringify).join(',') + ']';
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value as object).sort();
    return '{' + keys.map((k) =>
      JSON.stringify(k) + ':' + canonicalStringify((value as Record<string, unknown>)[k]),
    ).join(',') + '}';
  }
  throw new Error(`CANONICALIZE_UNSUPPORTED_TYPE: ${typeof value}`);
}

export interface CanonicalResult {
  canonicalJSON:          string;
  documentHash:           string; // sha256 hex
  canonicalSchemaVersion: string;
}

/** Project + serialize + hash for an attestation action. */
export function canonicalize(action: AttestationAction, input: ProjectionInput): CanonicalResult {
  const projected = project(action, input);
  // Stamp the schema version into the hash input so swapping projection
  // versions can never collide with a prior signature's hash.
  const payload = { canonicalSchemaVersion, ...projected };
  const canonicalJSON = canonicalStringify(payload);
  const documentHash = createHash('sha256').update(canonicalJSON, 'utf8').digest('hex');
  return { canonicalJSON, documentHash, canonicalSchemaVersion };
}
