import type { EvalResult, Evaluator } from './evaluator.js';
import type { ToolCall, Transcript } from '../runner/transcript.js';
import type { Scenario } from '../scenarios/types.js';

export interface WebsiteRebuildOutcome {
  called: boolean;
  /** null when websiteRebuild ran but success could not be parsed (treat as not OK). */
  succeeded: boolean | null;
  intakeTimedOut: boolean;
  handoffTriggered: boolean;
  outputUnparseable: boolean;
}

export function isWebsiteRebuildToolName(name: string): boolean {
  if (name === 'websiteRebuild' || name === 'website_rebuild') return true;
  return name.endsWith('__websiteRebuild');
}

export function isRebuildBuildPageToolName(name: string): boolean {
  if (name === 'rebuildBuildPage' || name === 'rebuild_build_page') return true;
  return name.endsWith('__rebuildBuildPage');
}

export function isWaitForIntakeToolName(name: string): boolean {
  if (name === 'waitForIntake' || name === 'wait_for_intake') return true;
  return name.endsWith('__waitForIntake');
}

export function isRebuildToolName(name: string): boolean {
  return (
    isWebsiteRebuildToolName(name)
    || isRebuildBuildPageToolName(name)
    || isWaitForIntakeToolName(name)
  );
}

export function parseToolOutputRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
    return null;
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

export function parseWebsiteRebuildOutcome(toolCalls: ToolCall[]): WebsiteRebuildOutcome {
  let called = false;
  let succeeded: boolean | null = null;
  let intakeTimedOut = false;
  let handoffTriggered = false;
  let outputUnparseable = false;

  for (const toolCall of toolCalls) {
    if (!isWebsiteRebuildToolName(toolCall.name)) continue;

    called = true;
    const output = parseToolOutputRecord(toolCall.output);
    if (output === null) {
      outputUnparseable = true;
      if (succeeded !== false) succeeded = null;
      continue;
    }

    const success = output.success;
    if (success === false) {
      succeeded = false;
    } else if (success === undefined) {
      outputUnparseable = true;
      if (succeeded !== false) succeeded = null;
    } else if (success === true && succeeded !== false && !outputUnparseable) {
      succeeded = true;
    }
    if (output.intakeTimedOut === true) intakeTimedOut = true;
    if (output.handoffTriggered === true) handoffTriggered = true;
  }

  return { called, succeeded, intakeTimedOut, handoffTriggered, outputUnparseable };
}

/**
 * Execution health from transcript signals (mirrors goarena batch-rebuild-execution).
 *
 * penalty = agent errors + failed tools + websiteRebuild failure
 */
export function rebuildExecutionHealth(
  errorEventCount: number,
  failedToolCount: number,
  failurePenalty: number = 0,
): number {
  return 1 / (1 + errorEventCount + failedToolCount + failurePenalty);
}

export function websiteRebuildFailurePenalty(outcome: WebsiteRebuildOutcome): number {
  if (!outcome.called) return 0;
  return outcome.succeeded === true ? 0 : 1;
}

export function websiteRebuildOk(outcome: WebsiteRebuildOutcome): boolean {
  return !outcome.called || outcome.succeeded === true;
}

export class RebuildExecutionHealthEvaluator implements Evaluator {
  readonly name = 'rebuild-execution-health';
  readonly regressionMode = 'score' as const;

  async evaluate(
    transcript: Transcript,
    _scenario: Scenario,
  ): Promise<EvalResult> {
    const allToolCalls = transcript.turns.flatMap((turn) => turn.toolCalls);

    if (!allToolCalls.some((toolCall) => isRebuildToolName(toolCall.name))) {
      return {
        evaluator: this.name,
        score: 0,
        verdict: 'unknown',
        reason: 'No rebuild tools in transcript',
        details: { rebuildToolCount: 0 },
      };
    }

    const errorEventCount = transcript.errors.length;
    const failedToolCount = allToolCalls.filter(
      (toolCall) => toolCall.error != null && toolCall.error !== '',
    ).length;
    const buildPageCount = allToolCalls.filter(
      (toolCall) => isRebuildBuildPageToolName(toolCall.name),
    ).length;
    const websiteRebuild = parseWebsiteRebuildOutcome(allToolCalls);
    const rebuildOk = websiteRebuildOk(websiteRebuild);
    const failurePenalty = websiteRebuildFailurePenalty(websiteRebuild);
    const score = rebuildExecutionHealth(errorEventCount, failedToolCount, failurePenalty);

    const reasonParts = [
      `${errorEventCount} agent error(s)`,
      `${failedToolCount} failed tool(s)`,
    ];
    if (buildPageCount) reasonParts.push(`${buildPageCount} rebuildBuildPage call(s)`);
    if (websiteRebuild.called) {
      if (websiteRebuild.outputUnparseable && websiteRebuild.succeeded !== false) {
        reasonParts.push('websiteRebuild output unparseable');
      } else {
        reasonParts.push(rebuildOk ? 'websiteRebuild ok' : 'websiteRebuild failed');
      }
    }
    if (websiteRebuild.intakeTimedOut) reasonParts.push('intake timed out');
    if (websiteRebuild.handoffTriggered) reasonParts.push('handoff triggered');

    return {
      evaluator: this.name,
      score,
      verdict: 'observed',
      reason: reasonParts.join('; '),
      details: {
        errorEventCount,
        failedToolCount,
        buildPageCount,
        penalty: errorEventCount + failedToolCount + failurePenalty,
        websiteRebuildOk: rebuildOk,
        websiteRebuildOutputUnparseable: websiteRebuild.outputUnparseable,
        intakeTimedOut: websiteRebuild.intakeTimedOut,
        handoffTriggered: websiteRebuild.handoffTriggered,
        executionHealth: score,
      },
    };
  }
}
