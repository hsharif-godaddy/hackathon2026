import { describe, it, expect } from 'vitest';
import {
  toFiniteNumber,
} from '../to-finite-number.js';

describe('toFiniteNumber', () => {
  // -- valid finite numbers -----------------------
  it('returns a valid number unchanged', () => {
    expect(toFiniteNumber(42, 0)).toBe(42);
  });

  it('returns zero unchanged', () => {
    expect(toFiniteNumber(0, 99)).toBe(0);
  });

  it('returns negative numbers unchanged', () => {
    expect(toFiniteNumber(-5, 0)).toBe(-5);
  });

  it('returns float values unchanged', () => {
    expect(toFiniteNumber(3.14, 0)).toBe(3.14);
  });

  // -- string coercion ----------------------------
  it('coerces a numeric string to number', () => {
    expect(toFiniteNumber('123', 0)).toBe(123);
  });

  it('coerces a float string to number', () => {
    expect(toFiniteNumber('3.14', 0)).toBe(3.14);
  });

  // -- NaN / Infinity -> fallback -----------------
  it('returns fallback for NaN', () => {
    expect(toFiniteNumber(NaN, 0)).toBe(0);
  });

  it('returns fallback for Infinity', () => {
    expect(toFiniteNumber(Infinity, 0)).toBe(0);
  });

  it('returns fallback for -Infinity', () => {
    expect(toFiniteNumber(-Infinity, 0)).toBe(0);
  });

  // -- non-numeric strings -> fallback ------------
  it(
    'returns fallback for non-numeric string',
    () => {
      expect(toFiniteNumber('garbage', 0)).toBe(0);
    },
  );

  // -- undefined -> fallback ----------------------
  it('returns fallback for undefined', () => {
    expect(toFiniteNumber(undefined, 0)).toBe(0);
  });

  // -- null / empty string coerce to finite 0 ----
  it(
    'coerces null to 0 (Number(null) is finite)',
    () => {
      expect(toFiniteNumber(null, 99)).toBe(0);
    },
  );

  it(
    'coerces empty string to 0 ' +
      '(Number("") is finite)',
    () => {
      expect(toFiniteNumber('', 99)).toBe(0);
    },
  );

  // -- objects / arrays -> fallback ---------------
  it('returns fallback for an object', () => {
    expect(toFiniteNumber({}, 0)).toBe(0);
  });

  it('returns fallback for an array', () => {
    expect(toFiniteNumber([1, 2], 0)).toBe(0);
  });

  // -- custom fallback ----------------------------
  it('uses the provided fallback value', () => {
    expect(toFiniteNumber('bad', -1)).toBe(-1);
  });
});
