import type { EvalResult, Evaluator } from './evaluator.js';
import type { DOMSnapshot, Transcript } from '../runner/transcript.js';
import type {
  Scenario,
  ToolCallAssertion,
} from '../scenarios/types.js';

function matchesAny(
  assertion: ToolCallAssertion,
  calledTools: Set<string>,
): boolean {
  if (assertion.toolPattern) {
    for (const called of calledTools) {
      if (assertion.toolPattern.test(called)) return true;
    }
    return false;
  }
  const mode = assertion.match ?? 'exact';
  if (mode === 'prefix') {
    for (const called of calledTools) {
      if (called.startsWith(assertion.tool)) return true;
    }
    return false;
  }
  return calledTools.has(assertion.tool);
}

export class ToolCallVerificationEvaluator implements Evaluator {
  readonly name = 'tool-call-verification';
  readonly deterministic = true;

  async evaluate(
    transcript: Transcript,
    scenario: Scenario,
    _snapshot?: DOMSnapshot,
  ): Promise<EvalResult> {
    const expectedTools = scenario.expectedTools ?? [];

    const calledTools = new Set(
      transcript.turns.flatMap((t) => t.toolCalls.map((tc) => tc.name)),
    );

    if (expectedTools.length === 0) {
      return {
        evaluator: this.name,
        score: 1.0,
        verdict: 'pass',
        reason: 'No tool assertions defined',
        details: {
          calledTools: Array.from(calledTools),
          violations: [],
          satisfiedCount: 0,
          totalAssertions: 0,
        },
      };
    }

    const violations: string[] = [];
    let satisfiedCount = 0;

    for (const assertion of expectedTools) {
      const wasCalled = matchesAny(assertion, calledTools);
      if (assertion.called && !wasCalled) {
        violations.push(
          `Expected tool '${assertion.tool}' was not called`,
        );
      } else if (!assertion.called && wasCalled) {
        violations.push(
          `Forbidden tool '${assertion.tool}' was called`,
        );
      } else {
        satisfiedCount++;
      }
    }

    const score = satisfiedCount / expectedTools.length;
    const verdict: EvalResult['verdict'] =
      violations.length === 0 ? 'pass' : 'fail';

    return {
      evaluator: this.name,
      score,
      verdict,
      reason:
        violations.length === 0
          ? `All ${expectedTools.length} tool assertion(s) satisfied`
          : violations.join('; '),
      details: {
        calledTools: Array.from(calledTools),
        violations,
        satisfiedCount,
        totalAssertions: expectedTools.length,
      },
    };
  }
}
