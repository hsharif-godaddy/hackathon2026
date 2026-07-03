import { describe, it, expect } from 'vitest';
import { JudgeVerdictSchema, extractJsonObject } from '../judge-schema.js';

describe('JudgeVerdictSchema', () => {
  const accepted: readonly string[] = ['pass', 'fail', 'incomplete'];

  for (const token of accepted) {
    it(`accepts '${token}'`, () => {
      const result: boolean = JudgeVerdictSchema.safeParse(token).success;
      expect(result).toBe(true);
    });
  }

  const rejected: readonly string[] = ['directional', 'partial', 'unknown', ''];

  for (const token of rejected) {
    it(`rejects '${token}'`, () => {
      const result: boolean = JudgeVerdictSchema.safeParse(token).success;
      expect(result).toBe(false);
    });
  }
});

describe('extractJsonObject', () => {
  it('extracts a clean object', () => {
    const output: string | null = extractJsonObject('{"verdict":"pass"}');
    expect(output).toBe('{"verdict":"pass"}');
  });

  it('extracts the outermost object from surrounding prose', () => {
    const output: string | null = extractJsonObject(
      'Here is my verdict: {"verdict":"fail"} and that is final.',
    );
    expect(output).toBe('{"verdict":"fail"}');
  });

  it('spans from the first brace to the last brace across nested objects', () => {
    const output: string | null = extractJsonObject(
      'noise {"a":{"b":1}} tail',
    );
    expect(output).toBe('{"a":{"b":1}}');
  });

  it('returns null when there is no opening brace', () => {
    const output: string | null = extractJsonObject('no braces here');
    expect(output).toBeNull();
  });

  it('returns null when there is no closing brace', () => {
    const output: string | null = extractJsonObject('{"verdict":"pass"');
    expect(output).toBeNull();
  });

  it('returns null when the closing brace precedes the opening brace', () => {
    const output: string | null = extractJsonObject('} then {');
    expect(output).toBeNull();
  });

  it('does not strip triple-backtick fences but excludes them as outside the braces', () => {
    const output: string | null = extractJsonObject(
      '```json\n{"verdict":"incomplete"}\n```',
    );
    expect(output).toBe('{"verdict":"incomplete"}');
  });
});
