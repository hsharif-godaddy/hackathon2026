import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  collectGitContext,
  renderGitContextMarkdown,
  DEFAULT_GIT_CONTEXT_CAPS,
  type GitContextCaps,
  type GitExec,
} from '../git-context.js';

// ── Git output builders ────────────────────────────────────────────────────────

const FIELD = '\x1f';
const RECORD = '\x1e';

interface FakeCommit {
  sha: string;
  subject: string;
  body: string;
}

function buildLogOutput(commits: readonly FakeCommit[]): string {
  return commits
    .map((c) => `${c.sha}${FIELD}${c.subject}${FIELD}${c.body}`)
    .join(RECORD + '\n');
}

/**
 * Builds a GitExec that dispatches on the git subcommand. `diffsBySha` supplies
 * per-`git show` diff bodies keyed by the SHA argument; `stat` is the cumulative
 * `git diff --stat` body. Unmatched invocations return ''.
 */
function makeGitExec(opts: {
  commits?: readonly FakeCommit[];
  cumulativeStat?: string;
  diffBySha?: Record<string, string>;
  statBySha?: Record<string, string>;
  throwOn?: (args: readonly string[]) => boolean;
}): GitExec {
  return vi.fn(async (args: readonly string[]): Promise<string> => {
    if (opts.throwOn?.(args)) throw new Error('not a git repository');

    const sub: string = args[0];
    if (sub === 'log') return buildLogOutput(opts.commits ?? []);

    if (sub === 'diff') return opts.cumulativeStat ?? '';

    if (sub === 'show') {
      const sha: string | undefined = args.find((a) =>
        Object.prototype.hasOwnProperty.call(opts.diffBySha ?? {}, a) ||
        Object.prototype.hasOwnProperty.call(opts.statBySha ?? {}, a),
      );
      if (sha === undefined) return '';
      const isStatOnly: boolean = args.includes('--stat');
      if (isStatOnly) return opts.statBySha?.[sha] ?? '';
      return opts.diffBySha?.[sha] ?? '';
    }

    return '';
  });
}

const NO_CAPS: GitContextCaps = {
  maxCommitsInspected: 100,
  maxDiffCharsTotal: 1_000_000,
  maxDiffCharsPerCommit: 1_000_000,
};

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  warnSpy.mockRestore();
  vi.restoreAllMocks();
});

// ── Commit enumeration ──────────────────────────────────────────────────────────

describe('collectGitContext — commit enumeration', () => {
  it('parses sha, subject, and body for each commit, newest-first', async () => {
    const commits: FakeCommit[] = [
      { sha: 'aaaaaa1', subject: 'newest change', body: 'detailed body one' },
      { sha: 'bbbbbb2', subject: 'older change', body: 'detailed body two' },
    ];
    const exec: GitExec = makeGitExec({
      commits,
      cumulativeStat: ' 2 files changed, 10 insertions(+)',
      diffBySha: { aaaaaa1: 'diff-A', bbbbbb2: 'diff-B' },
    });

    const ctx = await collectGitContext('base000', 'curr999', exec, NO_CAPS);

    expect(ctx).not.toBeNull();
    expect(ctx!.commits).toHaveLength(2);
    expect(ctx!.commits[0]).toMatchObject({
      sha: 'aaaaaa1',
      subject: 'newest change',
      body: 'detailed body one',
    });
    expect(ctx!.commits[1].sha).toBe('bbbbbb2');
    expect(ctx!.baselineSha).toBe('base000');
    expect(ctx!.currentSha).toBe('curr999');
    expect(ctx!.cumulativeStat).toContain('2 files changed');
  });

  it('includes the per-commit diff body within budget', async () => {
    const commits: FakeCommit[] = [
      { sha: 'c0ffee1', subject: 'fix bug', body: '' },
    ];
    const exec: GitExec = makeGitExec({
      commits,
      diffBySha: { c0ffee1: 'diff --git a/agents/x.ts b/agents/x.ts\n+++ changed' },
    });

    const ctx = await collectGitContext('base', 'curr', exec, NO_CAPS);

    expect(ctx!.commits[0].diff).toContain('agents/x.ts');
    expect(ctx!.commits[0].statOnly).toBe(false);
    expect(ctx!.commits[0].diffTruncated).toBe(false);
    expect(ctx!.commits[0].droppedChars).toBe(0);
  });

  it('multi-line commit bodies survive the record/field split', async () => {
    const commits: FakeCommit[] = [
      { sha: 'multi1', subject: 'subject line', body: 'line one\nline two\nline three' },
    ];
    const exec: GitExec = makeGitExec({ commits, diffBySha: { multi1: 'd' } });

    const ctx = await collectGitContext('base', 'curr', exec, NO_CAPS);

    expect(ctx!.commits[0].body).toBe('line one\nline two\nline three');
  });

  it('drops commits beyond maxCommitsInspected and logs the drop', async () => {
    const commits: FakeCommit[] = [
      { sha: 's1', subject: 'one', body: '' },
      { sha: 's2', subject: 'two', body: '' },
      { sha: 's3', subject: 'three', body: '' },
    ];
    const caps: GitContextCaps = { ...NO_CAPS, maxCommitsInspected: 2 };
    const exec: GitExec = makeGitExec({
      commits,
      diffBySha: { s1: 'd1', s2: 'd2', s3: 'd3' },
    });

    const ctx = await collectGitContext('base', 'curr', exec, caps);

    expect(ctx!.commits).toHaveLength(2);
    expect(ctx!.commits.map((c) => c.sha)).toEqual(['s1', 's2']);
    expect(ctx!.droppedCommitCount).toBe(1);
    expect(warnSpy).toHaveBeenCalled();
  });
});

// ── Budget split ─────────────────────────────────────────────────────────────────

describe('collectGitContext — diff budget split', () => {
  it('caps a single commit diff at maxDiffCharsPerCommit and records droppedChars', async () => {
    const bigDiff: string = 'x'.repeat(500);
    const caps: GitContextCaps = { ...NO_CAPS, maxDiffCharsPerCommit: 100 };
    const exec: GitExec = makeGitExec({
      commits: [{ sha: 'big1', subject: 's', body: '' }],
      diffBySha: { big1: bigDiff },
    });

    const ctx = await collectGitContext('base', 'curr', exec, caps);

    expect(ctx!.commits[0].diff.length).toBeLessThanOrEqual(100);
    expect(ctx!.commits[0].diffTruncated).toBe(true);
    expect(ctx!.commits[0].droppedChars).toBeGreaterThan(0);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('splits a shared total budget across commits, newest first', async () => {
    const caps: GitContextCaps = {
      maxCommitsInspected: 100,
      maxDiffCharsTotal: 150,
      maxDiffCharsPerCommit: 1_000_000,
    };
    const exec: GitExec = makeGitExec({
      commits: [
        { sha: 'first1', subject: 'newest', body: '' },
        { sha: 'second2', subject: 'oldest', body: '' },
      ],
      diffBySha: { first1: 'a'.repeat(100), second2: 'b'.repeat(100) },
      statBySha: { first1: 'stat-first', second2: ' 1 file changed' },
    });

    const ctx = await collectGitContext('base', 'curr', exec, caps);

    const totalDiffChars: number = ctx!.commits
      .filter((c) => !c.statOnly)
      .reduce((sum, c) => sum + c.diff.length, 0);
    expect(totalDiffChars).toBeLessThanOrEqual(150);
    // newest commit consumes the budget untruncated; the oldest is truncated to the remainder
    expect(ctx!.commits[0].diffTruncated).toBe(false);
    expect(ctx!.commits[1].diffTruncated).toBe(true);
    expect(ctx!.commits[1].diff.length).toBeLessThan(100);
  });
});

// ── Stat-only fallback + truncation logging ─────────────────────────────────────

describe('collectGitContext — stat-only fallback', () => {
  it('falls back to --stat once the total diff budget is exhausted and logs it', async () => {
    const caps: GitContextCaps = {
      maxCommitsInspected: 100,
      maxDiffCharsTotal: 50,
      maxDiffCharsPerCommit: 1_000_000,
    };
    const exec: GitExec = makeGitExec({
      commits: [
        { sha: 'cm1', subject: 'one', body: '' },
        { sha: 'cm2', subject: 'two', body: '' },
      ],
      diffBySha: { cm1: 'a'.repeat(50), cm2: 'b'.repeat(50) },
      statBySha: { cm2: ' 1 file changed, 2 insertions(+)' },
    });

    const ctx = await collectGitContext('base', 'curr', exec, caps);

    expect(ctx!.commits[0].statOnly).toBe(false);
    expect(ctx!.commits[1].statOnly).toBe(true);
    expect(ctx!.commits[1].diff).toContain('1 file changed');
    expect(warnSpy).toHaveBeenCalled();
  });
});

// ── Unresolvable range ──────────────────────────────────────────────────────────

describe('collectGitContext — unresolvable range', () => {
  it('returns null when git log throws (not a repo)', async () => {
    const exec: GitExec = makeGitExec({ throwOn: (args) => args[0] === 'log' });

    const ctx = await collectGitContext('base', 'curr', exec, NO_CAPS);

    expect(ctx).toBeNull();
  });

  it('returns null when there are no commits in the range', async () => {
    const exec: GitExec = makeGitExec({ commits: [] });

    const ctx = await collectGitContext('base', 'curr', exec, NO_CAPS);

    expect(ctx).toBeNull();
  });

  it('tolerates a git show failure by degrading that commit to stat-only', async () => {
    const exec: GitExec = makeGitExec({
      commits: [{ sha: 'fail1', subject: 's', body: '' }],
      statBySha: { fail1: ' 1 file changed' },
      throwOn: (args) => args[0] === 'show' && !args.includes('--stat'),
    });

    const ctx = await collectGitContext('base', 'curr', exec, NO_CAPS);

    expect(ctx).not.toBeNull();
    expect(ctx!.commits[0].statOnly).toBe(true);
  });
});

// ── Rendering ────────────────────────────────────────────────────────────────────

describe('renderGitContextMarkdown', () => {
  it('renders a section header with the SHA range and per-commit blocks citing SHAs', async () => {
    const exec: GitExec = makeGitExec({
      commits: [
        { sha: 'sha1aaa', subject: 'add feature', body: 'why it matters' },
        { sha: 'sha2bbb', subject: 'fix test', body: '' },
      ],
      cumulativeStat: ' 4 files changed, 20 insertions(+)',
      diffBySha: { sha1aaa: 'diff-1', sha2bbb: 'diff-2' },
    });
    const ctx = await collectGitContext('base000', 'curr999', exec, NO_CAPS);

    const md: string = renderGitContextMarkdown(ctx!);

    expect(md).toContain('base000');
    expect(md).toContain('curr999');
    expect(md).toContain('sha1aaa');
    expect(md).toContain('add feature');
    expect(md).toContain('why it matters');
    expect(md).toContain('sha2bbb');
    expect(md).toContain('4 files changed');
  });

  it('notes dropped commits and truncated diffs in the rendered output (no silent caps)', async () => {
    const caps: GitContextCaps = {
      maxCommitsInspected: 1,
      maxDiffCharsPerCommit: 10,
      maxDiffCharsTotal: 10,
    };
    const exec: GitExec = makeGitExec({
      commits: [
        { sha: 'keep1', subject: 'kept', body: '' },
        { sha: 'drop1', subject: 'dropped', body: '' },
      ],
      diffBySha: { keep1: 'z'.repeat(200) },
    });
    const ctx = await collectGitContext('base', 'curr', exec, caps);

    const md: string = renderGitContextMarkdown(ctx!);

    expect(md.toLowerCase()).toContain('truncated');
    expect(md).toMatch(/dropped|omitted/i);
  });
});

// ── Defaults ─────────────────────────────────────────────────────────────────────

describe('DEFAULT_GIT_CONTEXT_CAPS', () => {
  it('exposes positive, finite budget knobs', () => {
    expect(DEFAULT_GIT_CONTEXT_CAPS.maxCommitsInspected).toBeGreaterThan(0);
    expect(DEFAULT_GIT_CONTEXT_CAPS.maxDiffCharsTotal).toBeGreaterThan(0);
    expect(DEFAULT_GIT_CONTEXT_CAPS.maxDiffCharsPerCommit).toBeGreaterThan(0);
    expect(
      DEFAULT_GIT_CONTEXT_CAPS.maxDiffCharsPerCommit,
    ).toBeLessThanOrEqual(DEFAULT_GIT_CONTEXT_CAPS.maxDiffCharsTotal);
  });
});
