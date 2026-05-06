import { describe, it, expect } from 'vitest';
import { createCompleter } from '../autocomplete.js';

const CANDIDATES = [
  'build-landing-page',
  'build-contact-form',
  'login-flow',
];

describe('createCompleter', () => {
  it('returns all candidates for empty input', () => {
    const completer = createCompleter(CANDIDATES);
    const [completions, line] = completer('');
    expect(completions).toEqual(CANDIDATES);
    expect(line).toBe('');
  });

  it('returns matching candidates for partial input', () => {
    const completer = createCompleter(CANDIDATES);
    const [completions, line] = completer('build');
    expect(completions).toEqual([
      'build-landing-page',
      'build-contact-form',
    ]);
    expect(line).toBe('build');
  });

  it('returns exact match for full candidate name', () => {
    const completer = createCompleter(CANDIDATES);
    const [completions, line] = completer('login-flow');
    expect(completions).toEqual(['login-flow']);
    expect(line).toBe('login-flow');
  });

  it('returns empty array for no-match input', () => {
    const completer = createCompleter(CANDIDATES);
    const [completions, line] = completer('xyz');
    expect(completions).toEqual([]);
    expect(line).toBe('xyz');
  });

  it('handles empty candidates array', () => {
    const completer = createCompleter([]);
    const [completions, line] = completer('');
    expect(completions).toEqual([]);
    expect(line).toBe('');
  });

  it('is case-sensitive in matching', () => {
    const completer = createCompleter(CANDIDATES);
    const [completions] = completer('Build');
    expect(completions).toEqual([]);
  });

  it('preserves line as second element of result', () => {
    const completer = createCompleter(CANDIDATES);
    const [, line] = completer('build-landing');
    expect(line).toBe('build-landing');
  });

  it('single candidate list returns all for empty input', () => {
    const completer = createCompleter(['only-one']);
    const [completions, line] = completer('');
    expect(completions).toEqual(['only-one']);
    expect(line).toBe('');
  });
});
