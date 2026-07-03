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

function turnLoadingSkill(skill: string): Turn {
  return {
    role: 'assistant',
    content: '',
    toolCalls: [
      {
        id: `load-${skill}`,
        name: 'skill',
        input: { action: 'load', skill },
        startTime: 0,
        endTime: 1,
      },
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
    expect(result.verdict).toBe('incomplete');
  });

  // ── Skill-load sub-check ──────────────────────────────────────

  it('proxy mode: returns unknown when only skills expected and loadedSkills absent', async () => {
    const result = await evaluator.evaluate(
      makeTranscript(),
      makeScenario({ expectedSkills: ['payments'] }),
    );
    expect(result.verdict).toBe('incomplete');
    expect(result.details?.skillMode).toBe('proxy');
  });

  it('proxy mode: a skill({action:load}) tool call confirms a pass without instrumentation', async () => {
    const result = await evaluator.evaluate(
      makeTranscript({ turns: [turnLoadingSkill('payments')] }),
      makeScenario({ expectedSkills: ['payments'] }),
    );
    expect(result.verdict).toBe('pass');
    expect(result.score).toBe(1);
    expect(result.details?.skillMode).toBe('proxy');
    expect(result.details?.proxyConfirmedSkills).toEqual(['payments']);
  });

  it('proxy mode: tool-call match tolerates nested vs bare skill names', async () => {
    const result = await evaluator.evaluate(
      makeTranscript({ turns: [turnLoadingSkill('payment/stripe')] }),
      makeScenario({ expectedSkills: ['stripe'] }),
    );
    expect(result.verdict).toBe('pass');
    expect(result.details?.skillMode).toBe('proxy');
  });

  it('proxy mode: unconfirmed expected skill stays unknown, never fails', async () => {
    const result = await evaluator.evaluate(
      makeTranscript({ turns: [turnLoadingSkill('seo')] }),
      makeScenario({ expectedSkills: ['payments'] }),
    );
    // 'payments' was not loaded via a tool call, but absence is not proof of
    // non-loading (auto-load/pin/hook), so it must not fail — no evaluable
    // check remains, so the verdict is unknown.
    expect(result.verdict).toBe('incomplete');
    expect(result.details?.skillMode).toBe('proxy');
  });

  it('proxy mode: confirms the loaded subset and leaves the rest unknown (partial → pass on evaluable)', async () => {
    const result = await evaluator.evaluate(
      makeTranscript({ turns: [turnLoadingSkill('payments')] }),
      makeScenario({ expectedSkills: ['payments', 'seo'] }),
    );
    // Only 'payments' is confirmable via tool call; 'seo' stays unknown
    // (not a failure). The one evaluable check passes → pass, score 1.
    expect(result.verdict).toBe('pass');
    expect(result.score).toBe(1);
    expect(result.details?.proxyConfirmedSkills).toEqual(['payments']);
  });

  it('proxy mode: non-load skill actions (list/install) do not confirm', async () => {
    const installTurn: Turn = {
      role: 'assistant',
      content: '',
      toolCalls: [
        {
          id: 'inst',
          name: 'skill',
          input: { action: 'install', skill: 'payments' },
          startTime: 0,
          endTime: 1,
        },
      ],
      timestamp: 0,
    };
    const result = await evaluator.evaluate(
      makeTranscript({ turns: [installTurn] }),
      makeScenario({ expectedSkills: ['payments'] }),
    );
    expect(result.verdict).toBe('incomplete');
  });

  it('true mode takes precedence over tool-call evidence when instrumentation is present', async () => {
    // loadedSkills present but does NOT include 'payments', even though a
    // load tool call fired — true mode is authoritative and fails it.
    const result = await evaluator.evaluate(
      makeTranscript({
        turns: [turnLoadingSkill('payments')],
        loadedSkills: ['seo'],
      }),
      makeScenario({ expectedSkills: ['payments'] }),
    );
    expect(result.verdict).toBe('fail');
    expect(result.details?.skillMode).toBe('true');
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

  // ── requireSkillDiagnostics: absent instrumentation is loud ───

  it('required mode: fails (not unknown) when instrumentation is absent', async () => {
    const strict = new SkillSelectionEvaluator({ requireSkillDiagnostics: true });
    const result = await strict.evaluate(
      makeTranscript(),
      makeScenario({ expectedSkills: ['payments'] }),
    );
    expect(result.verdict).toBe('fail');
    expect(result.score).toBe(0);
    expect(result.details?.skillMode).toBe('missing-instrumentation');
  });

  it('required mode: a load tool call does NOT rescue a missing-instrumentation gate', async () => {
    // The point of required mode is that the deterministic signal must be live;
    // the best-effort proxy (which can only pass) must not paper over its
    // absence.
    const strict = new SkillSelectionEvaluator({ requireSkillDiagnostics: true });
    const result = await strict.evaluate(
      makeTranscript({ turns: [turnLoadingSkill('payments')] }),
      makeScenario({ expectedSkills: ['payments'] }),
    );
    expect(result.verdict).toBe('fail');
    expect(result.details?.skillMode).toBe('missing-instrumentation');
  });

  it('required mode: still fails loud even when routing passes (gate not silently dropped)', async () => {
    const strict = new SkillSelectionEvaluator({ requireSkillDiagnostics: true });
    const result = await strict.evaluate(
      makeTranscript({ turns: [turnWithAgent('develop')] }),
      makeScenario({ expectedAgent: 'develop', expectedSkills: ['payments'] }),
    );
    // routing sub-check passes but the required skill-load gate is unverifiable
    expect(result.verdict).toBe('fail');
    expect(result.score).toBe(0.5);
    expect(result.details?.skillMode).toBe('missing-instrumentation');
  });

  it('required mode: verifies normally when instrumentation IS present', async () => {
    const strict = new SkillSelectionEvaluator({ requireSkillDiagnostics: true });
    const result = await strict.evaluate(
      makeTranscript({ loadedSkills: ['payments'] }),
      makeScenario({ expectedSkills: ['payments'] }),
    );
    expect(result.verdict).toBe('pass');
    expect(result.details?.skillMode).toBe('true');
  });

  it('required mode: no expectations still yields incomplete (nothing to gate)', async () => {
    const strict = new SkillSelectionEvaluator({ requireSkillDiagnostics: true });
    const result = await strict.evaluate(makeTranscript(), makeScenario());
    expect(result.verdict).toBe('incomplete');
  });

  it('required mode marks the evaluator as gating (aggregator treats a crash as a hard fail)', () => {
    expect(new SkillSelectionEvaluator({ requireSkillDiagnostics: true }).gating).toBe(true);
  });

  it('best-effort (proxy) mode is not gating', () => {
    expect(new SkillSelectionEvaluator().gating).toBe(false);
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
