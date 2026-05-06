import { describe, it, expect } from 'vitest';
import { renderConversation } from
  '../conversation-renderer.js';
import { makeTurn } from '../../reporters/__tests__/fixtures.js';

// ── Tests ──────────────────────────────────────────────────

describe('renderConversation', () => {
  it('returns header with no-turns note for empty array', () => {
    const result = renderConversation(
      [],
      'my-scenario',
      0,
    );
    expect(result).toContain(
      '# Conversation: my-scenario (Trial 1)',
    );
    expect(result).toContain('(no turns)');
  });

  it('renders a single user turn with +0.0s timestamp', () => {
    const result = renderConversation(
      [makeTurn('user', 'Hello there', 1000000)],
      'test-scenario',
      0,
    );
    expect(result).toContain('**User** [+0.0s]');
    expect(result).toContain('Hello there');
  });

  it('renders user-assistant pair with relative times', () => {
    const result = renderConversation(
      [
        makeTurn('user', 'Build me a page', 1000000),
        makeTurn('assistant', 'Sure thing!', 1005000),
      ],
      'test-scenario',
      0,
    );
    expect(result).toContain('**User** [+0.0s]');
    expect(result).toContain('Build me a page');
    expect(result).toContain('**Assistant** [+5.0s]');
    expect(result).toContain('Sure thing!');
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
    expect(result).not.toMatch(
      /\*\*Assistant\*\* \[\+3\.0s\]/,
    );
    expect(result).toContain('**Assistant** [+7.0s]');
    expect(result).toContain('Got it!');
  });

  it('shows correct turn count and elapsed time in footer', () => {
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
    // 3 content-bearing turns (skip empty assistant)
    expect(result).toContain('3 messages');
    expect(result).toContain('10.0s elapsed');
  });

  it('renders multi-turn conversation with separators', () => {
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

    expect(result).toContain(
      '# Conversation: my-scenario (Trial 3)',
    );
    expect(result).toContain('**User** [+0.0s]');
    expect(result).toContain('**Assistant** [+3.0s]');
    expect(result).toContain('**User** [+8.0s]');
    expect(result).toContain('**Assistant** [+12.5s]');

    // Each turn separated by ---
    const separators = result.match(/^---$/gm);
    expect(separators!.length).toBeGreaterThanOrEqual(4);
  });

  it('uses 1-based trial index in header', () => {
    const result = renderConversation(
      [makeTurn('user', 'Hi', 1000000)],
      'scenario',
      4,
    );
    expect(result).toContain('(Trial 5)');
  });

  it('handles single turn footer correctly', () => {
    const result = renderConversation(
      [makeTurn('user', 'Only message', 1000000)],
      'test',
      0,
    );
    expect(result).toContain('1 message,');
    expect(result).toContain('0.0s elapsed');
  });

  // ── New edge case tests (Phase 2) ─────────────────────────

  it('all-empty-content turns shows 0 messages and 0.0s', () => {
    const result = renderConversation(
      [
        makeTurn('user', '', 1000000),
        makeTurn('assistant', '', 1003000),
      ],
      'test-scenario',
      0,
    );
    expect(result).toContain('0 messages');
    expect(result).toContain('0.0s elapsed');
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
    expect(result).not.toMatch(
      /\*\*Assistant\*\* \[\+3\.0s\]/,
    );
    expect(result).toContain('1 message,');
  });

  it('shows negative offset for out-of-order timestamps', () => {
    const result = renderConversation(
      [
        makeTurn('user', 'First', 1005000),
        makeTurn('assistant', 'Reply', 1002000),
      ],
      'test-scenario',
      0,
    );
    expect(result).toContain('**User** [+0.0s]');
    expect(result).toContain('**Assistant** [-3.0s]');
  });

  it('elapsed time uses last content-bearing turn', () => {
    // Empty turn at 7000ms should not affect elapsed time;
    // last content turn is at 3000ms → 3.0s elapsed
    const result = renderConversation(
      [
        makeTurn('user', 'msg', 1000000),
        makeTurn('assistant', 'Reply', 1003000),
        makeTurn('assistant', '', 1007000),
      ],
      'test-scenario',
      0,
    );
    expect(result).toContain('3.0s elapsed');
    expect(result).not.toContain('7.0s elapsed');
  });

  it('renders +0.0s for NaN timestamp offset', () => {
    const result = renderConversation(
      [
        makeTurn('user', 'First', 1000000),
        makeTurn('assistant', 'Reply', NaN),
      ],
      'test-scenario',
      0,
    );
    expect(result).toContain('**Assistant** [+0.0s]');
    expect(result).not.toContain('NaN');
  });

  it('renders 0.0s elapsed when all timestamps are NaN', () => {
    const result = renderConversation(
      [
        makeTurn('user', 'First', NaN),
        makeTurn('assistant', 'Reply', NaN),
      ],
      'test-scenario',
      0,
    );
    expect(result).toContain('0.0s elapsed');
    expect(result).not.toContain('NaN');
  });

  it('clamps negative elapsed time to 0.0s', () => {
    // Out-of-order timestamps can produce a negative elapsed value
    // (last content turn is earlier than the first turn).
    const result = renderConversation(
      [
        makeTurn('user', 'First', 1005000),
        makeTurn('assistant', 'Reply', 1002000),
      ],
      'test-scenario',
      0,
    );
    expect(result).toContain('0.0s elapsed');
    expect(result).not.toMatch(/-\d+\.\ds elapsed/);
  });

  it('uses first finite timestamp as base when first turn has NaN timestamp', () => {
    // Turn 1: NaN — not a valid base; Turn 2: 1000000 — becomes base.
    // Turn 3 at 1005000 must show a meaningful +5.0s offset, not +0.0s.
    const result = renderConversation(
      [
        makeTurn('user', 'First', NaN),
        makeTurn('assistant', 'Reply', 1000000),
        makeTurn('user', 'Done', 1005000),
      ],
      'test-scenario',
      0,
    );
    expect(result).toContain('**Assistant** [+0.0s]');
    expect(result).toContain('**User** [+5.0s]');
    expect(result).not.toContain('NaN');
  });
});
