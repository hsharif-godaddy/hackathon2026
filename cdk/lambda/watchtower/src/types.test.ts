import { describe, it, expect } from 'vitest';
import { emptyStatData, STAT_KEYS } from './types.js';

describe('StatData', () => {
  it('STAT_KEYS lists every key present in emptyStatData', () => {
    expect([...STAT_KEYS].sort()).toEqual(Object.keys(emptyStatData()).sort());
  });
  it('emptyStatData initializes all stats to 0', () => {
    const empty = emptyStatData();
    for (const k of STAT_KEYS) expect(empty[k]).toBe(0);
  });
});
