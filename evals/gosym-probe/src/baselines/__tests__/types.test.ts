import { describe, it, expect } from 'vitest';
import { pickGitFields } from '../types.js';

describe('pickGitFields', () => {
  it('returns empty object for null input', () => {
    expect(pickGitFields(null)).toEqual({});
  });

  it('returns empty object for undefined input', () => {
    expect(pickGitFields(undefined)).toEqual({});
  });

  it('returns empty object when meta has no git fields', () => {
    expect(pickGitFields({})).toEqual({});
  });

  it('extracts gitSha when present', () => {
    expect(pickGitFields({ gitSha: 'abc1234' })).toEqual({ gitSha: 'abc1234' });
  });

  it('extracts gitBranch when present', () => {
    expect(pickGitFields({ gitBranch: 'feat/test' })).toEqual({ gitBranch: 'feat/test' });
  });

  it('extracts both fields when both present', () => {
    expect(pickGitFields({ gitSha: 'abc1234', gitBranch: 'main' })).toEqual({
      gitSha: 'abc1234',
      gitBranch: 'main',
    });
  });

  it('preserves explicit null for gitSha (git info unavailable)', () => {
    expect(pickGitFields({ gitSha: null, gitBranch: 'main' })).toEqual({
      gitSha: null,
      gitBranch: 'main',
    });
  });

  it('preserves explicit null for gitBranch (git info unavailable)', () => {
    expect(pickGitFields({ gitSha: 'abc1234', gitBranch: null })).toEqual({
      gitSha: 'abc1234',
      gitBranch: null,
    });
  });

  it('preserves explicit null for both fields', () => {
    expect(pickGitFields({ gitSha: null, gitBranch: null })).toEqual({
      gitSha: null,
      gitBranch: null,
    });
  });

  it('omits undefined gitSha while preserving defined gitBranch', () => {
    const result = pickGitFields({ gitSha: undefined, gitBranch: 'main' });
    expect(result).toEqual({ gitBranch: 'main' });
    expect('gitSha' in result).toBe(false);
  });

  it('omits undefined gitBranch while preserving defined gitSha', () => {
    const result = pickGitFields({ gitSha: 'abc1234', gitBranch: undefined });
    expect(result).toEqual({ gitSha: 'abc1234' });
    expect('gitBranch' in result).toBe(false);
  });

  it('returns empty object when both fields are explicitly undefined', () => {
    const result = pickGitFields({ gitSha: undefined, gitBranch: undefined });
    expect(result).toEqual({});
    expect('gitSha' in result).toBe(false);
    expect('gitBranch' in result).toBe(false);
  });
});
