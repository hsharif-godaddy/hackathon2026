/**
 * Per-commit git context for the narrative summary's code-correlation section.
 *
 * Cumulative `git diff --stat` masks changes introduced then altered by a later
 * commit, so this module enumerates each commit in `baselineSha..currentSha`
 * individually (newest-first) and attaches a budget-bounded per-commit diff
 * scoped to high-signal source (`*.ts` under `agents/`, `packages/`, `app/`).
 * Once the shared diff budget is exhausted, remaining commits degrade to a
 * `--stat`-only summary rather than being dropped silently.
 *
 * `git` access is injected as a `GitExec` so callers (and tests) control the
 * subprocess boundary; this module performs no I/O of its own.
 */

/** Runs a git subcommand and resolves its trimmed stdout. Rejects on failure. */
export type GitExec = (args: readonly string[]) => Promise<string>;

export interface GitContextCaps {
  /** Upper bound on commits enumerated; older excess commits are dropped and logged. */
  maxCommitsInspected: number;
  /** Shared diff-character budget across all per-commit diffs. */
  maxDiffCharsTotal: number;
  /** Per-commit diff-character ceiling, applied on top of the shared total. */
  maxDiffCharsPerCommit: number;
}

export const DEFAULT_GIT_CONTEXT_CAPS: GitContextCaps = {
  maxCommitsInspected: 20,
  maxDiffCharsTotal: 24_000,
  maxDiffCharsPerCommit: 6_000,
};

export interface CommitContext {
  sha: string;
  subject: string;
  body: string;
  /** The diff (full unified diff, or a `--stat` summary when `statOnly`). */
  diff: string;
  /** True when the per-commit or total char budget clipped the unified diff. */
  diffTruncated: boolean;
  /** True when only a `--stat` summary was fetched (budget exhausted or diff fetch failed). */
  statOnly: boolean;
  /** Characters removed from the unified diff by the budget; 0 when untruncated. */
  droppedChars: number;
}

export interface GitContext {
  baselineSha: string;
  currentSha: string;
  /** Cumulative `git diff --stat baselineSha..currentSha`, kept as an overview. */
  cumulativeStat: string;
  /** Per-commit contexts, newest-first. */
  commits: CommitContext[];
  /** Commits omitted by `maxCommitsInspected`. */
  droppedCommitCount: number;
}

const FIELD_SEP = '\x1f';
const RECORD_SEP = '\x1e';
const TRUNCATION_MARKER = '\n... [truncated]';

const SOURCE_PATHSPECS: readonly string[] = [
  ':(glob)agents/**/*.ts',
  ':(glob)packages/**/*.ts',
  ':(glob)app/**/*.ts',
];

/**
 * Collects per-commit git context over `baselineSha..currentSha`. Returns null
 * when the range is unresolvable (git unavailable / not a repo / no commits in
 * range), in which case the caller omits the code-correlation section entirely.
 * Never throws: a failed per-commit diff degrades that commit to stat-only.
 */
export async function collectGitContext(
  baselineSha: string,
  currentSha: string,
  exec: GitExec,
  caps: GitContextCaps,
): Promise<GitContext | null> {
  const range: string = `${baselineSha}..${currentSha}`;

  const parsed: ParsedCommit[] | null = await enumerateCommits(range, exec);
  if (parsed === null || parsed.length === 0) return null;

  const kept: ParsedCommit[] = parsed.slice(0, caps.maxCommitsInspected);
  const droppedCommitCount: number = parsed.length - kept.length;
  if (droppedCommitCount > 0) {
    console.warn('[git-context] Commits dropped by maxCommitsInspected', {
      droppedCommitCount,
      maxCommitsInspected: caps.maxCommitsInspected,
      totalCommits: parsed.length,
    });
  }

  const cumulativeStat: string = await exec(['diff', '--stat', range]).catch(() => '');

  let remainingTotal: number = caps.maxDiffCharsTotal;
  const commits: CommitContext[] = [];
  for (const commit of kept) {
    const perCommitBudget: number = Math.min(caps.maxDiffCharsPerCommit, remainingTotal);
    const context: CommitContext = await buildCommitContext(commit, perCommitBudget, exec);
    if (!context.statOnly) remainingTotal -= context.diff.length;
    commits.push(context);
  }

  return { baselineSha, currentSha, cumulativeStat, commits, droppedCommitCount };
}

interface ParsedCommit {
  sha: string;
  subject: string;
  body: string;
}

async function enumerateCommits(
  range: string,
  exec: GitExec,
): Promise<ParsedCommit[] | null> {
  const format: string = `%H${FIELD_SEP}%s${FIELD_SEP}%b${RECORD_SEP}`;
  const logOut: string = await exec(['log', `--format=${format}`, range]).catch(() => '');
  if (!logOut.trim()) return null;

  return logOut
    .split(RECORD_SEP)
    .map((record) => record.trim())
    .filter((record) => record.length > 0)
    .map(parseCommitRecord);
}

function parseCommitRecord(record: string): ParsedCommit {
  const firstSep: number = record.indexOf(FIELD_SEP);
  const secondSep: number = record.indexOf(FIELD_SEP, firstSep + 1);
  const sha: string = record.slice(0, firstSep);
  const subject: string = record.slice(firstSep + 1, secondSep);
  const body: string = record.slice(secondSep + 1).trim();
  return { sha, subject, body };
}

async function buildCommitContext(
  commit: ParsedCommit,
  budget: number,
  exec: GitExec,
): Promise<CommitContext> {
  if (budget <= 0) {
    return statOnlyContext(commit, exec, 'total diff budget exhausted');
  }

  const rawDiff: string | null = await exec([
    'show',
    '--format=',
    commit.sha,
    '--',
    ...SOURCE_PATHSPECS,
  ]).catch(() => null);

  if (rawDiff === null) {
    return statOnlyContext(commit, exec, 'git show failed');
  }

  const { text, droppedChars } = capDiff(rawDiff, budget);
  if (droppedChars > 0) {
    console.warn('[git-context] Per-commit diff truncated by budget', {
      sha: commit.sha,
      droppedChars,
      budget,
    });
  }

  return {
    sha: commit.sha,
    subject: commit.subject,
    body: commit.body,
    diff: text,
    diffTruncated: droppedChars > 0,
    statOnly: false,
    droppedChars,
  };
}

async function statOnlyContext(
  commit: ParsedCommit,
  exec: GitExec,
  reason: string,
): Promise<CommitContext> {
  console.warn('[git-context] Commit degraded to stat-only', {
    sha: commit.sha,
    reason,
  });
  const stat: string = await exec(['show', '--stat', '--format=', commit.sha]).catch(() => '');
  return {
    sha: commit.sha,
    subject: commit.subject,
    body: commit.body,
    diff: stat,
    diffTruncated: false,
    statOnly: true,
    droppedChars: 0,
  };
}

function capDiff(full: string, budget: number): { text: string; droppedChars: number } {
  if (full.length <= budget) return { text: full, droppedChars: 0 };
  const keep: number = Math.max(0, budget - TRUNCATION_MARKER.length);
  return { text: full.slice(0, keep) + TRUNCATION_MARKER, droppedChars: full.length - keep };
}

/**
 * Renders the code-correlation section for the narrative prompt. Pure: every
 * cited commit SHA is present so the model can attribute regressions to a
 * specific commit, and any dropped/truncated content is stated inline.
 */
export function renderGitContextMarkdown(ctx: GitContext): string {
  const lines: string[] = [];
  lines.push(`## Git Changes (${ctx.baselineSha}..${ctx.currentSha})`);

  if (ctx.cumulativeStat.trim().length > 0) {
    lines.push('');
    lines.push('Cumulative diffstat:');
    lines.push('```');
    lines.push(ctx.cumulativeStat);
    lines.push('```');
  }

  for (const commit of ctx.commits) {
    lines.push('');
    lines.push(`### Commit ${commit.sha} — ${commit.subject}`);
    if (commit.body.length > 0) lines.push(commit.body);
    const label: string = commit.statOnly ? 'diffstat (diff omitted, budget exhausted)' : 'diff';
    lines.push(`${label}:`);
    lines.push('```');
    lines.push(commit.diff);
    lines.push('```');
    if (commit.diffTruncated) {
      lines.push(`_(diff truncated: ${commit.droppedChars} chars omitted)_`);
    }
  }

  if (ctx.droppedCommitCount > 0) {
    lines.push('');
    lines.push(
      `_(${ctx.droppedCommitCount} older commit(s) omitted by maxCommitsInspected.)_`,
    );
  }

  return lines.join('\n');
}
