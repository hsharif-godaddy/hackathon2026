import { describe, it, expect } from 'vitest';
import { stripUnsafeUnicode, sanitizeConfig } from '../sanitize.js';
import type { Config } from '../../../config/environments/types.js';

describe('stripUnsafeUnicode', () => {
  it('returns plain ASCII unchanged', () => {
    expect(stripUnsafeUnicode('hello world')).toBe('hello world');
  });

  it('returns empty string unchanged', () => {
    expect(stripUnsafeUnicode('')).toBe('');
  });

  it('strips BMP private-use char U+E000', () => {
    expect(stripUnsafeUnicode('\uE000')).toBe('');
  });

  it('strips BMP private-use char U+F8FF', () => {
    expect(stripUnsafeUnicode('\uF8FF')).toBe('');
  });

  it('strips supplementary private-use char U+F0000 (Plane 15)', () => {
    const char = String.fromCodePoint(0xF0000);
    expect(stripUnsafeUnicode(char)).toBe('');
  });

  it('strips supplementary private-use char U+100000 (Plane 16)', () => {
    const char = String.fromCodePoint(0x100000);
    expect(stripUnsafeUnicode(char)).toBe('');
  });

  it('strips unassigned plane char U+D5E70 (the exact LiteLLM error char)', () => {
    const char = String.fromCodePoint(0xD5E70);
    expect(stripUnsafeUnicode(char)).toBe('');
  });

  it('returns empty string when input contains only unsafe chars', () => {
    const onlyUnsafe = '\uE000\uF8FF' + String.fromCodePoint(0xD5E70);
    expect(stripUnsafeUnicode(onlyUnsafe)).toBe('');
  });

  it('strips unsafe chars embedded in safe text', () => {
    const mixed = 'hello\uE000world';
    expect(stripUnsafeUnicode(mixed)).toBe('helloworld');
  });

  it('preserves valid non-ASCII: CJK characters', () => {
    expect(stripUnsafeUnicode('中文')).toBe('中文');
  });

  it('preserves valid non-ASCII: emoji', () => {
    const emoji = String.fromCodePoint(0x1F600); // 😀
    expect(stripUnsafeUnicode(emoji)).toBe(emoji);
  });

  it('preserves valid non-ASCII: accented Latin', () => {
    expect(stripUnsafeUnicode('café')).toBe('café');
  });
});

// ── sanitizeConfig ────────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    env: 'test',
    aab: {
      agentsUrl: 'http://test',
      bffUrl: 'http://test',
      controlPlaneUrl: 'http://test',
    },
    gocode: {
      baseUrl: 'http://test',
      apiKey: 'secret-key',
      model: 'test-model',
    },
    eval: {
      defaultTrials: 2,
      maxTurns: 5,
      turnTimeoutMs: 5000,
    },
    playwright: { ignoreHttpsErrors: false },
    regression: { alpha: 0.05, k: 2.0, minMarginFraction: 0.05, reportingK: [1, 2, 3, 5, 10], fallbackThresholds: { thresholds: {}, defaultThreshold: 0.1 } },
    ...overrides,
  };
}

describe('sanitizeConfig', () => {
  it('strips gocode.apiKey from output', () => {
    const result = sanitizeConfig(makeConfig());
    expect(
      (result.gocode as Record<string, unknown>)['apiKey'],
    ).toBeUndefined();
  });

  it('preserves gocode.baseUrl', () => {
    const result = sanitizeConfig(makeConfig());
    expect(result.gocode.baseUrl).toBe('http://test');
  });

  it('preserves gocode.model', () => {
    const result = sanitizeConfig(makeConfig());
    expect(result.gocode.model).toBe('test-model');
  });

  it('preserves env field', () => {
    const result = sanitizeConfig(makeConfig());
    expect(result.env).toBe('test');
  });

  it('preserves aab config', () => {
    const result = sanitizeConfig(makeConfig());
    expect(result.aab).toEqual({
      agentsUrl: 'http://test',
      bffUrl: 'http://test',
      controlPlaneUrl: 'http://test',
    });
  });

  it('preserves eval config', () => {
    const result = sanitizeConfig(makeConfig());
    expect(result.eval).toEqual({
      defaultTrials: 2,
      maxTurns: 5,
      turnTimeoutMs: 5000,
    });
  });

  it('preserves playwright config', () => {
    const result = sanitizeConfig(makeConfig());
    expect(result.playwright).toEqual({ ignoreHttpsErrors: false });
  });

  it('preserves regression config', () => {
    const result = sanitizeConfig(makeConfig());
    expect(result.regression).toEqual({
      alpha: 0.05,
      k: 2.0,
      minMarginFraction: 0.05,
      reportingK: [1, 2, 3, 5, 10],
      fallbackThresholds: { thresholds: {}, defaultThreshold: 0.1 },
    });
  });

  it('preserves optional storage field when present', () => {
    const config = makeConfig({ storage: { maxRuns: 10 } });
    const result = sanitizeConfig(config);
    expect(result.storage).toEqual({ maxRuns: 10 });
  });

  it('omits storage field when absent', () => {
    const result = sanitizeConfig(makeConfig());
    expect(result.storage).toBeUndefined();
  });

  it('does not mutate the original config', () => {
    const config = makeConfig();
    sanitizeConfig(config);
    expect(config.gocode.apiKey).toBe('secret-key');
  });
});
