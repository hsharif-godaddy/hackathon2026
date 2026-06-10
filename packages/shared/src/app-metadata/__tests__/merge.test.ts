import { describe, it, expect } from 'vitest';
import { mergeAppMetadata } from '../merge.js';
import type { AppMetadata } from '../types.js';

describe('mergeAppMetadata', () => {
  it('adds new keys to an empty base', () => {
    expect(mergeAppMetadata({}, { source: 'prompt' })).toEqual({ source: 'prompt' });
  });

  it('overwrites existing keys (last-writer-wins) and preserves others', () => {
    const base = { source: 'prompt', ref: { id: 'a' } };
    const result = mergeAppMetadata(base, { ref: { id: 'b' } });
    expect(result).toEqual({ source: 'prompt', ref: { id: 'b' } });
  });

  it('merges shallowly — nested objects are replaced, not deep-merged', () => {
    const base = { ref: { id: 'a', kind: 'x' } };
    // patch provides only `id`; a shallow merge replaces the whole `ref` object,
    // so `kind` must be gone. A deep merge would (wrongly) keep kind: 'x'.
    const result = mergeAppMetadata(base, { ref: { id: 'b' } });
    expect(result.ref).toEqual({ id: 'b' });
    expect((result.ref as { kind?: string }).kind).toBeUndefined();
  });

  it('ignores patch keys whose value is undefined', () => {
    const result = mergeAppMetadata({ source: 'prompt' }, { source: undefined });
    expect(result).toEqual({ source: 'prompt' });
  });

  it('does not mutate the base object', () => {
    const base = { source: 'prompt' };
    mergeAppMetadata(base, { ref: { id: 'x' } });
    expect(base).toEqual({ source: 'prompt' });
  });

  it('supports arbitrary ad-hoc keys (the open bag)', () => {
    const base: AppMetadata = { signalA: 'v1', signalB: { count: 1 } };
    const result = mergeAppMetadata(base, { signalA: 'v2', signalC: true });
    expect(result).toEqual({ signalA: 'v2', signalB: { count: 1 }, signalC: true });
  });

  describe('prototype-chain key hardening', () => {
    it('does not rewire the prototype when patch has an own __proto__ key', () => {
      // JSON.parse gives a real own enumerable __proto__ key (object literal
      // { __proto__: ... } sets the prototype instead)
      const result = mergeAppMetadata({}, JSON.parse('{"__proto__":{"polluted":true}}'));
      expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
      expect(Object.prototype.hasOwnProperty.call(result, '__proto__')).toBe(false);
    });

    it('does not pollute Object.prototype when patch has an own __proto__ key', () => {
      mergeAppMetadata({}, JSON.parse('{"__proto__":{"polluted":true}}'));
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    });

    it('skips constructor and prototype keys (not stored as own data)', () => {
      const result = mergeAppMetadata(
        {},
        JSON.parse('{"constructor":"x","prototype":"y"}')
      );
      expect(Object.prototype.hasOwnProperty.call(result, 'constructor')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(result, 'prototype')).toBe(false);
      expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    });

    it('still merges legitimate keys in the same patch as __proto__', () => {
      const result = mergeAppMetadata(
        {},
        JSON.parse('{"__proto__":{"x":1},"safe":"ok"}')
      );
      expect(result.safe).toBe('ok');
      expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
      expect(Object.prototype.hasOwnProperty.call(result, '__proto__')).toBe(false);
    });
  });
});
