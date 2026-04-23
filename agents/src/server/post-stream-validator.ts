/**
 * Composite post-stream validator — runs the tsc phase and the runtime-error
 * phase in parallel, then combines their outcomes. Each phase is a small,
 * independently-testable helper that returns a discriminated result telling
 * the composite what to do (continue with a synthetic prompt, emit a "gave
 * up" chunk, or fall through).
 *
 * Why parallel?
 *   tsc typically takes ~5-10s (cold) or 2-4s (warm). During that window the
 *   browser's HMR pipeline is already propagating the agent's edits, and any
 *   runtime errors are trickling into the in-memory runtime-error buffer
 *   (populated by the builder parent via `POST /apps/:id/runtime-errors`).
 *   Running the runtime poll sequentially *after* tsc wastes that background
 *   time; the browser can easily take 10-15s from file-write to
 *   runtime-throw, so a short post-tsc poll will miss errors that were
 *   always going to happen. Running them concurrently gives the runtime
 *   poll a "free" tsc_duration head start.
 *
 * If both phases report errors, their prompts are concatenated into one
 * continuation so the agent fixes everything in a single retry. Each phase
 * independently increments its own retry counter — per-turn budgets are
 * preserved.
 *
 * Wire-up: consumed by `ai-lib-websocket-server.ts` in the
 * `postStreamValidator` slot of ai-transport's options. Unit tests live in
 * `agents/src/server/__tests__/post-stream-validator.test.ts`.
 */

import type { ILogger } from '../logging/types.js';
import type { RestartResult } from '../services/DevSupervisorClient.js';
import {
  TypecheckService,
  formatTscErrorsForPrompt,
  type TypecheckResult
} from '../services/typecheck-service.js';
import {
  RuntimeErrorService,
  formatRuntimeErrorsForPrompt,
  type RuntimeErrorResult
} from '../services/runtime-error-service.js';

type PhaseLogger = Pick<ILogger, 'info' | 'warn'>;

export interface PostStreamValidatorArgs {
  socketId: string;
  context: Record<string, unknown>;
  agentName: string;
  toolCalls: Array<{ toolName: string; args?: unknown }>;
  abortSignal: AbortSignal;
  emitChunk: (text: string) => Promise<void>;
}

export type PostStreamValidatorResult =
  | { continuationPrompt: string }
  | null
  | undefined
  | void;

type PhaseOutcome =
  | { kind: 'continue'; prompt: string }
  | { kind: 'exhausted'; message: string }
  | { kind: 'clean' };

export interface TypecheckPhaseDeps {
  typecheckService: Pick<TypecheckService, 'runTypecheck'>;
  retryCounters: Map<string, number>;
  maxRetries: number;
  logger: PhaseLogger;
}

export interface RuntimeErrorPhaseDeps {
  runtimeErrorService: Pick<
    RuntimeErrorService,
    'pollRuntimeErrors' | 'hasCycleEstablished' | 'getCurrentCycleId' | 'waitForCycleAdvance'
  >;
  retryCounters: Map<string, number>;
  maxRetries: number;
  maxWaitMs?: number;
  quietWindowMs?: number;
  /**
   * Optional. When provided, invoked on the 2nd+ runtime-phase run for
   * a socket (`retryCount >= 1`) if errors are still present, to cover
   * the "HMR didn't propagate the fix, buffer is stale" case
   * (typically a top-level module throw that crashes the page before
   * `error-client.ts` wires its HMR listeners). Called *before* the
   * retry-budget / continuation decision: on success we wait for a
   * fresh cycleId beacon, re-poll once, and only report errors that
   * survive the restart.
   *
   * If omitted, the phase behaves exactly as it did before this
   * recovery path existed — useful for the composite's broader tests
   * that don't care about this branch.
   */
  restartPreview?: (appId: string, signal: AbortSignal) => Promise<RestartResult>;
  /**
   * Upper bound on how long `waitForCycleAdvance` blocks after a
   * successful restart before falling through to the phase's existing
   * continuation logic. Sized to cover a cold dep-graph boot
   * (~2-5s process start + Vite re-optimize + initial render); defaults
   * to 15s.
   */
  restartBeaconWaitMs?: number;
  logger: PhaseLogger;
}

const DEFAULT_RESTART_BEACON_WAIT_MS = 15_000;

export interface CompositePostStreamValidatorDeps {
  typecheck: TypecheckPhaseDeps;
  runtimeErrors: RuntimeErrorPhaseDeps;
  /** Throws if the app or dev-supervisor can't be resolved (treated as skip). */
  hasUncommittedChanges: (appId: string) => Promise<boolean>;
  logger: PhaseLogger;
}

/**
 * Run the tsc phase. The skip-fast gate lives in the composite so both
 * phases share it — callers of this directly pay the tsc cost unconditionally.
 */
export async function runTypecheckPhase(
  args: PostStreamValidatorArgs,
  deps: TypecheckPhaseDeps,
  meta: { appId: string; conversationId?: string }
): Promise<PhaseOutcome> {
  const { socketId, agentName, abortSignal } = args;
  const { appId, conversationId } = meta;
  const { typecheckService, retryCounters, maxRetries, logger } = deps;

  const retryCount = retryCounters.get(socketId) ?? 0;

  logger.info('agent.typecheck.begin', {
    socketId,
    appId,
    conversationId,
    agentName,
    retryCount
  });

  let result: TypecheckResult;
  try {
    result = await typecheckService.runTypecheck(appId, { signal: abortSignal });
  } catch (err) {
    logger.warn('agent.typecheck.unexpected_error', {
      socketId,
      appId,
      conversationId,
      error: err instanceof Error ? err.message : String(err)
    });
    return { kind: 'clean' };
  }

  if (result.skipped) {
    logger.info('agent.typecheck.skipped', {
      socketId,
      appId,
      conversationId,
      agentName,
      reason: result.reason,
      durationMs: result.durationMs
    });
    return { kind: 'clean' };
  }

  if (result.ok) {
    logger.info('agent.typecheck.pass', {
      socketId,
      appId,
      conversationId,
      agentName,
      retryCount,
      durationMs: result.durationMs
    });
    return { kind: 'clean' };
  }

  logger.warn('agent.typecheck.fail', {
    socketId,
    appId,
    conversationId,
    agentName,
    retryCount,
    errorCount: result.errors.length,
    durationMs: result.durationMs,
    sampleErrors: result.errors.slice(0, 5).map((e) => ({
      file: e.file,
      line: e.line,
      code: e.code
    }))
  });

  if (retryCount >= maxRetries) {
    logger.warn('agent.typecheck.exceeded', {
      socketId,
      appId,
      conversationId,
      agentName,
      errorCount: result.errors.length,
      maxRetries
    });
    return {
      kind: 'exhausted',
      message: `\n\n_I couldn't fully resolve the remaining TypeScript errors in this turn — take a look at the latest changes and tell me if you want me to keep trying._\n`
    };
  }

  retryCounters.set(socketId, retryCount + 1);
  logger.info('agent.typecheck.retry.begin', {
    socketId,
    appId,
    conversationId,
    agentName,
    retryCount: retryCount + 1,
    errorCount: result.errors.length
  });

  return { kind: 'continue', prompt: formatTscErrorsForPrompt(result.errors) };
}

interface RestartAndRepollMeta {
  appId: string;
  conversationId?: string;
  socketId: string;
  agentName: string;
  retryCount: number;
}

interface RestartAndRepollDeps {
  runtimeErrorService: Pick<
    RuntimeErrorService,
    'pollRuntimeErrors' | 'getCurrentCycleId' | 'waitForCycleAdvance'
  >;
  restartPreview: (appId: string, signal: AbortSignal) => Promise<RestartResult>;
  restartBeaconWaitMs: number;
  maxWaitMs: number | undefined;
  quietWindowMs: number | undefined;
  abortSignal: AbortSignal;
  logger: PhaseLogger;
}

interface RestartAndRepollOutcome {
  /**
   * `null` means "don't trust a re-poll" — either the restart call
   * failed, the beacon never arrived, or the re-poll itself bailed
   * without a usable result. Caller should keep the phase's existing
   * result and fall through to its normal continue/exhausted logic.
   *
   * A non-null `result` means a re-poll completed against the new
   * cycle; caller should use this in place of the original poll
   * result. `result.ok === true` signals the "HMR was the problem"
   * happy path.
   */
  result: RuntimeErrorResult | null;
  /**
   * True if the abort signal fired at any point during the restart
   * sequence. Caller should treat this like the phase's initial
   * aborted-skip path (return `clean`, no counter bump, no chunk).
   */
  aborted: boolean;
}

/**
 * Restart the preview and, on success, wait for a fresh cycleId
 * beacon and re-poll runtime errors once. Factored out of
 * `runRuntimeErrorPhase` so the restart branch there reads as a
 * single decision point and the multi-step orchestration (which has
 * its own logging and abort handling) lives in one place.
 */
async function attemptRestartAndRepoll(
  meta: RestartAndRepollMeta,
  deps: RestartAndRepollDeps
): Promise<RestartAndRepollOutcome> {
  const { appId, conversationId, socketId, agentName, retryCount } = meta;
  const {
    runtimeErrorService,
    restartPreview,
    restartBeaconWaitMs,
    maxWaitMs,
    quietWindowMs,
    abortSignal,
    logger
  } = deps;

  const previousCycleId = runtimeErrorService.getCurrentCycleId(appId);

  logger.info('agent.runtime_errors.restart.begin', {
    socketId,
    appId,
    conversationId,
    agentName,
    retryCount,
    previousCycleId
  });

  let restartRes: RestartResult;
  try {
    restartRes = await restartPreview(appId, abortSignal);
  } catch (err) {
    logger.warn('agent.runtime_errors.restart.failed', {
      socketId,
      appId,
      conversationId,
      agentName,
      error: err instanceof Error ? err.message : String(err),
      reason: 'restart_threw'
    });
    return { result: null, aborted: abortSignal.aborted };
  }

  if (abortSignal.aborted) {
    return { result: null, aborted: true };
  }

  if (!restartRes.success) {
    logger.warn('agent.runtime_errors.restart.failed', {
      socketId,
      appId,
      conversationId,
      agentName,
      error: restartRes.error,
      reason: 'restart_unsuccessful'
    });
    return { result: null, aborted: false };
  }

  const waitRes = await runtimeErrorService.waitForCycleAdvance(appId, previousCycleId, {
    timeoutMs: restartBeaconWaitMs,
    signal: abortSignal
  });

  if (abortSignal.aborted) {
    return { result: null, aborted: true };
  }

  if (!waitRes.advanced) {
    logger.warn('agent.runtime_errors.restart.beacon_timeout', {
      socketId,
      appId,
      conversationId,
      agentName,
      previousCycleId,
      waitDurationMs: waitRes.durationMs,
      timeoutMs: restartBeaconWaitMs
    });
    return { result: null, aborted: false };
  }

  let rePoll: RuntimeErrorResult;
  try {
    rePoll = await runtimeErrorService.pollRuntimeErrors(appId, {
      maxWaitMs,
      quietWindowMs,
      signal: abortSignal
    });
  } catch (err) {
    logger.warn('agent.runtime_errors.restart.failed', {
      socketId,
      appId,
      conversationId,
      agentName,
      error: err instanceof Error ? err.message : String(err),
      reason: 'repoll_threw'
    });
    return { result: null, aborted: abortSignal.aborted };
  }

  if (rePoll.skipped) {
    // Aborted during the re-poll — treat like an early-out, don't
    // attribute the original stale errors to the user.
    return { result: null, aborted: true };
  }

  if (rePoll.ok) {
    logger.info('agent.runtime_errors.restart.resolved', {
      socketId,
      appId,
      conversationId,
      agentName,
      newCycleId: waitRes.newCycleId,
      waitDurationMs: waitRes.durationMs,
      rePollDurationMs: rePoll.durationMs
    });
  } else {
    logger.warn('agent.runtime_errors.restart.persisted', {
      socketId,
      appId,
      conversationId,
      agentName,
      newCycleId: waitRes.newCycleId,
      waitDurationMs: waitRes.durationMs,
      rePollDurationMs: rePoll.durationMs,
      errorCount: rePoll.errors.length
    });
  }

  return { result: rePoll, aborted: false };
}

/**
 * Run the runtime-error phase. Safe to execute in parallel with tsc —
 * both phases are independent (separate retry counters, separate error
 * sources: tsc invokes exec in the preview container; runtime drains the
 * in-process `runtimeErrorBuffer`). If tsc fails the agent will still see
 * tsc errors in the combined prompt, and any runtime errors captured
 * during the same window are generally still relevant: Vite transpiles
 * TS-with-type-errors to JS and the browser runs it, so type errors
 * don't suppress runtime errors.
 *
 * Freshness is owned entirely by the buffer: every POST carries a
 * `cycleId` stamped by the preview, and the buffer evicts entries from
 * superseded cycles on HMR rotation. The phase itself is stateless across
 * iterations — it just drains "what's current for this app" and runs
 * its own retry counter.
 */
export async function runRuntimeErrorPhase(
  args: PostStreamValidatorArgs,
  deps: RuntimeErrorPhaseDeps,
  meta: { appId: string; conversationId?: string }
): Promise<PhaseOutcome> {
  const { socketId, agentName, abortSignal } = args;
  const { appId, conversationId } = meta;
  const {
    runtimeErrorService,
    retryCounters,
    maxRetries,
    maxWaitMs,
    quietWindowMs,
    restartPreview,
    restartBeaconWaitMs,
    logger
  } = deps;

  const retryCount = retryCounters.get(socketId) ?? 0;

  logger.info('agent.runtime_errors.begin', {
    socketId,
    appId,
    conversationId,
    agentName,
    retryCount
  });

  let result: RuntimeErrorResult;
  try {
    // `pollRuntimeErrors` mints a fresh per-call `seenSignatures` Set
    // so its 250ms polling loop doesn't double-count within a single
    // drain window. Cross-iteration dedup is handled by the buffer's
    // cycle rotation — once the preview HMRs, prior-cycle entries are
    // evicted, and a still-broken error gets re-pushed under the new
    // cycle on the next render.
    result = await runtimeErrorService.pollRuntimeErrors(appId, {
      maxWaitMs,
      quietWindowMs,
      signal: abortSignal
    });
  } catch (err) {
    logger.warn('agent.runtime_errors.unexpected_error', {
      socketId,
      appId,
      conversationId,
      error: err instanceof Error ? err.message : String(err)
    });
    return { kind: 'clean' };
  }

  if (result.skipped) {
    logger.info('agent.runtime_errors.skipped', {
      socketId,
      appId,
      conversationId,
      agentName,
      reason: result.reason,
      durationMs: result.durationMs
    });
    return { kind: 'clean' };
  }

  // Stale-HMR recovery on the 2nd+ runtime-phase run. When the phase
  // has already surfaced errors at least once this socket's turn-chain
  // (`retryCount >= 1`) and errors are *still* present, the most
  // likely explanation is that HMR didn't propagate the agent's fix —
  // classically a top-level module throw that crashes the page before
  // `error-client.ts` has wired up its HMR listeners, so the buffer's
  // cycleId never advances and `drainForTurn` keeps returning
  // pre-fix errors. Force a preview restart, wait for the new
  // `error-client.ts` to emit its initial cycle beacon, then re-drain
  // once. If the re-drain is clean the agent's fix was actually
  // correct (HMR was the problem); if errors persist they're genuinely
  // current and get fed to the continuation prompt below.
  //
  // Fires on *every* subsequent retry (not just retryCount === 1):
  // the agent's 2nd fix can independently crash the page in the same
  // way, so we need to re-confirm via restart each time. Worst-case
  // latency is (MAX_RUNTIME_ERROR_RETRIES) × restart_sequence_ms,
  // bounded by the retry budget.
  //
  // Guarded on `restartPreview` being injected so test callers that
  // don't care about this branch keep the pre-existing behavior.
  if (
    !result.ok &&
    retryCount >= 1 &&
    restartPreview !== undefined &&
    !abortSignal.aborted
  ) {
    const restartOutcome = await attemptRestartAndRepoll(
      { appId, conversationId, socketId, agentName, retryCount },
      {
        runtimeErrorService,
        restartPreview,
        restartBeaconWaitMs: restartBeaconWaitMs ?? DEFAULT_RESTART_BEACON_WAIT_MS,
        maxWaitMs,
        quietWindowMs,
        abortSignal,
        logger
      }
    );
    if (restartOutcome.aborted) {
      // Abort during restart / beacon-wait / re-poll. Treat like the
      // initial aborted-skip path: leave counters untouched, no chunk.
      return { kind: 'clean' };
    }
    if (restartOutcome.result) {
      result = restartOutcome.result;
      if (result.ok) {
        return { kind: 'clean' };
      }
    }
    // restartOutcome.result === null: restart failed or beacon never
    // arrived. Fall through with the *original* stale errors — no
    // worse than today's behavior, and the continuation logic below
    // still runs.
  }

  if (result.ok) {
    // A clean result with no cycle ever established for this app means
    // the preview never sent its `runtime-errors-cycle` beacon — most
    // likely the postMessage forwarding path is broken, not that the
    // app is genuinely error-free. Surface it as a warning so an
    // operator can catch a regression in the beacon pipeline before it
    // starts silently hiding real errors.
    if (!deps.runtimeErrorService.hasCycleEstablished(appId)) {
      logger.warn('agent.runtime_errors.pass.no_cycle_established', {
        socketId,
        appId,
        conversationId,
        agentName,
        retryCount,
        durationMs: result.durationMs
      });
    } else {
      logger.info('agent.runtime_errors.pass', {
        socketId,
        appId,
        conversationId,
        agentName,
        retryCount,
        durationMs: result.durationMs
      });
    }
    return { kind: 'clean' };
  }

  logger.warn('agent.runtime_errors.fail', {
    socketId,
    appId,
    conversationId,
    agentName,
    retryCount,
    errorCount: result.errors.length,
    durationMs: result.durationMs,
    sampleErrors: result.errors.slice(0, 5).map((e) => ({
      name: e.name,
      message: e.message.slice(0, 200)
    }))
  });

  if (retryCount >= maxRetries) {
    logger.warn('agent.runtime_errors.exceeded', {
      socketId,
      appId,
      conversationId,
      agentName,
      errorCount: result.errors.length,
      maxRetries
    });
    return {
      kind: 'exhausted',
      message: `\n\n_I couldn't fully resolve the remaining runtime errors in this turn — take a look at the latest changes and tell me if you want me to keep trying._\n`
    };
  }

  retryCounters.set(socketId, retryCount + 1);
  logger.info('agent.runtime_errors.retry.begin', {
    socketId,
    appId,
    conversationId,
    agentName,
    retryCount: retryCount + 1,
    errorCount: result.errors.length
  });

  return { kind: 'continue', prompt: formatRuntimeErrorsForPrompt(result.errors) };
}

/**
 * Build the composite `postStreamValidator` callback. Runs tsc + runtime
 * phases in parallel and composes their outcomes:
 *
 *   - Both clean            → no continuation, no chunk.
 *   - Either `continue`     → send ONE combined continuation prompt covering
 *                              every phase that had errors. Each contributing
 *                              phase has already incremented its own retry
 *                              counter.
 *   - Any `exhausted` with
 *     no other `continue`   → emit that phase's "gave up" chunk.
 *   - `exhausted` alongside
 *     a `continue`          → defer the gave-up chunk; the next iteration
 *                              will re-run both phases and surface the
 *                              gave-up message if the errors persist.
 *
 * Both phases are gated on `hasUncommittedChanges` (same check the git
 * post-hook uses), so turns that don't touch files pay neither cost.
 */
export function createPostStreamValidator(deps: CompositePostStreamValidatorDeps) {
  const { typecheck, runtimeErrors, hasUncommittedChanges, logger } = deps;

  return async function postStreamValidator(
    args: PostStreamValidatorArgs
  ): Promise<PostStreamValidatorResult> {
    const { socketId, context, agentName, abortSignal, emitChunk } = args;

    if (abortSignal.aborted) {
      return;
    }

    const typedContext = context as {
      metadata?: { appId?: string };
      conversation?: { conversationId?: string };
    };
    const appId = typedContext?.metadata?.appId;
    const conversationId = typedContext?.conversation?.conversationId;

    if (!appId) {
      return;
    }

    // Note: the transport layer (`experimental-websocket-server.ts`) is
    // the sole gatekeeper for `__autoContinue` — it skips invoking this
    // validator entirely when a tool has already requested an
    // auto-continuation, so we don't need to re-check it here.

    // Fast-skip gate: if the working tree is clean we know neither
    // phase has anything new to validate. We still treat a *failure*
    // of the gate itself as "fall through and run the phases" rather
    // than "skip everything" — the gate is a `git status` shelled out
    // to dev-supervisor, which can transiently fail (exit_code -1,
    // process couldn't start, etc.) and previously silently disarmed
    // the entire validator. The runtime phase in particular is purely
    // an in-process buffer drain and doesn't need git at all, so a
    // git flake should not be allowed to swallow real runtime errors.
    let hasChanges: boolean;
    try {
      hasChanges = await hasUncommittedChanges(appId);
    } catch (err) {
      logger.warn('agent.post_stream_validator.change_check_failed', {
        socketId,
        appId,
        conversationId,
        agentName,
        error: err instanceof Error ? err.message : String(err),
        action: 'fall_through'
      });
      hasChanges = true;
    }
    if (!hasChanges) {
      logger.info('agent.typecheck.skipped', {
        socketId,
        appId,
        conversationId,
        agentName,
        reason: 'no_uncommitted_changes'
      });
      logger.info('agent.runtime_errors.skipped', {
        socketId,
        appId,
        conversationId,
        agentName,
        reason: 'no_uncommitted_changes'
      });
      return;
    }

    // Parallel: both phases read from independent sources (tsc shells
    // out via dev-supervisor; runtime drains the in-process
    // `runtimeErrorBuffer` populated by `POST /apps/:id/runtime-errors`)
    // and manage independent retry counters, so there is no contention
    // beyond tsc sharing the dev-supervisor HTTP client pool with other
    // exec calls. Promise.all preserves errors via each phase's internal
    // try/catch; neither phase throws.
    const [tscOutcome, rtOutcome] = await Promise.all([
      runTypecheckPhase(args, typecheck, { appId, conversationId }),
      runRuntimeErrorPhase(args, runtimeErrors, { appId, conversationId })
    ]);

    const continuationPrompts: string[] = [];
    if (tscOutcome.kind === 'continue') continuationPrompts.push(tscOutcome.prompt);
    if (rtOutcome.kind === 'continue') continuationPrompts.push(rtOutcome.prompt);

    if (continuationPrompts.length > 0) {
      return {
        continuationPrompt: continuationPrompts.join('\n\n---\n\n')
      };
    }

    // No continuation planned; surface any exhausted phases to the user
    // so they know we gave up. When both phases exhaust on the same turn
    // we concatenate both messages in deterministic order (tsc first) so
    // the user sees the full picture.
    const exhaustedMessages: string[] = [];
    if (tscOutcome.kind === 'exhausted') exhaustedMessages.push(tscOutcome.message);
    if (rtOutcome.kind === 'exhausted') exhaustedMessages.push(rtOutcome.message);

    if (exhaustedMessages.length > 0) {
      try {
        await emitChunk(exhaustedMessages.join(''));
      } catch (emitErr) {
        logger.warn('agent.post_stream_validator.exceeded.emit_failure', {
          socketId,
          error: emitErr instanceof Error ? emitErr.message : String(emitErr)
        });
      }
    }

    return;
  };
}
