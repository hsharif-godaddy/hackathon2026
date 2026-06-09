import { describe, it, expect, beforeEach } from 'vitest';
import { claim, isClaimed, reset } from '../error-claims';

describe('error-claims', () => {
  beforeEach(() => {
    reset();
  });

  it('reports an error as claimed only after claim() is called', () => {
    const err = new Error('boom');
    expect(isClaimed(err)).toBe(false);
    claim(err);
    expect(isClaimed(err)).toBe(true);
  });

  it('tracks errors by identity, not by message', () => {
    const claimed = new Error('same message');
    const other = new Error('same message');
    claim(claimed);
    expect(isClaimed(claimed)).toBe(true);
    expect(isClaimed(other)).toBe(false);
  });

  it('reset() drops all existing claims', () => {
    const err = new Error('boom');
    claim(err);
    expect(isClaimed(err)).toBe(true);
    reset();
    expect(isClaimed(err)).toBe(false);
  });

  it('ignores non-object values without throwing (re-dispatch always carries the Error object)', () => {
    expect(() => claim(null)).not.toThrow();
    expect(() => claim(undefined)).not.toThrow();
    expect(() => claim('string error')).not.toThrow();
    expect(isClaimed(null)).toBe(false);
    expect(isClaimed(undefined)).toBe(false);
    expect(isClaimed('string error')).toBe(false);
  });
});
