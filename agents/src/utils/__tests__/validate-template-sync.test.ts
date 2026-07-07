import { describe, it, expect, vi } from 'vitest';
// @ts-expect-error - .mjs import of plain ESM script outside the TS rootDir
import { checkSsrSkillTemplateSync, SSR_SKILL_TEMPLATE_PAIRS, resolveCiRange, buildSsrReaders } from '../../../../scripts/validate-template-sync.mjs';

const SKILL = SSR_SKILL_TEMPLATE_PAIRS[0].skillPath as string;
const V8 = SSR_SKILL_TEMPLATE_PAIRS[0].v8Path as string;

const staged = (content: string | null) => (_p: string) => content;
const head = (content: string | null) => (_p: string) => content;

describe('checkSsrSkillTemplateSync', () => {
  it('returns true when neither path is staged', () => {
    const result = checkSsrSkillTemplateSync([], { readStaged: staged(null), readHead: head(null) });
    expect(result).toBe(true);
  });

  it('returns true when both paths are staged with identical content', () => {
    const changes = [{ path: SKILL }, { path: V8 }];
    const rs = (_p: string) => 'same content';
    const result = checkSsrSkillTemplateSync(changes, { readStaged: rs, readHead: rs });
    expect(result).toBe(true);
  });

  it('returns false when both staged but skill content differs from v8', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const changes = [{ path: SKILL }, { path: V8 }];
    const rs = (p: string) => p === SKILL ? 'skill content' : 'v8 content';
    const result = checkSsrSkillTemplateSync(changes, { readStaged: rs, readHead: rs });
    expect(result).toBe(false);
  });

  it('returns true when only skill path staged and matches head of v8', () => {
    const changes = [{ path: SKILL }];
    const rs = (_p: string) => 'content';
    const rh = (_p: string) => 'content';
    const result = checkSsrSkillTemplateSync(changes, { readStaged: rs, readHead: rh });
    expect(result).toBe(true);
  });

  it('returns false when only skill path staged and differs from head of v8', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const changes = [{ path: SKILL }];
    const rs = (_p: string) => 'new skill content';
    const rh = (_p: string) => 'v8 head content';
    const result = checkSsrSkillTemplateSync(changes, { readStaged: rs, readHead: rh });
    expect(result).toBe(false);
  });

  it('returns true when only v8 path staged and matches head of skill', () => {
    const changes = [{ path: V8 }];
    const rs = (_p: string) => 'content';
    const rh = (_p: string) => 'content';
    const result = checkSsrSkillTemplateSync(changes, { readStaged: rs, readHead: rh });
    expect(result).toBe(true);
  });

  it('returns false when only v8 path staged and differs from head of skill', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const changes = [{ path: V8 }];
    const rs = (_p: string) => 'new v8 content';
    const rh = (_p: string) => 'skill head content';
    const result = checkSsrSkillTemplateSync(changes, { readStaged: rs, readHead: rh });
    expect(result).toBe(false);
  });

  it('skips a pair when either content is null (file missing)', () => {
    const changes = [{ path: SKILL }, { path: V8 }];
    const rs = (p: string) => p === SKILL ? null : 'v8 content';
    const result = checkSsrSkillTemplateSync(changes, { readStaged: rs, readHead: rs });
    expect(result).toBe(true);
  });

  it('checks all pairs and reports all failures', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const changes = SSR_SKILL_TEMPLATE_PAIRS.map((p: { skillPath: string }) => ({ path: p.skillPath }));
    const rs = (p: string) => `staged:${p}`;
    const rh = (p: string) => `head:${p}`;
    const result = checkSsrSkillTemplateSync(changes, { readStaged: rs, readHead: rh });
    expect(result).toBe(false);
  });

  it('warns (not silently skips) when a touched pair cannot be read', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const changes = [{ path: SKILL }, { path: V8 }];
    const rs = (p: string) => (p === SKILL ? null : 'v8 content');
    const result = checkSsrSkillTemplateSync(changes, { readStaged: rs, readHead: rs });
    expect(result).toBe(true);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(SKILL));
  });
});

describe('resolveCiRange', () => {
  it('returns mergeBase null and never shells out when not in CI mode', () => {
    const runMergeBase = vi.fn();
    const result = resolveCiRange({ ciMode: false, runMergeBase });
    expect(result).toEqual({ ok: true, mergeBase: null });
    expect(runMergeBase).not.toHaveBeenCalled();
  });

  it('resolves and trims the merge-base on success', () => {
    const runMergeBase = (_b: string, _h: string) => 'abc123def456\n';
    const result = resolveCiRange({ ciMode: true, baseSha: 'base', headSha: 'head', runMergeBase });
    expect(result).toEqual({ ok: true, mergeBase: 'abc123def456' });
  });

  it('classifies empty output as no common ancestor', () => {
    const runMergeBase = (_b: string, _h: string) => '\n';
    const result = resolveCiRange({ ciMode: true, baseSha: 'base', headSha: 'head', runMergeBase });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no common ancestor/);
  });

  it('prefers stderr over message when the git call throws', () => {
    const runMergeBase = () => {
      const err: Error & { stderr?: Buffer } = new Error('spawn failed');
      err.stderr = Buffer.from('fatal: Not a valid commit name base\n');
      throw err;
    };
    const result = resolveCiRange({ ciMode: true, baseSha: 'base', headSha: 'head', runMergeBase });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('fatal: Not a valid commit name base');
  });

  it('falls back to the error message when no stderr is present', () => {
    const runMergeBase = () => {
      throw new Error('git binary not found');
    };
    const result = resolveCiRange({ ciMode: true, baseSha: 'base', headSha: 'head', runMergeBase });
    expect(result).toEqual({ ok: false, error: 'git binary not found' });
  });
});

describe('buildSsrReaders', () => {
  it('returns no overrides in local mode', () => {
    expect(buildSsrReaders({ ciMode: false })).toEqual({});
  });

  it('overrides readHead to read the PR head (not the merge-base) in CI mode', () => {
    const show = vi.fn((spec: string) => `content-of:${spec}`);
    const readers = buildSsrReaders({ ciMode: true, headSha: 'HEADSHA', show });
    const readHead = readers.readHead as (file: string) => string;
    const content = readHead('src/server/entry.ts');
    expect(show).toHaveBeenCalledWith('HEADSHA:src/server/entry.ts');
    expect(content).toBe('content-of:HEADSHA:src/server/entry.ts');
  });
});
