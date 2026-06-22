import { describe, it, expect, beforeEach, vi } from 'vitest';

import { createPostStreamValidator } from '../post-stream-validator.js';
import type { TypecheckResult } from '../../services/typecheck-service.js';
import type { RuntimeErrorResult } from '../../services/runtime-error-service.js';
import type { RuleViolation } from '../../tools/content-rules-lint.js';

vi.mock('../../tools/content-rules-lint.js', () => ({
  checkContentRulesForFile: vi.fn(() => [])
}));

const contentSystemFlag = vi.hoisted(() => ({ enabled: true }));
vi.mock('../../profiles/profile-accessor.js', () => ({
  profileFlag: (key: string, defaultValue?: boolean) => {
    if (key === 'develop.contentSystem') return contentSystemFlag.enabled;
    return defaultValue ?? false;
  }
}));

const { checkContentRulesForFile: checkContentRulesForFileMock } = await import('../../tools/content-rules-lint.js') as {
  checkContentRulesForFile: ReturnType<typeof vi.fn>;
};

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
    emitChunk: vi.fn(async function (_text: string) {}),
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
  /** Content-rules: app path returned by resolveAppPath. null = app not found. */
  contentRulesAppPath?: string | null;
  crRetryCount?: number;
  crMaxRetries?: number;
} = {}) {
  const logger = { info: vi.fn(), warn: vi.fn() };
  const typecheckService = {
    runTypecheck: vi.fn(
      async function (_appId: string, _opts: unknown) { return overrides.typecheckResult ?? { ok: true, errors: [] }; }
    )
  };
  const previousCycleId = overrides.previousCycleId;
  const pollRuntimeErrors = vi.fn(
    async function (_appId: string, _opts: unknown) { return overrides.runtimeResult ?? { ok: true, errors: [] }; }
  );
  // Re-poll replaces the first-poll result on the next call. We wire
  // this via `mockImplementationOnce` in the restart tests rather than
  // here, but default the first/second calls to the same result so a
  // test that doesn't care about the re-poll shape still gets sane
  // behavior.
  if (overrides.rePollResult !== undefined) {
    pollRuntimeErrors.mockImplementationOnce(async function () { return overrides.runtimeResult ?? { ok: true, errors: [] }; });
    pollRuntimeErrors.mockImplementationOnce(async function () { return overrides.rePollResult!; });
  }
  const waitForCycleAdvance = vi.fn(
    async function (appId: string, prev: number | undefined, opts: { timeoutMs: number; signal?: AbortSignal }) { return overrides.waitForCycleAdvance
        ? overrides.waitForCycleAdvance(appId, prev, opts)
        : {
            advanced: true,
            newCycleId: (prev ?? 0) + 1,
            durationMs: 10
          }; }
  );
  const runtimeErrorService = {
    pollRuntimeErrors,
    // Default to `true` so existing tests (which assert clean/fail
    // behavior in isolation) don't fire the "no cycle established"
    // warning path. The dedicated observability test below overrides
    // this to `false`.
    hasCycleEstablished: vi.fn(function (_appId: string) { return overrides.cycleEstablished ?? true; }),
    getCurrentCycleId: vi.fn(function (_appId: string) { return previousCycleId; }),
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
    if (typeof override === 'boolean') return vi.fn(async function () { return override; });
    return vi.fn(async function () { return true; });
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
  const crCounters = new Map<string, number>();
  if (overrides.crRetryCount !== undefined) {
    crCounters.set(SOCKET_ID, overrides.crRetryCount);
  }
  const resolveAppPath = vi.fn(function (_appId: string) { return overrides.contentRulesAppPath ?? null; });
  return {
    deps: {
      typecheck: {
        typecheckService,
        retryCounters: tscCounters,
        maxRetries: overrides.tscMaxRetries ?? 2,
        logger
      },
      runtimeErrors: runtimeErrorsDeps,
      contentRules: {
        retryCounters: crCounters,
        maxRetries: overrides.crMaxRetries ?? 1,
        resolveAppPath,
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
      getCurrentCycleId: runtimeErrorService.getCurrentCycleId,
      waitForCycleAdvance: runtimeErrorService.waitForCycleAdvance,
      hasUncommittedChanges: hasUncommittedChangesFn,
      restartPreview: restartPreviewMock,
      healthCheckPreview: runtimeErrorsDeps.healthCheckPreview as ReturnType<typeof vi.fn> | undefined,
      resolveAppPath,
      tscCounters,
      rtCounters,
      crCounters
    }
  };
}

describe('createPostStreamValidator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    contentSystemFlag.enabled = true;
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
    // The SSE execution path skips calling this validator entirely when a
    // tool has already requested an auto-continuation, so the validator
    // itself does not (and must not) short-circuit on `__autoContinue`.
    // Documented here so nobody adds the guard back without also moving the
    // transport-side gate.
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

  it.each(['initial', 'initial-logo-designer'])('skips validation for %s agent before checking git state', async (agent) => {
    const { deps, mocks } = makeDeps({
      hasUncommittedChanges: async () => {
        throw new Error('git status should not run');
      }
    });
    const validator = createPostStreamValidator(deps);
    const emitValidationStart = vi.fn(async function () {});
    const result = await validator(makeArgs({
      agentName: agent,
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
    const emitValidationStart = vi.fn(async function () {});
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
    const emitValidationStart = vi.fn(async function () {});
    const result = await validator(makeArgs({ emitValidationStart }));
    expect(result).toBeUndefined();
    expect(emitValidationStart).toHaveBeenCalledTimes(1);
    expect(mocks.runTypecheck).toHaveBeenCalledTimes(1);
    expect(mocks.pollRuntimeErrors).toHaveBeenCalledTimes(1);
    // Non-stop-after dirty turn must NOT emit the ran_despite_stop_after log.
    expect(mocks.logger.warn).not.toHaveBeenCalledWith(
      'agent.post_stream_validator.ran_despite_stop_after',
      expect.anything()
    );
  });

  // ─── Combined stop-after + uncommitted-changes gate ───────────────────────
  // Bug repro: a turn that edits files and ends with a stop-after tool
  // (e.g. develop's end-of-build `askQuestion`) used to bypass validation
  // entirely because the transport's stop-after gate fired before the
  // validator's has-changes gate. The fix moves the stop-after check into
  // the validator so the two gates compose: skip iff (stop-after AND no
  // uncommitted changes). Tests below pin the four-quadrant truth table;
  // the failing one drives the implementation in step 2 of the plan.
  describe('combined gate: stop-after tools + uncommitted changes', () => {
    it('skips with reason "stop_after_no_changes" when last tool is stop-after AND tree is clean', async () => {
      const { deps, mocks } = makeDeps({ hasUncommittedChanges: false });
      const validator = createPostStreamValidator(deps);
      const emitValidationStart = vi.fn(async function () {});
      const result = await validator(
        makeArgs({
          emitValidationStart,
          toolCalls: [{ toolName: 'readFile' }, { toolName: 'askQuestion' }],
          stopAfterTools: ['askQuestion']
        })
      );
      expect(result).toEqual({ skipped: true, reason: 'stop_after_no_changes' });
      expect(mocks.runTypecheck).not.toHaveBeenCalled();
      expect(mocks.pollRuntimeErrors).not.toHaveBeenCalled();
      expect(emitValidationStart).not.toHaveBeenCalled();
    });

    it('runs both phases when last tool is stop-after AND tree has uncommitted edits', async () => {
      // The Rebu repro: agent edited files this turn, then asked a question.
      // Validation must still run so a parse error in the just-written file
      // surfaces as a continuation prompt rather than a blank preview.
      const { deps, mocks } = makeDeps({ hasUncommittedChanges: true });
      const validator = createPostStreamValidator(deps);
      const emitValidationStart = vi.fn(async function () {});
      const result = await validator(
        makeArgs({
          emitValidationStart,
          toolCalls: [
            { toolName: 'str_replace_based_edit_tool' },
            { toolName: 'askQuestion' }
          ],
          stopAfterTools: ['askQuestion']
        })
      );
      expect(result).toBeUndefined();
      expect(emitValidationStart).toHaveBeenCalledTimes(1);
      expect(mocks.runTypecheck).toHaveBeenCalledTimes(1);
      expect(mocks.pollRuntimeErrors).toHaveBeenCalledTimes(1);
      // Observability: fix path must emit the ran_despite_stop_after warn log.
      expect(mocks.logger.warn).toHaveBeenCalledWith(
        'agent.post_stream_validator.ran_despite_stop_after',
        expect.objectContaining({ lastTool: 'askQuestion' })
      );
    });

    it('still skips with reason "no_uncommitted_changes" when last tool is NOT stop-after AND tree is clean', async () => {
      // Regression guard: clean-tree skip path keeps its original reason
      // for read-only turns so existing log dashboards / metrics don't shift.
      const { deps, mocks } = makeDeps({ hasUncommittedChanges: false });
      const validator = createPostStreamValidator(deps);
      const result = await validator(
        makeArgs({
          toolCalls: [{ toolName: 'searchFiles' }, { toolName: 'readFile' }],
          stopAfterTools: ['askQuestion']
        })
      );
      expect(result).toEqual({ skipped: true, reason: 'no_uncommitted_changes' });
      expect(mocks.runTypecheck).not.toHaveBeenCalled();
      expect(mocks.pollRuntimeErrors).not.toHaveBeenCalled();
    });

    it('runs both phases when no stop-after tools are configured AND tree has uncommitted edits', async () => {
      // Regression guard: the new gate must not change behavior for agents
      // that don't declare `stopAfterTools` (e.g. internal/test agents).
      const { deps, mocks } = makeDeps({ hasUncommittedChanges: true });
      const validator = createPostStreamValidator(deps);
      const result = await validator(
        makeArgs({
          toolCalls: [{ toolName: 'str_replace_based_edit_tool' }],
          stopAfterTools: undefined
        })
      );
      expect(result).toBeUndefined();
      expect(mocks.runTypecheck).toHaveBeenCalledTimes(1);
      expect(mocks.pollRuntimeErrors).toHaveBeenCalledTimes(1);
    });

    // End-to-end (unit test variant):
    // Turn edits a .tsx file containing an unescaped apostrophe inside a
    // single-quoted string ('you're'), then ends with `askQuestion`.
    // Before the fix: transport gate short-circuited → validator never ran
    // → parse error reached the preview as a blank screen.
    // After the fix: validator runs, tsc returns the parse error, and
    // `createPostStreamValidator` returns a continuationPrompt so the agent
    // loop self-corrects before the user sees anything broken.
    it('returns a continuation prompt for a tsc parse error when the turn ended with askQuestion', async () => {
      const parseError = {
        file: 'src/pages/index.tsx',
        line: 42,
        column: 50,
        code: 'TS1002',
        message: "Unterminated string literal."
      };
      const { deps, mocks } = makeDeps({
        hasUncommittedChanges: true,
        typecheckResult: { ok: false, errors: [parseError] }
      });
      const validator = createPostStreamValidator(deps);
      const emitValidationStart = vi.fn(async function () {});

      const result = await validator(
        makeArgs({
          emitValidationStart,
          toolCalls: [
            { toolName: 'str_replace_based_edit_tool', args: { command: 'create', path: 'src/pages/index.tsx' } },
            { toolName: 'askQuestion', args: { question: 'What do you think of the design?' } }
          ],
          stopAfterTools: ['askQuestion']
        })
      );

      // Validator must have run (not skipped on stop-after).
      expect(emitValidationStart).toHaveBeenCalledTimes(1);
      expect(mocks.runTypecheck).toHaveBeenCalledTimes(1);

      // Parse error must surface as a continuation prompt so the agent loop
      // fixes it before the user's preview renders the broken page.
      expect(result).toMatchObject({
        continuationPrompt: expect.stringContaining('src/pages/index.tsx')
      });
      expect(result).toMatchObject({
        continuationPrompt: expect.stringContaining('TS1002')
      });
      expect(result).toMatchObject({
        continuationPrompt: expect.stringContaining('Unterminated string literal')
      });
    });
  });

  // ─── Auto restart-after-fix: HMR limbo recovery ──────────────────────────
  // Concrete production failure this guards against: file A has a parse
  // error; file B imports A; Vite drops B's HMR update because the dep
  // graph is broken. Validator continuation fixes A, but Vite never
  // retries B's dropped update, so the browser runs a stale B (e.g.
  // routes.tsx without the new /about route). A graceful preview restart
  // after the fix-then-clean iteration forces a fresh module load and
  // closes the HMR limbo.
  describe('auto restart-after-fix', () => {
    it('restarts the preview when phases come back clean AND tsc retry counter > 0', async () => {
      const restartPreview = vi.fn(async function () { return { success: true } });
      const { deps, mocks } = makeDeps({
        hasUncommittedChanges: true,
        tscRetryCount: 1,                              // prior iteration found tsc errors
        typecheckResult: { ok: true, errors: [] },     // this iteration is clean
        runtimeResult: { ok: true, errors: [] },
        restartPreview
      });
      const validator = createPostStreamValidator(deps);
      const result = await validator(makeArgs());
      expect(result).toBeUndefined();
      expect(restartPreview).toHaveBeenCalledTimes(1);
      expect(restartPreview).toHaveBeenCalledWith(APP_ID, expect.any(Object));
      expect(mocks.logger.info).toHaveBeenCalledWith(
        'agent.post_stream_validator.restart_after_fix.success',
        expect.objectContaining({ appId: APP_ID })
      );
    });

    it('restarts the preview when phases come back clean AND runtime retry counter > 0', async () => {
      const restartPreview = vi.fn(async function () { return { success: true } });
      const { deps } = makeDeps({
        hasUncommittedChanges: true,
        rtRetryCount: 1,                               // prior iteration found runtime errors
        typecheckResult: { ok: true, errors: [] },
        runtimeResult: { ok: true, errors: [] },
        restartPreview
      });
      const validator = createPostStreamValidator(deps);
      await validator(makeArgs());
      expect(restartPreview).toHaveBeenCalledTimes(1);
    });

    it('does NOT restart when phases come back clean AND no retries occurred this turn', async () => {
      // Plain happy path: agent edited files, no errors found, no fix needed.
      // No HMR limbo to recover from, so no restart cost should be paid.
      const restartPreview = vi.fn(async function () { return { success: true } });
      const { deps } = makeDeps({
        hasUncommittedChanges: true,
        typecheckResult: { ok: true, errors: [] },
        runtimeResult: { ok: true, errors: [] },
        restartPreview
      });
      const validator = createPostStreamValidator(deps);
      await validator(makeArgs());
      expect(restartPreview).not.toHaveBeenCalled();
    });

    it('does NOT restart when validator returns a continuation (errors still present)', async () => {
      // Mid-fix iteration: errors found, returning continuationPrompt.
      // The fix may still be in flight; restarting now would interrupt it.
      const restartPreview = vi.fn(async function () { return { success: true } });
      const { deps } = makeDeps({
        hasUncommittedChanges: true,
        typecheckResult: { ok: false, errors: [{ file: 'a.ts', line: 1, column: 1, code: 'TS1002', message: 'x' }] },
        restartPreview
      });
      const validator = createPostStreamValidator(deps);
      const result = await validator(makeArgs());
      expect(result).toMatchObject({ continuationPrompt: expect.any(String) });
      expect(restartPreview).not.toHaveBeenCalled();
    });

    it('logs "unavailable" warn and does NOT restart when restartPreview is not configured on deps', async () => {
      // Production always wires `restartPreview`; a missing callback means
      // a regression in `buildSharedPostStreamValidator` and HMR limbo
      // would silently linger. The validator must surface this so an
      // operator can attribute the gap.
      const { deps, mocks } = makeDeps({
        hasUncommittedChanges: true,
        tscRetryCount: 1,
        typecheckResult: { ok: true, errors: [] },
        runtimeResult: { ok: true, errors: [] }
        // no restartPreview override → deps.runtimeErrors.restartPreview is undefined
      });
      const validator = createPostStreamValidator(deps);
      const result = await validator(makeArgs());
      expect(result).toBeUndefined();
      expect(mocks.logger.warn).toHaveBeenCalledWith(
        'agent.post_stream_validator.restart_after_fix.unavailable',
        expect.objectContaining({
          appId: APP_ID,
          tscRetries: 1,
          reason: 'restartPreview_not_configured'
        })
      );
    });

    it('does NOT restart when the abort signal fires mid-flight (after phases, before restart check)', async () => {
      // Genuine coverage of the `!abortSignal.aborted` guard at the restart
      // condition. Aborting BEFORE invoke would short-circuit at the
      // top-level abort check and never reach this guard. Instead, abort
      // from inside a phase mock so both phases run normally with an
      // unaborted signal, then the signal is aborted before the composite's
      // post-phase restart-decision block.
      const restartPreview = vi.fn(async function () { return { success: true } });
      const ac = new AbortController();
      const { deps } = makeDeps({
        hasUncommittedChanges: true,
        tscRetryCount: 1,
        typecheckResult: { ok: true, errors: [] },
        runtimeResult: { ok: true, errors: [] },
        restartPreview
      });
      // Abort from inside the runTypecheck mock so the signal flips to
      // aborted while phases are running. Both phases still complete
      // (Promise.all preserves the originally-stubbed clean results).
      (deps.typecheck.typecheckService.runTypecheck as unknown as ReturnType<typeof vi.fn>)
        .mockImplementationOnce(async () => {
          ac.abort();
          return { ok: true, errors: [] };
        });
      const validator = createPostStreamValidator(deps);
      const result = await validator(makeArgs({ abortSignal: ac.signal }));
      expect(result).toBeUndefined();
      expect(restartPreview).not.toHaveBeenCalled();
    });

    it('does NOT double-restart when the runtime phase already restarted in-phase (alreadyRestartedDuringPhase)', async () => {
      // Stale-HMR recovery on the 2nd runtime-phase run already restarted
      // the preview when its re-poll resolved cleanly. The composite must
      // see `restartedDuringPhase: true` on the rtOutcome and suppress its
      // own auto-restart so the supervisor isn't kicked twice in a turn.
      //
      // Setup: rtRetryCount=1 + runtime errors present + clean re-poll →
      // runtime phase calls restartPreview once and returns
      // `{ kind: 'clean', restartedDuringPhase: true }`. Composite then
      // checks fixedErrorsThisChain (true) but should suppress the second
      // restart because of the in-phase flag.
      const restartPreview = vi.fn(async function () { return { success: true } });
      const runtimeErrors = [
        { name: 'TypeError', message: 'obj is undefined', timestamp: 1 }
      ];
      const { deps } = makeDeps({
        hasUncommittedChanges: true,
        rtRetryCount: 1,
        runtimeResult: { ok: false, errors: runtimeErrors },
        rePollResult: { ok: true, errors: [] },
        previousCycleId: 100,
        restartPreview,
        typecheckResult: { ok: true, errors: [] }
      });
      const validator = createPostStreamValidator(deps);
      const result = await validator(makeArgs());
      expect(result).toBeUndefined();
      // The runtime phase's in-phase restart fired exactly once; the
      // composite did NOT add a second.
      expect(restartPreview).toHaveBeenCalledTimes(1);
    });

    it('logs failure with reason="restart_unsuccessful" when restartPreview reports unsuccess', async () => {
      // Fail-open: the typecheck and runtime checks already passed; a
      // restart hiccup must not change the validator's return value. The
      // `reason: 'restart_unsuccessful'` discriminator separates supervisor-
      // declined restarts from thrown exceptions in Loki attribution and
      // matches the convention in `attemptRestartAndRepoll`.
      const restartPreview = vi.fn(async function () { return { success: false, error: 'supervisor unreachable' } });
      const { deps, mocks } = makeDeps({
        hasUncommittedChanges: true,
        tscRetryCount: 1,
        typecheckResult: { ok: true, errors: [] },
        runtimeResult: { ok: true, errors: [] },
        restartPreview
      });
      const validator = createPostStreamValidator(deps);
      const result = await validator(makeArgs());
      expect(result).toBeUndefined();
      expect(restartPreview).toHaveBeenCalledTimes(1);
      expect(mocks.logger.warn).toHaveBeenCalledWith(
        'agent.post_stream_validator.restart_after_fix.failed',
        expect.objectContaining({ reason: 'restart_unsuccessful', error: 'supervisor unreachable' })
      );
    });

    it('logs failure with reason="restart_threw" when restartPreview throws and still returns success', async () => {
      const restartPreview = vi.fn(async function () { throw new Error('boom') });
      const { deps, mocks } = makeDeps({
        hasUncommittedChanges: true,
        tscRetryCount: 1,
        typecheckResult: { ok: true, errors: [] },
        runtimeResult: { ok: true, errors: [] },
        restartPreview
      });
      const validator = createPostStreamValidator(deps);
      const result = await validator(makeArgs());
      expect(result).toBeUndefined();
      expect(mocks.logger.warn).toHaveBeenCalledWith(
        'agent.post_stream_validator.restart_after_fix.failed',
        expect.objectContaining({ reason: 'restart_threw', error: 'boom' })
      );
    });
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
    const emitChunk = vi.fn(async function (_text: string) {});
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
    const emitChunk = vi.fn(async function (_text: string) {});
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
    const emitChunk = vi.fn(async function (_text: string) {});
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
    const emitChunk = vi.fn(async function (_text: string) {});
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
        .mockImplementationOnce(async function () { return { ok: false, errors: runtimeErrors }; })
        .mockImplementationOnce(async function () {
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
      const emitChunk = vi.fn(async function (_text: string) {});
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
      const emitChunk = vi.fn(async function (_text: string) {});
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

  describe('content-rules phase', () => {
    const missedOpportunityViolation: RuleViolation = {
      rule: 'missed-content-opportunity',
      file: 'src/pages/index.tsx',
      message: 'page has 5 inline text strings but no import from "virtual:content".'
    };

    const pageEditToolCalls = [
      { toolName: 'str_replace_based_edit_tool', args: { path: 'src/pages/index.tsx' } }
    ];

    beforeEach(() => {
      checkContentRulesForFileMock.mockReset().mockReturnValue([]);
    });

    it('returns clean when resolveAppPath returns null (app not found)', async () => {
      const { deps } = makeDeps({ contentRulesAppPath: null });
      const validator = createPostStreamValidator(deps);
      const result = await validator(makeArgs());
      expect(result).toBeUndefined();
      expect(checkContentRulesForFileMock).not.toHaveBeenCalled();
    });

    it('skips the phase entirely when develop.contentSystem is OFF (default for all traffic)', async () => {
      contentSystemFlag.enabled = false;
      checkContentRulesForFileMock.mockReturnValue([missedOpportunityViolation]);
      const { deps } = makeDeps({ contentRulesAppPath: '/tmp/app' });
      const validator = createPostStreamValidator(deps);
      const result = await validator(makeArgs({ toolCalls: pageEditToolCalls }));
      expect(result).toBeUndefined();
      expect(checkContentRulesForFileMock).not.toHaveBeenCalled();
    });

    it('returns clean when no violations found', async () => {
      checkContentRulesForFileMock.mockReturnValue([]);
      const { deps, mocks } = makeDeps({ contentRulesAppPath: '/tmp/app' });
      const validator = createPostStreamValidator(deps);
      // readFile will fail (ENOENT) so checkContentRulesForFile won't be called —
      // violations stays empty, which resolves to clean.
      const result = await validator(makeArgs({ toolCalls: pageEditToolCalls }));
      expect(result).toBeUndefined();
      expect(mocks.logger.info).toHaveBeenCalledWith(
        'agent.content_rules.pass',
        expect.objectContaining({ appId: APP_ID })
      );
    });

    it('ignores non-actionable violations', async () => {
      checkContentRulesForFileMock.mockReturnValue([
        { rule: 'destructured-content-import', file: 'src/pages/index.tsx', message: 'destructured' }
      ]);
      const { deps } = makeDeps({ contentRulesAppPath: '/tmp/app' });
      const validator = createPostStreamValidator(deps);
      const result = await validator(makeArgs({ toolCalls: pageEditToolCalls }));
      expect(result).toBeUndefined();
    });

    it('continues with content-rules prompt when missed-content-opportunity violations found', async () => {
      checkContentRulesForFileMock.mockReturnValue([missedOpportunityViolation]);
      const { deps, mocks } = makeDeps({ contentRulesAppPath: '/tmp/app' });
      const validator = createPostStreamValidator(deps);
      // Write the file so readFile succeeds and the linter mock is invoked
      const tmpDir = '/tmp/app/src/pages';
      await import('node:fs/promises').then((f) => f.mkdir(tmpDir, { recursive: true }));
      await import('node:fs/promises').then((f) => f.writeFile(`${tmpDir}/index.tsx`, 'export default function Home() {}'));
      const result = await validator(makeArgs({ toolCalls: pageEditToolCalls }));
      expect(result).toMatchObject({
        continuationPrompt: expect.stringContaining('Content-layer violations'),
        message: expect.stringContaining('virtual:content')
      });
      expect(mocks.crCounters.get(SOCKET_ID)).toBe(1);
      expect(mocks.logger.info).toHaveBeenCalledWith(
        'agent.content_rules.retry.begin',
        expect.objectContaining({ retryCount: 1, violationCount: 1 })
      );
    });

    it('exhausts after the default 1-retry budget', async () => {
      checkContentRulesForFileMock.mockReturnValue([missedOpportunityViolation]);
      const { deps, mocks } = makeDeps({
        contentRulesAppPath: '/tmp/app',
        crRetryCount: 1,
        crMaxRetries: 1
      });
      const emitChunk = vi.fn(async function (_text: string) {});
      const validator = createPostStreamValidator(deps);
      const tmpDir = '/tmp/app/src/pages';
      await import('node:fs/promises').then((f) => f.mkdir(tmpDir, { recursive: true }));
      await import('node:fs/promises').then((f) => f.writeFile(`${tmpDir}/index.tsx`, 'export default function Home() {}'));
      const result = await validator(makeArgs({ toolCalls: pageEditToolCalls, emitChunk }));
      expect(result).toMatchObject({
        skipped: true,
        reason: 'exhausted',
        message: expect.stringContaining('inline text')
      });
      expect(emitChunk).toHaveBeenCalledTimes(1);
      expect(mocks.logger.warn).toHaveBeenCalledWith(
        'agent.content_rules.exceeded',
        expect.objectContaining({ appId: APP_ID, maxRetries: 1 })
      );
    });

    it('composes the content-rules continuation with typecheck errors', async () => {
      checkContentRulesForFileMock.mockReturnValue([missedOpportunityViolation]);
      const { deps } = makeDeps({
        contentRulesAppPath: '/tmp/app',
        typecheckResult: {
          ok: false,
          errors: [{ file: 'a.ts', line: 1, column: 1, code: 'TS1', message: 'boom' }]
        }
      });
      const validator = createPostStreamValidator(deps);
      const tmpDir = '/tmp/app/src/pages';
      await import('node:fs/promises').then((f) => f.mkdir(tmpDir, { recursive: true }));
      await import('node:fs/promises').then((f) => f.writeFile(`${tmpDir}/index.tsx`, 'export default function Home() {}'));
      const result = await validator(makeArgs({ toolCalls: pageEditToolCalls }));
      const prompt = (result as { continuationPrompt: string }).continuationPrompt;
      expect(prompt).toContain('TS1');
      expect(prompt).toContain('Content-layer violations');
    });

    it('returns clean when checkContentRulesForFile throws (non-fatal)', async () => {
      checkContentRulesForFileMock.mockImplementation(() => { throw new Error('fs permission denied'); });
      const { deps, mocks } = makeDeps({ contentRulesAppPath: '/tmp/app' });
      const validator = createPostStreamValidator(deps);
      const tmpDir = '/tmp/app/src/pages';
      await import('node:fs/promises').then((f) => f.mkdir(tmpDir, { recursive: true }));
      await import('node:fs/promises').then((f) => f.writeFile(`${tmpDir}/index.tsx`, 'export default function Home() {}'));
      const result = await validator(makeArgs({ toolCalls: pageEditToolCalls }));
      expect(result).toBeUndefined();
      expect(mocks.logger.warn).toHaveBeenCalledWith(
        'agent.content_rules.lint_error',
        expect.objectContaining({ error: 'fs permission denied' })
      );
    });

    it('continues on local-content-object violations', async () => {
      checkContentRulesForFileMock.mockReturnValue([{
        rule: 'local-content-object',
        file: 'src/pages/index.tsx',
        message: 'page extracts user-visible text into local object "home" instead of using the content layer'
      }]);
      const { deps, mocks } = makeDeps({ contentRulesAppPath: '/tmp/app' });
      const validator = createPostStreamValidator(deps);
      const tmpDir = '/tmp/app/src/pages';
      await import('node:fs/promises').then((f) => f.mkdir(tmpDir, { recursive: true }));
      await import('node:fs/promises').then((f) => f.writeFile(`${tmpDir}/index.tsx`, 'export default function Home() {}'));
      const result = await validator(makeArgs({ toolCalls: pageEditToolCalls }));
      expect(result).toMatchObject({
        continuationPrompt: expect.stringContaining('Content-layer violations')
      });
      expect(mocks.crCounters.get(SOCKET_ID)).toBe(1);
    });

    it('continues on direct-content-import violations', async () => {
      checkContentRulesForFileMock.mockReturnValue([{
        rule: 'direct-content-import',
        file: 'src/pages/index.tsx',
        message: 'page imports from "@/content" instead of "virtual:content"'
      }]);
      const { deps, mocks } = makeDeps({ contentRulesAppPath: '/tmp/app' });
      const validator = createPostStreamValidator(deps);
      const tmpDir = '/tmp/app/src/pages';
      await import('node:fs/promises').then((f) => f.mkdir(tmpDir, { recursive: true }));
      await import('node:fs/promises').then((f) => f.writeFile(`${tmpDir}/index.tsx`, 'export default function Home() {}'));
      const result = await validator(makeArgs({ toolCalls: pageEditToolCalls }));
      expect(result).toMatchObject({
        continuationPrompt: expect.stringContaining('Content-layer violations')
      });
      expect(mocks.crCounters.get(SOCKET_ID)).toBe(1);
    });

    it('skips the phase when there are no uncommitted changes', async () => {
      const { deps } = makeDeps({
        hasUncommittedChanges: false,
        contentRulesAppPath: '/tmp/app'
      });
      const validator = createPostStreamValidator(deps);
      await validator(makeArgs({ toolCalls: pageEditToolCalls }));
      expect(checkContentRulesForFileMock).not.toHaveBeenCalled();
    });

    // ─── Rollout-safety regression guards ───────────────────────────────────
    // Key invariant: only pages the agent actually touched this turn are linted.
    // Untouched pages (even if they have violations) must NEVER block the turn.

    it('returns clean when no page files were touched this turn', async () => {
      // Agent only called a non-page tool — content-rules linter must NOT fire.
      checkContentRulesForFileMock.mockReturnValue([{
        rule: 'missed-content-opportunity',
        file: 'src/pages/index.tsx',
        message: 'test'
      }]);
      const { deps } = makeDeps({ contentRulesAppPath: '/tmp/app' });
      const validator = createPostStreamValidator(deps);
      const result = await validator(makeArgs({
        toolCalls: [{ toolName: 'str_replace_based_edit_tool', args: { path: 'src/components/Button.tsx' } }]
      }));
      expect(result).toBeUndefined();
      expect(checkContentRulesForFileMock).not.toHaveBeenCalled();
    });

    it('lints only touched pages — other pages with violations are NOT scanned', async () => {
      // The agent touched about.tsx (clean); index.tsx and contact.tsx are NOT
      // in toolCalls. Even if those files have violations, they must not be scanned.
      checkContentRulesForFileMock.mockReturnValue([]);
      const { deps } = makeDeps({ contentRulesAppPath: '/tmp/app' });
      const validator = createPostStreamValidator(deps);
      // readFile will fail (ENOENT for about.tsx) — linter won't be called,
      // violations stays empty → clean. The key assertion is call count = 0.
      const result = await validator(makeArgs({
        toolCalls: [{ toolName: 'str_replace_based_edit_tool', args: { path: 'src/pages/about.tsx' } }]
      }));
      expect(result).toBeUndefined();
      // Linter called at most once — only for about.tsx, never for index/contact.
      expect(checkContentRulesForFileMock).not.toHaveBeenCalled();
    });

    it('returns continue when agent edited a page that HAS violations', async () => {
      const violation: RuleViolation = {
        rule: 'missed-content-opportunity',
        file: 'src/pages/home.tsx',
        message: 'page has 5 inline text strings but no import from "virtual:content".'
      };
      checkContentRulesForFileMock.mockReturnValue([violation]);
      const { deps } = makeDeps({ contentRulesAppPath: '/tmp/app' });
      const validator = createPostStreamValidator(deps);
      const tmpDir = '/tmp/app/src/pages';
      await import('node:fs/promises').then((f) => f.mkdir(tmpDir, { recursive: true }));
      await import('node:fs/promises').then((f) => f.writeFile(`${tmpDir}/home.tsx`, 'export default function Home() { return <div>hello</div>; }'));
      const result = await validator(makeArgs({
        toolCalls: [{ toolName: 'str_replace_based_edit_tool', args: { path: 'src/pages/home.tsx' } }]
      }));
      expect(result).toMatchObject({
        continuationPrompt: expect.stringContaining('Content-layer violations')
      });
    });
  });
});
