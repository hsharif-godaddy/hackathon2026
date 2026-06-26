import type { ResolvedConfig } from '../../config/index.js';
import type {
  AgentClient,
  AgentEvent,
} from '../clients/agent-client.js';
import { CaptureError, type SiteCapture } from '../clients/dom-capture.js';
import type { Scenario, SetupContext } from '../scenarios/types.js';
import { Agent, fetch } from 'undici';
import { GoalTracker } from './goal-tracker.js';
import type { SyntheticUserAgent } from './synthetic-user.js';
import type { Transcript, ToolCall, Turn } from './transcript.js';
import { TranscriptBuilder } from './transcript.js';
import type { DiagnosticLogFn } from './types.js';
import { classifyCaptureError } from '../clients/site-capture/timeout-class.js';
import { warnLine } from '../util/warn-line.js';

export class FatalAABError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FatalAABError';
  }
}

export class InactivityTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(
      `Turn 1 inactivity timeout: no events received within ${timeoutMs}ms window`,
    );
    this.name = 'InactivityTimeoutError';
  }
}

export class InactivityGuard {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;

  constructor(
    private readonly timeoutMs: number,
    private readonly onTimeout: () => void,
  ) {}

  arm(): void {
    if (this.disposed) return;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.onTimeout(), this.timeoutMs);
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }
}

export function isFatalError(error: string): boolean {
  // The SSE client surfaces a dead transport as `AAB stream error[: detail]`
  // (the prior Socket.IO `AAB disconnected` string is never emitted now), so
  // match that to abort immediately instead of waiting out the turn timeout.
  return /\bAAB stream error\b/.test(error)
    || /\bunauthorized\b/i.test(error)
    || /\bS2S token\b/i.test(error);
}

/**
 * Pairs `SiteCapture` with the trial-directory resolver it needs.
 * Both fields are required together — providing one without the
 * other is invalid, hence they live in a single value rather than
 * two separate optional fields.
 */
export interface SimulationCaptureContext {
  siteCapture: SiteCapture;
  getTrialOutputDir: (trialIndex: number) => Promise<string>;
}

export interface SimulationOptions {
  scenario: Scenario;
  agentClient: AgentClient;
  syntheticUser: SyntheticUserAgent;
  /**
   * When provided, captures the preview-app DOM snapshot and
   * per-route screenshots after the agent loop completes and
   * writes artifacts to the resolved trial directory.
   */
  captureContext?: SimulationCaptureContext;
  config: ResolvedConfig;
  maxTurnsOverride?: number;
  firstTurnInactivityMsOverride?: number;
  /**
   * Fires after the conversation loop completes, before capture begins.
   * Awaited so the caller can flush conversation data to disk before the
   * 90-second capture window starts. Must not throw; SuiteRunner
   * guarantees this for the standard wiring by wrapping in try/catch.
   * Receives the setup context so callers can use per-trial resources
   * (e.g. previewUrl) while the app is still alive.
   */
  onConversationComplete?: (
    trialIndex: number,
    partialTranscript: Transcript,
    setupContext: SetupContext,
  ) => Promise<void>;
  /**
   * When true, capture diagnostic events (capture.conversation.complete,
   * capture.phase.complete, capture.phase.failed, capture.turn.timeout)
   * are emitted. When false or absent, they are suppressed entirely.
   */
  verbose?: boolean;
  /**
   * Bar-aware log callback. When verbose is true, capture diagnostics are
   * emitted via this callback if provided, otherwise via warnLine.
   * Signature matches warnLine so the two are interchangeable.
   */
  log?: DiagnosticLogFn;
}

interface RunState {
  resolveTurn: ((content: string) => void) | null;
  rejectTurn: ((error: Error) => void) | null;
  inactivityGuard: InactivityGuard | null;
  currentTurnTools: Map<string, ToolCall>;
  inputDeltas: Map<string, string>;
  lastStepContent: string;
  currentAgentId: string | undefined;
  lastTotalSteps: number | undefined;
  lastDurationMs: number | undefined;
}

export class Simulation {
  constructor(private readonly options: SimulationOptions) {}

  /**
   * Emits a capture diagnostic event when verbose mode is on.
   * Routes to the caller-supplied log callback first, falling back to warnLine.
   * No-ops when verbose is false or absent.
   */
  private captureLog(msg: string, data?: Record<string, unknown>): void {
    if (!this.options.verbose) return;
    const emit = this.options.log ?? warnLine;
    emit(msg, data);
  }

  async run(trialIndex: number): Promise<Transcript> {
    const { scenario, config } = this.options;
    const builder = new TranscriptBuilder(scenario.name, trialIndex);
    const tracker = new GoalTracker(scenario.goals);
    // All scenarios share the global turn ceiling (default 30). Per-scenario
    // maxTurns was removed intentionally: a uniform ceiling simplifies
    // cross-scenario comparison.
    const maxTurns = this.options.maxTurnsOverride ?? config.eval.maxTurns;
    const history: Turn[] = [];

    const state: RunState = {
      resolveTurn: null,
      rejectTurn: null,
      inactivityGuard: null,
      currentTurnTools: new Map(),
      inputDeltas: new Map(),
      lastStepContent: '',
      currentAgentId: undefined,
      lastTotalSteps: undefined,
      lastDurationMs: undefined,
    };

    this.options.agentClient.onMessage(
      this.createEventHandler(state, builder, trialIndex),
    );

    let setupResult: SetupContext | void = undefined;
    try {
      setupResult = await this.runSetup(trialIndex);
      const conversationStartMs = Date.now();
      let assistantTurnCount = 0;
      while (assistantTurnCount < maxTurns) {
        const activeGoal = tracker.nextGoal();
        const activeIndex = activeGoal
          ? scenario.goals.indexOf(activeGoal)
          : -1;

        const message = await this.options.syntheticUser.nextMessage(
          history, scenario, tracker,
        );
        if (message === null) break;

        if (activeIndex >= 0) {
          tracker.markRequested(activeIndex);
        }

        const userTurn: Turn = {
          role: 'user',
          content: message,
          toolCalls: [],
          timestamp: Date.now(),
        };
        builder.addTurn(userTurn);
        history.push(userTurn);

        let content: string;
        try {
          content = await this.sendAndAwaitTurn(
            state, message, assistantTurnCount,
          );
        } catch (err) {
          if (err instanceof FatalAABError) break;
          throw err;
        }

        const assistantTurn: Turn = {
          role: 'assistant',
          content,
          toolCalls: Array.from(
            state.currentTurnTools.values(),
          ),
          timestamp: Date.now(),
          totalSteps: state.lastTotalSteps,
          durationMs: state.lastDurationMs,
        };
        builder.addTurn(assistantTurn);
        history.push(assistantTurn);

        assistantTurnCount++;
      }

      this.captureLog('capture.conversation.complete', {
        scenario: scenario.name,
        trialIndex,
        conversationMs: Date.now() - conversationStartMs,
        turns: assistantTurnCount,
      });

      if (this.options.onConversationComplete) {
        await this.options.onConversationComplete(trialIndex, builder.build(), setupResult ?? {});
      }

      await this.runCapture(trialIndex, setupResult, builder);
    } finally {
      try {
        await scenario.teardown?.(setupResult ?? {});
      } catch (teardownErr) {
        const msg = teardownErr instanceof Error
          ? teardownErr.message
          : String(teardownErr);
        builder.addError(
          `[${scenario.name}] teardown failed (trial ${trialIndex}): ${msg}`,
        );
        // nosemgrep: javascript.lang.security.audit.unsafe-formatstring
        console.error(
          '[%s] teardown failed (trial %d):',
          scenario.name, trialIndex, teardownErr,
        );
      }
    }

    return builder.build();
  }

  private createEventHandler(
    state: RunState,
    builder: TranscriptBuilder,
    trialIndex: number,
  ): (event: AgentEvent) => void {
    return (event) => {
      state.inactivityGuard?.arm();
      if (event.type === 'step_start') {
        state.currentAgentId = event.agentName;
      } else if (event.type === 'tool_start') {
        state.currentTurnTools.set(event.tool.id, {
          id: event.tool.id,
          name: event.tool.name,
          input: event.tool.input,
          startTime: Date.now(),
          endTime: 0,
          agentId: state.currentAgentId,
        });
      } else if (event.type === 'tool_input_delta') {
        const prev = state.inputDeltas.get(event.tool.id) ?? '';
        state.inputDeltas.set(event.tool.id, prev + event.delta);
      } else if (event.type === 'tool_result') {
        const accumulated = state.inputDeltas.get(event.tool.id);
        state.inputDeltas.delete(event.tool.id);
        const tool = state.currentTurnTools.get(event.tool.id);
        if (tool) {
          if (accumulated !== undefined) {
            try {
              tool.input = JSON.parse(accumulated) as unknown;
            } catch {
              console.warn(
                `[Trial ${trialIndex}] Malformed tool_input_delta ` +
                `JSON for tool ${event.tool.id}. ` +
                `Keeping tool_start input.`,
              );
            }
          }
          tool.output = event.tool.output;
          tool.error = event.tool.error;
          tool.endTime = Date.now();
        }
      } else if (event.type === 'error') {
        if (/429|rate limit/i.test(event.error)) {
          // Log a sanitized message — do not include event.error
          // which may contain tokens or other sensitive API
          // response content.
          console.warn(
            `[Trial ${trialIndex}] GoCode rate-limit error. ` +
            `Lower eval.maxConcurrency to reduce ` +
            `concurrent requests.`,
          );
        }
        builder.addError(event.error);
        if (isFatalError(event.error)) {
          state.rejectTurn?.(
            new FatalAABError(event.error),
          );
        }
      } else if (event.type === 'step_complete') {
        state.lastStepContent = event.content;
      } else if (event.type === 'complete') {
        let content = event.content || state.lastStepContent;
        if (!content && event.data?.commitHash) {
          const hash = event.data.commitHash as string;
          const agent =
            (event.data.agentId as string | undefined) ?? 'develop';
          content =
            `[Build complete by ${agent} — commit ${hash}]`;
        }
        const steps = event.data?.totalSteps as number | undefined;
        if (Number.isFinite(steps)) {
          state.lastTotalSteps = steps;
        }
        const durStr = event.data?.duration as string | undefined;
        if (durStr) {
          const parsed = parseInt(durStr, 10);
          if (Number.isFinite(parsed)) {
            state.lastDurationMs = parsed;
          }
        }
        state.resolveTurn?.(content);
      }
    };
  }

  private async runSetup(
    trialIndex: number,
  ): Promise<SetupContext | void> {
    const { scenario, agentClient, captureContext } = this.options;
    let setupResult: SetupContext | void;
    try {
      setupResult = await scenario.setup?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `[${scenario.name}] setup failed on trial ${trialIndex}: ${msg}`,
      );
    }

    agentClient.configure(setupResult ?? {});

    // Pre-warm the preview URL so Vite is already running when the
    // snapshot fires. Fire-and-forget — errors are intentionally
    // swallowed since a failed pre-warm is not fatal.
    if (
      captureContext &&
      typeof setupResult?.previewUrl === 'string'
    ) {
      fetch(setupResult.previewUrl, {
        signal: AbortSignal.timeout(5_000),
        dispatcher: this.options.config.playwright.ignoreHttpsErrors
          ? new Agent({ connect: { rejectUnauthorized: false } }) // nosemgrep: problem-based-packs.insecure-transport.js-node.bypass-tls-verification.bypass-tls-verification
          : undefined,
      }).catch(() => {});
    }

    return setupResult;
  }

  private async sendAndAwaitTurn(
    state: RunState,
    message: string,
    turnCount: number,
  ): Promise<string> {
    if (state.resolveTurn) {
      throw new Error('sendAndAwaitTurn called while a previous turn is still pending');
    }
    const { agentClient, config } = this.options;
    state.currentTurnTools.clear();
    state.inputDeltas.clear();
    state.lastStepContent = '';
    state.currentAgentId = undefined;
    state.lastTotalSteps = undefined;
    state.lastDurationMs = undefined;

    const turnTimeout = config.eval.turnTimeoutMs;
    const isFirstTurn = turnCount === 0;
    const inactivityMs =
      this.options.firstTurnInactivityMsOverride
      ?? config.eval.firstTurnInactivityMs;

    const { scenario } = this.options;
    const hardTimer = setTimeout(
      () => {
        this.captureLog('capture.turn.timeout', {
          scenario: scenario.name,
          turnCount: turnCount + 1,
          kind: 'hard',
          turnTimeoutMs: turnTimeout,
        });
        state.rejectTurn?.(
          new Error(
            `Turn ${turnCount + 1} timed out ` +
            `after ${turnTimeout}ms`,
          ),
        );
      },
      turnTimeout,
    );

    const content = await new Promise<string>((resolve, reject) => {
      state.resolveTurn = resolve;
      state.rejectTurn = reject;
      if (isFirstTurn) {
        const guard = new InactivityGuard(
          inactivityMs,
          () => {
            this.captureLog('capture.turn.timeout', {
              scenario: scenario.name,
              turnCount: turnCount + 1,
              kind: 'inactivity',
              inactivityMs,
            });
            state.rejectTurn?.(
              new InactivityTimeoutError(inactivityMs),
            );
          },
        );
        state.inactivityGuard = guard;
      }
      agentClient.send(message);
      if (isFirstTurn) state.inactivityGuard?.arm();
    }).finally(() => {
      clearTimeout(hardTimer);
      state.inactivityGuard?.dispose();
      state.inactivityGuard = null;
    });
    state.resolveTurn = null;
    state.rejectTurn = null;
    return content;
  }

  private async runCapture(
    trialIndex: number,
    setupResult: SetupContext | void,
    builder: TranscriptBuilder,
  ): Promise<void> {
    const { captureContext } = this.options;
    if (!captureContext) return;

    let trialDir: string;
    try {
      trialDir = await captureContext.getTrialOutputDir(trialIndex);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      builder.addCaptureError(
        `Capture failed (trial ${trialIndex}): ${msg}`,
      );
      // nosemgrep: javascript.lang.security.audit.unsafe-formatstring
      console.warn(
        '[Trial %d] Capture skipped: trial output dir failed:',
        trialIndex, err,
      );
      return;
    }

    const captureStartMs = Date.now();
    try {
      const result = await captureContext.siteCapture.capture(
        setupResult ?? {},
        trialDir,
      );
      builder.addSnapshot(result.snapshot);
      builder.addCapturedSite(result.capturedSite);
      this.captureLog('capture.phase.complete', {
        scenario: this.options.scenario.name,
        trialIndex,
        captureMs: Date.now() - captureStartMs,
        routes: result.capturedSite?.routes?.length ?? 0,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);

      // Correlate with rate-limiting: either a 429/Retry-After response was
      // observed during capture, or the agent already recorded a 429 error
      // upstream (capture itself makes no LLM calls). When either is true the
      // empty/erroring page is most likely a downstream symptom of throttling.
      const captureSawRateLimit =
        err instanceof CaptureError
        && err.diagnostics.networkFailures.some((f) => f.isRateLimit);
      const likelyRateLimited = captureSawRateLimit || builder.hasRateLimitError();
      const note = likelyRateLimited
        ? ' (likely rate-limited — see transcript errors / Retry-After)'
        : '';

      builder.addCaptureError(
        `Capture failed (trial ${trialIndex}): ${msg}${note}`,
      );
      if (err instanceof CaptureError) {
        builder.addCaptureDiagnostics(err.diagnostics);
      }
      this.captureLog('capture.phase.failed', {
        scenario: this.options.scenario.name,
        trialIndex,
        captureMs: Date.now() - captureStartMs,
        timeoutClass: classifyCaptureError(err),
        likelyRateLimited,
      });
      if (likelyRateLimited) {
        // Sanitized — do not log raw page/response bodies, which may contain
        // tokens or other sensitive content (mirrors the 429 handler above).
        console.warn(
          `[Trial ${trialIndex}] Capture likely rate-limited. ` +
          `Lower eval.maxConcurrency to reduce concurrent requests.`,
        );
      }
      // nosemgrep: javascript.lang.security.audit.unsafe-formatstring
      console.warn(
        '[Trial %d] Capture skipped:',
        trialIndex, err,
      );
    }
  }
}
