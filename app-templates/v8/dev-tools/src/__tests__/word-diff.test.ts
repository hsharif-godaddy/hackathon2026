import { describe, it, expect } from 'vitest';
import { diffWords } from '../utils/word-diff';

describe('diffWords', () => {
  it('returns a single unchanged part when inputs are identical', () => {
    const parts = diffWords('hello world', 'hello world');
    expect(parts).toEqual([{ type: 'unchanged', text: 'hello world' }]);
  });

  it('marks pure additions', () => {
    const parts = diffWords('hello', 'hello world');
    // "hello" unchanged, " world" added
    expect(parts).toEqual([
      { type: 'unchanged', text: 'hello' },
      { type: 'added', text: ' world' },
    ]);
  });

  it('marks pure deletions', () => {
    const parts = diffWords('hello world', 'hello');
    expect(parts).toEqual([
      { type: 'unchanged', text: 'hello' },
      { type: 'removed', text: ' world' },
    ]);
  });

  it('marks a single-word substitution', () => {
    const parts = diffWords('teh quick fox', 'the quick fox');
    // LCS keeps " quick fox", so "teh" → "the" appears as a removed/added pair.
    expect(parts.find((p) => p.type === 'removed')?.text).toBe('teh');
    expect(parts.find((p) => p.type === 'added')?.text).toBe('the');
    expect(parts.find((p) => p.type === 'unchanged')?.text).toBe(' quick fox');
  });

  it('coalesces adjacent same-type parts', () => {
    const parts = diffWords('a b c', 'x y z');
    // Without coalescing this would emit 5+ parts; coalesced it should be one
    // removed run and one added run.
    const removed = parts.filter((p) => p.type === 'removed');
    const added = parts.filter((p) => p.type === 'added');
    expect(removed.length).toBe(1);
    expect(added.length).toBe(1);
  });
});
