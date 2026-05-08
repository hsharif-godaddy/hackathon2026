import type { DOMSnapshot } from '../clients/dom-capture.js';
import type { CapturedSite } from '../clients/site-capture/types.js';

export type { DOMSnapshot };

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
}

export class TranscriptBuilder {
  private readonly _turns: Turn[] = [];
  private readonly _snapshots: DOMSnapshot[] = [];
  private readonly _errors: string[] = [];
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
    };
  }
}
