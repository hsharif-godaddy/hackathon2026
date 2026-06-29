import type { CaptureDiagnostics, DOMSnapshot } from '../clients/dom-capture.js';
import type { CapturedSite } from '../clients/site-capture/types.js';

export type { CaptureDiagnostics, DOMSnapshot };

export interface ToolCall {
  id: string;
  name: string;
  input?: unknown;
  output?: unknown;
  error?: string;
  startTime: number;
  endTime: number;
  agentId?: string;
}

/** Token/cost totals attributed to a single assistant turn. */
export interface TurnTokens {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokensRead: number;
  cachedInputTokensWrite: number;
  totalCost: number;
  /** Number of token_usage_summary events folded into this turn. */
  eventCount: number;
}

export interface Turn {
  role: 'user' | 'assistant';
  content: string;
  toolCalls: ToolCall[];
  timestamp: number;
  totalSteps?: number;
  durationMs?: number;
  /**
   * Per-turn token/cost totals, summed from the token_usage_summary events
   * (one per agent message-execution) that arrived while this turn was the
   * in-flight assistant turn. Present only when the AAB agent runs with
   * `SOCKET_DIAGNOSTICS=true`: the sole emission site
   * (agents MessageExecutionService) wraps token_usage_summary in that flag,
   * so with the flag off no events arrive
   * and this field stays absent. Lets a multi-turn trial isolate one turn's
   * cost (e.g. an increment turn vs a prior build turn). Also absent on legacy
   * transcripts and for clients that never emit token events. A variance run
   * that needs per-turn cost MUST set `SOCKET_DIAGNOSTICS=true`, or every
   * turn.tokens is silently empty.
   */
  tokens?: TurnTokens;
}

export interface Transcript {
  scenarioName: string;
  trialIndex: number;
  turns: Turn[];
  snapshots: DOMSnapshot[];
  capturedSite?: CapturedSite;
  errors: string[];
  /** Infrastructure failures from the capture path (Playwright timeouts, output dir errors).
   * Not counted as agent errors — kept separate so evaluators like bug-hit-rate are not polluted. */
  captureErrors: string[];
  /** Structured page-state diagnostics gathered when a capture fails
   * (HTTP status, page errors, network failures). Optional so existing
   * fixtures and baselines remain valid. */
  captureDiagnostics?: CaptureDiagnostics[];
  /** Number of retries before the trial succeeded (0 means first attempt). */
  retryCount?: number;
  /** Skills loaded at any point during the run (loads win over later
   * unloads — deriveLoadedSkills returns the union of everything ever
   * loaded), as reported by the agents-service `skill_diagnostics` socket
   * event (emitted only when SKILL_DIAGNOSTICS=true). Optional so existing
   * fixtures and baselines remain valid, and absent when instrumentation is
   * off — skill-selection treats absence as an 'unknown' skill-load verdict
   * rather than a pass/fail. */
  loadedSkills?: string[];
}

export class TranscriptBuilder {
  private readonly _turns: Turn[] = [];
  private readonly _snapshots: DOMSnapshot[] = [];
  private readonly _errors: string[] = [];
  private readonly _captureErrors: string[] = [];
  private readonly _captureDiagnostics: CaptureDiagnostics[] = [];
  private _capturedSite: CapturedSite | undefined;
  private _loadedSkills: string[] | undefined;

  constructor(
    private readonly scenarioName: string,
    private readonly trialIndex: number,
  ) {}

  addTurn(turn: Turn): void {
    this._turns.push(turn);
  }

  addSnapshot(snapshot: DOMSnapshot): void {
    this._snapshots.push(snapshot);
  }

  addCapturedSite(captured: CapturedSite): void {
    this._capturedSite = captured;
  }

  addError(error: string): void {
    this._errors.push(error);
  }

  addCaptureError(error: string): void {
    this._captureErrors.push(error);
  }

  addCaptureDiagnostics(diagnostics: CaptureDiagnostics): void {
    this._captureDiagnostics.push(diagnostics);
  }

  /** Record the skills active in the agent, as reported by the
   * agents-service `skill_diagnostics` event. No-op consumers (instrumentation
   * off) simply never call this, leaving loadedSkills absent. */
  setLoadedSkills(skills: string[]): void {
    this._loadedSkills = [...skills];
  }

  /** True when any agent error recorded so far looks like a rate-limit (429). */
  hasRateLimitError(): boolean {
    return this._errors.some((e) => /429|rate limit/i.test(e));
  }

  build(): Transcript {
    return {
      scenarioName: this.scenarioName,
      trialIndex: this.trialIndex,
      turns: [...this._turns],
      snapshots: [...this._snapshots],
      ...(this._capturedSite !== undefined && {
        capturedSite: this._capturedSite,
      }),
      errors: [...this._errors],
      captureErrors: [...this._captureErrors],
      ...(this._captureDiagnostics.length > 0 && {
        captureDiagnostics: [...this._captureDiagnostics],
      }),
      ...(this._loadedSkills !== undefined && {
        loadedSkills: [...this._loadedSkills],
      }),
    };
  }
}
