import { describe, it, expect } from 'vitest';
import { serializePlanRationale, parsePlanRationale, type PlanRationale } from '../plan-rationale.js';

const VALID: PlanRationale = {
  assumptions: ['Local foot traffic', 'Mobile-first audience'],
  mixRationale: 'Landing page converts; blog builds SEO; social reaches followers',
  expectedOutcome: 'A small first wave of visitors and a handful of early sales',
};

describe('plan-rationale', () => {
  it('serializes then parses back to an equal object (round-trip)', () => {
    const json: string = serializePlanRationale(VALID);
    expect(parsePlanRationale(json)).toEqual(VALID);
  });

  it('throws on serialize when the shape is invalid (strict on write)', () => {
    expect(() => serializePlanRationale({ assumptions: 'not-an-array' } as unknown as PlanRationale)).toThrow();
  });

  it('returns null for a null / empty stored value', () => {
    expect(parsePlanRationale(null)).toBeNull();
    expect(parsePlanRationale('')).toBeNull();
    expect(parsePlanRationale('   ')).toBeNull();
  });

  it('returns null (lenient on read) for malformed JSON or a wrong shape', () => {
    expect(parsePlanRationale('{not valid json')).toBeNull();
    expect(parsePlanRationale('{"assumptions":"x"}')).toBeNull(); // wrong type
    expect(parsePlanRationale('{"mixRationale":"only one field"}')).toBeNull(); // missing fields
  });
});
