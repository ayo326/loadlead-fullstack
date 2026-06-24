// CONSTRAINT 3 layer 3 proof — the ESLint guard catches drift-by-edit.
//
// We don't run ESLint inside this test (it's already a CI job). Instead
// we read the rule file + signatureService.ts and assert:
//   1) The override scopes the ban to signatureService.ts.
//   2) The rule names UpdateCommand / DeleteCommand / BatchWriteCommand.
//   3) signatureService.ts does NOT currently import any of those.
//
// If anyone adds one of the banned imports, this test reads the new
// content and fails — a fast, in-process safety net beyond CI lint.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..', 'src', 'services', 'attestation');

describe('CONSTRAINT 3 layer 3 — ESLint immutability ban', () => {
  const eslintRc = readFileSync(join(ROOT, '.eslintrc.cjs'), 'utf8');

  it('scopes the override to signatureService.ts', () => {
    expect(eslintRc).toMatch(/files:\s*\['signatureService\.ts'\]/);
  });

  it('bans UpdateCommand / DeleteCommand / BatchWriteCommand from @aws-sdk/lib-dynamodb', () => {
    expect(eslintRc).toMatch(/@aws-sdk\/lib-dynamodb/);
    expect(eslintRc).toMatch(/UpdateCommand/);
    expect(eslintRc).toMatch(/DeleteCommand/);
    expect(eslintRc).toMatch(/BatchWriteCommand/);
  });

  it('signatureService.ts currently does NOT import any banned command', () => {
    const sig = readFileSync(join(ROOT, 'signatureService.ts'), 'utf8');
    // Look only at import lines (banned tokens are allowed in comments
    // describing the ban). An import line for these would look like
    // `import { ... UpdateCommand ... } from '@aws-sdk/lib-dynamodb'`.
    const importLines = sig
      .split('\n')
      .filter((l) => /^import\s/.test(l.trim()))
      .join(' | ');
    expect(importLines).not.toMatch(/UpdateCommand/);
    expect(importLines).not.toMatch(/DeleteCommand/);
    expect(importLines).not.toMatch(/BatchWriteCommand/);
  });

  it('signatureService.ts uses the attribute_not_exists guard on every PutItem', () => {
    const sig = readFileSync(join(ROOT, 'signatureService.ts'), 'utf8');
    // One PutItem in the file; if more are added, each must keep the guard.
    const puts = sig.match(/PutCommand/g) ?? [];
    expect(puts.length).toBeGreaterThan(0);
    const guards = sig.match(/attribute_not_exists\(signatureId\)/g) ?? [];
    expect(guards.length).toBe(puts.length);
  });
});
