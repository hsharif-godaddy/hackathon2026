import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createNarrowArtifactJudge } from '../narrow-artifact-judge.js';
import {
  makeScenario,
  makeTranscriptWith as makeTranscript,
} from './evaluator-test-helpers.js';
import type { GocodeClient } from '../../clients/gocode-client.js';
import type {
  ChecklistItem,
  ExpectedArtifactSpec,
} from '../../scenarios/types.js';

const capItem: ChecklistItem = {
  id: 'has-contact',
  description: 'a contact form exists',
  type: 'capability',
  domMatcher: () => true,
};
const secondCapItem: ChecklistItem = {
  id: 'mentions-fast',
  description: 'copy mentions speed',
  type: 'capability',
  textMatcher: { source: 'rendered', pattern: /fast/i },
};

function specOf(...items: ChecklistItem[]): ExpectedArtifactSpec {
  return { intent: 'build a site', items, evalVersion: 'v1' };
}

describe('narrow-artifact-judge', () => {
  let mockGocode: { complete: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.resetAllMocks();
    mockGocode = { complete: vi.fn() };
  });

  it('has the kebab-case evaluator name', () => {
    const judge = createNarrowArtifactJudge(
      mockGocode as unknown as GocodeClient,
    );
    expect(judge.name).toBe('narrow-artifact-judge');
  });

  it('returns unknown without calling the LLM when no artifact defined', async () => {
    const judge = createNarrowArtifactJudge(
      mockGocode as unknown as GocodeClient,
    );
    const result = await judge.evaluate(makeTranscript(), makeScenario());
    expect(result.verdict).toBe('incomplete');
    expect(mockGocode.complete).not.toHaveBeenCalled();
  });

  it('passes when the judge marks all items met', async () => {
    mockGocode.complete.mockResolvedValue(
      JSON.stringify({
        items: [{ id: 'has-contact', met: true, reason: 'form present' }],
      }),
    );
    const judge = createNarrowArtifactJudge(
      mockGocode as unknown as GocodeClient,
    );
    const result = await judge.evaluate(
      makeTranscript(),
      makeScenario({ expectedArtifact: specOf(capItem) }),
    );
    expect(result.verdict).toBe('pass');
    expect(result.evalVersion).toBe('v1');
  });

  it('hard-fails when a capability item is judged not met', async () => {
    mockGocode.complete.mockResolvedValue(
      JSON.stringify({
        items: [{ id: 'has-contact', met: false, reason: 'no form' }],
      }),
    );
    const judge = createNarrowArtifactJudge(
      mockGocode as unknown as GocodeClient,
    );
    const result = await judge.evaluate(
      makeTranscript(),
      makeScenario({ expectedArtifact: specOf(capItem) }),
    );
    expect(result.verdict).toBe('fail');
    expect(result.details?.hardFailures).toEqual(['has-contact']);
  });

  it('fails when any binary item is not met (no partial verdict)', async () => {
    mockGocode.complete.mockResolvedValue(
      JSON.stringify({
        items: [
          { id: 'has-contact', met: true, reason: 'form present' },
          { id: 'mentions-fast', met: false, reason: 'no speed copy' },
        ],
      }),
    );
    const judge = createNarrowArtifactJudge(
      mockGocode as unknown as GocodeClient,
    );
    const result = await judge.evaluate(
      makeTranscript(),
      makeScenario({ expectedArtifact: specOf(capItem, secondCapItem) }),
    );
    expect(result.verdict).toBe('fail');
  });

  it('marks an item unknown when the judge omits its verdict', async () => {
    mockGocode.complete.mockResolvedValue(
      JSON.stringify({ items: [] }),
    );
    const judge = createNarrowArtifactJudge(
      mockGocode as unknown as GocodeClient,
    );
    const result = await judge.evaluate(
      makeTranscript(),
      makeScenario({ expectedArtifact: specOf(capItem) }),
    );
    expect(result.verdict).toBe('incomplete');
    expect(result.details?.incompleteCount).toBe(1);
  });

  it('returns unknown on a malformed (non-JSON) response', async () => {
    mockGocode.complete.mockResolvedValue('I think it looks good!');
    const judge = createNarrowArtifactJudge(
      mockGocode as unknown as GocodeClient,
    );
    const result = await judge.evaluate(
      makeTranscript(),
      makeScenario({ expectedArtifact: specOf(capItem) }),
    );
    expect(result.verdict).toBe('incomplete');
  });

  it('includes the checklist item ids in the judge prompt', async () => {
    mockGocode.complete.mockResolvedValue(
      JSON.stringify({
        items: [{ id: 'has-contact', met: true, reason: 'ok' }],
      }),
    );
    const judge = createNarrowArtifactJudge(
      mockGocode as unknown as GocodeClient,
    );
    await judge.evaluate(
      makeTranscript(),
      makeScenario({ expectedArtifact: specOf(capItem) }),
    );
    const prompt = mockGocode.complete.mock.calls[0][0][0].content as string;
    expect(prompt).toContain('has-contact');
    expect(prompt).toContain('a contact form exists');
  });
});
