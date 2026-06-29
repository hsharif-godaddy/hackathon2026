import type { EvalResult, Evaluator } from './evaluator.js';
import type {
  DOMSnapshot,
  ToolCall,
  Transcript,
} from '../runner/transcript.js';
import type { CapturedSite } from '../clients/site-capture/types.js';
import type {
  ChecklistItem,
  Scenario,
} from '../scenarios/types.js';
import {
  reduceChecklistOutcomes,
  type ChecklistItemOutcome,
} from './checklist-verdict.js';

type ItemResult = ChecklistItemOutcome;

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
 * Evaluate a single CheckList item against the trial artifact.
 *
 * Returns 'unknown' when the input the item's matcher needs is absent
 * (e.g. a domMatcher with no captured site) so that missing data is
 * never miscounted as a behavioral failure. Exactly one matcher is
 * expected per item; if none is set the item is 'unknown'.
 */
function evaluateItem(
  item: ChecklistItem,
  transcript: Transcript,
  snapshots: DOMSnapshot[],
): ItemResult {
  const site = transcript.capturedSite;

  if (item.domMatcher) {
    if (!site) {
      return unknownItem(item, 'no captured site for domMatcher');
    }
    return booleanItem(item, item.domMatcher(site, snapshots));
  }

  if (item.routeMatcher) {
    if (!site) {
      return unknownItem(item, 'no captured site for routeMatcher');
    }
    const reachable = routeReachable(site, item.routeMatcher.path);
    return booleanItem(item, reachable === item.routeMatcher.mustBeReachable);
  }

  if (item.toolMatcher) {
    return booleanItem(item, item.toolMatcher(flattenToolCalls(transcript)));
  }

  if (item.textMatcher) {
    if (item.textMatcher.source === 'rendered') {
      if (!site) {
        return unknownItem(item, 'no captured site for rendered textMatcher');
      }
      return booleanItem(item, item.textMatcher.pattern.test(renderedText(site)));
    }
    return booleanItem(
      item,
      item.textMatcher.pattern.test(transcriptText(transcript)),
    );
  }

  return unknownItem(item, 'no matcher defined');
}

function booleanItem(item: ChecklistItem, passed: boolean): ItemResult {
  return {
    id: item.id,
    type: item.type,
    status: passed ? 'pass' : 'fail',
    reason: passed ? item.description : `unmet: ${item.description}`,
  };
}

function unknownItem(item: ChecklistItem, reason: string): ItemResult {
  return { id: item.id, type: item.type, status: 'unknown', reason };
}

/**
 * Static, deterministic comparison of the agent's finished product
 * against a scenario's written-down expectation (a CheckList of binary
 * behavioral expectations). Capability (MFT) and invariance (INV)
 * failures hard-fail the scenario; directional (DIR) failures only
 * downgrade to 'partial'. The verdict — not the fractional score — is
 * the headline signal; the score exists only so the result aggregates
 * cleanly in composites and pass@k.
 */
export class ExpectedArtifactMatchEvaluator implements Evaluator {
  readonly name = 'expected-artifact-match';

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
        verdict: 'unknown',
        reason: 'No expected artifact defined',
      };
    }

    const snapshots =
      transcript.snapshots.length > 0
        ? transcript.snapshots
        : snapshot
          ? [snapshot]
          : [];

    const results = spec.items.map((item) =>
      evaluateItem(item, transcript, snapshots),
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
        unknownCount: reduced.unknownCount,
        hardFailures: reduced.hardFailures,
        directionalFailures: reduced.directionalFailures,
      },
    };
  }
}
