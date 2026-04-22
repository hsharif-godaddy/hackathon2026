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
  hasUncommittedChanges?: boolean | (() => Promise<boolean>);
  cycleEstablished?: boolean;
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
    ),
    // Default to `true` so existing tests (which assert clean/fail
    // behavior in isolation) don't fire the "no cycle established"
    // warning path. The dedicated observability test below overrides
    // this to `false`.
    hasCycleEstablished: vi.fn<[string], boolean>(() => overrides.cycleEstablished ?? true)
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
      hasCycleEstablished: runtimeErrorService.hasCycleEstablished,
      hasUncommittedChanges: hasUncommittedChangesFn,
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
});
