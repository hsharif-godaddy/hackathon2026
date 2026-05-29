export interface ProgressReporterOptions {
  /** Total trials expected across all scenarios. Must be > 0. */
  total: number;
  /** Per-scenario trial counts for "trial n/k" display. */
  scenarioTrialCounts: Map<string, number>;
  /** Output stream. Defaults to process.stderr. */
  stream?: NodeJS.WriteStream;
  /** Already-completed trials from a prior run. Clamped to [0, total]. Defaults to 0. */
  offset?: number;
}

const BAR_WIDTH = 20;
const FILLED = '\u2588';
const EMPTY = '\u2591';

export class ProgressReporter {
  private readonly total: number;
  private readonly scenarioTrialCounts: Map<string, number>;
  private readonly stream: NodeJS.WriteStream;
  private readonly isTTY: boolean;
  private readonly forcedPiped: boolean;
  private completed: number;
  private barRendered: boolean;
  private disabled: boolean;

  constructor(options: ProgressReporterOptions) {
    if (options.total <= 0) {
      throw new Error(
        `ProgressReporter: total must be > 0, got ${options.total}`,
      );
    }
    this.total = options.total;
    this.scenarioTrialCounts = options.scenarioTrialCounts;
    this.stream = options.stream ?? process.stderr;
    const realTTY = this.stream.isTTY ?? false;
    this.forcedPiped = !realTTY && process.env.FORCE_PROGRESS === '1';
    this.isTTY = realTTY || this.forcedPiped;
    this.completed = Math.min(Math.max(options.offset ?? 0, 0), options.total);
    this.barRendered = false;
    this.disabled = false;
    if (this.isTTY) {
      this.renderBar();
    }
  }

  trialCompleted(scenarioName: string, trialIndex: number): void {
    if (this.disabled) return;

    this.completed = Math.min(this.completed + 1, this.total);

    const scenarioTrials = this.scenarioTrialCounts.get(scenarioName) ?? '?';
    const message = `${scenarioName}: trial ${trialIndex + 1}/${scenarioTrials} complete\n`;

    if (this.forcedPiped) {
      this.write(message);
      this.renderBar();
    } else if (this.isTTY) {
      if (this.barRendered) {
        this.write('\r\x1B[K');
      }
      this.write(message);
      this.renderBar();
    } else {
      this.write(message);
    }
  }

  finish(): void {
    if (this.disabled) return;
    if (this.forcedPiped) {
      this.barRendered = false;
      return;
    }
    if (this.isTTY && this.barRendered) {
      this.write('\r\x1B[K');
      this.barRendered = false;
    }
  }

  private renderBar(): void {
    if (this.disabled) return;

    const clamped = Math.min(this.completed, this.total);
    const pct = Math.round((clamped / this.total) * 100);
    const filledCount = Math.round((clamped / this.total) * BAR_WIDTH);
    const emptyCount = BAR_WIDTH - filledCount;

    const bar = FILLED.repeat(filledCount) + EMPTY.repeat(emptyCount);
    if (this.forcedPiped) {
      this.write(`Progress: |${bar}| ${clamped}/${this.total}  ${pct}%\n`);
    } else {
      this.write(`Progress: |${bar}| ${clamped}/${this.total}  ${pct}%`);
    }
    if (!this.disabled) {
      this.barRendered = true;
    }
  }

  private write(text: string): void {
    if (this.disabled) return;
    try {
      this.stream.write(text);
    } catch {
      this.disabled = true;
    }
  }
}
