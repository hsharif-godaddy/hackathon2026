import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GocodeClient } from '../../clients/gocode-client.js';
import type { Transcript, Turn } from '../../runner/transcript.js';
import type { Scenario } from '../../scenarios/types.js';
import type { Persona } from '../../personas/types.js';
import type { ScenarioGoal } from '../../scenarios/types.js';
import type { VoiceGoalMapping } from '../handoff-voice-compliance-types.js';
import {
  extractHandoffTransitions,
  resolveApplicableGoals,
  aggregateJudgments,
  HandoffVoiceComplianceEvaluator,
} from '../handoff-voice-compliance.js';

const mockPersona: Persona = {
  name: 'test',
  description: '',
  systemPrompt: '',
};

function makeTurn(overrides: Partial<Turn> = {}): Turn {
  return {
    role: 'assistant',
    content: '',
    toolCalls: [],
    timestamp: Date.now(),
    ...overrides,
  };
}

function makeTranscript(turns: Turn[]): Transcript {
  return {
    scenarioName: 'test',
    trialIndex: 0,
    turns,
    snapshots: [],
    errors: [],
    captureErrors: [],
  };
}

function makeScenario(
  goals: ScenarioGoal[],
  overrides: Partial<Scenario> = {},
): Scenario {
  return {
    name: 'test-scenario',
    persona: mockPersona,
    goals,
    evaluators: [],
    trials: 1,
    ...overrides,
  };
}

const developOutboundGoal: ScenarioGoal = {
  description: 'Develop outbound voice check',
  assertion: 'positive',
};

const marketingInboundGoal: ScenarioGoal = {
  description: 'Marketing inbound voice check',
  assertion: 'positive',
};

const marketingOutboundGoal: ScenarioGoal = {
  description: 'Marketing outbound voice check',
  assertion: 'positive',
};

const developInboundGoal: ScenarioGoal = {
  description: 'Develop inbound voice check',
  assertion: 'positive',
};

describe('extractHandoffTransitions', () => {
  it('returns empty array when no handoff tool calls exist', () => {
    const transcript = makeTranscript([
      makeTurn({ content: 'Hello', toolCalls: [] }),
      makeTurn({
        content: 'Building page',
        toolCalls: [
          { id: '1', name: 'writeFile', startTime: 0, endTime: 1, agentId: 'develop' },
        ],
      }),
    ]);
    const transitions = extractHandoffTransitions(transcript);
    expect(transitions).toEqual([]);
  });

  it('extracts a single handoff transition with correct fields', () => {
    const transcript = makeTranscript([
      makeTurn({ role: 'user', content: 'Check my SEO' }),
      makeTurn({
        role: 'assistant',
        content: "I'll run an SEO analysis on your site.",
        toolCalls: [
          {
            id: 'h1',
            name: 'handoff',
            input: { targetAgent: 'marketing', prompt: 'Run SEO' },
            startTime: 0,
            endTime: 1,
            agentId: 'develop',
          },
        ],
      }),
      makeTurn({ role: 'user', content: '' }),
      makeTurn({
        role: 'assistant',
        content: 'Running SEO analysis now.',
        toolCalls: [
          { id: 't1', name: 'seoAnalysis', startTime: 2, endTime: 3, agentId: 'marketing' },
        ],
      }),
    ]);

    const transitions = extractHandoffTransitions(transcript);
    expect(transitions).toHaveLength(1);
    expect(transitions[0]).toEqual({
      sourceAgent: 'develop',
      targetAgent: 'marketing',
      turnIndex: 1,
      preChatContent: "I'll run an SEO analysis on your site.",
      postChatContent: 'Running SEO analysis now.',
    });
  });

  it('extracts multiple handoff transitions in order', () => {
    const transcript = makeTranscript([
      makeTurn({ role: 'user', content: 'Check my SEO' }),
      makeTurn({
        role: 'assistant',
        content: '',
        toolCalls: [
          {
            id: 'h1',
            name: 'handoff',
            input: { targetAgent: 'marketing', prompt: 'SEO check' },
            startTime: 0,
            endTime: 1,
            agentId: 'develop',
          },
        ],
      }),
      makeTurn({ role: 'user', content: '' }),
      makeTurn({
        role: 'assistant',
        content: '',
        toolCalls: [
          { id: 't1', name: 'seoAnalysis', startTime: 2, endTime: 3, agentId: 'marketing' },
          {
            id: 'h2',
            name: 'handoff',
            input: { targetAgent: 'develop', prompt: 'SEO done' },
            startTime: 4,
            endTime: 5,
            agentId: 'marketing',
          },
        ],
      }),
      makeTurn({ role: 'user', content: '' }),
      makeTurn({
        role: 'assistant',
        content: 'Implementing fixes.',
        toolCalls: [],
      }),
    ]);

    const transitions = extractHandoffTransitions(transcript);
    expect(transitions).toHaveLength(2);
    expect(transitions[0].sourceAgent).toBe('develop');
    expect(transitions[0].targetAgent).toBe('marketing');
    expect(transitions[1].sourceAgent).toBe('marketing');
    expect(transitions[1].targetAgent).toBe('develop');
    expect(transitions[1].postChatContent).toBe('Implementing fixes.');
  });

  it('uses empty string for postChatContent when no subsequent assistant turn exists', () => {
    const transcript = makeTranscript([
      makeTurn({
        role: 'assistant',
        content: '',
        toolCalls: [
          {
            id: 'h1',
            name: 'handoff',
            input: { targetAgent: 'marketing', prompt: 'Go' },
            startTime: 0,
            endTime: 1,
            agentId: 'develop',
          },
        ],
      }),
    ]);

    const transitions = extractHandoffTransitions(transcript);
    expect(transitions).toHaveLength(1);
    expect(transitions[0].postChatContent).toBe('');
  });

  it('handles missing agentId gracefully with empty string', () => {
    const transcript = makeTranscript([
      makeTurn({
        role: 'assistant',
        content: 'hello',
        toolCalls: [
          {
            id: 'h1',
            name: 'handoff',
            input: { targetAgent: 'marketing', prompt: 'Go' },
            startTime: 0,
            endTime: 1,
            // no agentId
          },
        ],
      }),
    ]);

    const transitions = extractHandoffTransitions(transcript);
    expect(transitions).toHaveLength(1);
    expect(transitions[0].sourceAgent).toBe('');
  });

  it('handles missing or malformed input gracefully', () => {
    const transcript = makeTranscript([
      makeTurn({
        role: 'assistant',
        content: '',
        toolCalls: [
          {
            id: 'h1',
            name: 'handoff',
            input: undefined,
            startTime: 0,
            endTime: 1,
            agentId: 'develop',
          },
        ],
      }),
    ]);

    const transitions = extractHandoffTransitions(transcript);
    expect(transitions).toHaveLength(1);
    expect(transitions[0].targetAgent).toBe('');
  });
});

describe('resolveApplicableGoals', () => {
  const devToMarketing = {
    sourceAgent: 'develop',
    targetAgent: 'marketing',
    turnIndex: 1,
    preChatContent: '',
    postChatContent: '',
  };

  const marketingToDev = {
    sourceAgent: 'marketing',
    targetAgent: 'develop',
    turnIndex: 3,
    preChatContent: '',
    postChatContent: '',
  };

  it('matches outbound goal to transition where agent is source', () => {
    const mappings: VoiceGoalMapping[] = [
      { goal: developOutboundGoal, agent: 'develop', direction: 'outbound' },
    ];

    const result = resolveApplicableGoals(mappings, [devToMarketing]);
    expect(result.applicable).toHaveLength(1);
    expect(result.applicable[0].mapping.goal).toBe(developOutboundGoal);
    expect(result.applicable[0].transition).toBe(devToMarketing);
    expect(result.skipped).toHaveLength(0);
  });

  it('matches inbound goal to transition where agent is target', () => {
    const mappings: VoiceGoalMapping[] = [
      { goal: marketingInboundGoal, agent: 'marketing', direction: 'inbound' },
    ];

    const result = resolveApplicableGoals(mappings, [devToMarketing]);
    expect(result.applicable).toHaveLength(1);
    expect(result.applicable[0].mapping.goal).toBe(marketingInboundGoal);
    expect(result.applicable[0].transition).toBe(devToMarketing);
    expect(result.skipped).toHaveLength(0);
  });

  it('skips goals when matching transition does not exist', () => {
    const mappings: VoiceGoalMapping[] = [
      { goal: marketingOutboundGoal, agent: 'marketing', direction: 'outbound' },
      { goal: developInboundGoal, agent: 'develop', direction: 'inbound' },
    ];

    // Only develop->marketing transition exists, no marketing->develop
    const result = resolveApplicableGoals(mappings, [devToMarketing]);
    expect(result.applicable).toHaveLength(0);
    expect(result.skipped).toHaveLength(2);
  });

  it('handles multiple goals and transitions correctly', () => {
    const mappings: VoiceGoalMapping[] = [
      { goal: developOutboundGoal, agent: 'develop', direction: 'outbound' },
      { goal: marketingInboundGoal, agent: 'marketing', direction: 'inbound' },
      { goal: marketingOutboundGoal, agent: 'marketing', direction: 'outbound' },
      { goal: developInboundGoal, agent: 'develop', direction: 'inbound' },
    ];

    const result = resolveApplicableGoals(mappings, [devToMarketing, marketingToDev]);
    expect(result.applicable).toHaveLength(4);
    expect(result.skipped).toHaveLength(0);
  });

  it('returns all goals as skipped when no transitions exist', () => {
    const mappings: VoiceGoalMapping[] = [
      { goal: developOutboundGoal, agent: 'develop', direction: 'outbound' },
      { goal: marketingInboundGoal, agent: 'marketing', direction: 'inbound' },
    ];

    const result = resolveApplicableGoals(mappings, []);
    expect(result.applicable).toHaveLength(0);
    expect(result.skipped).toHaveLength(2);
  });
});

describe('aggregateJudgments', () => {
  it('returns pass with score 1.0 when all applicable goals pass', () => {
    const judgments = [
      { goal: developOutboundGoal, applicable: true, verdict: 'pass' as const, reason: 'Clean', evidence: '' },
      { goal: marketingInboundGoal, applicable: true, verdict: 'pass' as const, reason: 'Clean', evidence: '' },
    ];

    const result = aggregateJudgments(judgments, 'handoff-voice-compliance');
    expect(result.verdict).toBe('pass');
    expect(result.score).toBe(1.0);
  });

  it('returns fail with proportional score when any applicable goal fails', () => {
    const judgments = [
      { goal: developOutboundGoal, applicable: true, verdict: 'pass' as const, reason: 'Clean', evidence: '' },
      { goal: marketingInboundGoal, applicable: true, verdict: 'fail' as const, reason: 'Seam exposed', evidence: '"hand off"' },
    ];

    const result = aggregateJudgments(judgments, 'handoff-voice-compliance');
    expect(result.verdict).toBe('fail');
    expect(result.score).toBe(0.5);
  });

  it('returns incomplete when all goals are N/A (not applicable)', () => {
    const judgments = [
      { goal: marketingOutboundGoal, applicable: false, verdict: 'fail' as const, reason: 'N/A', evidence: '' },
      { goal: developInboundGoal, applicable: false, verdict: 'fail' as const, reason: 'N/A', evidence: '' },
    ];

    const result = aggregateJudgments(judgments, 'handoff-voice-compliance');
    expect(result.verdict).toBe('incomplete');
    expect(result.score).toBe(0);
  });

  it('excludes N/A goals from scoring and verdict', () => {
    const judgments = [
      { goal: developOutboundGoal, applicable: true, verdict: 'pass' as const, reason: 'Clean', evidence: '' },
      { goal: marketingOutboundGoal, applicable: false, verdict: 'fail' as const, reason: 'N/A', evidence: '' },
    ];

    const result = aggregateJudgments(judgments, 'handoff-voice-compliance');
    expect(result.verdict).toBe('pass');
    expect(result.score).toBe(1.0);
  });

  it('returns incomplete when judgments array is empty', () => {
    const result = aggregateJudgments([], 'handoff-voice-compliance');
    expect(result.verdict).toBe('incomplete');
    expect(result.score).toBe(0);
  });

  it('excludes incomplete (infra-failure) judgments from the denominator', () => {
    const judgments = [
      { goal: developOutboundGoal, applicable: true, verdict: 'pass' as const, reason: 'Clean', evidence: '' },
      { goal: marketingInboundGoal, applicable: true, verdict: 'incomplete' as const, reason: 'Judge request failed', evidence: '' },
    ];

    const result = aggregateJudgments(judgments, 'handoff-voice-compliance');
    expect(result.verdict).toBe('pass');
    expect(result.score).toBe(1.0);
  });

  it('returns incomplete when all applicable judgments are incomplete', () => {
    const judgments = [
      { goal: developOutboundGoal, applicable: true, verdict: 'incomplete' as const, reason: 'Malformed JSON', evidence: '' },
      { goal: marketingInboundGoal, applicable: true, verdict: 'incomplete' as const, reason: 'Schema mismatch', evidence: '' },
    ];

    const result = aggregateJudgments(judgments, 'handoff-voice-compliance');
    expect(result.verdict).toBe('incomplete');
    expect(result.score).toBe(0);
  });

  it('returns fail with proportional score when mixing pass, fail, and incomplete', () => {
    const judgments = [
      { goal: developOutboundGoal, applicable: true, verdict: 'pass' as const, reason: 'Clean', evidence: '' },
      { goal: marketingInboundGoal, applicable: true, verdict: 'fail' as const, reason: 'Seam exposed', evidence: '"hand off"' },
      { goal: marketingOutboundGoal, applicable: true, verdict: 'incomplete' as const, reason: 'Judge request failed', evidence: '' },
    ];

    const result = aggregateJudgments(judgments, 'handoff-voice-compliance');
    expect(result.verdict).toBe('fail');
    expect(result.score).toBe(0.5);
  });

  it('includes per-goal details in result', () => {
    const judgments = [
      { goal: developOutboundGoal, applicable: true, verdict: 'pass' as const, reason: 'No chat before handoff', evidence: '' },
      { goal: marketingInboundGoal, applicable: true, verdict: 'fail' as const, reason: 'Said "taking over"', evidence: '"I\'m taking over now"' },
    ];

    const result = aggregateJudgments(judgments, 'handoff-voice-compliance');
    expect(result.details?.perGoalJudgments).toEqual(judgments);
  });
});

describe('HandoffVoiceComplianceEvaluator', () => {
  let mockGocode: { complete: ReturnType<typeof vi.fn> };
  let evaluator: HandoffVoiceComplianceEvaluator;

  const goalMappings: VoiceGoalMapping[] = [
    { goal: developOutboundGoal, agent: 'develop', direction: 'outbound' },
    { goal: marketingInboundGoal, agent: 'marketing', direction: 'inbound' },
  ];

  beforeEach(() => {
    vi.resetAllMocks();
    mockGocode = { complete: vi.fn() };
    evaluator = new HandoffVoiceComplianceEvaluator(
      mockGocode as unknown as GocodeClient,
      goalMappings,
    );
  });

  it('has correct evaluator name', () => {
    expect(evaluator.name).toBe('handoff-voice-compliance');
  });

  it('returns incomplete when no handoff transitions found in transcript', async () => {
    const transcript = makeTranscript([
      makeTurn({ role: 'user', content: 'Build a page' }),
      makeTurn({ role: 'assistant', content: 'Building it now.', toolCalls: [] }),
    ]);

    const result = await evaluator.evaluate(
      transcript,
      makeScenario([developOutboundGoal, marketingInboundGoal]),
    );

    expect(result.verdict).toBe('incomplete');
    expect(mockGocode.complete).not.toHaveBeenCalled();
  });

  it('calls LLM judge for each applicable goal and returns pass when all pass', async () => {
    mockGocode.complete.mockResolvedValue(
      JSON.stringify({ verdict: 'pass', reason: 'No seam exposed', evidence: '' }),
    );

    const transcript = makeTranscript([
      makeTurn({ role: 'user', content: 'Check my SEO' }),
      makeTurn({
        role: 'assistant',
        content: '',
        toolCalls: [
          {
            id: 'h1',
            name: 'handoff',
            input: { targetAgent: 'marketing', prompt: 'SEO check' },
            startTime: 0,
            endTime: 1,
            agentId: 'develop',
          },
        ],
      }),
      makeTurn({ role: 'user', content: '' }),
      makeTurn({
        role: 'assistant',
        content: 'Analyzing your site.',
        toolCalls: [{ id: 't1', name: 'seoAnalysis', startTime: 2, endTime: 3, agentId: 'marketing' }],
      }),
    ]);

    const result = await evaluator.evaluate(
      transcript,
      makeScenario([developOutboundGoal, marketingInboundGoal]),
    );

    expect(result.verdict).toBe('pass');
    expect(result.score).toBe(1.0);
    expect(mockGocode.complete).toHaveBeenCalledTimes(2);
  });

  it('returns fail when LLM judge fails any goal', async () => {
    mockGocode.complete
      .mockResolvedValueOnce(JSON.stringify({ verdict: 'pass', reason: 'Clean', evidence: '' }))
      .mockResolvedValueOnce(JSON.stringify({ verdict: 'fail', reason: 'Said "taking over"', evidence: '"I\'m taking over"' }));

    const transcript = makeTranscript([
      makeTurn({ role: 'user', content: 'Check my SEO' }),
      makeTurn({
        role: 'assistant',
        content: '',
        toolCalls: [
          {
            id: 'h1',
            name: 'handoff',
            input: { targetAgent: 'marketing', prompt: 'SEO' },
            startTime: 0,
            endTime: 1,
            agentId: 'develop',
          },
        ],
      }),
      makeTurn({ role: 'user', content: '' }),
      makeTurn({
        role: 'assistant',
        content: "I'm taking over from develop.",
        toolCalls: [],
      }),
    ]);

    const result = await evaluator.evaluate(
      transcript,
      makeScenario([developOutboundGoal, marketingInboundGoal]),
    );

    expect(result.verdict).toBe('fail');
    expect(result.score).toBe(0.5);
  });

  it('handles malformed LLM JSON response gracefully as incomplete', async () => {
    mockGocode.complete.mockResolvedValue('not json at all');

    const transcript = makeTranscript([
      makeTurn({ role: 'user', content: 'Check my SEO' }),
      makeTurn({
        role: 'assistant',
        content: '',
        toolCalls: [
          {
            id: 'h1',
            name: 'handoff',
            input: { targetAgent: 'marketing', prompt: 'SEO' },
            startTime: 0,
            endTime: 1,
            agentId: 'develop',
          },
        ],
      }),
      makeTurn({ role: 'user', content: '' }),
      makeTurn({ role: 'assistant', content: 'Analyzing.' }),
    ]);

    const result = await evaluator.evaluate(
      transcript,
      makeScenario([developOutboundGoal, marketingInboundGoal]),
    );

    // Both goals get incomplete due to parse failure, no conclusive judgments
    expect(result.verdict).toBe('incomplete');
  });

  it('includes goal description verbatim in LLM prompt', async () => {
    mockGocode.complete.mockResolvedValue(
      JSON.stringify({ verdict: 'pass', reason: 'OK', evidence: '' }),
    );

    const transcript = makeTranscript([
      makeTurn({ role: 'user', content: 'Check my SEO' }),
      makeTurn({
        role: 'assistant',
        content: "I'll analyze your SEO.",
        toolCalls: [
          {
            id: 'h1',
            name: 'handoff',
            input: { targetAgent: 'marketing', prompt: 'SEO' },
            startTime: 0,
            endTime: 1,
            agentId: 'develop',
          },
        ],
      }),
      makeTurn({ role: 'user', content: '' }),
      makeTurn({ role: 'assistant', content: 'Starting analysis.' }),
    ]);

    await evaluator.evaluate(
      transcript,
      makeScenario([developOutboundGoal, marketingInboundGoal]),
    );

    const firstCallPrompt = mockGocode.complete.mock.calls[0][0][0].content as string;
    expect(firstCallPrompt).toContain('Develop outbound voice check');
  });

  it('includes transition chat context in LLM prompt', async () => {
    mockGocode.complete.mockResolvedValue(
      JSON.stringify({ verdict: 'pass', reason: 'OK', evidence: '' }),
    );

    const transcript = makeTranscript([
      makeTurn({ role: 'user', content: 'Check my SEO' }),
      makeTurn({
        role: 'assistant',
        content: "Let me hand this off to the SEO team.",
        toolCalls: [
          {
            id: 'h1',
            name: 'handoff',
            input: { targetAgent: 'marketing', prompt: 'SEO' },
            startTime: 0,
            endTime: 1,
            agentId: 'develop',
          },
        ],
      }),
      makeTurn({ role: 'user', content: '' }),
      makeTurn({ role: 'assistant', content: 'Welcome! I am marketing.' }),
    ]);

    await evaluator.evaluate(
      transcript,
      makeScenario([developOutboundGoal, marketingInboundGoal]),
    );

    // Outbound goal prompt should have preChatContent
    const outboundPrompt = mockGocode.complete.mock.calls[0][0][0].content as string;
    expect(outboundPrompt).toContain('Let me hand this off to the SEO team.');

    // Inbound goal prompt should have postChatContent
    const inboundPrompt = mockGocode.complete.mock.calls[1][0][0].content as string;
    expect(inboundPrompt).toContain('Welcome! I am marketing.');
  });
});
