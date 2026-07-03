/**
 * Measures chunk-level stream latency for AAB agent responses.
 *
 * Probe-side: hooks into AABClient SSE events to record
 * time-to-first-chunk (TTFC) and inter-chunk gaps per trial.
 *
 * AAB-side diagnostics: when `SOCKET_DIAGNOSTICS=true` is set in
 * AAB's `agents/.env`, AAB emits `stream_timing_summary`,
 * `stream_chunk_slow_gap`, and `stream_chunk_timeout` as standalone
 * SSE events. These are captured here and surfaced in
 * `details.aabDiagnostics`. The timing summary breaks the probe's
 * end-to-end TTFC into two components:
 *   - `timeToStreamStartMs`: agent init time before the LLM call
 *   - `timeToFirstTextChunkMs`: LLM time to first text chunk
 *     from AAB's perspective
 * Both appear in the eval reason string as `aabInit` and
 * `aabTTFC`.
 */
import type { EvalResult, Evaluator } from './evaluator.js';
import type {
  DOMSnapshot,
  Transcript,
  Turn,
} from '../runner/transcript.js';
import type { Scenario } from '../scenarios/types.js';
import type {
  AgentClient,
} from '../clients/agent-client.js';
import { median } from '../util/median.js';

// -------------------------------------------------------
// Internal types for chunk-timing collection
// -------------------------------------------------------

interface TurnTiming {
  turnIndex: number;
  firstChunkTime: number | null;
  chunkTimes: number[];
}

interface TrialTiming {
  completedTurns: TurnTiming[];
  activeTurn: TurnTiming;
  nextTurnIndex: number;
}

interface StreamTimingSummary {
  turnIndex: number;
  timeToStreamStartMs: number;
  timeToFirstTextChunkMs: number | null;
  maxChunkGapMs: number;
  chunksRead: number;
  streamDurationMs: number;
}

interface SlowGapEvent {
  turnIndex: number;
  gapMs: number;
  chunksRead: number;
  streamElapsedMs: number;
}

interface TimeoutEvent {
  turnIndex: number;
  chunksRead: number;
  streamElapsedMs: number;
  timeToFirstTextChunkMs: number;
  maxChunkGapMs: number;
}

interface TrialDiagnostics {
  timingSummaries: StreamTimingSummary[];
  slowGaps: SlowGapEvent[];
  timeouts: TimeoutEvent[];
}

interface CollectedTrial {
  timing: TrialTiming;
  diagnostics: TrialDiagnostics;
}

// -------------------------------------------------------
// ChunkTimingCollector: side-effectful event accumulation
// -------------------------------------------------------

/**
 * Registers per-trial event listeners on an AgentClient
 * and accumulates chunk timestamps and AAB diagnostic
 * events. Separates stateful event collection from
 * stateless metric computation in LatencyEvaluator.
 */
class ChunkTimingCollector {
  private readonly timings =
    new Map<number, TrialTiming>();
  private readonly diagnostics =
    new Map<number, TrialDiagnostics>();

  /**
   * Register event listeners on the client for the given
   * trial. Throws if the trial is already hooked.
   */
  hook(
    client: AgentClient,
    trialIndex: number,
  ): void {
    if (this.timings.has(trialIndex)) {
      throw new Error(
        `hookClient already called for trial` +
          ` ${trialIndex}`,
      );
    }

    const timing: TrialTiming = {
      completedTurns: [],
      activeTurn: {
        turnIndex: 0,
        firstChunkTime: null,
        chunkTimes: [],
      },
      nextTurnIndex: 1,
    };
    this.timings.set(trialIndex, timing);

    const diag: TrialDiagnostics = {
      timingSummaries: [],
      slowGaps: [],
      timeouts: [],
    };
    this.diagnostics.set(trialIndex, diag);

    client.onMessage((event) => {
      if (event.type === 'chunk') {
        const now = Date.now();
        const turn = timing.activeTurn;
        if (turn.firstChunkTime === null) {
          turn.firstChunkTime = now;
        }
        turn.chunkTimes.push(now);
      } else if (event.type === 'complete') {
        if (
          timing.activeTurn.chunkTimes.length > 0
        ) {
          timing.completedTurns.push(
            timing.activeTurn,
          );
        }
        timing.activeTurn = {
          turnIndex: timing.nextTurnIndex++,
          firstChunkTime: null,
          chunkTimes: [],
        };
      } else if (
        event.type === 'stream_timing_summary'
      ) {
        diag.timingSummaries.push({
          turnIndex: timing.activeTurn.turnIndex,
          timeToStreamStartMs:
            event.timeToStreamStartMs,
          timeToFirstTextChunkMs:
            event.timeToFirstTextChunkMs,
          maxChunkGapMs: event.maxChunkGapMs,
          chunksRead: event.chunksRead,
          streamDurationMs: event.streamDurationMs,
        });
      } else if (
        event.type === 'stream_chunk_slow_gap'
      ) {
        diag.slowGaps.push({
          turnIndex: timing.activeTurn.turnIndex,
          gapMs: event.gapMs,
          chunksRead: event.chunksRead,
          streamElapsedMs: event.streamElapsedMs,
        });
      } else if (
        event.type === 'stream_chunk_timeout'
      ) {
        diag.timeouts.push({
          turnIndex: timing.activeTurn.turnIndex,
          chunksRead: event.chunksRead,
          streamElapsedMs: event.streamElapsedMs,
          timeToFirstTextChunkMs:
            event.timeToFirstTextChunkMs,
          maxChunkGapMs: event.maxChunkGapMs,
        });
      }
    });
  }

  /**
   * Retrieve and remove collected data for a trial.
   * Returns null when no timing was registered (e.g.
   * hookClient was never called for this trial).
   */
  collect(
    trialIndex: number,
  ): CollectedTrial | null {
    const timing = this.timings.get(trialIndex);
    const diagnostics = this.diagnostics.get(
      trialIndex,
    ) ?? {
      timingSummaries: [],
      slowGaps: [],
      timeouts: [],
    };

    this.timings.delete(trialIndex);
    this.diagnostics.delete(trialIndex);

    if (!timing) return null;
    return { timing, diagnostics };
  }

  /**
   * Idempotent cleanup. No-op when collect() or a
   * previous unhook() already removed the entries.
   */
  unhook(trialIndex: number): void {
    this.timings.delete(trialIndex);
    this.diagnostics.delete(trialIndex);
  }
}

// -------------------------------------------------------
// LatencyEvaluator: metric computation and formatting
// -------------------------------------------------------

interface PerTurnMetrics {
  turnIndex: number;
  timeToFirstChunkMs: number | null;
  maxInterChunkGapMs: number;
  totalTurnMs: number | null;
  chunkCount: number;
}

function maxGapMs(times: number[]): number {
  let max = 0;
  for (let i = 1; i < times.length; i++) {
    const gap = times[i] - times[i - 1];
    if (gap > max) max = gap;
  }
  return max;
}

export class LatencyEvaluator implements Evaluator {
  readonly name = 'latency';
  readonly comparisonMode = 'score' as const;

  private readonly collector =
    new ChunkTimingCollector();
  private readonly halfLifeMs: number;

  constructor(options?: { halfLifeMs?: number }) {
    this.halfLifeMs = options?.halfLifeMs ?? 4000;
    if (!Number.isFinite(this.halfLifeMs) || this.halfLifeMs <= 0) {
      throw new Error(
        'halfLifeMs must be a finite positive number',
      );
    }
  }

  /**
   * Register a chunk-timing hook on the client for this
   * trial. Called by SuiteRunner before each simulation.
   */
  hookClient(
    client: AgentClient,
    trialIndex: number,
  ): void {
    this.collector.hook(client, trialIndex);
  }

  /**
   * Idempotent cleanup for a trial's collected data.
   * Called by SuiteRunner after each trial completes or
   * crashes. No-op when evaluate() already consumed the
   * data.
   */
  unhookTrial(trialIndex: number): void {
    this.collector.unhook(trialIndex);
  }

  evaluate(
    transcript: Transcript,
    _scenario: Scenario,
    _snapshot?: DOMSnapshot,
  ): Promise<EvalResult> {
    const collected = this.collector.collect(
      transcript.trialIndex,
    );

    if (!collected) {
      return Promise.resolve({
        evaluator: this.name,
        score: 0,
        verdict: 'incomplete',
        reason: 'No chunk events captured',
        details: {
          totalMs: null,
          chunkCount: 0,
          aabDiagnostics: {
            timingSummaries: [],
            slowGaps: [],
            timeouts: [],
          },
        },
      });
    }

    const { timing, diagnostics: diag } = collected;

    // Include activeTurn if it has data (conversation
    // ended without a final complete event).
    const allTurns =
      timing.activeTurn.chunkTimes.length > 0
        ? [
            ...timing.completedTurns,
            timing.activeTurn,
          ]
        : timing.completedTurns;

    const totalChunks = allTurns.reduce(
      (sum, t) => sum + t.chunkTimes.length,
      0,
    );

    if (totalChunks === 0) {
      return Promise.resolve({
        evaluator: this.name,
        score: 0,
        verdict: 'incomplete',
        reason: 'No chunk events captured',
        details: {
          totalMs: null,
          chunkCount: 0,
          aabDiagnostics: diag,
        },
      });
    }

    const perTurn = this.buildPerTurnMetrics(
      allTurns,
      transcript,
    );

    const firstTurnTTFC =
      perTurn[0]?.timeToFirstChunkMs ?? null;
    const maxGapAcrossTurns = Math.max(
      ...perTurn.map((t) => t.maxInterChunkGapMs),
    );

    const totalMs = this.conversationSpanMs(
      transcript,
    );

    const medianTTFC =
      this.computeMedianTTFC(perTurn);

    const { score, verdict } =
      medianTTFC !== null
        ? {
            score: Math.min(
              1,
              Math.max(
                0,
                Math.pow(
                  2,
                  -medianTTFC / this.halfLifeMs,
                ),
              ),
            ),
            verdict: 'directional' as const,
          }
        : { score: 0, verdict: 'incomplete' as const };

    const reason = this.buildReason(
      firstTurnTTFC,
      maxGapAcrossTurns,
      totalMs,
      totalChunks,
      perTurn.length,
      diag,
      score,
      medianTTFC,
    );

    return Promise.resolve({
      evaluator: this.name,
      score,
      verdict,
      reason,
      details: {
        timeToFirstChunkMs: firstTurnTTFC,
        maxInterChunkGapMs: maxGapAcrossTurns,
        totalMs,
        chunkCount: totalChunks,
        perTurn,
        medianTTFC,
        halfLifeMs: this.halfLifeMs,
        aabDiagnostics: diag,
      },
    });
  }

  private conversationSpanMs(
    transcript: Transcript,
  ): number | null {
    const firstUser = transcript.turns.find(
      (t) => t.role === 'user',
    );
    const lastAssistant = [...transcript.turns]
      .reverse()
      .find((t) => t.role === 'assistant');
    return firstUser && lastAssistant
      ? lastAssistant.timestamp -
          firstUser.timestamp
      : null;
  }

  private buildReason(
    firstTurnTTFC: number | null,
    maxGapAcrossTurns: number,
    totalMs: number | null,
    totalChunks: number,
    turnCount: number,
    diag: TrialDiagnostics,
    score: number,
    medianTTFC: number | null,
  ): string {
    const firstTextIdx =
      diag.timingSummaries.findIndex(
        (s) => s.timeToFirstTextChunkMs !== null,
      );
    const firstTextSummary =
      firstTextIdx >= 0
        ? diag.timingSummaries[firstTextIdx]
        : null;

    let worstGapIdx = -1;
    let worstGapVal = -1;
    for (
      let i = 0;
      i < diag.timingSummaries.length;
      i++
    ) {
      const gap =
        diag.timingSummaries[i].maxChunkGapMs;
      if (gap > worstGapVal) {
        worstGapVal = gap;
        worstGapIdx = i;
      }
    }
    const worstGapSummary =
      worstGapIdx >= 0
        ? diag.timingSummaries[worstGapIdx]
        : null;

    const aabSuffix = firstTextSummary
      ? ` aabInit=` +
        `${firstTextSummary.timeToStreamStartMs}` +
        `ms` +
        ` aabTTFC=` +
        `${firstTextSummary.timeToFirstTextChunkMs}` +
        `ms` +
        (worstGapSummary &&
        worstGapIdx !== firstTextIdx
          ? ` aabWorstGap=` +
            `${worstGapSummary.maxChunkGapMs}ms`
          : '')
      : '';

    const scoreSuffix =
      medianTTFC !== null
        ? ` score=${score.toFixed(2)}`
        : '';

    return (
      `TTFC=${firstTurnTTFC ?? 'N/A'}ms ` +
      `maxGap=${maxGapAcrossTurns}ms ` +
      `total=${totalMs ?? 'N/A'}ms ` +
      `chunks=${totalChunks} ` +
      `turns=${turnCount}` +
      scoreSuffix +
      aabSuffix
    );
  }

  private computeMedianTTFC(
    perTurn: PerTurnMetrics[],
  ): number | null {
    const values = perTurn
      .map((t) => t.timeToFirstChunkMs)
      .filter((v): v is number => v !== null);
    return median(values);
  }

  private buildPerTurnMetrics(
    turns: TurnTiming[],
    transcript: Transcript,
  ): PerTurnMetrics[] {
    const pairs = this.extractPairs(transcript);
    const results: PerTurnMetrics[] = [];
    let chunkTurnPos = 0;

    for (const turn of turns) {
      if (turn.chunkTimes.length === 0) continue;

      // Primary: turnIndex maps directly to a
      // transcript pair when the collector's
      // complete counter is in sync. Fallback:
      // when double-complete inflates turnIndex
      // beyond available pairs, use sequential
      // position among chunk-bearing turns. When
      // no pair is available at all (empty
      // transcript), timing fields are null.
      const pairIdx =
        turn.turnIndex < pairs.length
          ? turn.turnIndex
          : chunkTurnPos < pairs.length
            ? chunkTurnPos
            : -1;
      chunkTurnPos++;

      const userTurn =
        pairIdx >= 0
          ? pairs[pairIdx].userTurn
          : undefined;
      const assistantTurn =
        pairIdx >= 0
          ? pairs[pairIdx].assistantTurn
          : undefined;

      const ttfc =
        turn.firstChunkTime !== null && userTurn
          ? turn.firstChunkTime - userTurn.timestamp
          : null;

      const totalTurnMs =
        userTurn && assistantTurn
          ? assistantTurn.timestamp -
            userTurn.timestamp
          : null;

      results.push({
        turnIndex: turn.turnIndex,
        timeToFirstChunkMs: ttfc,
        maxInterChunkGapMs: maxGapMs(
          turn.chunkTimes,
        ),
        totalTurnMs,
        chunkCount: turn.chunkTimes.length,
      });
    }

    return results;
  }

  private extractPairs(
    transcript: Transcript,
  ): Array<{
    userTurn: Turn;
    assistantTurn: Turn | undefined;
  }> {
    const pairs: Array<{
      userTurn: Turn;
      assistantTurn: Turn | undefined;
    }> = [];
    for (
      let i = 0;
      i < transcript.turns.length;
      i++
    ) {
      const t = transcript.turns[i];
      if (t.role === 'user') {
        const next = transcript.turns[i + 1];
        pairs.push({
          userTurn: t,
          assistantTurn:
            next?.role === 'assistant'
              ? next
              : undefined,
        });
      }
    }
    return pairs;
  }
}
