/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';

import { pickBranch } from './RepoSelector';

describe('pickBranch', function pickBranchTests() {
  it('should prefer the repo defaultBranch when present in branches', function preferDefault() {
    const repo = { defaultBranch: 'develop' };
    const branches = [{ name: 'main' }, { name: 'develop' }, { name: 'feature' }];

    expect(pickBranch(repo, branches)).toBe('develop');
  });

  it('should fall back to branches[0] when defaultBranch is not in the list', function fallbackFirst() {
    const repo = { defaultBranch: 'deleted-branch' };
    const branches = [{ name: 'main' }, { name: 'staging' }];

    expect(pickBranch(repo, branches)).toBe('main');
  });

  it('should fall back to branches[0] when repo has no defaultBranch', function noDefault() {
    const repo = { defaultBranch: undefined };
    const branches = [{ name: 'staging' }, { name: 'main' }];

    expect(pickBranch(repo, branches)).toBe('staging');
  });

  it('should fall back to branches[0] when repo is undefined', function undefinedRepo() {
    const branches = [{ name: 'production' }];

    expect(pickBranch(undefined, branches)).toBe('production');
  });

  it('should return main when branches array is empty', function emptyBranches() {
    const repo = { defaultBranch: 'develop' };

    expect(pickBranch(repo, [])).toBe('main');
  });

  it('should return main when both repo is undefined and branches are empty', function nothingAvailable() {
    expect(pickBranch(undefined, [])).toBe('main');
  });
});
