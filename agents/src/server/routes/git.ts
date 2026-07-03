import { Router } from 'express';
import { AppRepository } from '../../database/index.js';
import { GitTool } from '../../tools/git-tool.js';
import { GitUtils } from '../../utils/git.js';
import { log } from '../../logging/index.js';
import { createForWorkspace } from '../../workspace/index.js';
import { validateAppOwnership } from '../middleware/app-ownership.js';
import { ConversationRepository } from '../../database/index.js';
import { getMessageStore } from '../../memory/index.js';
import { RESTORE, type RestoreActionMetadata } from '@airo/shared';

const router: Router = Router();
const appRepository = new AppRepository();
const messages = getMessageStore();
const chatConversationRepo = new ConversationRepository();

/** Default page size; keep in sync with app `GIT_HISTORY_PAGE_SIZE` (`app/src/services/AppService.ts`). */
const GIT_HISTORY_DEFAULT_COUNT = 30;
const GIT_HISTORY_MAX_COUNT = 200;
const GIT_HISTORY_MAX_OFFSET = 100_000;
const COMMIT_MESSAGE_MAX_LENGTH = 500;

function parseGitHistoryCount(value: unknown): number | null {
  if (value === undefined || value === '') {
    return GIT_HISTORY_DEFAULT_COUNT;
  }
  const raw = Array.isArray(value) ? value[0] : value;
  const n = Number(typeof raw === 'string' ? raw.trim() : raw);
  if (!Number.isInteger(n) || n < 1 || n > GIT_HISTORY_MAX_COUNT) {
    return null;
  }
  return n;
}

function parseGitHistoryOffset(value: unknown): number | null {
  if (value === undefined || value === '') {
    return 0;
  }
  const raw = Array.isArray(value) ? value[0] : value;
  const n = Number(typeof raw === 'string' ? raw.trim() : raw);
  if (!Number.isInteger(n) || n < 0 || n > GIT_HISTORY_MAX_OFFSET) {
    return null;
  }
  return n;
}

/**
 * Map a v8-template page file to its React Router path. Returns null for
 * non-page files or special files (e.g. `_404.tsx`) that we don't want to
 * land the iframe on.
 *
 * Conventions:
 *   src/pages/index.tsx             → /
 *   src/pages/<name>.tsx            → /<name>
 *   src/pages/<dir>/index.tsx       → /<dir>
 *   src/pages/<dir>/<name>.tsx      → /<dir>/<name>
 *   src/pages/_<*>                  → null (private/special)
 */
function mapPageFileToRoute(filePath: string): string | null {
  const match = /^src\/pages\/(.+)\.tsx$/.exec(filePath);
  if (!match) return null;
  const segments = match[1]!.split('/');
  if (segments.some(seg => seg.startsWith('_'))) return null;
  const last = segments[segments.length - 1]!;
  const trimmed = last === 'index' ? segments.slice(0, -1) : segments;
  return '/' + trimmed.join('/');
}

/** Cap on how far back to walk when looking for page changes. */
const PAGE_HINT_MAX_COMMITS = 3;

/**
 * Pick the most likely route the iframe should land on after checking out a
 * commit, so the preview doesn't 404 on a path that didn't exist yet.
 *
 * Walks up to {@link PAGE_HINT_MAX_COMMITS} commits starting at `commitHash`
 * (target, then `~1`, `~2`, …) and returns the highest-churn page touched by
 * the first ancestor that modified one, alongside the source file path so
 * dev-tools can resolve via the live route registry when the filename
 * heuristic misses (e.g. skill-installed pages mounted at non-filename paths).
 *
 * Falling back to ancestors handles commits that only touched components/styles.
 * If nothing page-shaped is found within the walk, returns `null` for both
 * fields — the client falls back to leaving the iframe wherever it was. This
 * is preferable to a fake `/` hint that overwrites the user's current path
 * with a route that may not exist in this app's route table.
 */
async function computePageHint(
  gitUtils: GitUtils,
  repoPath: string,
  commitHash: string,
): Promise<{ pageHint: string | null; modulePath: string | null }> {
  for (let depth = 0; depth < PAGE_HINT_MAX_COMMITS; depth++) {
    const ancestor = depth === 0 ? commitHash : `${commitHash}~${depth}`;
    const fileStats = await gitUtils.getCommitFileStats(repoPath, ancestor);
    if (fileStats.length === 0) {
      // Either the ancestor doesn't exist or git failed (logged inside
      // getCommitFileStats); either way there's nothing more to walk.
      break;
    }
    const pages = fileStats
      .map(entry => ({ ...entry, route: mapPageFileToRoute(entry.path) }))
      .filter((entry): entry is typeof entry & { route: string } => entry.route !== null)
      .sort((a, b) => (b.added + b.deleted) - (a.added + a.deleted));
    const top = pages[0];
    if (top) {
      return { pageHint: top.route, modulePath: top.path };
    }
  }
  return { pageHint: null, modulePath: null };
}

/**
 * Get commit history for an app
 * SECURITY: Ownership validation prevents cross-tenant git history access
 */
router.get('/apps/:id/git/history', validateAppOwnership, async (req, res) => {
  try {
    const id = req.params.id!; // Validated by validateAppOwnership middleware
    const count = parseGitHistoryCount(req.query.count);
    const offset = parseGitHistoryOffset(req.query.offset);
    if (count === null || offset === null) {
      return res.status(400).json({
        error: 'Invalid git history query parameters',
        details: 'count must be an integer 1-' + GIT_HISTORY_MAX_COUNT + ', offset must be an integer 0-' + GIT_HISTORY_MAX_OFFSET,
      });
    }
    const contextLogger = log.forApp(id);

    // Get app path from database
    const app = appRepository.findById(id);
    if (!app) {
      return res.status(404).json({ error: 'App not found' });
    }

    // Create git tool with dev-supervisor for this specific app
    const workspace = createForWorkspace(id, 'preview');
    if (!workspace) {
      return res.status(503).json({ error: 'Preview container is not available' });
    }
    const gitTool = new GitTool(workspace.tasks);
    const gitUtils = new GitUtils(workspace.tasks);

    // Fetch one extra commit so the API can return hasMore without an extra round-trip.
    const result = await gitTool.executeGitOperation(app.path, {
      operation: 'log',
      options: {
        count: count + 1,
        offset
      }
    });

    if (!result.success) {
      return res.status(400).json({
        error: 'Failed to get commit history',
        details: result.error
      });
    }

    const commits = result.commits || [];
    const hasMore = commits.length > count;
    const visibleCommits = hasMore ? commits.slice(0, count) : commits;

    // Get current commit (HEAD)
    let currentCommit: string | null = null;
    try {
      currentCommit = await gitUtils.getCurrentCommit(app.path);
    } catch (error) {
      // Log but don't fail - current commit is optional
      contextLogger.warn('route.git.history.current-commit-failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    contextLogger.info('route.git.history.success', {
      commitCount: visibleCommits.length,
      hasMore,
      currentCommit: currentCommit?.substring(0, 7),
    });

    return res.json({
      success: true,
      commits: visibleCommits,
      hasMore,
      currentCommit: currentCommit
    });
  } catch (error) {
    const contextLogger = log.forApp(req.params.id!);
    log.error(contextLogger, 'route.git.history.error', error as Error, {});
    return res.status(500).json({
      error: 'Failed to get commit history',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * Amend the latest commit message on main branch
 * SECURITY: Ownership validation prevents cross-tenant git amend operations
 */
router.patch('/apps/:id/git/commit-message', validateAppOwnership, async (req, res) => {
  try {
    const id = req.params.id!;
    const rawMessage = req.body?.message;
    const expectedHash: string | undefined = req.body?.expectedHash;
    const contextLogger = log.forApp(id);

    if (typeof rawMessage !== 'string' || !rawMessage.trim()) {
      return res.status(400).json({ error: 'Commit message is required' });
    }

    const message = rawMessage.trim();
    if (message.length > COMMIT_MESSAGE_MAX_LENGTH) {
      return res.status(400).json({
        error: `Commit message must be ${COMMIT_MESSAGE_MAX_LENGTH} characters or fewer`
      });
    }

    const app = appRepository.findById(id);
    if (!app) {
      return res.status(404).json({ error: 'App not found' });
    }

    const workspace = createForWorkspace(id, 'preview');
    if (!workspace) {
      return res.status(503).json({ error: 'Preview container is not available' });
    }
    const gitUtils = new GitUtils(workspace.tasks);

    const currentBranch = await gitUtils.getCurrentBranch(app.path);
    if (currentBranch !== 'main') {
      contextLogger.warn('route.git.commit-message.invalid-branch', {
        currentBranch,
      });
      return res.status(409).json({
        error: 'Commit message can only be edited on the main branch',
        currentBranch
      });
    }

    const status = await gitUtils.getStatus(app.path);
    if (status.stagedFiles > 0) {
      contextLogger.warn('route.git.commit-message.staged-changes', {
        stagedFiles: status.stagedFiles,
      });
      return res.status(409).json({
        error: 'Cannot edit commit message while staged changes exist'
      });
    }

    if (await gitUtils.hasRemote(app.path, 'origin')) {
      contextLogger.warn('route.git.commit-message.remote-configured', {
        branch: currentBranch,
      });
      return res.status(409).json({
        error: 'Cannot edit commit message when an origin remote is configured (amend rewrites history)'
      });
    }

    if (expectedHash) {
      const currentHead = await gitUtils.getCurrentCommit(app.path);
      if (currentHead !== expectedHash) {
        contextLogger.warn('route.git.commit-message.stale-head', {
          expectedHash: expectedHash.substring(0, 7),
          actualHead: currentHead.substring(0, 7),
        });
        return res.status(409).json({
          error: 'HEAD has moved since editing started — another commit may have been created',
          expectedHash,
          actualHead: currentHead,
        });
      }
    }

    const amendResult = await gitUtils.amendCommitMessage(app.path, message);
    if (!amendResult.success) {
      contextLogger.warn('route.git.commit-message.amend-failed', {
        stderr: amendResult.stderr,
      });
      return res.status(400).json({
        error: 'Failed to edit commit message'
      });
    }

    let newCommitHash: string;
    try {
      newCommitHash = await gitUtils.getCurrentCommit(app.path);
    } catch (error) {
      contextLogger.warn('route.git.commit-message.get-hash-failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return res.status(500).json({
        error: 'Amend succeeded but failed to retrieve new commit hash'
      });
    }

    contextLogger.info('route.git.commit-message.success', {
      commitHash: newCommitHash.substring(0, 7),
    });

    return res.json({
      success: true,
      newCommitHash
    });
  } catch (error) {
    const contextLogger = log.forApp(req.params.id!);
    log.error(contextLogger, 'route.git.commit-message.error', error as Error, {});
    return res.status(500).json({
      error: 'Failed to edit commit message'
    });
  }
});

/**
 * Report whether the working tree has uncommitted changes.
 * Used by the chat undo button to decide whether to enable itself when
 * the agent isn't streaming — a clean tree means there's nothing to undo.
 * SECURITY: Ownership validation prevents cross-tenant git status access.
 */
router.get('/apps/:id/git/status', validateAppOwnership, async (req, res) => {
  try {
    const id = req.params.id!;
    const contextLogger = log.forApp(id);

    const app = appRepository.findById(id);
    if (!app) {
      contextLogger.error('route.git.status.app-not-found', {});
      return res.status(404).json({ error: 'App not found' });
    }

    const workspace = createForWorkspace(id, 'preview');
    if (!workspace) {
      return res.status(503).json({ error: 'Preview container is not available' });
    }
    const gitUtils = new GitUtils(workspace.tasks);

    const hasUncommittedChanges = await gitUtils.hasUncommittedChanges(app.path);

    return res.json({ success: true, hasUncommittedChanges });
  } catch (error) {
    const contextLogger = log.forApp(req.params.id!);
    log.error(contextLogger, 'route.git.status.error', error as Error, {});
    return res.status(500).json({
      error: 'Failed to read git status',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * Hash format the diff endpoint accepts. Hex only, 4-40 chars to cover both
 * abbreviated short hashes and full SHA-1s; rejects anything that could
 * smuggle a flag or path through to git.
 */
const GIT_DIFF_HASH_PATTERN = /^[0-9a-f]{4,40}$/i;

function parseDiffHashParam(value: unknown): string | null | 'invalid' {
  if (value === undefined || value === '' || value === null) {
    return null;
  }
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string') {
    return 'invalid';
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  if (!GIT_DIFF_HASH_PATTERN.test(trimmed)) {
    return 'invalid';
  }
  return trimmed;
}

/**
 * Lazy diff lookup for synthetic user-action notices.
 *
 * Given a `stashHash` and/or `commitHash` from the notice metadata, this
 * route returns the combined unified diff so the chat-history renderer can
 * show what changed when the user clicked Undo or Restore — without having
 * to bake the (possibly large) diff text into every persisted message.
 *
 * Stash diff is rendered first (the uncommitted-work side), then the
 * commit's own intrinsic diff (`commitHash^..commitHash`). Either piece can
 * be omitted; at least one hash must be present. Results are bounded by
 * the same `diffMaxBytes` cap the underlying GitUtils helpers already use.
 *
 * SECURITY: Ownership validation prevents cross-tenant diff reads.
 */
router.get('/apps/:id/git/diff', validateAppOwnership, async (req, res) => {
  try {
    const id = req.params.id!; // Validated by validateAppOwnership middleware
    const contextLogger = log.forApp(id);

    const commitHashParam = parseDiffHashParam(req.query.commitHash);
    const stashHashParam = parseDiffHashParam(req.query.stashHash);

    if (commitHashParam === 'invalid' || stashHashParam === 'invalid') {
      return res.status(400).json({
        error: 'Invalid hash',
        details: 'commitHash and stashHash must be hex strings between 4 and 40 characters',
      });
    }
    if (!commitHashParam && !stashHashParam) {
      return res.status(400).json({
        error: 'At least one of commitHash or stashHash is required',
      });
    }

    const app = appRepository.findById(id);
    if (!app) {
      contextLogger.error('route.git.diff.app-not-found', {});
      return res.status(404).json({ error: 'App not found' });
    }

    const workspace = createForWorkspace(id, 'preview');
    if (!workspace) {
      return res.status(503).json({ error: 'Preview container is not available' });
    }
    const gitUtils = new GitUtils(workspace.tasks);

    let stashDiff: string | null = null;
    let stashTruncated = false;
    if (stashHashParam) {
      const stashResult = await gitUtils.getStashDiff(app.path, stashHashParam);
      stashDiff = stashResult.diff;
      stashTruncated = stashResult.diffTruncated;
    }

    let commitDiff: string | null = null;
    let commitTruncated = false;
    if (commitHashParam) {
      // `${hash}^..${hash}` is the standard form for "what this commit
      // introduced." On the initial commit there's no parent, so getCommitDiff
      // returns null, and we silently omit the commit-side diff rather than
      // failing the whole request.
      const commitResult = await gitUtils.getCommitDiff(app.path, `${commitHashParam}^`, commitHashParam);
      commitDiff = commitResult.diff;
      commitTruncated = commitResult.diffTruncated;
    }

    const pieces = [stashDiff, commitDiff].filter((piece): piece is string => piece !== null && piece.length > 0);
    const diff = pieces.length === 0 ? null : pieces.join('\n');
    const diffTruncated = stashTruncated || commitTruncated;

    contextLogger.info('route.git.diff.success', {
      commitHash: commitHashParam ? commitHashParam.substring(0, 7) : null,
      stashHash: stashHashParam ? stashHashParam.substring(0, 7) : null,
      hasDiff: diff !== null,
      diffTruncated,
    });

    return res.json({
      success: true,
      diff,
      diffTruncated,
    });
  } catch (error) {
    const contextLogger = log.forApp(req.params.id!);
    log.error(contextLogger, 'route.git.diff.error', error as Error, {});
    return res.status(500).json({
      error: 'Failed to read diff',
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * Checkout a specific commit for viewing purposes
 * Note: Any changes should be made on the main branch, not in detached HEAD state
 * SECURITY: Ownership validation prevents cross-tenant git checkout operations
 */
router.post('/apps/:id/git/checkout', validateAppOwnership, async (req, res) => {
  try {
    const id = req.params.id!; // Validated by validateAppOwnership middleware
    const { commitHash } = req.body;
    const contextLogger = log.forApp(id);

    if (!commitHash) {
      return res.status(400).json({ error: 'Commit hash is required' });
    }

    contextLogger.info('route.git.checkout.begin', {
      commitHash: commitHash.substring(0, 7),
    });

    // Get app path from database
    const app = appRepository.findById(id);
    if (!app) {
      contextLogger.error('route.git.checkout.app-not-found', {});
      return res.status(404).json({ error: 'App not found' });
    }

    // Create git tool with dev-supervisor for this specific app
    const workspace = createForWorkspace(id, 'preview');
    if (!workspace) {
      return res.status(503).json({ error: 'Preview container is not available' });
    }
    const gitTool = new GitTool(workspace.tasks);

    // First save the current HEAD position
    const currentBranchResult = await gitTool.executeGitOperation(app.path, {
      operation: 'branch'
    });

    if (!currentBranchResult.success) {
      contextLogger.error('route.git.checkout.branch-check-failed', {});
      return res.status(400).json({
        error: 'Failed to get current branch',
        details: currentBranchResult.error
      });
    }

    const currentBranch = currentBranchResult.currentBranch || 'HEAD';
    contextLogger.info('route.git.checkout.current-branch', {
      currentBranch,
    });

    // Check for uncommitted changes and auto-commit if needed
    const statusResult = await gitTool.executeGitOperation(app.path, {
      operation: 'status'
    });

    if (statusResult.success && statusResult.status && !statusResult.status.isClean) {
      contextLogger.info('route.git.checkout.auto-committing', {
        stagedFiles: statusResult.status.stagedFiles,
        modifiedFiles: statusResult.status.modifiedFiles,
        untrackedFiles: statusResult.status.untrackedFiles,
      });

      // Add all files
      const addResult = await gitTool.executeGitOperation(app.path, {
        operation: 'add',
        files: ['.']
      });

      if (!addResult.success) {
        contextLogger.error('route.git.checkout.add-failed', {
          error: addResult.error,
        });
        return res.status(500).json({
          error: 'Failed to stage changes before checkout',
          details: addResult.error
        });
      }

      // Commit with descriptive message
      const commitResult = await gitTool.executeGitOperation(app.path, {
        operation: 'commit',
        message: `Auto-commit: Save changes before switching to version ${commitHash.substring(0, 7)}`
      });

      if (!commitResult.success) {
        contextLogger.error('route.git.checkout.commit-failed', {
          error: commitResult.error,
        });
        return res.status(500).json({
          error: 'Failed to commit changes before checkout',
          details: commitResult.error
        });
      }

      contextLogger.info('route.git.checkout.auto-committed', {});
    }

    // Create a temporary branch at the specified commit (not used currently)
    // const branchName = `temp-view-${commitHash.substring(0, 7)}`;

    // Checkout the specific commit
    const result = await gitTool.executeGitOperation(app.path, {
      operation: 'checkout',
      branch: commitHash
    });

    if (!result.success) {
      contextLogger.error('route.git.checkout.failed', {
        commitHash: commitHash.substring(0, 7),
        error: result.error,
      });
      return res.status(400).json({
        error: 'Failed to checkout commit',
        details: result.error
      });
    }

    contextLogger.info('route.git.checkout.success', {
      commitHash: commitHash.substring(0, 7),
      previousBranch: currentBranch,
    });
    contextLogger.warn('route.git.checkout.detached-head', {
      warning: 'App is now in detached HEAD state',
    });

    // Hint to the iframe which page the user could land on at this commit
    // so the preview doesn't 404 when the current path didn't exist yet.
    // `pageHint` is the filename-derived route guess; `modulePath` is the
    // source file the guess came from, so dev-tools can cross-check against
    // its live route registry (skills can mount pages at non-filename paths).
    let pageHint: string | null = null;
    let modulePath: string | null = null;
    try {
      const gitUtils = new GitUtils(workspace.tasks);
      const result = await computePageHint(gitUtils, app.path, commitHash);
      pageHint = result.pageHint;
      modulePath = result.modulePath;
    } catch (error) {
      // Hint is best-effort; never fail the checkout because we couldn't
      // compute it. Client treats null as "leave the iframe alone".
      contextLogger.warn('route.git.checkout.page-hint-failed', {
        message: 'Failed to compute page hint',
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return res.json({
      success: true,
      message: `Checked out commit ${commitHash}`,
      previousBranch: currentBranch,
      isDetachedHead: true,
      pageHint,
      modulePath,
    });
  } catch (error) {
    const contextLogger = log.forApp(req.params.id!);
    log.error(contextLogger, 'route.git.checkout.error', error as Error, {});
    return res.status(500).json({
      error: 'Failed to checkout commit',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * Return to the main branch (or specified branch) to ensure changes are made on HEAD
 * This is critical for preventing detached HEAD state issues
 * SECURITY: Ownership validation prevents cross-tenant git operations
 */
router.post('/apps/:id/git/return', validateAppOwnership, async (req, res) => {
  try {
    const id = req.params.id!; // Validated by validateAppOwnership middleware
    const { branch = 'main' } = req.body;
    const contextLogger = log.forApp(id);

    contextLogger.info('route.git.return-to-branch.begin', {
      branch,
    });

    // Get app path from database
    const app = appRepository.findById(id);
    if (!app) {
      contextLogger.error('route.git.return-to-branch.app-not-found', {});
      return res.status(404).json({ error: 'App not found' });
    }

    // Create git tool with dev-supervisor for this specific app
    const workspace = createForWorkspace(id, 'preview');
    if (!workspace) {
      return res.status(503).json({ error: 'Preview container is not available' });
    }
    const gitTool = new GitTool(workspace.tasks);

    // First, check current branch status
    const statusResult = await gitTool.executeGitOperation(app.path, {
      operation: 'branch'
    });

    // Log current state before attempting checkout
    if (statusResult.success) {
      const currentBranch = statusResult.currentBranch || 'detached HEAD';
      contextLogger.info('route.git.return-to-branch.current-state', {
        currentBranch,
      });
    } else {
      contextLogger.warn('route.git.return-to-branch.state-unknown', {});
    }

    // Return to the specified branch
    const result = await gitTool.executeGitOperation(app.path, {
      operation: 'checkout',
      branch
    });

    if (!result.success) {
      contextLogger.error('route.git.return-to-branch.failed', {
        branch,
        error: result.error,
      });
      return res.status(400).json({
        error: `Failed to return to ${branch} branch`,
        details: result.error
      });
    }

    contextLogger.info('route.git.return-to-branch.success', {
      branch,
    });

    return res.json({
      success: true,
      message: `Returned to branch ${branch}`,
      previousState: statusResult.success ? statusResult.currentBranch : 'unknown'
    });
  } catch (error) {
    const contextLogger = log.forApp(req.params.id!);
    log.error(contextLogger, 'route.git.return-to-branch.error', error as Error, {});
    return res.status(500).json({
      error: 'Failed to return to branch',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * Unified rewind endpoint for the chat undo + per-prompt restore buttons.
 *
 * Always stashes any uncommitted working-tree changes (including untracked
 * files) before doing anything else, so the user's in-flight work is
 * preserved as a recoverable git stash rather than clobbered.
 *
 * If `commitHash` is provided AND it differs from the current HEAD, the
 * route then runs the restore operation to rewind onto that commit. Omitting
 * `commitHash` (or passing the current HEAD) makes this a stash-only call —
 * used by the undo button mid-stream / on a dirty tree where there is no
 * older commit to rewind to.
 *
 * The captured diff combines the stash diff (what was in the working tree)
 * with the restore-side diff (what changed between pre- and post-restore
 * HEAD), so the synthetic user-action notice can render exactly what was
 * rolled back.
 *
 * SECURITY: Ownership validation prevents cross-tenant git restore operations.
 */
router.post('/apps/:id/git/restore', validateAppOwnership, async (req, res) => {
  try {
    const id = req.params.id!; // Validated by validateAppOwnership middleware
    const { commitHash } = req.body ?? {};
    const contextLogger = log.forApp(id);

    if (commitHash !== undefined && (typeof commitHash !== 'string' || !commitHash.trim())) {
      return res.status(400).json({ error: 'commitHash must be a non-empty string when provided' });
    }
    const targetCommit: string | null = typeof commitHash === 'string' ? commitHash.trim() : null;

    contextLogger.info('route.git.restore-files.begin', {
      commitHash: targetCommit ? targetCommit.substring(0, 7) : null,
    });

    const app = appRepository.findById(id);
    if (!app) {
      contextLogger.error('route.git.restore-files.app-not-found', {});
      return res.status(404).json({ error: 'App not found' });
    }

    const workspace = createForWorkspace(id, 'preview');
    if (!workspace) {
      return res.status(503).json({ error: 'Preview container is not available' });
    }
    const gitTool = new GitTool(workspace.tasks);
    const gitUtils = new GitUtils(workspace.tasks);

    // Stash before any restore so the user's uncommitted work is preserved.
    // The stash command is a no-op when the tree is clean, so this is safe
    // to run unconditionally.
    const stashResult = await gitUtils.stashUncommittedChanges(app.path, {
      message: `airo-rewind @ ${new Date().toISOString()}`,
    });

    let didRestore = false;

    // If there is a target commit, then we are attempting to roll back
    if (targetCommit) {
      const opResult = await gitTool.executeGitOperation(app.path, {
        operation: 'restore',
        options: {hash: targetCommit}
      });

      if (!opResult.success) {
        return res.status(400).json({
          error: 'Failed to restore files from commit',
          details: opResult.error,
          stashHash: stashResult.stashHash,
        });
      }
      // If the output contains "Nothing to commit, working tree clean", then we did not restore anything.
      didRestore = !(opResult?.status?.isClean === true);
    } else {
      // Switch back to main with the uncommitted changes stashed (if there were any) so the user can continue working from a clean state.
      // When an agent starts a conversation, it creates a branch. This ensures that it switches back to main after an undo action, so that the next conversation starts from the correct state.
      const checkoutResult = await gitTool.executeGitOperation(app.path, {
        operation: 'checkout',
        branch: 'main'
      })
      if (!checkoutResult.success) {
        // Don't fall through — `getCurrentCommit` below would read the
        // wrong-branch HEAD and the persisted user-action notice would be
        // anchored to a commit that doesn't reflect the actual rolled-back
        // state. Surface the failure (with the stash hash so the client can
        // recover the user's working-tree changes if they were stashed).
        contextLogger.error(
          'route.git.restore-files.failed',
          {
            error: checkoutResult.error,
          }
        )
        return res.status(400).json({
          error: 'Failed to checkout main branch',
          details: checkoutResult.error,
          stashHash: stashResult.stashHash,
        });
      }
    }

    const currentCommit = didRestore ? targetCommit : await gitUtils.getCurrentCommit(app.path);

    contextLogger.info('route.git.restore-files.success', {
      hadUncommitted: stashResult.hasChanges,
      stashHash: stashResult.stashHash ? stashResult.stashHash.substring(0, 7) : null,
      restored: didRestore,
      currentCommit: currentCommit,
      restoredCommitHash: targetCommit,
    });

    // If no changes were made, exit early.
    if (!didRestore && !stashResult.hasChanges) {

      return res.json({
        success: true,
        message: 'No changes to rewind',
        hasChanges: stashResult.hasChanges
      });
    }


    // Persist a synthetic user-action notice so the next agent turn sees the
    // rollback (and the client can mirror the saved row into its transcript
    // without a follow-up fetch). The metadata's `action` is `'undo'` when
    // the caller didn't supply a target commit (chat Undo button: stash-only
    // / mid-stream / dirty-tree) and `'restore'` when it did (per-prompt
    // Restore + version history).
    //
    // Diff text is intentionally NOT captured here — `UserActionDiffRenderer`
    // fetches it lazily through `/git/diff` when the user expands the card,
    // so the persisted message stays small.
    let savedNotice: { id: string; sender: 'user' | 'agent'; content: string; createdAt: Date; metadata?: Record<string, unknown> } | null = null;
    try {
      // Improvement: Localize this message to ensure the agent doesn't get mix-localized messages from the user.
      const content =
        `[system] The user performed a rollback`
        + `${stashResult.stashHash ? `; the working tree was stashed (stash ${stashResult.stashHash})` : ''}.`
        + ' The codebase has been reverted; a restore commit has been generated for historical preservation.'
        + ' Do not assume files still match what was described earlier in this conversation — re-read anything you plan to edit.';
      const conversationId = await chatConversationRepo.getLatestForApp(app.id).then(conv => conv?.id)
      if (conversationId) {
        const metadata: RestoreActionMetadata = {
          kind: RESTORE,
          commitHash: currentCommit,
          stashHash: stashResult.stashHash,
          restoredCommitHash: targetCommit,
        };
        const persisted = await messages.addMessage(conversationId, 'user', content, {
          messageType: 'status',
          metadata: {...metadata}
        });

        savedNotice = {
          id: persisted.id,
          sender: persisted.sender,
          content: persisted.content,
          createdAt: persisted.createdAt,
          metadata: persisted.metadata,
        };

        contextLogger.info('route.git.restore-files.persist-conversation.success', {
          conversationId,
          messageId: persisted.id,
        });
      } else {
        contextLogger.info(
          'route.git.restore-files.persist-conversation.skipped', {
          reason: 'nullConversationId'
        })
      }
    } catch (error) {
      // Silent fail here to avoid blocking the main operation, but log so we can investigate and fix any issues with conversation persistence.
      contextLogger.error(
        'route.git.restore-files.persist-conversation.error',
        {
          error: 'Failed to store conversation message during restore.',
          details: error instanceof Error ? error.message : String(error)
        }
      )
    }

    return res.json({
      success: true,
      message: didRestore && targetCommit
        ? `Restored files from commit ${targetCommit}`
        : stashResult.hasChanges
          ? 'Stashed uncommitted changes'
          : 'No changes to rewind',
      hasChanges: stashResult.hasChanges,
      stashHash: stashResult.stashHash,
      notice: savedNotice,
    });
  } catch (error) {
    const contextLogger = log.forApp(req.params.id!);
    log.error(contextLogger, 'route.git.restore-files.error', error as Error, {});
    return res.status(500).json({
      error: 'Failed to rewind working tree',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

export default router;
