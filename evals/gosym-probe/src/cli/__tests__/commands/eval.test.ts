import { describe, it, expect } from 'vitest';
import {
  buildEvalFlags,
  type EvalOptions,
} from '../../commands/eval.js';

describe('buildEvalFlags', () => {
  it('returns empty array for empty options', () => {
    expect(buildEvalFlags({})).toEqual([]);
  });

  it('adds --scenario flag', () => {
    const flags = buildEvalFlags({ scenario: 'build-landing-page' });
    expect(flags).toEqual(['--scenario', 'build-landing-page']);
  });

  it('adds --trials flag as string', () => {
    const flags = buildEvalFlags({ trials: 5 });
    expect(flags).toEqual(['--trials', '5']);
  });

  it('adds --env flag', () => {
    const flags = buildEvalFlags({ env: 'local.test' });
    expect(flags).toEqual(['--env', 'local.test']);
  });

  it('adds --skip-baseline flag', () => {
    const flags = buildEvalFlags({ skipBaseline: true });
    expect(flags).toEqual(['--skip-baseline']);
  });

  it('omits skipBaseline when false', () => {
    const flags = buildEvalFlags({ skipBaseline: false });
    expect(flags).toEqual([]);
  });

  it('combines multiple options', () => {
    const options: EvalOptions = {
      scenario: 'build-landing-page',
      trials: 3,
      env: 'local.dev',
    };
    const flags = buildEvalFlags(options);
    expect(flags).toEqual([
      '--scenario', 'build-landing-page',
      '--trials', '3',
      '--env', 'local.dev',
    ]);
  });

  it('handles trials of 1', () => {
    expect(buildEvalFlags({ trials: 1 })).toEqual(['--trials', '1']);
  });

  it('handles scenarios with hyphens in name', () => {
    const flags = buildEvalFlags({ scenario: 'my-test-scenario' });
    expect(flags).toEqual(['--scenario', 'my-test-scenario']);
  });

  it('adds --suite flag', () => {
    const flags = buildEvalFlags({ suite: 'smoke' });
    expect(flags).toEqual(['--suite', 'smoke']);
  });

  it('places --suite after --scenario', () => {
    const flags = buildEvalFlags({
      scenario: 'build-landing-page',
      suite: 'smoke',
    });
    expect(flags).toEqual([
      '--scenario', 'build-landing-page',
      '--suite', 'smoke',
    ]);
  });

  it('places --suite before --trials', () => {
    const flags = buildEvalFlags({ suite: 'smoke', trials: 3 });
    expect(flags).toEqual(['--suite', 'smoke', '--trials', '3']);
  });

  it('omits --suite when not provided', () => {
    const flags = buildEvalFlags({ trials: 2 });
    expect(flags).not.toContain('--suite');
  });
});
