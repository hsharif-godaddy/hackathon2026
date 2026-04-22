import { describe, it, expect, beforeEach, vi } from 'vitest';

import { createPostStreamValidator } from '../post-stream-validator.js';
import type { TypecheckResult } from '../../services/typecheck-service.js';
import type { RuntimeErrorResult } from '../../services/runtime-error-service.js';

const SOCKET_ID = 'socket-xyz';
const APP_ID = 'app-abc';
const AGENT_NAME = 'develop-agent';
const CONVERSATION_ID = 'conv-123';

function makeArgs(overrides: Partial<Parameters<ReturnType<typeof createPostStreamValidator>>[0]> = {}) {
  const abortController = new AbortController();
  return {
    socketId: SOCKET_ID,
    context: {
      metadata: { appId: APP_ID },
      conversation: { conversationId: CONVERSATION_ID }
    },
    agentName: AGENT_NAME,
    toolCalls: [{ toolName: 'fileEdit' }] as Array<{ toolName: string }>,
    abortSignal: abortController.signal,
    emitChunk: vi.fn(async () => {}),
    ...overrides
  };
}

function makeDeps(overrides: {
  typecheckResult?: TypecheckResult;
  runtimeResult?: RuntimeErrorResult;
  tscMaxRetries?: number;
  rtMaxRetries?: number;
  tscRetryCount?: number;
  rtRetryCount?: number;
  turnStartedAt?: number;
  hasUncommittedChanges?: boolean | (() => Promise<boolean>);
} = {}) {
  const logger = { info: vi.fn(), warn: vi.fn() };
  const typecheckService = {
    runTypecheck: vi.fn<[string, unknown], Promise<TypecheckResult>>(async () =>
      overrides.typecheckResult ?? { ok: true, errors: [] }
    )
  };
  const runtimeErrorService = {
    pollRuntimeErrors: vi.fn<[string, unknown], Promise<RuntimeErrorResult>>(async () =>
      overrides.runtimeResult ?? { ok: true, errors: [] }
    )
  };
  const tscCounters = new Map<string, number>();
  if (overrides.tscRetryCount !== undefined) {
    tscCounters.set(SOCKET_ID, overrides.tscRetryCount);
  }
  const rtCounters = new Map<string, number>();
  if (overrides.rtRetryCount !== undefined) {
    rtCounters.set(SOCKET_ID, overrides.rtRetryCount);
  }
  const turnStartedAtBySocket = new Map<string, number>();
  if (overrides.turnStartedAt !== undefined) {
    turnStartedAtBySocket.set(SOCKET_ID, overrides.turnStartedAt);
  } else {
    turnStartedAtBySocket.set(SOCKET_ID, Date.now());
  }
  const hasUncommittedChangesFn = (() => {
    const override = overrides.hasUncommittedChanges;
    if (typeof override === 'function') return vi.fn(override);
    if (typeof override === 'boolean') return vi.fn(async () => override);
    return vi.fn(async () => true);
  })();
  return {
    deps: {
      typecheck: {
        typecheckService,
        retryCounters: tscCounters,
        maxRetries: overrides.tscMaxRetries ?? 2,
        logger
      },
      runtimeErrors: {
        runtimeErrorService,
        retryCounters: rtCounters,
        turnStartedAtBySocket,
        maxRetries: overrides.rtMaxRetries ?? 2,
        logger
      },
      hasUncommittedChanges: hasUncommittedChangesFn,
      logger
    },
    mocks: {
      logger,
      runTypecheck: typecheckService.runTypecheck,
      pollRuntimeErrors: runtimeErrorService.pollRuntimeErrors,
      hasUncommittedChanges: hasUncommittedChangesFn,
      tscCounters,
      rtCounters,
      turnStartedAtBySocket
    }
  };
}

describe('createPostStreamValidator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns void when aborted', async () => {
    const { deps, mocks } = makeDeps();
    const validator = createPostStreamValidator(deps);
    const ac = new AbortController();
    ac.abort();
    const result = await validator(makeArgs({ abortSignal: ac.signal }));
    expect(result).toBeUndefined();
    expect(mocks.runTypecheck).not.toHaveBeenCalled();
    expect(mocks.pollRuntimeErrors).not.toHaveBeenCalled();
  });

  it('returns void when appId is missing', async () => {
    const { deps, mocks } = makeDeps();
    const validator = createPostStreamValidator(deps);
    const result = await validator(makeArgs({ context: { metadata: {} } }));
    expect(result).toBeUndefined();
    expect(mocks.runTypecheck).not.toHaveBeenCalled();
  });

  it('is __autoContinue-agnostic (transport is the sole gatekeeper)', async () => {
    // The transport layer (`experimental-websocket-server.ts`) skips
    // calling this validator entirely when a tool has already requested
    // an auto-continuation, so the validator itself does not (and must
    // not) short-circuit on `__autoContinue`. Documented here so nobody
    // adds the guard back without also moving the transport-side gate.
    const { deps, mocks } = makeDeps();
    const validator = createPostStreamValidator(deps);
    await validator(
      makeArgs({
        context: {
          metadata: { appId: APP_ID, __autoContinue: true },
          conversation: { conversationId: CONVERSATION_ID }
        }
      })
    );
    expect(mocks.runTypecheck).toHaveBeenCalledTimes(1);
    expect(mocks.pollRuntimeErrors).toHaveBeenCalledTimes(1);
  });

  it('skips both phases when the working tree has no uncommitted changes', async () => {
    const { deps, mocks } = makeDeps({ hasUncommittedChanges: false });
    const validator = createPostStreamValidator(deps);
    const result = await validator(
      makeArgs({ toolCalls: [{ toolName: 'searchFiles' }, { toolName: 'readFile' }] })
    );
    expect(result).toBeUndefined();
    expect(mocks.hasUncommittedChanges).toHaveBeenCalledWith(APP_ID);
    expect(mocks.runTypecheck).not.toHaveBeenCalled();
    expect(mocks.pollRuntimeErrors).not.toHaveBeenCalled();
    expect(mocks.logger.info).toHaveBeenCalledWith(
      'agent.typecheck.skipped',
      expect.objectContaining({ reason: 'no_uncommitted_changes' })
    );
    expect(mocks.logger.info).toHaveBeenCalledWith(
      'agent.runtime_errors.skipped',
      expect.objectContaining({ reason: 'no_uncommitted_changes' })
    );
  });

  it('falls through to running both phases when the change-check itself throws', async () => {
    // A `git status` flake from dev-supervisor (e.g. exit_code -1, process
    // couldn't start) used to silently disarm the entire validator. The
    // runtime phase doesn't need git at all, so a transient git failure
    // must not be allowed to swallow real runtime errors.
    const { deps, mocks } = makeDeps({
      hasUncommittedChanges: async () => {
        throw new Error('DevSupervisor not available');
      }
    });
    const validator = createPostStreamValidator(deps);
    const result = await validator(makeArgs());
    expect(result).toBeUndefined();
    expect(mocks.runTypecheck).toHaveBeenCalledTimes(1);
    expect(mocks.pollRuntimeErrors).toHaveBeenCalledTimes(1);
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      'agent.post_stream_validator.change_check_failed',
      expect.objectContaining({
        error: 'DevSupervisor not available',
        action: 'fall_through'
      })
    );
  });

  it('runs tsc and runtime in parallel; tsc-only failure continues with tsc prompt', async () => {
    const { deps, mocks } = makeDeps({
      typecheckResult: {
        ok: false,
        errors: [{ file: 'a.ts', line: 1, column: 1, code: 'TS1', message: 'boom' }]
      }
      // runtime defaults to clean
    });
    const validator = createPostStreamValidator(deps);
    const result = await validator(makeArgs());
    expect(result).toMatchObject({ continuationPrompt: expect.stringContaining('TS1') });
    // Both phases run even when tsc fails — runtime poll is independent.
    expect(mocks.runTypecheck).toHaveBeenCalledTimes(1);
    expect(mocks.pollRuntimeErrors).toHaveBeenCalledTimes(1);
    expect(mocks.tscCounters.get(SOCKET_ID)).toBe(1);
    expect(mocks.rtCounters.has(SOCKET_ID)).toBe(false);
  });

  it('emits tsc gave-up message when tsc budget exhausted and runtime is clean', async () => {
    const { deps, mocks } = makeDeps({
      typecheckResult: {
        ok: false,
        errors: [{ file: 'a.ts', line: 1, column: 1, code: 'TS1', message: 'boom' }]
      },
      tscRetryCount: 2,
      tscMaxRetries: 2
    });
    const validator = createPostStreamValidator(deps);
    const emitChunk = vi.fn(async () => {});
    const result = await validator(makeArgs({ emitChunk }));
    expect(result).toBeUndefined();
    expect(emitChunk).toHaveBeenCalledTimes(1);
    expect(emitChunk.mock.calls[0]![0]).toContain('TypeScript errors');
    // Runtime phase still ran in parallel; it just returned clean.
    expect(mocks.pollRuntimeErrors).toHaveBeenCalledTimes(1);
  });

  it('combines prompts when both tsc and runtime have errors', async () => {
    const { deps, mocks } = makeDeps({
      typecheckResult: {
        ok: false,
        errors: [{ file: 'a.ts', line: 1, column: 1, code: 'TS1', message: 'boom' }]
      },
      runtimeResult: {
        ok: false,
        errors: [{ name: 'TypeError', message: 'x is undefined', timestamp: 1 }]
      }
    });
    const validator = createPostStreamValidator(deps);
    const result = await validator(makeArgs());
    expect(result).toMatchObject({
      continuationPrompt: expect.stringContaining('TS1')
    });
    expect((result as { continuationPrompt: string }).continuationPrompt).toContain('TypeError');
    // Each phase bumped its own counter independently.
    expect(mocks.tscCounters.get(SOCKET_ID)).toBe(1);
    expect(mocks.rtCounters.get(SOCKET_ID)).toBe(1);
  });

  it('defers gave-up chunks when another phase is still continuing', async () => {
    // tsc still has budget → continues. runtime exhausted → gave-up chunk
    // should NOT be emitted yet; next iteration will re-run and emit if
    // the runtime errors persist.
    const { deps, mocks } = makeDeps({
      typecheckResult: {
        ok: false,
        errors: [{ file: 'a.ts', line: 1, column: 1, code: 'TS1', message: 'boom' }]
      },
      runtimeResult: {
        ok: false,
        errors: [{ name: 'Err', message: 'oops', timestamp: 1 }]
      },
      rtRetryCount: 2,
      rtMaxRetries: 2
    });
    const emitChunk = vi.fn(async () => {});
    const validator = createPostStreamValidator(deps);
    const result = await validator(makeArgs({ emitChunk }));
    expect(result).toMatchObject({ continuationPrompt: expect.stringContaining('TS1') });
    // No runtime prompt in the combined output (budget exhausted, phase
    // returned 'exhausted', not 'continue'), and no gave-up chunk yet.
    expect((result as { continuationPrompt: string }).continuationPrompt).not.toContain('oops');
    expect(emitChunk).not.toHaveBeenCalled();
    expect(mocks.tscCounters.get(SOCKET_ID)).toBe(1);
  });

  it('emits both gave-up messages when both budgets are exhausted on the same turn', async () => {
    const { deps } = makeDeps({
      typecheckResult: {
        ok: false,
        errors: [{ file: 'a.ts', line: 1, column: 1, code: 'TS1', message: 'boom' }]
      },
      runtimeResult: {
        ok: false,
        errors: [{ name: 'Err', message: 'oops', timestamp: 1 }]
      },
      tscRetryCount: 2,
      tscMaxRetries: 2,
      rtRetryCount: 2,
      rtMaxRetries: 2
    });
    const emitChunk = vi.fn(async () => {});
    const validator = createPostStreamValidator(deps);
    const result = await validator(makeArgs({ emitChunk }));
    expect(result).toBeUndefined();
    expect(emitChunk).toHaveBeenCalledTimes(1);
    const emitted = emitChunk.mock.calls[0]![0] as string;
    expect(emitted).toContain('TypeScript errors');
    expect(emitted).toContain('runtime errors');
  });

  it('falls through to runtime phase when tsc skipped (no supervisor)', async () => {
    const { deps, mocks } = makeDeps({
      typecheckResult: { ok: true, errors: [], skipped: true, reason: 'no_supervisor' }
    });
    const validator = createPostStreamValidator(deps);
    const result = await validator(makeArgs());
    expect(result).toBeUndefined();
    expect(mocks.pollRuntimeErrors).toHaveBeenCalledTimes(1);
  });

  it('retries when tsc passes and runtime errors are present', async () => {
    const { deps, mocks } = makeDeps({
      runtimeResult: {
        ok: false,
        errors: [{ name: 'TypeError', message: 'x is undefined', timestamp: 1 }]
      }
    });
    const validator = createPostStreamValidator(deps);
    const result = await validator(makeArgs());
    expect(result).toMatchObject({ continuationPrompt: expect.stringContaining('TypeError') });
    expect(mocks.rtCounters.get(SOCKET_ID)).toBe(1);
    expect(mocks.tscCounters.has(SOCKET_ID)).toBe(false);
  });

  it('emits gave-up message when runtime budget is exhausted', async () => {
    const { deps, mocks } = makeDeps({
      runtimeResult: {
        ok: false,
        errors: [{ name: 'TypeError', message: 'x is undefined', timestamp: 1 }]
      },
      rtRetryCount: 2,
      rtMaxRetries: 2
    });
    const validator = createPostStreamValidator(deps);
    const emitChunk = vi.fn(async () => {});
    const result = await validator(makeArgs({ emitChunk }));
    expect(result).toBeUndefined();
    expect(emitChunk).toHaveBeenCalledTimes(1);
    expect(emitChunk.mock.calls[0]![0]).toContain('runtime errors');
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      'agent.runtime_errors.exceeded',
      expect.any(Object)
    );
  });

  it('both clean: returns void and leaves counters untouched', async () => {
    const { deps, mocks } = makeDeps();
    const validator = createPostStreamValidator(deps);
    const result = await validator(makeArgs());
    expect(result).toBeUndefined();
    expect(mocks.tscCounters.has(SOCKET_ID)).toBe(false);
    expect(mocks.rtCounters.has(SOCKET_ID)).toBe(false);
  });

  it('tsc and runtime retry counters are independent', async () => {
    // First call: tsc fails → tsc counter bumps, rt untouched
    const first = makeDeps({
      typecheckResult: {
        ok: false,
        errors: [{ file: 'a.ts', line: 1, column: 1, code: 'TS1', message: 'boom' }]
      }
    });
    const validator1 = createPostStreamValidator(first.deps);
    await validator1(makeArgs());
    expect(first.mocks.tscCounters.get(SOCKET_ID)).toBe(1);
    expect(first.mocks.rtCounters.has(SOCKET_ID)).toBe(false);

    // Second call (different instance): tsc passes, runtime fails → rt counter bumps
    const second = makeDeps({
      runtimeResult: {
        ok: false,
        errors: [{ name: 'Err', message: 'oops', timestamp: 1 }]
      }
    });
    const validator2 = createPostStreamValidator(second.deps);
    await validator2(makeArgs());
    expect(second.mocks.tscCounters.has(SOCKET_ID)).toBe(false);
    expect(second.mocks.rtCounters.get(SOCKET_ID)).toBe(1);
  });

  it('skips runtime phase when no turnStartedAt is recorded', async () => {
    const { deps, mocks } = makeDeps();
    deps.runtimeErrors.turnStartedAtBySocket.delete(SOCKET_ID);
    const validator = createPostStreamValidator(deps);
    const result = await validator(makeArgs());
    expect(result).toBeUndefined();
    expect(mocks.pollRuntimeErrors).not.toHaveBeenCalled();
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      'agent.runtime_errors.skipped',
      expect.objectContaining({ reason: 'no_turn_started_at' })
    );
  });

  it('does not pass a seenSignatures Set across iterations (watermark handles dedup)', async () => {
    // We deliberately rely on `RuntimeErrorService.pollRuntimeErrors`
    // to mint a fresh in-call Set so its 250ms polling loop doesn't
    // double-count. Cross-iteration dedup is the watermark's job —
    // sharing a Set across iterations was the bug that hid re-thrown
    // errors after partial fixes.
    const { deps, mocks } = makeDeps();
    const validator = createPostStreamValidator(deps);

    await validator(makeArgs());
    await validator(makeArgs());

    expect(mocks.pollRuntimeErrors).toHaveBeenCalledTimes(2);
    const firstCallOpts = mocks.pollRuntimeErrors.mock.calls[0][1] as {
      seenSignatures?: Set<string>;
    };
    const secondCallOpts = mocks.pollRuntimeErrors.mock.calls[1][1] as {
      seenSignatures?: Set<string>;
    };
    expect(firstCallOpts.seenSignatures).toBeUndefined();
    expect(secondCallOpts.seenSignatures).toBeUndefined();
  });

  it('advances the runtime watermark after a continue outcome', async () => {
    // After surfacing errors in iteration N, the watermark must move
    // forward so iteration N+1's drain only sees errors pushed *after*
    // the agent had a chance to react. Otherwise stale buffer entries
    // re-match `pushedAt >= since` forever and the runtime phase
    // either re-feeds resolved errors or (with naive dedup) hides
    // genuine re-throws.
    const initialWatermark = 1_000;
    const { deps, mocks } = makeDeps({
      turnStartedAt: initialWatermark,
      runtimeResult: {
        ok: false,
        errors: [{ name: 'TypeError', message: 'x is undefined', timestamp: 1 }]
      }
    });
    const validator = createPostStreamValidator(deps);
    const before = Date.now();
    await validator(makeArgs());
    const after = Date.now();
    const advanced = mocks.turnStartedAtBySocket.get(SOCKET_ID)!;
    expect(advanced).toBeGreaterThanOrEqual(before);
    expect(advanced).toBeLessThanOrEqual(after);
    expect(advanced).toBeGreaterThan(initialWatermark);
  });

  it('advances the runtime watermark after an exhausted outcome', async () => {
    // Even when we give up, advance so a subsequent message on the
    // same socket starts from a clean slate rather than re-surfacing
    // the entries we just gave up on.
    const initialWatermark = 1_000;
    const { deps, mocks } = makeDeps({
      turnStartedAt: initialWatermark,
      runtimeResult: {
        ok: false,
        errors: [{ name: 'Err', message: 'oops', timestamp: 1 }]
      },
      rtRetryCount: 2,
      rtMaxRetries: 2
    });
    const validator = createPostStreamValidator(deps);
    await validator(makeArgs({ emitChunk: vi.fn(async () => {}) }));
    expect(mocks.turnStartedAtBySocket.get(SOCKET_ID)).toBeGreaterThan(initialWatermark);
  });

  it('does not advance the runtime watermark on a clean outcome', async () => {
    // Clean iterations don't move the cursor — a future iteration in
    // the same turn should still inherit the original turn-start
    // watermark, not a "now" stamp that would skip pre-existing
    // late-arriving errors from async effects.
    const initialWatermark = 1_000;
    const { deps, mocks } = makeDeps({
      turnStartedAt: initialWatermark
      // runtime defaults to clean
    });
    const validator = createPostStreamValidator(deps);
    await validator(makeArgs());
    expect(mocks.turnStartedAtBySocket.get(SOCKET_ID)).toBe(initialWatermark);
  });

  it('does NOT advance the watermark at phase start on the first iteration', async () => {
    // First iteration must use the `onMessageStart` watermark as-is so
    // any errors the user left in the editor before sending the message
    // are still caught. Advancing here would filter out pre-turn bugs
    // that the agent was asked to fix.
    const initialWatermark = 1_000;
    const { deps, mocks } = makeDeps({
      turnStartedAt: initialWatermark
      // runtime defaults to clean, retryCount defaults to 0
    });
    const validator = createPostStreamValidator(deps);
    await validator(makeArgs());

    const sinceArg = (mocks.pollRuntimeErrors.mock.calls[0][1] as { since: number }).since;
    expect(sinceArg).toBe(initialWatermark);
  });

  it('advances the watermark at phase START on retry iterations to filter mid-edit ghosts', async () => {
    // Regression for the "ghost re-report" bug: during iter N+1 the
    // agent's preceding stream produced multiple mid-edit HMR states
    // that each pushed a brief runtime error to the buffer between the
    // previous drain's end and this iteration's start. Using the old
    // (phase-end) watermark would let all those intermediate entries
    // pass `pushedAt >= since` and re-report as if they were bugs in
    // the stable post-stream code. Advancing the watermark at phase
    // START on retry iterations is what suppresses them.
    const staleWatermark = 1_000;
    const { deps, mocks } = makeDeps({
      turnStartedAt: staleWatermark,
      rtRetryCount: 1 // retry iteration
      // runtime defaults to clean — we only care that `since` gets advanced
    });
    const validator = createPostStreamValidator(deps);
    const before = Date.now();
    await validator(makeArgs());
    const after = Date.now();

    // The `since` passed to `pollRuntimeErrors` must be a fresh
    // phase-start timestamp, not the stale phase-end value from the
    // prior iteration.
    const sinceArg = (mocks.pollRuntimeErrors.mock.calls[0][1] as { since: number }).since;
    expect(sinceArg).toBeGreaterThanOrEqual(before);
    expect(sinceArg).toBeLessThanOrEqual(after);
    expect(sinceArg).toBeGreaterThan(staleWatermark);

    // And the persisted watermark reflects the advance so future
    // iterations (and cleanup paths) see a consistent value.
    expect(mocks.turnStartedAtBySocket.get(SOCKET_ID)).toBeGreaterThanOrEqual(sinceArg);
  });

  it('tsc unexpected_error falls through to runtime phase', async () => {
    const { deps, mocks } = makeDeps();
    (deps.typecheck.typecheckService.runTypecheck as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('unexpected boom')
    );
    const validator = createPostStreamValidator(deps);
    const result = await validator(makeArgs());
    expect(result).toBeUndefined();
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      'agent.typecheck.unexpected_error',
      expect.any(Object)
    );
    expect(mocks.pollRuntimeErrors).toHaveBeenCalledTimes(1);
  });
});
