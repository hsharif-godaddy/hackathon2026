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

export interface Turn {
  role: 'user' | 'assistant';
  content: string;
  toolCalls: ToolCall[];
  timestamp: number;
  totalSteps?: number;
  durationMs?: number;
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
}

export class TranscriptBuilder {
  private readonly _turns: Turn[] = [];
  private readonly _snapshots: DOMSnapshot[] = [];
  private readonly _errors: string[] = [];
  private readonly _captureErrors: string[] = [];
  private readonly _captureDiagnostics: CaptureDiagnostics[] = [];
  private _capturedSite: CapturedSite | undefined;

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
    };
  }
}
