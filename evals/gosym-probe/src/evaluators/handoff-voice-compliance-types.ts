import type { ScenarioGoal } from '../scenarios/types.js';

/**
 * Evaluator config: passed at construction time by scenario builder.
 * Maps each voice goal to the specific handoff transition it evaluates.
 */
export interface VoiceGoalMapping {
  /** Reference to the goal constant from the scenario */
  goal: ScenarioGoal;
  /** Which agent this goal evaluates (e.g. "develop", "marketing") */
  agent: string;
  /** outbound = agent leaving (source side), inbound = agent arriving (target side) */
  direction: 'outbound' | 'inbound';
}

/**
 * A handoff transition extracted deterministically from the transcript.
 * Each instance represents one handoff tool call and the chat context around it.
 */
export interface HandoffTransition {
  /** agentId that called the handoff tool (e.g. "develop") */
  sourceAgent: string;
  /** targetAgent from the handoff tool input (e.g. "marketing") */
  targetAgent: string;
  /** Index of the turn containing the handoff tool call */
  turnIndex: number;
  /** Assistant chat content in the same turn as the handoff tool call */
  preChatContent: string;
  /** Assistant chat content in the next assistant turn (new agent's first words) */
  postChatContent: string;
}

/**
 * Result of judging one voice goal against its matched transition.
 */
export interface GoalJudgment {
  /** The goal that was evaluated */
  goal: ScenarioGoal;
  /** false = N/A (matching transition never occurred in transcript) */
  applicable: boolean;
  /** Verdict from LLM judge (or 'unknown' if not applicable / parse failure) */
  verdict: 'pass' | 'fail' | 'unknown';
  /** Human-readable explanation from the LLM judge */
  reason: string;
  /** Quoted chat content that triggered the verdict */
  evidence: string;
}
