import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RateLimitError } from 'openai';

import { createSkillOutcomeEvaluator } from '../skill-outcome.js';
import {
  makeScenario,
  makeTranscriptWith,
  makeAssistantTurn,
  makeToolCall,
  makeUserTurn,
} from './evaluator-test-helpers.js';
import type { IGocodeClient } from '../../clients/gocode-client.js';
import type { SkillInstruction } from '../../scenarios/types.js';

function mockGocode(): { complete: ReturnType<typeof vi.fn>; getAccumulatedUsage: ReturnType<typeof vi.fn> } {
  return {
    complete: vi.fn(),
    getAccumulatedUsage: vi.fn().mockReturnValue({
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      calls: 0,
    }),
  };
}

const requiredInstruction: SkillInstruction = {
  id: 'uses-form-component',
  instruction: 'Agent must use a form component for contact',
  priority: 'required',
};

const advisoryInstruction: SkillInstruction = {
  id: 'adds-placeholder-text',
  instruction: 'Agent should add placeholder text to inputs',
  priority: 'advisory',
};

describe('skill-outcome evaluator', () => {
  let gocode: ReturnType<typeof mockGocode>;

  beforeEach(() => {
    vi.resetAllMocks();
    gocode = mockGocode();
  });

  it('has the correct evaluator name', () => {
    const evaluator = createSkillOutcomeEvaluator(
      gocode as unknown as IGocodeClient,
    );
    expect(evaluator.name).toBe('skill-outcome');
  });

  describe('boundary tests', () => {
    it('returns unknown when scenario has no skillInstructions', async () => {
      const evaluator = createSkillOutcomeEvaluator(
        gocode as unknown as IGocodeClient,
      );
      const result = await evaluator.evaluate(
        makeTranscriptWith(),
        makeScenario(),
      );
      expect(result.verdict).toBe('unknown');
      expect(gocode.complete).not.toHaveBeenCalled();
    });

    it('returns unknown when scenario has undefined skillInstructions', async () => {
      const evaluator = createSkillOutcomeEvaluator(
        gocode as unknown as IGocodeClient,
      );
      const result = await evaluator.evaluate(
        makeTranscriptWith(),
        makeScenario({ skillInstructions: undefined }),
      );
      expect(result.verdict).toBe('unknown');
      expect(gocode.complete).not.toHaveBeenCalled();
    });

    it('returns unknown when scenario has empty skillInstructions array', async () => {
      const evaluator = createSkillOutcomeEvaluator(
        gocode as unknown as IGocodeClient,
      );
      const result = await evaluator.evaluate(
        makeTranscriptWith(),
        makeScenario({ skillInstructions: [] }),
      );
      expect(result.verdict).toBe('unknown');
      expect(gocode.complete).not.toHaveBeenCalled();
    });

    it('runs evaluator even when transcript has no turns', async () => {
      gocode.complete.mockResolvedValue(
        JSON.stringify({
          items: [{ id: 'uses-form-component', followed: true, reason: 'form present' }],
        }),
      );
      const evaluator = createSkillOutcomeEvaluator(
        gocode as unknown as IGocodeClient,
      );
      const result = await evaluator.evaluate(
        makeTranscriptWith({ turns: [] }),
        makeScenario({ skillInstructions: [requiredInstruction] }),
      );
      expect(gocode.complete).toHaveBeenCalled();
      expect(result.verdict).not.toBe('unknown');
    });
  });

  describe('error path tests', () => {
    it('returns unknown when LLM throws RateLimitError (429)', async () => {
      const rateLimitError = new RateLimitError(
        429, undefined, 'Rate limited', new Headers(),
      );
      gocode.complete.mockRejectedValue(rateLimitError);
      const evaluator = createSkillOutcomeEvaluator(
        gocode as unknown as IGocodeClient,
      );
      const result = await evaluator.evaluate(
        makeTranscriptWith(),
        makeScenario({ skillInstructions: [requiredInstruction] }),
      );
      expect(result.verdict).toBe('unknown');
      expect(result.score).toBe(0);
    });

    it('returns unknown when LLM returns malformed JSON', async () => {
      gocode.complete.mockResolvedValue('This is not valid JSON at all');
      const evaluator = createSkillOutcomeEvaluator(
        gocode as unknown as IGocodeClient,
      );
      const result = await evaluator.evaluate(
        makeTranscriptWith(),
        makeScenario({ skillInstructions: [requiredInstruction] }),
      );
      expect(result.verdict).toBe('unknown');
    });

    it('returns unknown when LLM returns valid JSON missing item IDs', async () => {
      gocode.complete.mockResolvedValue(
        JSON.stringify({
          items: [{ id: 'wrong-id', followed: true, reason: 'ok' }],
        }),
      );
      const evaluator = createSkillOutcomeEvaluator(
        gocode as unknown as IGocodeClient,
      );
      const result = await evaluator.evaluate(
        makeTranscriptWith(),
        makeScenario({ skillInstructions: [requiredInstruction] }),
      );
      expect(result.verdict).toBe('unknown');
      expect(result.details?.unknownCount).toBe(1);
    });

    it('returns unknown when LLM response has wrong schema shape', async () => {
      gocode.complete.mockResolvedValue(
        JSON.stringify({ verdict: 'pass', score: 1.0 }),
      );
      const evaluator = createSkillOutcomeEvaluator(
        gocode as unknown as IGocodeClient,
      );
      const result = await evaluator.evaluate(
        makeTranscriptWith(),
        makeScenario({ skillInstructions: [requiredInstruction] }),
      );
      expect(result.verdict).toBe('unknown');
    });
  });

  describe('edge case tests', () => {
    it('returns pass with score 1.0 when all instructions are followed', async () => {
      gocode.complete.mockResolvedValue(
        JSON.stringify({
          items: [
            { id: 'uses-form-component', followed: true, reason: 'form used' },
            { id: 'adds-placeholder-text', followed: true, reason: 'placeholders added' },
          ],
        }),
      );
      const evaluator = createSkillOutcomeEvaluator(
        gocode as unknown as IGocodeClient,
      );
      const result = await evaluator.evaluate(
        makeTranscriptWith(),
        makeScenario({
          skillInstructions: [requiredInstruction, advisoryInstruction],
        }),
      );
      expect(result.verdict).toBe('pass');
      expect(result.score).toBe(1.0);
    });

    it('returns fail when a required instruction is not followed', async () => {
      gocode.complete.mockResolvedValue(
        JSON.stringify({
          items: [
            { id: 'uses-form-component', followed: false, reason: 'no form' },
          ],
        }),
      );
      const evaluator = createSkillOutcomeEvaluator(
        gocode as unknown as IGocodeClient,
      );
      const result = await evaluator.evaluate(
        makeTranscriptWith(),
        makeScenario({ skillInstructions: [requiredInstruction] }),
      );
      expect(result.verdict).toBe('fail');
      expect(result.details?.hardFailures).toContain('uses-form-component');
    });

    it('returns partial when only an advisory instruction is not followed', async () => {
      gocode.complete.mockResolvedValue(
        JSON.stringify({
          items: [
            { id: 'adds-placeholder-text', followed: false, reason: 'no placeholders' },
          ],
        }),
      );
      const evaluator = createSkillOutcomeEvaluator(
        gocode as unknown as IGocodeClient,
      );
      const result = await evaluator.evaluate(
        makeTranscriptWith(),
        makeScenario({ skillInstructions: [advisoryInstruction] }),
      );
      expect(result.verdict).toBe('partial');
      expect(result.details?.directionalFailures).toContain('adds-placeholder-text');
    });

    it('returns fail when required fails even if advisory passes (required dominates)', async () => {
      gocode.complete.mockResolvedValue(
        JSON.stringify({
          items: [
            { id: 'uses-form-component', followed: false, reason: 'no form' },
            { id: 'adds-placeholder-text', followed: true, reason: 'placeholders present' },
          ],
        }),
      );
      const evaluator = createSkillOutcomeEvaluator(
        gocode as unknown as IGocodeClient,
      );
      const result = await evaluator.evaluate(
        makeTranscriptWith(),
        makeScenario({
          skillInstructions: [requiredInstruction, advisoryInstruction],
        }),
      );
      expect(result.verdict).toBe('fail');
      expect(result.score).toBe(0.5);
    });

    it('includes instruction IDs and text in the judge prompt', async () => {
      gocode.complete.mockResolvedValue(
        JSON.stringify({
          items: [{ id: 'uses-form-component', followed: true, reason: 'ok' }],
        }),
      );
      const evaluator = createSkillOutcomeEvaluator(
        gocode as unknown as IGocodeClient,
      );
      await evaluator.evaluate(
        makeTranscriptWith({
          turns: [
            makeUserTurn(),
            makeAssistantTurn({
              content: 'I added a contact form',
              toolCalls: [makeToolCall({ name: 'write_file', input: { path: 'contact.tsx' } })],
            }),
          ],
        }),
        makeScenario({ skillInstructions: [requiredInstruction] }),
      );
      const prompt = gocode.complete.mock.calls[0][0][0].content as string;
      expect(prompt).toContain('uses-form-component');
      expect(prompt).toContain('Agent must use a form component for contact');
      expect(prompt).toContain('required');
    });

    it('includes tool call evidence in the prompt', async () => {
      gocode.complete.mockResolvedValue(
        JSON.stringify({
          items: [{ id: 'uses-form-component', followed: true, reason: 'ok' }],
        }),
      );
      const evaluator = createSkillOutcomeEvaluator(
        gocode as unknown as IGocodeClient,
      );
      await evaluator.evaluate(
        makeTranscriptWith({
          turns: [
            makeAssistantTurn({
              toolCalls: [makeToolCall({ name: 'write_file', input: { path: 'form.tsx' } })],
            }),
          ],
        }),
        makeScenario({ skillInstructions: [requiredInstruction] }),
      );
      const prompt = gocode.complete.mock.calls[0][0][0].content as string;
      expect(prompt).toContain('write_file');
    });
  });
});
