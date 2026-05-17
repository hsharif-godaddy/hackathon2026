import { describe, it, expect } from 'vitest';
import { walkLinearChain } from '../asm-chain.js';
import type { AsmMessage } from '../asm-types.js';

function makeMsg(id: string, responseTo?: string[], createdAt?: string): AsmMessage {
  return {
    id,
    createdAt: createdAt ?? '2024-01-01T00:00:00Z',
    contents: [{ __typename: 'TextContent', text: id }],
    participant: { id: 'user', type: 'USER' },
    responseTo,
  };
}

describe('walkLinearChain', function chainTests() {
  it('should return empty array for empty input', function emptyInput() {
    expect(walkLinearChain([])).toEqual([]);
  });

  it('should return single message for one-element array', function singleMsg() {
    const msg = makeMsg('m1');
    expect(walkLinearChain([msg])).toEqual([msg]);
  });

  it('should walk from head to root in chronological order', function linearOrder() {
    const m1 = makeMsg('m1', undefined, '2024-01-01T00:00:00Z');
    const m2 = makeMsg('m2', ['m1'], '2024-01-01T00:00:01Z');
    const m3 = makeMsg('m3', ['m2'], '2024-01-01T00:00:02Z');
    const result = walkLinearChain([m1, m2, m3]);
    expect(result.map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
  });

  it('should handle messages in non-chronological order', function outOfOrder() {
    const m1 = makeMsg('m1', undefined, '2024-01-01T00:00:00Z');
    const m2 = makeMsg('m2', ['m1'], '2024-01-01T00:00:01Z');
    const m3 = makeMsg('m3', ['m2'], '2024-01-01T00:00:02Z');
    const result = walkLinearChain([m3, m1, m2]);
    expect(result.map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
  });

  it('should detect and break cycles', function cycleDetection() {
    const m1 = makeMsg('m1', ['m2'], '2024-01-01T00:00:00Z');
    const m2 = makeMsg('m2', ['m1'], '2024-01-01T00:00:01Z');
    const result = walkLinearChain([m1, m2]);
    expect(result.length).toBeLessThanOrEqual(2);
    expect(new Set(result.map((m) => m.id)).size).toBe(result.length);
  });

  it('should handle self-referencing message', function selfRef() {
    const m1 = makeMsg('m1', ['m1'], '2024-01-01T00:00:00Z');
    const result = walkLinearChain([m1]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('m1');
  });

  it('should pick head by latest createdAt when multiple unreferenced messages exist', function multipleHeads() {
    const m1 = makeMsg('m1', undefined, '2024-01-01T00:00:00Z');
    const m2 = makeMsg('m2', ['m1'], '2024-01-01T00:00:01Z');
    const orphan = makeMsg('orphan', ['nonexistent'], '2024-01-01T00:00:03Z');
    const result = walkLinearChain([m1, m2, orphan]);
    expect(result[result.length - 1].id).toBe('orphan');
  });

  it('should handle dangling responseTo (parent not in set)', function danglingParent() {
    const m1 = makeMsg('m1', ['missing-parent'], '2024-01-01T00:00:00Z');
    const result = walkLinearChain([m1]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('m1');
  });
});
