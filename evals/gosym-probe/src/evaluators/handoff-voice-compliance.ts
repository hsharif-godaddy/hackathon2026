import { z } from 'zod';
import type { EvalResult, Evaluator } from './evaluator.js';
import type { DOMSnapshot, Transcript, Turn } from '../runner/transcript.js';
import type { Scenario } from '../scenarios/types.js';
import type { IGocodeClient } from '../clients/gocode-client.js';
import type {
  GoalJudgment,
  HandoffTransition,
  VoiceGoalMapping,
} from './handoff-voice-compliance-types.js';
import { extractJsonObject } from './judge-schema.js';

const VoiceJudgmentSchema = z.object({
  verdict: z.enum(['pass', 'fail']),
  reason: z.string().min(1),
  evidence: z.string(),
});

/**
 * Extract all handoff transitions from the transcript deterministically.
 * Scans assistant turns for tool calls named "handoff" and extracts
 * the surrounding chat context.
 */
export function extractHandoffTransitions(transcript: Transcript): HandoffTransition[] {
  const transitions: HandoffTransition[] = [];

  for (let i = 0; i < transcript.turns.length; i++) {
    const turn = transcript.turns[i];
    if (turn.role !== 'assistant') continue;

    for (const toolCall of turn.toolCalls) {
      if (toolCall.name !== 'handoff') continue;

      const input = toolCall.input as { targetAgent?: string } | undefined;
      const targetAgent = input?.targetAgent ?? '';
      const sourceAgent = toolCall.agentId ?? '';

      const postChatContent = findNextAssistantContent(transcript.turns, i);

      transitions.push({
        sourceAgent,
        targetAgent,
        turnIndex: i,
        preChatContent: turn.content,
        postChatContent,
      });
    }
  }

  return transitions;
}

function findNextAssistantContent(turns: Turn[], afterIndex: number): string {
  for (let j = afterIndex + 1; j < turns.length; j++) {
    if (turns[j].role === 'assistant') {
      return turns[j].content;
    }
  }
  return '';
}

/**
 * Match voice goal mappings to extracted transitions.
 * A goal is applicable if a matching transition exists:
 * - outbound: transition where sourceAgent === mapping.agent
 * - inbound: transition where targetAgent === mapping.agent
 */
export function resolveApplicableGoals(
  goalMappings: VoiceGoalMapping[],
  transitions: HandoffTransition[],
): {
  applicable: Array<{ mapping: VoiceGoalMapping; transition: HandoffTransition }>;
  skipped: VoiceGoalMapping[];
} {
  const applicable: Array<{ mapping: VoiceGoalMapping; transition: HandoffTransition }> = [];
  const skipped: VoiceGoalMapping[] = [];

  for (const mapping of goalMappings) {
    const match = transitions.find((t) =>
      mapping.direction === 'outbound'
        ? t.sourceAgent === mapping.agent
        : t.targetAgent === mapping.agent,
    );

    if (match) {
      applicable.push({ mapping, transition: match });
    } else {
      skipped.push(mapping);
    }
  }

  return { applicable, skipped };
}

/**
 * Aggregate per-goal judgments into a single EvalResult.
 * Uses worst-of semantics over conclusive judgments: any fail = fail,
 * all pass = pass. 'incomplete' judgments (infra/parse failures) are
 * excluded from pass/fail tallies; when no conclusive judgment remains
 * the evaluator reports 'incomplete' rather than polluting regression
 * gating with a transient judge flake.
 * Score = proportion of conclusive judgments that passed.
 */
export function aggregateJudgments(
  judgments: GoalJudgment[],
  evaluatorName: string,
): EvalResult {
  const applicableJudgments = judgments.filter((j) => j.applicable);

  if (applicableJudgments.length === 0) {
    return {
      evaluator: evaluatorName,
      score: 0,
      verdict: 'incomplete',
      reason: 'No applicable goals (all transitions were N/A)',
      details: { perGoalJudgments: judgments },
    };
  }

  const passCount = applicableJudgments.filter((j) => j.verdict === 'pass').length;
  const failCount = applicableJudgments.filter((j) => j.verdict === 'fail').length;
  const conclusiveCount: number = passCount + failCount;

  if (conclusiveCount === 0) {
    return {
      evaluator: evaluatorName,
      score: 0,
      verdict: 'incomplete',
      reason: 'All applicable voice goals were inconclusive (judge failures)',
      details: { perGoalJudgments: judgments },
    };
  }

  const score: number = passCount / conclusiveCount;
  const verdict: EvalResult['verdict'] = failCount > 0 ? 'fail' : 'pass';

  const failedGoals = applicableJudgments
    .filter((j) => j.verdict === 'fail')
    .map((j) => j.reason);
  const reason = verdict === 'pass'
    ? `All ${passCount} conclusive voice goals passed`
    : `Failed: ${failedGoals.join('; ')}`;

  return {
    evaluator: evaluatorName,
    score,
    verdict,
    reason,
    details: { perGoalJudgments: judgments },
  };
}

function buildJudgePrompt(
  mapping: VoiceGoalMapping,
  transition: HandoffTransition,
): string {
  const chatToEvaluate = mapping.direction === 'outbound'
    ? transition.preChatContent
    : transition.postChatContent;

  const directionLabel = mapping.direction === 'outbound'
    ? `${transition.sourceAgent} agent's chat BEFORE handing off to ${transition.targetAgent}`
    : `${transition.targetAgent} agent's first chat AFTER receiving handoff from ${transition.sourceAgent}`;

  return [
    'You are a voice-compliance judge. You evaluate whether an AI assistant exposed',
    'internal multi-agent routing ("the seam") to the user at a specific handoff transition.',
    '',
    `## Transition being evaluated`,
    `Direction: ${directionLabel}`,
    `Source agent: ${transition.sourceAgent}`,
    `Target agent: ${transition.targetAgent}`,
    '',
    '## Chat content at this transition',
    chatToEvaluate.length > 0
      ? `"""${chatToEvaluate}"""`
      : '[No user-facing chat at this transition]',
    '',
    '## Goal criteria (evaluate against this)',
    transition.preChatContent.length > 0 || transition.postChatContent.length > 0
      ? ''
      : '',
    mapping.goal.description,
    '',
    '## Instructions',
    '- PASS if the chat meets the criteria in the goal description above.',
    '- PASS if there is no user-facing chat at this transition (silence is acceptable).',
    '- FAIL only if the chat violates the criteria (exposes the seam, uses forbidden phrases, etc.).',
    '- Respond with JSON only. No other text.',
    '',
    '## Response format',
    '```json',
    '{',
    '  "verdict": "pass" | "fail",',
    '  "reason": "one-sentence explanation",',
    '  "evidence": "quoted text that triggered the verdict, or empty string"',
    '}',
    '```',
  ].join('\n');
}

async function judgeGoal(
  mapping: VoiceGoalMapping,
  transition: HandoffTransition,
  gocode: IGocodeClient,
): Promise<GoalJudgment> {
  const prompt = buildJudgePrompt(mapping, transition);

  let response: string;
  try {
    response = await gocode.complete([{ role: 'user', content: prompt }]);
  } catch {
    return {
      goal: mapping.goal,
      applicable: true,
      verdict: 'incomplete',
      reason: 'LLM judge request failed',
      evidence: '',
    };
  }

  const jsonText = extractJsonObject(response);
  if (!jsonText) {
    return {
      goal: mapping.goal,
      applicable: true,
      verdict: 'incomplete',
      reason: 'Failed to parse LLM judge JSON response',
      evidence: '',
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return {
      goal: mapping.goal,
      applicable: true,
      verdict: 'incomplete',
      reason: 'Failed to parse LLM judge JSON response',
      evidence: '',
    };
  }

  const validated = VoiceJudgmentSchema.safeParse(parsed);
  if (!validated.success) {
    return {
      goal: mapping.goal,
      applicable: true,
      verdict: 'incomplete',
      reason: 'LLM judge response did not match expected schema',
      evidence: '',
    };
  }

  return {
    goal: mapping.goal,
    applicable: true,
    verdict: validated.data.verdict,
    reason: validated.data.reason,
    evidence: validated.data.evidence,
  };
}

export class HandoffVoiceComplianceEvaluator implements Evaluator {
  readonly name = 'handoff-voice-compliance';
  readonly comparisonMode = 'passRate' as const;

  constructor(
    private readonly gocode: IGocodeClient,
    private readonly goalMappings: VoiceGoalMapping[],
  ) {}

  async evaluate(
    transcript: Transcript,
    _scenario: Scenario,
    _snapshot?: DOMSnapshot,
  ): Promise<EvalResult> {
    const transitions = extractHandoffTransitions(transcript);
    const { applicable, skipped } = resolveApplicableGoals(
      this.goalMappings,
      transitions,
    );

    const skippedJudgments: GoalJudgment[] = skipped.map((mapping) => ({
      goal: mapping.goal,
      applicable: false,
      verdict: 'incomplete' as const,
      reason: `N/A: no ${mapping.direction} transition found for agent "${mapping.agent}"`,
      evidence: '',
    }));

    if (applicable.length === 0) {
      return aggregateJudgments(skippedJudgments, this.name);
    }

    const applicableJudgments = await Promise.all(
      applicable.map(({ mapping, transition }) =>
        judgeGoal(mapping, transition, this.gocode),
      ),
    );

    const allJudgments = [...applicableJudgments, ...skippedJudgments];
    return aggregateJudgments(allJudgments, this.name);
  }
}
