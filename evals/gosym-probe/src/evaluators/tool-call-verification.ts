import type { EvalResult, Evaluator } from './evaluator.js';
import type {
  DOMSnapshot,
  Transcript,
  Turn,
  ToolCall,
} from '../runner/transcript.js';
import type { Scenario, ToolCallAssertion, AssertionArgValue } from '../scenarios/types.js';

interface CalledTool {
  name: string;
  input?: unknown;
}

function nameMatches(assertion: ToolCallAssertion, name: string): boolean {
  if (assertion.toolPattern) return assertion.toolPattern.test(name);
  if ((assertion.match ?? 'exact') === 'prefix') {
    return name.startsWith(assertion.tool);
  }
  return name === assertion.tool;
}

function argsMatch(
  expected: Record<string, AssertionArgValue>,
  input: unknown,
): boolean {
  if (typeof input !== 'object' || input === null) return false;
  const obj: Record<string, unknown> = input as Record<string, unknown>;
  return Object.entries(expected).every(
    ([key, value]: [string, AssertionArgValue]): boolean => obj[key] === value,
  );
}

function matchesAny(
  assertion: ToolCallAssertion,
  calls: CalledTool[],
): boolean {
  return calls.some((call: CalledTool): boolean => {
    if (!nameMatches(assertion, call.name)) return false;
    if (!assertion.args) return true;
    return argsMatch(assertion.args, call.input);
  });
}

function describeAssertion(assertion: ToolCallAssertion): string {
  const base: string = assertion.toolPattern
    ? `/${assertion.toolPattern.source}/`
    : assertion.tool;
  return assertion.args ? `${base} ${JSON.stringify(assertion.args)}` : base;
}

export class ToolCallVerificationEvaluator implements Evaluator {
  readonly name = 'tool-call-verification';

  async evaluate(
    transcript: Transcript,
    scenario: Scenario,
    _snapshot?: DOMSnapshot,
  ): Promise<EvalResult> {
    const expectedTools: ToolCallAssertion[] = scenario.expectedTools ?? [];

    const calls: CalledTool[] = transcript.turns.flatMap(
      (turn: Turn): CalledTool[] =>
        turn.toolCalls.map(
          (tc: ToolCall): CalledTool => ({ name: tc.name, input: tc.input }),
        ),
    );
    const calledToolNames: string[] = calls.map(
      (call: CalledTool): string => call.name,
    );

    if (expectedTools.length === 0) {
      return {
        evaluator: this.name,
        score: 1.0,
        verdict: 'pass',
        reason: 'No tool assertions defined',
        details: {
          calledTools: calledToolNames,
          violations: [],
          satisfiedCount: 0,
          totalAssertions: 0,
        },
      };
    }

    const violations: string[] = [];
    let satisfiedCount: number = 0;

    for (const assertion of expectedTools) {
      const wasCalled: boolean = matchesAny(assertion, calls);
      if (assertion.called && !wasCalled) {
        violations.push(
          `Expected tool '${describeAssertion(assertion)}' was not called`,
        );
      } else if (!assertion.called && wasCalled) {
        violations.push(
          `Forbidden tool '${describeAssertion(assertion)}' was called`,
        );
      } else {
        satisfiedCount++;
      }
    }

    const score: number = satisfiedCount / expectedTools.length;
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
        calledTools: calledToolNames,
        violations,
        satisfiedCount,
        totalAssertions: expectedTools.length,
      },
    };
  }
}
