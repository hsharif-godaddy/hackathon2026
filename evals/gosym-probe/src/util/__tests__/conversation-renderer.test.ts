import { describe, it, expect } from 'vitest';
import { renderConversation } from
  '../conversation-renderer.js';
import { makeTurn } from '../../reporters/__tests__/fixtures.js';

describe('renderConversation', () => {
  it('returns empty turns array for empty input', () => {
    const result = renderConversation([], 'my-scenario', 0);
    expect(result).toEqual({
      scenarioName: 'my-scenario',
      trial: 1,
      turns: [],
      summary: {
        messageCount: 0,
        totalElapsedSeconds: 0,
      },
    });
  });

  it('renders a single user turn with durationSeconds 0', () => {
    const result = renderConversation(
      [makeTurn('user', 'Hello there', 1000000)],
      'test-scenario',
      0,
    );
    expect(result.turns).toHaveLength(1);
    expect(result.turns[0]).toEqual({
      role: 'user',
      content: 'Hello there',
      durationSeconds: 0,
    });
  });

  it('renders user-assistant pair with correct durations', () => {
    const result = renderConversation(
      [
        makeTurn('user', 'Build me a page', 1000000),
        makeTurn('assistant', 'Sure thing!', 1005000),
      ],
      'test-scenario',
      0,
    );
    expect(result.turns[0].durationSeconds).toBe(0);
    expect(result.turns[1].durationSeconds).toBe(5);
  });

  it('skips turns with empty content', () => {
    const result = renderConversation(
      [
        makeTurn('user', 'Hello', 1000000),
        makeTurn('assistant', '', 1003000),
        makeTurn('assistant', 'Got it!', 1007000),
      ],
      'test-scenario',
      0,
    );
    expect(result.turns).toHaveLength(2);
    expect(result.turns[1].role).toBe('assistant');
    expect(result.turns[1].content).toBe('Got it!');
    // Duration is from previous content turn (user at 1000000) to this one (1007000)
    expect(result.turns[1].durationSeconds).toBe(7);
  });

  it('shows correct message count and elapsed time in summary', () => {
    const result = renderConversation(
      [
        makeTurn('user', 'First message', 1000000),
        makeTurn('assistant', '', 1002000),
        makeTurn('assistant', 'Response', 1005000),
        makeTurn('user', 'Follow up', 1010000),
      ],
      'test-scenario',
      0,
    );
    expect(result.summary.messageCount).toBe(3);
    expect(result.summary.totalElapsedSeconds).toBe(10);
  });

  it('renders multi-turn conversation', () => {
    const result = renderConversation(
      [
        makeTurn('user', 'Step one', 1000000),
        makeTurn('assistant', 'Done step one', 1003000),
        makeTurn('user', 'Step two', 1008000),
        makeTurn('assistant', 'Done step two', 1012500),
      ],
      'my-scenario',
      2,
    );

    expect(result.scenarioName).toBe('my-scenario');
    expect(result.trial).toBe(3);
    expect(result.turns).toHaveLength(4);
    expect(result.turns[0].durationSeconds).toBe(0);
    expect(result.turns[1].durationSeconds).toBe(3);
    expect(result.turns[2].durationSeconds).toBe(5);
    expect(result.turns[3].durationSeconds).toBe(4.5);
  });

  it('uses 1-based trial index', () => {
    const result = renderConversation(
      [makeTurn('user', 'Hi', 1000000)],
      'scenario',
      4,
    );
    expect(result.trial).toBe(5);
  });

  it('handles single turn summary correctly', () => {
    const result = renderConversation(
      [makeTurn('user', 'Only message', 1000000)],
      'test',
      0,
    );
    expect(result.summary.messageCount).toBe(1);
    expect(result.summary.totalElapsedSeconds).toBe(0);
  });

  it('all-empty-content turns shows 0 messages', () => {
    const result = renderConversation(
      [
        makeTurn('user', '', 1000000),
        makeTurn('assistant', '', 1003000),
      ],
      'test-scenario',
      0,
    );
    expect(result.summary.messageCount).toBe(0);
    expect(result.summary.totalElapsedSeconds).toBe(0);
    expect(result.turns).toHaveLength(0);
  });

  it('whitespace-only content is skipped', () => {
    const result = renderConversation(
      [
        makeTurn('user', 'Hello', 1000000),
        makeTurn('assistant', '   ', 1003000),
      ],
      'test-scenario',
      0,
    );
    expect(result.turns).toHaveLength(1);
    expect(result.summary.messageCount).toBe(1);
  });

  it('clamps negative duration to 0', () => {
    const result = renderConversation(
      [
        makeTurn('user', 'First', 1005000),
        makeTurn('assistant', 'Reply', 1002000),
      ],
      'test-scenario',
      0,
    );
    expect(result.turns[1].durationSeconds).toBe(0);
  });

  it('elapsed time uses last content-bearing turn', () => {
    const result = renderConversation(
      [
        makeTurn('user', 'msg', 1000000),
        makeTurn('assistant', 'Reply', 1003000),
        makeTurn('assistant', '', 1007000),
      ],
      'test-scenario',
      0,
    );
    expect(result.summary.totalElapsedSeconds).toBe(3);
  });

  it('handles NaN timestamp with durationSeconds 0', () => {
    const result = renderConversation(
      [
        makeTurn('user', 'First', 1000000),
        makeTurn('assistant', 'Reply', NaN),
      ],
      'test-scenario',
      0,
    );
    expect(result.turns[1].durationSeconds).toBe(0);
  });

  it('handles previous NaN followed by finite timestamp', () => {
    const result = renderConversation(
      [
        makeTurn('user', 'First', 1000000),
        makeTurn('assistant', 'Middle', NaN),
        makeTurn('user', 'Last', 1005000),
      ],
      'test-scenario',
      0,
    );
    expect(result.turns[2].durationSeconds).toBe(0);
  });

  it('handles all NaN timestamps with 0 elapsed', () => {
    const result = renderConversation(
      [
        makeTurn('user', 'First', NaN),
        makeTurn('assistant', 'Reply', NaN),
      ],
      'test-scenario',
      0,
    );
    expect(result.summary.totalElapsedSeconds).toBe(0);
    expect(result.turns[0].durationSeconds).toBe(0);
    expect(result.turns[1].durationSeconds).toBe(0);
  });

  it('clamps negative elapsed time to 0', () => {
    const result = renderConversation(
      [
        makeTurn('user', 'First', 1005000),
        makeTurn('assistant', 'Reply', 1002000),
      ],
      'test-scenario',
      0,
    );
    expect(result.summary.totalElapsedSeconds).toBe(0);
  });

  it('uses first finite timestamp as base when first turn has NaN', () => {
    const result = renderConversation(
      [
        makeTurn('user', 'First', NaN),
        makeTurn('assistant', 'Reply', 1000000),
        makeTurn('user', 'Done', 1005000),
      ],
      'test-scenario',
      0,
    );
    expect(result.summary.totalElapsedSeconds).toBe(5);
    expect(result.turns[0].durationSeconds).toBe(0);
    expect(result.turns[1].durationSeconds).toBe(0);
    expect(result.turns[2].durationSeconds).toBe(5);
  });
});
