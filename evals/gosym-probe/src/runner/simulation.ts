import type { ResolvedConfig } from '../../config/index.js';
import type {
  AgentClient,
  AgentEvent,
} from '../clients/agent-client.js';
import type { SiteCapture } from '../clients/dom-capture.js';
import type { Scenario, SetupContext } from '../scenarios/types.js';
import { Agent } from 'undici';
import { GoalTracker } from './goal-tracker.js';
import type { SyntheticUserAgent } from './synthetic-user.js';
import type { Transcript, ToolCall, Turn } from './transcript.js';
import { TranscriptBuilder } from './transcript.js';

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
  return /\bAAB disconnected\b/.test(error)
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

  async run(trialIndex: number): Promise<Transcript> {
    const { scenario, config } = this.options;
    const builder = new TranscriptBuilder(scenario.name, trialIndex);
    const tracker = new GoalTracker(scenario.goals);
    // All scenarios share the global turn ceiling (default 30). Per-scenario
    // maxTurns was removed intentionally: sigmoid scoring makes budgets
    // unnecessary, and a uniform ceiling simplifies cross-scenario comparison.
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
      const url = setupResult.previewUrl as string;
      const fetchOptions: RequestInit = {
        signal: AbortSignal.timeout(5_000),
      };
      if (this.options.config.playwright.ignoreHttpsErrors) {
        (fetchOptions as RequestInit & { dispatcher: unknown }).dispatcher =
          new Agent({ connect: { rejectUnauthorized: false } }); // nosemgrep: problem-based-packs.insecure-transport.js-node.bypass-tls-verification.bypass-tls-verification
      }
      fetch(url, fetchOptions).catch(() => {});
    }

    return setupResult;
  }

  private async sendAndAwaitTurn(
    state: RunState,
    message: string,
    turnCount: number,
  ): Promise<string> {
    const { agentClient, config } = this.options;
    state.currentTurnTools.clear();
    state.inputDeltas.clear();
    state.lastStepContent = '';
    state.currentAgentId = undefined;
    state.lastTotalSteps = undefined;
    state.lastDurationMs = undefined;

    const turnTimeout = config.eval.turnTimeoutMs;
    const isFirstTurn = turnCount === 0;
    const inactivityMs = config.eval.firstTurnInactivityMs;

    const hardTimer = setTimeout(
      () => {
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
          () => state.rejectTurn?.(
            new InactivityTimeoutError(inactivityMs),
          ),
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
      builder.addError(
        `Capture failed (trial ${trialIndex}): ${msg}`,
      );
      // nosemgrep: javascript.lang.security.audit.unsafe-formatstring
      console.warn(
        '[Trial %d] Capture skipped: trial output dir failed:',
        trialIndex, err,
      );
      return;
    }

    try {
      const result = await captureContext.siteCapture.capture(
        setupResult ?? {},
        trialDir,
      );
      builder.addSnapshot(result.snapshot);
      builder.addCapturedSite(result.capturedSite);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      builder.addError(
        `Capture failed (trial ${trialIndex}): ${msg}`,
      );
      // nosemgrep: javascript.lang.security.audit.unsafe-formatstring
      console.warn(
        '[Trial %d] Capture skipped:',
        trialIndex, err,
      );
    }
  }
}
