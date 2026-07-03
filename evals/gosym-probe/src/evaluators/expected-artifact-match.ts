import type { EvalResult, Evaluator } from './evaluator.js';
import type {
  DOMSnapshot,
  ToolCall,
  Transcript,
} from '../runner/transcript.js';
import type { CapturedSite } from '../clients/site-capture/types.js';
import type {
  MatchableItem,
  Scenario,
} from '../scenarios/types.js';
import {
  reduceChecklistOutcomes,
  type ChecklistItemOutcome,
} from './checklist-verdict.js';

function flattenToolCalls(transcript: Transcript): ToolCall[] {
  return transcript.turns.flatMap((t) => t.toolCalls);
}

function routeReachable(site: CapturedSite, path: string | RegExp): boolean {
  return site.routes.some((r) => {
    const matches =
      typeof path === 'string' ? r.path === path : path.test(r.path);
    return matches && r.status === 'ok';
  });
}

function renderedText(site: CapturedSite): string {
  return site.perRoute
    .map((rc) => {
      const r = rc.rendered;
      if (!r) return '';
      return [r.title, r.h1 ?? '', r.headingText, r.bodyPreview].join(' ');
    })
    .join(' \n');
}

function transcriptText(transcript: Transcript): string {
  return transcript.turns.map((t) => t.content).join(' \n');
}

/**
 * The snapshots a matcher should see: the full per-trial capture when
 * present, else the single fallback snapshot, else none. Shared so the
 * binary and directional evaluators resolve snapshots identically.
 */
export function resolveSnapshots(
  transcript: Transcript,
  snapshot?: DOMSnapshot,
): DOMSnapshot[] {
  if (transcript.snapshots.length > 0) return transcript.snapshots;
  return snapshot ? [snapshot] : [];
}

/**
 * Run a single item's matcher against the trial artifact, shared by the
 * binary expected-artifact-match evaluator and the score-mode
 * DirectionalSignalEvaluator so both resolve matchers identically.
 *
 * Returns 'incomplete' when the input the matcher needs is absent (e.g. a
 * domMatcher with no captured site) so that missing data is never
 * miscounted as a behavioral failure. Exactly one matcher is expected per
 * item; if none is set the item is 'incomplete'.
 */
export function matchItem(
  item: MatchableItem,
  transcript: Transcript,
  snapshots: DOMSnapshot[],
): ChecklistItemOutcome {
  const site = transcript.capturedSite;

  if (item.domMatcher) {
    if (!site) return unknownMatch(item, 'no captured site for domMatcher');
    return booleanMatch(item, item.domMatcher(site, snapshots));
  }

  if (item.routeMatcher) {
    if (!site) return unknownMatch(item, 'no captured site for routeMatcher');
    const reachable = routeReachable(site, item.routeMatcher.path);
    return booleanMatch(item, reachable === item.routeMatcher.mustBeReachable);
  }

  if (item.toolMatcher) {
    return booleanMatch(item, item.toolMatcher(flattenToolCalls(transcript)));
  }

  if (item.textMatcher) {
    if (item.textMatcher.source === 'rendered') {
      if (!site) {
        return unknownMatch(item, 'no captured site for rendered textMatcher');
      }
      return booleanMatch(item, item.textMatcher.pattern.test(renderedText(site)));
    }
    return booleanMatch(
      item,
      item.textMatcher.pattern.test(transcriptText(transcript)),
    );
  }

  return unknownMatch(item, 'no matcher defined');
}

function booleanMatch(item: MatchableItem, passed: boolean): ChecklistItemOutcome {
  return {
    id: item.id,
    status: passed ? 'pass' : 'fail',
    reason: passed ? item.description : `unmet: ${item.description}`,
  };
}

function unknownMatch(item: MatchableItem, reason: string): ChecklistItemOutcome {
  return { id: item.id, status: 'incomplete', reason };
}

/**
 * Static, deterministic comparison of the agent's finished product
 * against a scenario's written-down expectation (a CheckList of binary
 * behavioral expectations). Every item is capability (MFT) or invariance
 * (INV); any failure hard-fails the scenario (clean pass/fail, never
 * 'partial'). Directional signals are scored separately by the score-mode
 * DirectionalSignalEvaluator. The verdict — not the fractional score — is
 * the headline signal; the score exists only so the result aggregates
 * cleanly in composites and pass@k.
 */
export class ExpectedArtifactMatchEvaluator implements Evaluator {
  readonly name = 'expected-artifact-match';
  readonly comparisonMode = 'passRate' as const;

  async evaluate(
    transcript: Transcript,
    scenario: Scenario,
    snapshot?: DOMSnapshot,
  ): Promise<EvalResult> {
    const spec = scenario.expectedArtifact;
    if (!spec || spec.items.length === 0) {
      return {
        evaluator: this.name,
        score: 0,
        verdict: 'incomplete',
        reason: 'No expected artifact defined',
      };
    }

    const snapshots = resolveSnapshots(transcript, snapshot);

    const results = spec.items.map((item) =>
      matchItem(item, transcript, snapshots),
    );

    const reduced = reduceChecklistOutcomes(results);

    return {
      evaluator: this.name,
      score: reduced.score,
      verdict: reduced.verdict,
      reason: reduced.reason,
      evalVersion: spec.evalVersion,
      details: {
        intent: spec.intent,
        items: results,
        passedCount: reduced.passedCount,
        failedCount: reduced.failedCount,
        incompleteCount: reduced.incompleteCount,
        hardFailures: reduced.hardFailures,
      },
    };
  }
}
