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
  runtimeErrorService: Pick<RuntimeErrorService, 'pollRuntimeErrors' | 'hasCycleEstablished'>;
  retryCounters: Map<string, number>;
  maxRetries: number;
  maxWaitMs?: number;
  quietWindowMs?: number;
  logger: PhaseLogger;
}

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
  const { runtimeErrorService, retryCounters, maxRetries, maxWaitMs, quietWindowMs, logger } =
    deps;

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
