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
    emitChunk: vi.fn(async (_text: string) => {}),
    ...overrides
  };
}

type RestartPreviewFn = (
  appId: string,
  signal: AbortSignal
) => Promise<{ success: boolean; error?: string }>;

type WaitForCycleAdvanceFn = (
  appId: string,
  previousCycleId: number | undefined,
  opts: { timeoutMs: number; signal?: AbortSignal }
) => Promise<{ advanced: boolean; newCycleId?: number; durationMs: number }>;

function makeDeps(overrides: {
  typecheckResult?: TypecheckResult;
  runtimeResult?: RuntimeErrorResult;
  /** Override for the re-poll after a successful restart + beacon wait. */
  rePollResult?: RuntimeErrorResult;
  tscMaxRetries?: number;
  rtMaxRetries?: number;
  tscRetryCount?: number;
  rtRetryCount?: number;
  hasUncommittedChanges?: boolean | (() => Promise<boolean>);
  cycleEstablished?: boolean;
  /** Preset cycleId reported before the restart fires. */
  previousCycleId?: number;
  /**
   * Inject restart wiring. `false` / undefined keeps the deps identical
   * to pre-restart behavior (no restart callback on deps, no
   * `waitForCycleAdvance` exercised), which lets us assert the
   * regression case from the plan.
   */
  restartPreview?: RestartPreviewFn;
  /**
   * Override for the cycle-advance wait. Defaults to
   * `{ advanced: true, newCycleId: previousCycleId + 1 }` when
   * `restartPreview` is set, so happy-path tests don't have to wire
   * both overrides.
   */
  waitForCycleAdvance?: WaitForCycleAdvanceFn;
  restartBeaconWaitMs?: number;
  healthCheckPreview?: (appId: string) => Promise<boolean>;
} = {}) {
  const logger = { info: vi.fn(), warn: vi.fn() };
  const typecheckService = {
    runTypecheck: vi.fn(
      async (_appId: string, _opts: unknown): Promise<TypecheckResult> =>
        overrides.typecheckResult ?? { ok: true, errors: [] }
    )
  };
  const previousCycleId = overrides.previousCycleId;
  const pollRuntimeErrors = vi.fn(
    async (_appId: string, _opts: unknown): Promise<RuntimeErrorResult> =>
      overrides.runtimeResult ?? { ok: true, errors: [] }
  );
  // Re-poll replaces the first-poll result on the next call. We wire
  // this via `mockImplementationOnce` in the restart tests rather than
  // here, but default the first/second calls to the same result so a
  // test that doesn't care about the re-poll shape still gets sane
  // behavior.
  if (overrides.rePollResult !== undefined) {
    pollRuntimeErrors.mockImplementationOnce(async () => overrides.runtimeResult ?? { ok: true, errors: [] });
    pollRuntimeErrors.mockImplementationOnce(async () => overrides.rePollResult!);
  }
  const waitForCycleAdvance = vi.fn(
    async (
      appId: string,
      prev: number | undefined,
      opts: { timeoutMs: number; signal?: AbortSignal }
    ): Promise<{ advanced: boolean; newCycleId?: number; durationMs: number }> =>
      overrides.waitForCycleAdvance
        ? overrides.waitForCycleAdvance(appId, prev, opts)
        : {
            advanced: true,
            newCycleId: (prev ?? 0) + 1,
            durationMs: 10
          }
  );
  const runtimeErrorService = {
    pollRuntimeErrors,
    // Default to `true` so existing tests (which assert clean/fail
    // behavior in isolation) don't fire the "no cycle established"
    // warning path. The dedicated observability test below overrides
    // this to `false`.
    hasCycleEstablished: vi.fn((_appId: string): boolean => overrides.cycleEstablished ?? true),
    getCurrentCycleId: vi.fn((_appId: string): number | undefined => previousCycleId),
    waitForCycleAdvance
  };
  const tscCounters = new Map<string, number>();
  if (overrides.tscRetryCount !== undefined) {
    tscCounters.set(SOCKET_ID, overrides.tscRetryCount);
  }
  const rtCounters = new Map<string, number>();
  if (overrides.rtRetryCount !== undefined) {
    rtCounters.set(SOCKET_ID, overrides.rtRetryCount);
  }
  const hasUncommittedChangesFn = (() => {
    const override = overrides.hasUncommittedChanges;
    if (typeof override === 'function') return vi.fn(override);
    if (typeof override === 'boolean') return vi.fn(async () => override);
    return vi.fn(async () => true);
  })();
  const restartPreviewMock = overrides.restartPreview
    ? vi.fn(overrides.restartPreview)
    : undefined;
  const runtimeErrorsDeps: {
    runtimeErrorService: typeof runtimeErrorService;
    retryCounters: Map<string, number>;
    maxRetries: number;
    logger: typeof logger;
    restartPreview?: RestartPreviewFn;
    restartBeaconWaitMs?: number;
  } = {
    runtimeErrorService,
    retryCounters: rtCounters,
    maxRetries: overrides.rtMaxRetries ?? 2,
    logger
  };
  if (restartPreviewMock) {
    runtimeErrorsDeps.restartPreview = restartPreviewMock;
  }
  if (overrides.restartBeaconWaitMs !== undefined) {
    runtimeErrorsDeps.restartBeaconWaitMs = overrides.restartBeaconWaitMs;
  }
  if (overrides.healthCheckPreview) {
    runtimeErrorsDeps.healthCheckPreview = vi.fn(overrides.healthCheckPreview);
  }
  return {
    deps: {
      typecheck: {
        typecheckService,
        retryCounters: tscCounters,
        maxRetries: overrides.tscMaxRetries ?? 2,
        logger
      },
      runtimeErrors: runtimeErrorsDeps,
      hasUncommittedChanges: hasUncommittedChangesFn,
      logger
    },
    mocks: {
      logger,
      runTypecheck: typecheckService.runTypecheck,
      pollRuntimeErrors: runtimeErrorService.pollRuntimeErrors,
      hasCycleEstablished: runtimeErrorService.hasCycleEstablished,
      getCurrentCycleId: runtimeErrorService.getCurrentCycleId,
      waitForCycleAdvance: runtimeErrorService.waitForCycleAdvance,
      hasUncommittedChanges: hasUncommittedChangesFn,
      restartPreview: restartPreviewMock,
      healthCheckPreview: runtimeErrorsDeps.healthCheckPreview as ReturnType<typeof vi.fn> | undefined,
      tscCounters,
      rtCounters
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

  it('skips validation for the initial agent before checking git state', async () => {
    const { deps, mocks } = makeDeps({
      hasUncommittedChanges: async () => {
        throw new Error('git status should not run');
      }
    });
    const validator = createPostStreamValidator(deps);
    const emitValidationStart = vi.fn(async () => {});
    const result = await validator(makeArgs({
      agentName: 'initial',
      emitValidationStart
    }));
    expect(result).toEqual({ skipped: true, reason: 'initial_agent' });
    expect(mocks.hasUncommittedChanges).not.toHaveBeenCalled();
    expect(mocks.runTypecheck).not.toHaveBeenCalled();
    expect(mocks.pollRuntimeErrors).not.toHaveBeenCalled();
    expect(emitValidationStart).not.toHaveBeenCalled();
  });

  it('skips both phases when the working tree has no uncommitted changes', async () => {
    const { deps, mocks } = makeDeps({ hasUncommittedChanges: false });
    const validator = createPostStreamValidator(deps);
    const emitValidationStart = vi.fn(async () => {});
    const result = await validator(
      makeArgs({
        emitValidationStart,
        toolCalls: [{ toolName: 'searchFiles' }, { toolName: 'readFile' }]
      })
    );
    expect(result).toEqual({ skipped: true, reason: 'no_uncommitted_changes' });
    expect(mocks.hasUncommittedChanges).toHaveBeenCalledWith(APP_ID);
    expect(mocks.runTypecheck).not.toHaveBeenCalled();
    expect(mocks.pollRuntimeErrors).not.toHaveBeenCalled();
    expect(emitValidationStart).not.toHaveBeenCalled();
    expect(mocks.logger.info).toHaveBeenCalledWith(
      'agent.typecheck.skipped',
      expect.objectContaining({ reason: 'no_uncommitted_changes' })
    );
    expect(mocks.logger.info).toHaveBeenCalledWith(
      'agent.runtime_errors.skipped',
      expect.objectContaining({ reason: 'no_uncommitted_changes' })
    );
  });

  it('emits validation start when the working tree has uncommitted changes', async () => {
    const { deps, mocks } = makeDeps({ hasUncommittedChanges: true });
    const validator = createPostStreamValidator(deps);
    const emitValidationStart = vi.fn(async () => {});
    const result = await validator(makeArgs({ emitValidationStart }));
    expect(result).toBeUndefined();
    expect(emitValidationStart).toHaveBeenCalledTimes(1);
    expect(mocks.runTypecheck).toHaveBeenCalledTimes(1);
    expect(mocks.pollRuntimeErrors).toHaveBeenCalledTimes(1);
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
    expect(result).toMatchObject({
      continuationPrompt: expect.stringContaining('TS1'),
      message: expect.stringContaining('TS1')
    });
    expect((result as { continuationPrompt: string }).continuationPrompt).toContain('TS1');
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
    const emitChunk = vi.fn(async (_text: string) => {});
    const result = await validator(makeArgs({ emitChunk }));
    expect(result).toMatchObject({
      skipped: true,
      reason: 'exhausted',
      message: expect.stringContaining('TypeScript errors')
    });
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
      continuationPrompt: expect.stringContaining('TS1'),
      message: expect.stringContaining('TS1')
    });
    expect((result as { continuationPrompt: string }).continuationPrompt).toContain('TypeError');
    expect((result as { message: string }).message).toContain('TypeError');
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
    const emitChunk = vi.fn(async (_text: string) => {});
    const validator = createPostStreamValidator(deps);
    const result = await validator(makeArgs({ emitChunk }));
    expect(result).toMatchObject({
      continuationPrompt: expect.stringContaining('TS1'),
      message: expect.stringContaining('TS1')
    });
    // Runtime returned 'exhausted', not 'continue', so no gave-up chunk yet.
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
    const emitChunk = vi.fn(async (_text: string) => {});
    const validator = createPostStreamValidator(deps);
    const result = await validator(makeArgs({ emitChunk }));
    expect(result).toMatchObject({
      skipped: true,
      reason: 'exhausted',
      message: expect.stringContaining('TypeScript errors')
    });
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
    expect(result).toMatchObject({
      continuationPrompt: expect.stringContaining('TypeError'),
      message: expect.stringContaining('TypeError')
    });
    expect(mocks.rtCounters.get(SOCKET_ID)).toBe(1);
    expect(mocks.tscCounters.has(SOCKET_ID)).toBe(false);
  });

  it('limits runtime stack details in validation diagnostics', async () => {
    const { deps } = makeDeps({
      runtimeResult: {
        ok: false,
        errors: [{
          name: 'TypeError',
          message: 'x is undefined',
          stack: [
            'TypeError: x is undefined',
            'at first (src/App.tsx:1:1)',
            'at second (src/App.tsx:2:1)',
            'at third (src/App.tsx:3:1)',
            'at fourth (src/App.tsx:4:1)',
            'at fifth (src/App.tsx:5:1)'
          ].join('\n'),
          componentStack: [
            'at App',
            'at Layout',
            'at Provider',
            'at Root',
            'at Extra'
          ].join('\n'),
          timestamp: 1
        }]
      }
    });
    const validator = createPostStreamValidator(deps);
    const result = await validator(makeArgs());

    expect(result).toMatchObject({
      continuationPrompt: expect.stringContaining('at third'),
      message: expect.stringContaining('at third')
    });
    expect((result as { message: string }).message).not.toContain('at fourth (src/App.tsx:4:1)');
    expect((result as { message: string }).message).not.toContain('at Extra');
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
    const emitChunk = vi.fn(async (_text: string) => {});
    const result = await validator(makeArgs({ emitChunk }));
    expect(result).toMatchObject({
      skipped: true,
      reason: 'exhausted',
      message: expect.stringContaining('runtime errors')
    });
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

  it('does not pass a seenSignatures Set across iterations (cycle rotation handles dedup)', async () => {
    // Sharing a signature Set across iterations would hide a genuinely
    // unfixed error that re-throws under the new cycle after HMR.
    // `RuntimeErrorService.pollRuntimeErrors` mints its own per-call
    // Set to handle the 250ms polling loop's in-call dedup; cross-
    // iteration dedup is the buffer's job via cycle rotation.
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

  it('does not pass a since watermark to pollRuntimeErrors', async () => {
    // Regression guard: freshness is owned entirely by the buffer's
    // cycle-id filter. The validator must stay stateless and not
    // re-introduce a timestamp watermark.
    const { deps, mocks } = makeDeps();
    const validator = createPostStreamValidator(deps);
    await validator(makeArgs());

    const opts = mocks.pollRuntimeErrors.mock.calls[0][1] as Record<string, unknown>;
    expect(opts.since).toBeUndefined();
  });

  it('warns when runtime phase passes but no cycle was ever established', async () => {
    // If the preview never sent a cycle beacon (postMessage broken,
    // forwarding failed, etc.), `drainForTurn` silently returns `[]`
    // and the phase would otherwise report clean with no indication
    // that the freshness signal is missing. Logging a dedicated warn
    // event lets an operator catch a regression in the beacon pipeline
    // before it starts hiding real errors.
    const { deps, mocks } = makeDeps({ cycleEstablished: false });
    const validator = createPostStreamValidator(deps);
    await validator(makeArgs());

    expect(mocks.logger.warn).toHaveBeenCalledWith(
      'agent.runtime_errors.pass.no_cycle_established',
      expect.objectContaining({ appId: APP_ID, socketId: SOCKET_ID })
    );
    expect(mocks.logger.info).not.toHaveBeenCalledWith(
      'agent.runtime_errors.pass',
      expect.any(Object)
    );
  });

  it('logs the normal pass event when a cycle has been established', async () => {
    const { deps, mocks } = makeDeps({ cycleEstablished: true });
    const validator = createPostStreamValidator(deps);
    await validator(makeArgs());

    expect(mocks.logger.info).toHaveBeenCalledWith(
      'agent.runtime_errors.pass',
      expect.objectContaining({ appId: APP_ID, socketId: SOCKET_ID })
    );
    expect(mocks.logger.warn).not.toHaveBeenCalledWith(
      'agent.runtime_errors.pass.no_cycle_established',
      expect.any(Object)
    );
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

  describe('runtime phase — 2nd-run restart recovery', () => {
    const runtimeErrors = [
      { name: 'TypeError', message: 'obj is undefined', timestamp: 1 }
    ];
    const freshErrors = [
      { name: 'ReferenceError', message: 'foo is not defined', timestamp: 2 }
    ];

    it('does NOT trigger restart on the 1st runtime-phase run even if restartPreview is wired', async () => {
      const { deps, mocks } = makeDeps({
        runtimeResult: { ok: false, errors: runtimeErrors },
        restartPreview: async () => ({ success: true })
      });
      const validator = createPostStreamValidator(deps);
      const result = await validator(makeArgs());
      expect(result).toMatchObject({
        continuationPrompt: expect.stringContaining('obj is undefined'),
        message: expect.stringContaining('obj is undefined')
      });
      expect(mocks.restartPreview).not.toHaveBeenCalled();
      expect(mocks.pollRuntimeErrors).toHaveBeenCalledTimes(1);
      expect(mocks.rtCounters.get(SOCKET_ID)).toBe(1);
    });

    it('on 2nd run with errors: restart + clean re-poll returns void and does not emit a continuation', async () => {
      const { deps, mocks } = makeDeps({
        rtRetryCount: 1,
        runtimeResult: { ok: false, errors: runtimeErrors },
        rePollResult: { ok: true, errors: [] },
        previousCycleId: 100,
        restartPreview: async () => ({ success: true }),
        restartBeaconWaitMs: 7_500
      });
      const validator = createPostStreamValidator(deps);
      const result = await validator(makeArgs());
      expect(result).toBeUndefined();
      expect(mocks.restartPreview).toHaveBeenCalledTimes(1);
      expect(mocks.waitForCycleAdvance).toHaveBeenCalledTimes(1);
      expect(mocks.waitForCycleAdvance.mock.calls[0]![1]).toBe(100);
      expect(mocks.waitForCycleAdvance.mock.calls[0]![2]).toMatchObject({
        timeoutMs: 7_500,
        signal: expect.any(AbortSignal)
      });
      expect(mocks.pollRuntimeErrors).toHaveBeenCalledTimes(2);
      // The counter is NOT bumped on a resolved re-poll — the fix
      // actually worked, we should exit the retry loop.
      expect(mocks.rtCounters.get(SOCKET_ID)).toBe(1);
      expect(mocks.logger.info).toHaveBeenCalledWith(
        'agent.runtime_errors.restart.begin',
        expect.objectContaining({ previousCycleId: 100, retryCount: 1 })
      );
      expect(mocks.logger.info).toHaveBeenCalledWith(
        'agent.runtime_errors.restart.resolved',
        expect.any(Object)
      );
    });

    it('on 2nd run with errors: restart + still-dirty re-poll emits a continuation with the fresh errors', async () => {
      const { deps, mocks } = makeDeps({
        rtRetryCount: 1,
        runtimeResult: { ok: false, errors: runtimeErrors },
        rePollResult: { ok: false, errors: freshErrors },
        previousCycleId: 100,
        restartPreview: async () => ({ success: true })
      });
      const validator = createPostStreamValidator(deps);
      const result = await validator(makeArgs());
      expect(result).toMatchObject({
        continuationPrompt: expect.stringContaining('foo is not defined'),
        message: expect.stringContaining('foo is not defined')
      });
      expect((result as { continuationPrompt: string }).continuationPrompt).not.toContain('obj is undefined');
      expect((result as { message: string }).message).not.toContain('obj is undefined');
      expect(mocks.rtCounters.get(SOCKET_ID)).toBe(2);
      expect(mocks.logger.warn).toHaveBeenCalledWith(
        'agent.runtime_errors.restart.persisted',
        expect.any(Object)
      );
    });

    it('on 2nd run with errors: unsuccessful restart falls through with the original stale errors and warns', async () => {
      const { deps, mocks } = makeDeps({
        rtRetryCount: 1,
        runtimeResult: { ok: false, errors: runtimeErrors },
        restartPreview: async () => ({ success: false, error: 'DevSupervisor not available' })
      });
      const validator = createPostStreamValidator(deps);
      const result = await validator(makeArgs());
      expect(result).toMatchObject({
        continuationPrompt: expect.stringContaining('obj is undefined'),
        message: expect.stringContaining('obj is undefined')
      });
      // Re-poll must not happen if the restart didn't actually succeed.
      expect(mocks.waitForCycleAdvance).not.toHaveBeenCalled();
      expect(mocks.pollRuntimeErrors).toHaveBeenCalledTimes(1);
      expect(mocks.logger.warn).toHaveBeenCalledWith(
        'agent.runtime_errors.restart.failed',
        expect.objectContaining({
          reason: 'restart_unsuccessful',
          error: 'DevSupervisor not available'
        })
      );
    });

    it('on 2nd run with errors: restart throwing is caught, falls through with original errors', async () => {
      const { deps, mocks } = makeDeps({
        rtRetryCount: 1,
        runtimeResult: { ok: false, errors: runtimeErrors },
        restartPreview: async () => {
          throw new Error('socket hang up');
        }
      });
      const validator = createPostStreamValidator(deps);
      const result = await validator(makeArgs());
      expect(result).toMatchObject({
        continuationPrompt: expect.stringContaining('obj is undefined'),
        message: expect.stringContaining('obj is undefined')
      });
      expect(mocks.logger.warn).toHaveBeenCalledWith(
        'agent.runtime_errors.restart.failed',
        expect.objectContaining({ reason: 'restart_threw', error: 'socket hang up' })
      );
    });

    it('on 2nd run with errors: re-poll throwing after a successful restart falls through with the original errors', async () => {
      // Structural parity with `restart_threw`: the re-poll's try/catch
      // is a separate branch in `attemptRestartAndRepoll`, so it
      // deserves its own coverage.
      const { deps, mocks } = makeDeps({
        rtRetryCount: 1,
        runtimeResult: { ok: false, errors: runtimeErrors },
        previousCycleId: 100,
        restartPreview: async () => ({ success: true })
      });
      mocks.pollRuntimeErrors
        .mockReset()
        .mockImplementationOnce(async () => ({ ok: false, errors: runtimeErrors }))
        .mockImplementationOnce(async () => {
          throw new Error('buffer gone');
        });
      const validator = createPostStreamValidator(deps);
      const result = await validator(makeArgs());
      expect(result).toMatchObject({
        continuationPrompt: expect.stringContaining('obj is undefined'),
        message: expect.stringContaining('obj is undefined')
      });
      expect(mocks.pollRuntimeErrors).toHaveBeenCalledTimes(2);
      expect(mocks.logger.warn).toHaveBeenCalledWith(
        'agent.runtime_errors.restart.failed',
        expect.objectContaining({ reason: 'repoll_threw', error: 'buffer gone' })
      );
    });

    it('on 2nd run with errors: beacon timeout falls through with original errors and logs a dedicated warn', async () => {
      const { deps, mocks } = makeDeps({
        rtRetryCount: 1,
        runtimeResult: { ok: false, errors: runtimeErrors },
        previousCycleId: 100,
        restartPreview: async () => ({ success: true }),
        waitForCycleAdvance: async () => ({ advanced: false, durationMs: 15_000 })
      });
      const validator = createPostStreamValidator(deps);
      const result = await validator(makeArgs());
      expect(result).toMatchObject({
        continuationPrompt: expect.stringContaining('obj is undefined'),
        message: expect.stringContaining('obj is undefined')
      });
      // Re-poll must be skipped — we don't trust a drain under the
      // old cycle after a restart whose beacon never arrived.
      expect(mocks.pollRuntimeErrors).toHaveBeenCalledTimes(1);
      expect(mocks.logger.warn).toHaveBeenCalledWith(
        'agent.runtime_errors.restart.beacon_timeout',
        expect.objectContaining({ previousCycleId: 100 })
      );
    });

    it('on 2nd run with errors: abort during the restart sequence returns void with no counter bump', async () => {
      const ac = new AbortController();
      const { deps, mocks } = makeDeps({
        rtRetryCount: 1,
        runtimeResult: { ok: false, errors: runtimeErrors },
        restartPreview: async () => {
          ac.abort();
          return { success: true };
        }
      });
      const validator = createPostStreamValidator(deps);
      const result = await validator(makeArgs({ abortSignal: ac.signal }));
      expect(result).toBeUndefined();
      // Counter must NOT advance on abort — the turn is going away.
      expect(mocks.rtCounters.get(SOCKET_ID)).toBe(1);
    });

    it('when restartPreview is omitted from deps, 2nd-run behavior is identical to pre-restart (regression guard)', async () => {
      const { deps, mocks } = makeDeps({
        rtRetryCount: 1,
        runtimeResult: { ok: false, errors: runtimeErrors }
        // No `restartPreview` → phase must not touch the restart path.
      });
      const validator = createPostStreamValidator(deps);
      const result = await validator(makeArgs());
      expect(result).toMatchObject({
        continuationPrompt: expect.stringContaining('obj is undefined'),
        message: expect.stringContaining('obj is undefined')
      });
      expect(mocks.waitForCycleAdvance).not.toHaveBeenCalled();
      expect(mocks.pollRuntimeErrors).toHaveBeenCalledTimes(1);
      // No restart-related log events fired.
      const restartEvents = mocks.logger.info.mock.calls
        .concat(mocks.logger.warn.mock.calls)
        .map((c) => c[0] as string)
        .filter((name) => name.startsWith('agent.runtime_errors.restart.'));
      expect(restartEvents).toEqual([]);
    });

    it('at budget exhaustion on 2nd run: persisted errors after restart surface the gave-up chunk', async () => {
      // When rtRetryCount is already at maxRetries before the phase
      // runs and the re-poll confirms errors persist, the counter
      // bump inside the phase would push to maxRetries+1; the
      // exhausted message path must still emit its gave-up chunk.
      const { deps, mocks } = makeDeps({
        rtRetryCount: 2,
        rtMaxRetries: 2,
        runtimeResult: { ok: false, errors: runtimeErrors },
        rePollResult: { ok: false, errors: freshErrors },
        previousCycleId: 100,
        restartPreview: async () => ({ success: true })
      });
      const emitChunk = vi.fn(async (_text: string) => {});
      const validator = createPostStreamValidator(deps);
      const result = await validator(makeArgs({ emitChunk }));
      expect(result).toMatchObject({
        skipped: true,
        reason: 'exhausted',
        message: expect.stringContaining('runtime errors')
      });
      expect(emitChunk).toHaveBeenCalledTimes(1);
      expect(emitChunk.mock.calls[0]![0]).toContain('runtime errors');
      expect(mocks.logger.warn).toHaveBeenCalledWith(
        'agent.runtime_errors.restart.persisted',
        expect.any(Object)
      );
      expect(mocks.logger.warn).toHaveBeenCalledWith(
        'agent.runtime_errors.exceeded',
        expect.any(Object)
      );
    });
  });

  describe('runtime phase — preview health check (no cycle established)', () => {
    it('returns continue with diagnostic when health check reports unhealthy', async () => {
      const { deps, mocks } = makeDeps({
        cycleEstablished: false,
        healthCheckPreview: async () => false,
      });
      const validator = createPostStreamValidator(deps);
      const result = await validator(makeArgs());
      expect(result).toMatchObject({
        continuationPrompt: expect.stringContaining('not responding'),
        message: expect.stringContaining('not responding')
      });
      expect(mocks.healthCheckPreview).toHaveBeenCalledWith(APP_ID);
      expect(mocks.logger.warn).toHaveBeenCalledWith(
        'agent.runtime_errors.pass.health_check_failed',
        expect.objectContaining({ appId: APP_ID, socketId: SOCKET_ID })
      );
      expect(mocks.rtCounters.get(SOCKET_ID)).toBe(1);
    });

    it('returns clean when health check reports healthy despite no cycle', async () => {
      const { deps, mocks } = makeDeps({
        cycleEstablished: false,
        healthCheckPreview: async () => true,
      });
      const validator = createPostStreamValidator(deps);
      const result = await validator(makeArgs());
      expect(result).toBeUndefined();
      expect(mocks.healthCheckPreview).toHaveBeenCalledWith(APP_ID);
      expect(mocks.logger.warn).not.toHaveBeenCalledWith(
        'agent.runtime_errors.pass.health_check_failed',
        expect.any(Object)
      );
    });

    it('treats a throwing health check as healthy (fail-open)', async () => {
      const { deps, mocks } = makeDeps({
        cycleEstablished: false,
        healthCheckPreview: async () => { throw new Error('ECONNREFUSED'); },
      });
      const validator = createPostStreamValidator(deps);
      const result = await validator(makeArgs());
      expect(result).toBeUndefined();
      expect(mocks.logger.warn).not.toHaveBeenCalledWith(
        'agent.runtime_errors.pass.health_check_failed',
        expect.any(Object)
      );
    });

    it('does not call health check when cycle IS established', async () => {
      const { deps, mocks } = makeDeps({
        cycleEstablished: true,
        healthCheckPreview: async () => false,
      });
      const validator = createPostStreamValidator(deps);
      const result = await validator(makeArgs());
      expect(result).toBeUndefined();
      expect(mocks.healthCheckPreview).not.toHaveBeenCalled();
    });

    it('returns exhausted when health check fails and retry budget is spent', async () => {
      const { deps, mocks } = makeDeps({
        cycleEstablished: false,
        healthCheckPreview: async () => false,
        rtRetryCount: 2,
        rtMaxRetries: 2,
      });
      const emitChunk = vi.fn(async (_text: string) => {});
      const validator = createPostStreamValidator(deps);
      const result = await validator(makeArgs({ emitChunk }));
      expect(result).toMatchObject({
        skipped: true,
        reason: 'exhausted',
        message: expect.stringContaining('not responding')
      });
      expect(emitChunk).toHaveBeenCalledTimes(1);
      expect(emitChunk.mock.calls[0]![0]).toContain('not responding');
    });
  });
});
