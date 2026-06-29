import { describe, it, expect } from 'vitest';
import { SkillSelectionEvaluator } from '../skill-selection.js';
import {
  makeScenario,
  makeTranscriptWith as makeTranscript,
} from './evaluator-test-helpers.js';
import type { Turn } from '../../runner/transcript.js';

function turnWithAgent(agentId: string): Turn {
  return {
    role: 'assistant',
    content: '',
    toolCalls: [
      { id: 't1', name: 'some_tool', startTime: 0, endTime: 1, agentId },
    ],
    timestamp: 0,
  };
}

describe('SkillSelectionEvaluator', () => {
  const evaluator = new SkillSelectionEvaluator();

  it('has the kebab-case evaluator name', () => {
    expect(evaluator.name).toBe('skill-selection');
  });

  it('returns unknown when neither skills nor agent are expected', async () => {
    const result = await evaluator.evaluate(makeTranscript(), makeScenario());
    expect(result.verdict).toBe('unknown');
  });

  // ── Skill-load sub-check ──────────────────────────────────────

  it('proxy mode: returns unknown when only skills expected and loadedSkills absent', async () => {
    const result = await evaluator.evaluate(
      makeTranscript(),
      makeScenario({ expectedSkills: ['payments'] }),
    );
    expect(result.verdict).toBe('unknown');
    expect(result.details?.skillMode).toBe('proxy');
  });

  it('true mode: passes when all expected skills are loaded', async () => {
    const result = await evaluator.evaluate(
      makeTranscript({ loadedSkills: ['payments', 'seo'] }),
      makeScenario({ expectedSkills: ['payments'] }),
    );
    expect(result.verdict).toBe('pass');
    expect(result.score).toBe(1);
    expect(result.details?.skillMode).toBe('true');
  });

  it('true mode: fails when an expected skill is not loaded', async () => {
    const result = await evaluator.evaluate(
      makeTranscript({ loadedSkills: ['seo'] }),
      makeScenario({ expectedSkills: ['payments'] }),
    );
    expect(result.verdict).toBe('fail');
    expect(result.details?.missingSkills).toEqual(['payments']);
  });

  it('true mode: empty loadedSkills array fails (not unknown)', async () => {
    const result = await evaluator.evaluate(
      makeTranscript({ loadedSkills: [] }),
      makeScenario({ expectedSkills: ['payments'] }),
    );
    expect(result.verdict).toBe('fail');
    expect(result.details?.skillMode).toBe('true');
  });

  it('true mode: partial-load scores the fraction loaded', async () => {
    const result = await evaluator.evaluate(
      makeTranscript({ loadedSkills: ['payments'] }),
      makeScenario({ expectedSkills: ['payments', 'seo'] }),
    );
    expect(result.verdict).toBe('fail');
    expect(result.score).toBe(0.5);
  });

  // ── Routing sub-check (agentId, available today) ──────────────

  it('routing: passes when expected agent handled a tool call', async () => {
    const result = await evaluator.evaluate(
      makeTranscript({ turns: [turnWithAgent('develop')] }),
      makeScenario({ expectedAgent: 'develop' }),
    );
    expect(result.verdict).toBe('pass');
    expect(result.details?.routing).toEqual({
      expected: 'develop',
      matched: true,
    });
  });

  it('routing: fails when expected agent never handled a tool call', async () => {
    const result = await evaluator.evaluate(
      makeTranscript({ turns: [turnWithAgent('marketing')] }),
      makeScenario({ expectedAgent: 'develop' }),
    );
    expect(result.verdict).toBe('fail');
  });

  it('routing works even when loadedSkills is absent (no instrumentation)', async () => {
    const result = await evaluator.evaluate(
      makeTranscript({ turns: [turnWithAgent('develop')] }),
      makeScenario({ expectedAgent: 'develop' }),
    );
    expect(result.verdict).toBe('pass');
  });

  // ── Combined ──────────────────────────────────────────────────

  it('combines routing (true) + skill-load proxy: routing alone decides', async () => {
    const result = await evaluator.evaluate(
      makeTranscript({ turns: [turnWithAgent('develop')] }),
      makeScenario({ expectedAgent: 'develop', expectedSkills: ['payments'] }),
    );
    // skill-load is proxy (unverified) but routing is evaluable and passes
    expect(result.verdict).toBe('pass');
    expect(result.details?.skillMode).toBe('proxy');
  });

  it('combines routing pass + skill-load fail (true mode) → fail', async () => {
    const result = await evaluator.evaluate(
      makeTranscript({
        turns: [turnWithAgent('develop')],
        loadedSkills: ['seo'],
      }),
      makeScenario({ expectedAgent: 'develop', expectedSkills: ['payments'] }),
    );
    expect(result.verdict).toBe('fail');
    expect(result.score).toBe(0.5);
  });
});
