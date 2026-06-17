import { Logger } from '../../logging/index.js';
import type { WorkspaceClient } from '../../workspace/client.js';
import type { AppRestartService } from '../AppRestartService.js';
import type { DiagnoseService } from '../diagnose/DiagnoseService.js';
import type { Analysis, DiagnoseAction } from '../diagnose/types.js';
import { buildUnknownAnalysis } from '../diagnose/PaaSDiagnoseService.js';
import type { ActionExecutor } from './ActionExecutor.js';
import type { AgentDrivenFixer, AgentFixResult } from './AgentDrivenFixer.js';
import type {
  AgentFixOutcome,
  AppliedAction,
  AutoFixRequest,
  AutoFixResponse,
  AutoFixService,
} from './types.js';

/**
 * Minimal interface the service needs from GitTool. Importing the concrete class
 * here would pull in tools/git-tool.ts and its transitive deps (some of which
 * reference packages not built during test runs); a structural type keeps the
 * service decoupled. The route layer constructs `new GitTool(workspace?.tasks)`
 * and injects a factory.
 */
export interface AutoFixGitOperation {
  operation: string;
  files?: string[];
  message?: string;
  options?: { mode?: 'soft' | 'mixed' | 'hard'; hash?: string };
}

export interface AutoFixGitTool {
  executeGitOperation(
    appPath: string,
    options: AutoFixGitOperation
  ): Promise<{ success: boolean; error?: string }>;
}

export type AutoFixGitToolFactory = (workspace: WorkspaceClient | null) => AutoFixGitTool;

const logger = Logger.create({ component: 'auto-fix.service' });

/** Container-rooted path for the customer app. PaaS preview always mounts at /app. */
const PREVIEW_APP_PATH = '/app';

/** Wait between restart and verify so the dev server has time to emit fresh logs. */
const DEFAULT_VERIFY_DELAY_MS = 3_000;

/**
 * After an agent-fallback run times out, the develop-agent loop has NO
 * AbortSignal (see AgentDrivenFixer) and may keep editing the workspace in the
 * background. We can't stop it, but we can stop a *second* writer: the app's
 * in-flight entry is held for this long after the timed-out run settles so a
 * same-app retry coalesces/rejects instead of starting a fresh concurrent run.
 *
 * Sized to comfortably exceed the orphaned loop's realistic remaining lifetime
 * (the develop agent's per-step timeout is 10 min). This is a best-effort guard,
 * not a guarantee — the real fix is plumbing an AbortSignal into the agent loop.
 */
const DEFAULT_ORPHAN_HOLD_MS = 10 * 60_000;

const COMMIT_MESSAGE = 'Auto-fix: applied diagnostic actions';

/**
 * Workspace factory injected by the route. Tests substitute a fake to avoid
 * touching dev-supervisor; production wires `createForWorkspace(_, 'preview')`.
 */
export type AutoFixWorkspaceFactory = (appId: string) => WorkspaceClient | null;

export interface PaaSAutoFixServiceDeps {
  diagnoseService: DiagnoseService;
  actionExecutor: ActionExecutor;
  workspaceFactory: AutoFixWorkspaceFactory;
  /** Builds the GitTool used for commit + rollback. Route wires `new GitTool(workspace?.tasks)`. */
  gitToolFactory: AutoFixGitToolFactory;
  appRestart?: Pick<AppRestartService, 'restartDevServer'>;
  /**
   * Optional develop-agent fallback. When the request has
   * `enableAgentFallback: true` and diagnose produces no executable actions,
   * the service hands the analysis to this fixer instead of returning
   * NO_ACTIONABLE_FIXES. Omit to disable agent fallback for this instance —
   * requests with `enableAgentFallback: true` then return NO_ACTIONABLE_FIXES.
   */
  agentFixer?: AgentDrivenFixer;
  /** Injectable clock for deterministic timing in tests. */
  clock?: () => number;
  /** Test override for the post-restart wait. Set to 0 in tests. */
  verifyDelayMs?: number;
  /**
   * How long to keep an app's in-flight entry alive after an agent-fallback run
   * times out, blocking a second concurrent writer while the orphaned agent loop
   * may still be running. Defaults to {@link DEFAULT_ORPHAN_HOLD_MS}.
   */
  orphanHoldMs?: number;
  /** Container path passed to GitTool. PaaS preview uses /app; tests may override. */
  appPath?: string;
}

/**
 * PaaS auto-fix orchestrator.
 *
 * Composes the existing diagnose pipeline with an action executor and a
 * restart/verify loop. The contract:
 *
 *   1. Run diagnose (pre-fix analysis).
 *   2. Collect Issue.actions[] from the LLM's response.
 *   3. Apply each action against the preview workspace, stopping on first failure.
 *   4. On apply failure → git rollback; return APPLY_FAILED.
 *   5. On apply success → git commit + dev-server restart + verify diagnose.
 *   6. If verify still reports failing/degraded → VERIFICATION_FAILED.
 *
 * In-flight handling is keyed by appId: at most one auto-fix runs per app at a
 * time. A concurrent call for the same app with the SAME intent (dryRun +
 * enableAgentFallback) is COALESCED onto the running promise and returns its
 * result — so a duplicate trigger (retry, double-fire) gets the real outcome of
 * the run already fixing the app instead of an `ANOTHER_DIAGNOSE_IN_FLIGHT`
 * (HTTP 409) that hides a success. A concurrent call with different intent
 * cannot share that result (a dryRun must not receive a mutating run's outcome,
 * or vice versa), so it is rejected with `ANOTHER_DIAGNOSE_IN_FLIGHT`.
 *
 * Orphaned-agent hold: when an agent-fallback run TIMES OUT, the underlying
 * develop-agent loop has no AbortSignal and may keep writing to the workspace
 * after we return (see AgentDrivenFixer). To avoid two concurrent writers on one
 * tree, the in-flight entry is kept for `orphanHoldMs` after such a run settles
 * (lazily evicted on the next call once the clock passes the hold). During the
 * hold a same-app retry coalesces onto the (already-resolved) timeout result or
 * is rejected — it never starts a fresh writer. Best-effort, not a guarantee;
 * the real fix is an AbortSignal into the agent loop.
 *
 * Note: the inner diagnose calls use this service's OWN injected
 * PaaSDiagnoseService, which is a different instance from the one behind
 * `POST /apps/:id/diagnose` (each route constructs its own, with independent
 * in-flight stores). An external `/diagnose` therefore cannot block this
 * service's pre-fix or verify diagnose.
 */
export class PaaSAutoFixService implements AutoFixService {
  private readonly diagnoseService: DiagnoseService;
  private readonly actionExecutor: ActionExecutor;
  private readonly workspaceFactory: AutoFixWorkspaceFactory;
  private readonly gitToolFactory: AutoFixGitToolFactory;
  private readonly appRestart: Pick<AppRestartService, 'restartDevServer'> | undefined;
  private readonly agentFixer: AgentDrivenFixer | undefined;
  private readonly clock: () => number;
  private readonly verifyDelayMs: number;
  private readonly orphanHoldMs: number;
  private readonly appPath: string;
  /**
   * One run per appId. Holds the in-flight promise so a concurrent same-intent
   * call can ride on it (coalesce) instead of being rejected. `dryRun` and
   * `enableAgentFallback` capture the run's intent — a concurrent call with
   * different intent can't share the result and is rejected instead.
   *
   * `holdUntil` (epoch ms from {@link clock}) is set only on the orphaned-agent
   * hold path: the entry lingers, with its resolved promise, until the clock
   * passes it; the next call for the app evicts it lazily. Undefined for a live
   * run (released immediately when it settles).
   */
  private readonly inFlight = new Map<
    string,
    {
      promise: Promise<AutoFixResponse>;
      dryRun: boolean;
      enableAgentFallback: boolean;
      holdUntil?: number;
    }
  >();

  constructor(deps: PaaSAutoFixServiceDeps) {
    this.diagnoseService = deps.diagnoseService;
    this.actionExecutor = deps.actionExecutor;
    this.workspaceFactory = deps.workspaceFactory;
    this.gitToolFactory = deps.gitToolFactory;
    this.appRestart = deps.appRestart;
    this.agentFixer = deps.agentFixer;
    this.clock = deps.clock ?? Date.now;
    this.verifyDelayMs = deps.verifyDelayMs ?? DEFAULT_VERIFY_DELAY_MS;
    this.orphanHoldMs = deps.orphanHoldMs ?? DEFAULT_ORPHAN_HOLD_MS;
    this.appPath = deps.appPath ?? PREVIEW_APP_PATH;
  }

  async autoFix(request: AutoFixRequest): Promise<AutoFixResponse> {
    const dryRun = Boolean(request.dryRun);
    const enableAgentFallback = Boolean(request.enableAgentFallback);

    const existing = this.inFlight.get(request.appId);
    if (existing) {
      // An orphaned-agent hold whose window has passed is stale — the timed-out
      // agent's realistic lifetime is over. Evict it and fall through to a fresh
      // run rather than coalescing onto a long-dead result.
      if (existing.holdUntil !== undefined && this.clock() >= existing.holdUntil) {
        logger.info('auto-fix.invocation.orphan_hold_expired', { appId: request.appId });
        this.inFlight.delete(request.appId);
      } else {
        // A run is already underway (or an orphaned agent may still be writing).
        // If the new call has the same intent, coalesce onto it: the caller awaits
        // the running/held promise and gets its real outcome. This is the fix for
        // duplicate triggers (retries, double-fires) that previously got a 409 even
        // though the in-flight run went on to fix the app. Differing intent can't
        // share a result — a dryRun must not receive a mutating run's outcome, or
        // vice versa — so reject.
        if (existing.dryRun === dryRun && existing.enableAgentFallback === enableAgentFallback) {
          logger.info('auto-fix.invocation.coalesced', {
            appId: request.appId,
            dryRun,
            heldForOrphan: existing.holdUntil !== undefined,
          });
          return existing.promise;
        }
        logger.info('auto-fix.invocation.rejected', {
          appId: request.appId,
          reason: existing.holdUntil !== undefined ? 'orphan_agent_hold' : 'incompatible_in_flight',
        });
        return {
          success: false,
          error:
            'Another auto-fix with different options is already in progress for this app. Wait for it to finish and retry.',
          errorCode: 'ANOTHER_DIAGNOSE_IN_FLIGHT',
          analysis: buildUnknownAnalysis(this.clock, this.clock()),
        };
      }
    }

    // Explicit out-param the inner run sets when an agent-fallback times out, so
    // this method knows to hold the entry afterward (the orphaned agent has no
    // AbortSignal and may keep writing). Passed by argument — not read from an
    // enclosing mutable binding — and consulted only in the finally below.
    const orphanHold = { triggered: false };
    const promise = this.runAutoFix(request, orphanHold);
    this.inFlight.set(request.appId, { promise, dryRun, enableAgentFallback });
    try {
      return await promise;
    } finally {
      // Only touch our own entry (coalesced callers never replace it, but guard
      // anyway). On an agent timeout, keep it alive for orphanHoldMs so a retry
      // can't start a second writer; otherwise release immediately.
      const current = this.inFlight.get(request.appId);
      if (current && current.promise === promise) {
        if (orphanHold.triggered) {
          this.inFlight.set(request.appId, {
            ...current,
            holdUntil: this.clock() + this.orphanHoldMs,
          });
          logger.warn('auto-fix.invocation.orphan_hold_started', {
            appId: request.appId,
            holdMs: this.orphanHoldMs,
          });
        } else {
          this.inFlight.delete(request.appId);
        }
      }
    }
  }

  private async runAutoFix(
    request: AutoFixRequest,
    orphanHold: { triggered: boolean },
  ): Promise<AutoFixResponse> {
    logger.info('auto-fix.invocation.start', {
      appId: request.appId,
      dryRun: Boolean(request.dryRun),
    });

    // 1. Pre-fix diagnose.
    const preFix = await this.diagnoseService.diagnose({
      appId: request.appId,
      target: 'preview',
      ...(request.tier !== undefined ? { tier: request.tier } : {}),
    });
    if (!preFix.success) {
      logger.info('auto-fix.diagnose.pre.failed', {
        appId: request.appId,
        errorCode: preFix.errorCode,
      });
      return preFix;
    }

    // 2. Collect actions.
    const actions = collectActions(preFix.analysis);

    // Build is healthy / no error logs → nothing to do, return early as success.
    if (preFix.analysis.status === 'healthy' || preFix.analysis.status === 'noerrlog') {
      logger.info('auto-fix.preflight.no_failure', {
        appId: request.appId,
        status: preFix.analysis.status,
      });
      return {
        success: true,
        analysis: preFix.analysis,
        postFixAnalysis: preFix.analysis,
        appliedActions: [],
        restarted: false,
      };
    }

    // Build is broken but the LLM produced no actionable fixes. If the caller
    // opted into the develop-agent fallback AND we have a fixer wired, hand
    // the analysis to the agent and let it apply the fix via tools. Otherwise
    // preserve the previous behavior (NO_ACTIONABLE_FIXES).
    if (actions.length === 0) {
      if (request.enableAgentFallback === true && this.agentFixer) {
        logger.info('auto-fix.agent_fallback.invoke', {
          appId: request.appId,
          status: preFix.analysis.status,
          issueCount: preFix.analysis.issues.length,
        });
        return await this.runAgentFallback(request, preFix.analysis, orphanHold);
      }

      logger.info('auto-fix.preflight.no_actions', {
        appId: request.appId,
        status: preFix.analysis.status,
        issueCount: preFix.analysis.issues.length,
        agentFallbackRequested: request.enableAgentFallback === true,
        agentFixerWired: this.agentFixer !== undefined,
      });
      return {
        success: false,
        error:
          'Diagnose identified issues but produced no actionable fixes. Review the analysis manually.',
        errorCode: 'NO_ACTIONABLE_FIXES',
        analysis: preFix.analysis,
        appliedActions: [],
      };
    }

    // 3. dryRun branch — no mutation, no restart, no verify.
    if (request.dryRun === true) {
      logger.info('auto-fix.dry_run', {
        appId: request.appId,
        actionCount: actions.length,
      });
      const planned: AppliedAction[] = actions.map((action) => ({
        action,
        status: 'skipped',
        output: 'dryRun=true: action planned but not applied',
      }));
      return {
        success: true,
        analysis: preFix.analysis,
        postFixAnalysis: preFix.analysis,
        appliedActions: planned,
        restarted: false,
      };
    }

    // 4. Apply actions.
    const exec = await this.actionExecutor.execute(request.appId, actions);
    if (!exec.success) {
      // Couldn't even reach the workspace → SUPERVISOR_UNAVAILABLE; otherwise APPLY_FAILED + rollback.
      if (exec.workspaceUnavailable) {
        logger.warn('auto-fix.apply.workspace_unavailable', { appId: request.appId });
        return {
          success: false,
          error: 'Preview workspace is unreachable; no fixes applied.',
          errorCode: 'SUPERVISOR_UNAVAILABLE',
          analysis: preFix.analysis,
          appliedActions: exec.applied,
        };
      }

      const rollback = await this.gitRollback(request.appId);
      const appliedCount = exec.applied.filter((a) => a.status === 'applied').length;
      const failedCount = exec.applied.filter((a) => a.status === 'failed').length;
      const firstFailure = exec.applied.find(
        (a): a is Extract<AppliedAction, { status: 'failed' }> => a.status === 'failed'
      );

      if (!rollback.rolledBack) {
        // The workspace still holds the partially-applied actions — don't tell
        // the customer it was rolled back when it wasn't.
        logger.error('auto-fix.apply.rollback_failed', {
          appId: request.appId,
          appliedCount,
          failedCount,
          error: rollback.error,
        });
        return {
          success: false,
          error:
            (firstFailure?.error ?? 'One or more auto-fix actions failed') +
            '. Automatic rollback also failed, so the preview workspace may still ' +
            'contain partially-applied changes — manual recovery may be required.',
          errorCode: 'APPLY_FAILED',
          analysis: preFix.analysis,
          appliedActions: exec.applied,
        };
      }

      logger.info('auto-fix.apply.rolled_back', {
        appId: request.appId,
        appliedCount,
        failedCount,
      });
      return {
        success: false,
        error: firstFailure?.error ?? 'One or more auto-fix actions failed; changes were rolled back.',
        errorCode: 'APPLY_FAILED',
        analysis: preFix.analysis,
        appliedActions: exec.applied,
      };
    }

    // 5. Commit applied changes — if commit fails we still proceed to verify;
    // the dev server restart picks up the on-disk state regardless.
    await this.gitCommit(request.appId);

    // 6. Restart preview dev server. Capture the restart boundary *before* the
    // restart so the verify window starts here: it covers the install/build/start
    // the restart triggers and the new server's output, while excluding the
    // pre-fix errors that are still inside diagnose's default 3-hour window.
    const verifySinceIso = new Date(this.clock()).toISOString();
    const restartResult = await this.appRestart?.restartDevServer(request.appId);
    const restarted = restartResult?.success ?? false;
    // A restart that was attempted and failed must NOT fall through to verify:
    // the old server keeps running, emits no fresh logs in the verify window,
    // and the empty window reads as `noerrlog` → a false "verified" success.
    // (restartResult === undefined means no restart service was wired — leave
    // that path alone; only an explicit failure is a problem here.)
    if (restartResult && !restartResult.success) {
      logger.warn('auto-fix.restart.failed', {
        appId: request.appId,
        error: restartResult.error,
      });
      return {
        success: false,
        error:
          'Fixes were applied and committed, but restarting the preview dev ' +
          'server failed, so the changes could not be verified.',
        errorCode: 'RESTART_FAILED',
        analysis: preFix.analysis,
        appliedActions: exec.applied,
      };
    }

    // 7. Wait briefly so the dev server has time to emit fresh logs.
    if (this.verifyDelayMs > 0) {
      await delay(this.verifyDelayMs);
    }

    // 8. Verify by re-running diagnose, scoped to post-restart logs only.
    const postFix = await this.diagnoseService.diagnose({
      appId: request.appId,
      target: 'preview',
      tier: 'llm',
      since: verifySinceIso,
    });
    if (!postFix.success) {
      logger.info('auto-fix.verify.diagnose_failed', {
        appId: request.appId,
        errorCode: postFix.errorCode,
      });
      return {
        success: false,
        error: postFix.error,
        errorCode: postFix.errorCode,
        analysis: preFix.analysis,
        postFixAnalysis: postFix.analysis,
        appliedActions: exec.applied,
      };
    }

    const postStatus = postFix.analysis.status;
    if (postStatus === 'healthy' || postStatus === 'noerrlog') {
      logger.info('auto-fix.verify.success', {
        appId: request.appId,
        postStatus,
        appliedCount: exec.applied.length,
      });
      return {
        success: true,
        analysis: preFix.analysis,
        postFixAnalysis: postFix.analysis,
        appliedActions: exec.applied,
        restarted,
      };
    }

    logger.info('auto-fix.verify.still_failing', {
      appId: request.appId,
      postStatus,
      issueCount: postFix.analysis.issues.length,
    });
    return {
      success: false,
      error: 'Fixes applied but the build still reports issues after restart.',
      errorCode: 'VERIFICATION_FAILED',
      analysis: preFix.analysis,
      postFixAnalysis: postFix.analysis,
      appliedActions: exec.applied,
    };
  }

  /**
   * Develop-agent fallback path. Invoked when `actions[]` is empty but the
   * caller opted into letting the agent apply fixes from the diagnose
   * recommendations. Mirrors the action-executor success branch (commit +
   * restart + verify) so callers see a uniform response shape; the only
   * differences are an empty appliedActions[] (the agent edits via tools,
   * not DiagnoseAction records) and the populated `agentFix` outcome.
   */
  private async runAgentFallback(
    request: AutoFixRequest,
    preFixAnalysis: Analysis,
    orphanHold: { triggered: boolean },
  ): Promise<AutoFixResponse> {
    // dryRun semantics for the agent path: don't burn LLM tokens; report
    // that the fallback would have run.
    if (request.dryRun === true) {
      logger.info('auto-fix.agent_fallback.dry_run', { appId: request.appId });
      const dryOutcome: AgentFixOutcome = {
        summary: 'dryRun=true: agent fallback would be invoked but was skipped',
        toolCallCount: 0,
      };
      return {
        success: true,
        analysis: preFixAnalysis,
        postFixAnalysis: preFixAnalysis,
        appliedActions: [],
        restarted: false,
        agentFix: dryOutcome,
      };
    }

    // Non-null asserted: caller verified `this.agentFixer` is wired before
    // entering this branch.
    const fixResult: AgentFixResult = await this.agentFixer!.applyFix(
      request.appId,
      preFixAnalysis,
    );

    if (!fixResult.success) {
      // Agent didn't run cleanly — couldn't reach the registry, threw, or
      // timed out. On timeout the loop has no AbortSignal and may still be
      // writing, so signal the caller to HOLD the in-flight entry: a same-app
      // retry must not start a second concurrent writer on this tree.
      if (fixResult.timedOut) {
        orphanHold.triggered = true;
      }
      // Roll back any partial edits from the (possibly aborted) tool loop so we
      // don't leave the workspace in a half-fixed state. Best-effort on timeout
      // (the orphaned agent can write again after the reset).
      const rollback = await this.gitRollback(request.appId);
      if (!rollback.rolledBack) {
        logger.error('auto-fix.agent_fallback.rollback_failed', {
          appId: request.appId,
          error: rollback.error,
          agentError: fixResult.error,
        });
      }
      logger.warn('auto-fix.agent_fallback.failed', {
        appId: request.appId,
        unavailable: Boolean(fixResult.unavailable),
        error: fixResult.error,
        rolledBack: rollback.rolledBack,
        timedOut: Boolean(fixResult.timedOut),
      });
      // Message must reflect what we can actually guarantee about the workspace:
      //  - timedOut: the agent has NO AbortSignal, so it may still be running
      //    and can write AFTER our reset. The reset can't be trusted as a clean
      //    rollback — never claim "rolled back" here, regardless of git's result.
      //  - rollback succeeded (and not timed out): safe to say "rolled back".
      //  - rollback failed: warn the workspace may still be dirty.
      const error = fixResult.timedOut
        ? (fixResult.error ?? 'The develop agent fallback timed out') +
          '. The agent may still be running in the background, so the preview ' +
          'workspace state is indeterminate — manual recovery may be required.'
        : rollback.rolledBack
          ? fixResult.error ??
            'The develop agent fallback failed to apply fixes; changes were rolled back.'
          : (fixResult.error ?? 'The develop agent fallback failed to apply fixes') +
            '. Automatic rollback also failed, so the preview workspace may still ' +
            'contain partially-applied changes — manual recovery may be required.';
      return {
        success: false,
        error,
        errorCode: 'AGENT_FIX_FAILED',
        analysis: preFixAnalysis,
        appliedActions: [],
        agentFix: { summary: fixResult.summary, toolCallCount: fixResult.toolCallCount },
      };
    }

    // Always commit + restart + re-diagnose, regardless of tool-call count.
    //
    // We previously gated commit on toolCallCount > 0, but that count is
    // unreliable: AI SDK 6's `result.toolCalls` reports tools from the LAST
    // step only. If the agent's tool loop edited files in step N and emitted
    // a final summary in step N+1 (the common shape), the count is 0 even
    // though edits really happened. We can't tell from outside whether the
    // workspace was modified, so we trust the post-restart diagnose to be
    // the source of truth — committing and restarting are safe no-ops if
    // there's actually nothing to apply.
    await this.gitCommit(request.appId);

    // Capture the restart boundary *before* restarting so the verify diagnose
    // only sees post-restart logs. Without this, verify reuses diagnose's
    // default 3-hour window and re-reads the very errors that triggered the
    // fix — a correctly-fixed app then fails verification every time.
    const verifySinceIso = new Date(this.clock()).toISOString();
    const restartResult = await this.appRestart?.restartDevServer(request.appId);
    const restarted = restartResult?.success ?? false;
    // As in the action path: an attempted-but-failed restart can't fall through
    // to verify. The old server emits no fresh logs, the verify window reads
    // `noerrlog`, and the run would wrongly report success even though the
    // agent's changes were never loaded. (undefined = no restart service wired.)
    if (restartResult && !restartResult.success) {
      logger.warn('auto-fix.agent_fallback.restart_failed', {
        appId: request.appId,
        error: restartResult.error,
      });
      return {
        success: false,
        error:
          'The develop agent applied changes, but restarting the preview dev ' +
          'server failed, so the fix could not be verified.',
        errorCode: 'RESTART_FAILED',
        analysis: preFixAnalysis,
        appliedActions: [],
        agentFix: { summary: fixResult.summary, toolCallCount: fixResult.toolCallCount },
      };
    }

    if (this.verifyDelayMs > 0) {
      await delay(this.verifyDelayMs);
    }

    const postFix = await this.diagnoseService.diagnose({
      appId: request.appId,
      target: 'preview',
      tier: 'llm',
      since: verifySinceIso,
    });
    const agentFix: AgentFixOutcome = {
      summary: fixResult.summary,
      toolCallCount: fixResult.toolCallCount,
    };

    if (!postFix.success) {
      logger.info('auto-fix.agent_fallback.verify_diagnose_failed', {
        appId: request.appId,
        errorCode: postFix.errorCode,
      });
      return {
        success: false,
        error: postFix.error,
        errorCode: postFix.errorCode,
        analysis: preFixAnalysis,
        postFixAnalysis: postFix.analysis,
        appliedActions: [],
        agentFix,
      };
    }

    const postStatus = postFix.analysis.status;
    if (postStatus === 'healthy' || postStatus === 'noerrlog') {
      logger.info('auto-fix.agent_fallback.success', {
        appId: request.appId,
        postStatus,
        toolCallCount: fixResult.toolCallCount,
      });
      return {
        success: true,
        analysis: preFixAnalysis,
        postFixAnalysis: postFix.analysis,
        appliedActions: [],
        restarted,
        agentFix,
      };
    }

    logger.info('auto-fix.agent_fallback.still_failing', {
      appId: request.appId,
      postStatus,
      issueCount: postFix.analysis.issues.length,
      reportedToolCallCount: fixResult.toolCallCount,
    });
    return {
      success: false,
      error:
        'The develop agent ran but the build still reports issues after restart. ' +
        'Compare the agent\'s summary against the post-restart analysis — both are ' +
        'attached.',
      errorCode: 'AGENT_FIX_FAILED',
      analysis: preFixAnalysis,
      postFixAnalysis: postFix.analysis,
      appliedActions: [],
      agentFix,
    };
  }

  private async gitCommit(appId: string): Promise<void> {
    try {
      const workspace = this.workspaceFactory(appId);
      const gitTool = this.gitToolFactory(workspace);
      const addResult = await gitTool.executeGitOperation(this.appPath, {
        operation: 'add',
        files: ['.'],
      });
      if (!addResult.success) {
        logger.warn('auto-fix.commit.add_failed', { appId, error: addResult.error });
        return;
      }
      const commitResult = await gitTool.executeGitOperation(this.appPath, {
        operation: 'commit',
        message: COMMIT_MESSAGE,
      });
      if (!commitResult.success) {
        logger.warn('auto-fix.commit.commit_failed', { appId, error: commitResult.error });
      }
    } catch (err) {
      logger.warn('auto-fix.commit.threw', {
        appId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Roll the workspace back to HEAD. Returns whether the rollback actually
   * landed so the caller can tell the customer the truth — a swallowed failure
   * here would leave partially-applied changes on disk while the response
   * claims a clean rollback.
   */
  private async gitRollback(appId: string): Promise<{ rolledBack: boolean; error?: string }> {
    try {
      const workspace = this.workspaceFactory(appId);
      const gitTool = this.gitToolFactory(workspace);
      const resetResult = await gitTool.executeGitOperation(this.appPath, {
        operation: 'reset',
        options: { mode: 'hard', hash: 'HEAD' },
      });
      if (!resetResult.success) {
        logger.warn('auto-fix.rollback.reset_failed', { appId, error: resetResult.error });
        return { rolledBack: false, error: resetResult.error ?? 'git reset --hard HEAD failed' };
      }
      const cleanResult = await gitTool.executeGitOperation(this.appPath, {
        operation: 'clean',
      });
      if (!cleanResult.success) {
        logger.warn('auto-fix.rollback.clean_failed', { appId, error: cleanResult.error });
        return { rolledBack: false, error: cleanResult.error ?? 'git clean failed' };
      }
      return { rolledBack: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.warn('auto-fix.rollback.threw', { appId, error });
      return { rolledBack: false, error };
    }
  }
}

function collectActions(analysis: Analysis): DiagnoseAction[] {
  return analysis.issues.flatMap((issue) => issue.actions ?? []);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
