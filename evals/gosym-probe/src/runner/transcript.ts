import type { DOMSnapshot } from '../clients/dom-capture.js';

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
  errors: string[];
}

export class TranscriptBuilder {
  private readonly _turns: Turn[] = [];
  private readonly _snapshots: DOMSnapshot[] = [];
  private readonly _errors: string[] = [];

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

  addError(error: string): void {
    this._errors.push(error);
  }

  build(): Transcript {
    return {
      scenarioName: this.scenarioName,
      trialIndex: this.trialIndex,
      turns: [...this._turns],
      snapshots: [...this._snapshots],
      errors: [...this._errors],
    };
  }
}
