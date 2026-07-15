/**
 * M16 (audit v6): capacityService pure math was untested. These are the geometry +
 * safety-buffer helpers the capacity board relies on; wrong output silently mis-sizes
 * loads. Pure functions - no mocks.
 */
import { describe, it, expect } from 'vitest';
import {
  calcMaxOperationalWeight,
  calcMaxOperationalVolume,
  calcUsableVolume,
} from '../../../src/services/capacityService';

describe('calcMaxOperationalWeight', () => {
  it('applies the safety buffer as a percentage haircut', () => {
    expect(calcMaxOperationalWeight(10000, 10)).toBe(9000);
    expect(calcMaxOperationalWeight(10000, 25)).toBe(7500);
    expect(calcMaxOperationalWeight(10000, 5)).toBe(9500);
  });
  it('is the full capacity at 0% buffer and zero at 100%', () => {
    expect(calcMaxOperationalWeight(8000, 0)).toBe(8000);
    expect(calcMaxOperationalWeight(8000, 100)).toBe(0);
  });
});

describe('calcMaxOperationalVolume', () => {
  it('applies the same percentage haircut to a usable volume', () => {
    expect(calcMaxOperationalVolume(300000, 10)).toBe(270000);
    expect(calcMaxOperationalVolume(0, 10)).toBe(0);
  });
});

describe('calcUsableVolume', () => {
  it('is L x W x H for interior dimensions in inches', () => {
    expect(calcUsableVolume(100, 50, 60)).toBe(300000);
  });
  it('returns 0 when any dimension is missing or zero (unknown geometry -> no volume check)', () => {
    expect(calcUsableVolume(undefined, 50, 60)).toBe(0);
    expect(calcUsableVolume(100, 0, 60)).toBe(0);
    expect(calcUsableVolume(100, 50, undefined)).toBe(0);
    expect(calcUsableVolume()).toBe(0);
  });
});
