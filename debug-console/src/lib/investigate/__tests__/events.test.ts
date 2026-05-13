/**
 * Unit tests for event-log helpers: key derivation, seq parsing, and the
 * terminal-event predicate. Reader is integration-tested against a mocked
 * S3 client in a separate file when that lands.
 */
import { describe, expect, it } from 'vitest';

import {
  eventKey,
  isTerminalEvent,
  keysForInvestigation,
  seqFromKey,
  TERMINAL_EVENT_TYPES,
  type InvestigationEvent,
  type InvestigationEventType,
} from '../types';

function mkEvent(type: InvestigationEventType, seq = 1): InvestigationEvent {
  return {
    v: 1,
    seq,
    investigationId: 'inv-test',
    ts: '2026-05-12T00:00:00.000Z',
    type,
    data: {},
  };
}

describe('keysForInvestigation — eventsPrefix', () => {
  it('returns events prefix scoped to investigation', () => {
    const keys = keysForInvestigation('cust-a', 'app-b', 'inv-2026-05-12-xxx');
    expect(keys.eventsPrefix).toBe('events/cust-a/app-b/inv-2026-05-12-xxx/');
  });

  it('url-encodes customer and app ids in events prefix too', () => {
    const keys = keysForInvestigation('a/b', 'app?x', 'inv-1');
    expect(keys.eventsPrefix).toBe('events/a%2Fb/app%3Fx/inv-1/');
  });
});

describe('eventKey', () => {
  it('zero-pads seq to 6 digits', () => {
    expect(eventKey('events/c/a/id/', 1)).toBe('events/c/a/id/000001.json');
    expect(eventKey('events/c/a/id/', 42)).toBe('events/c/a/id/000042.json');
    expect(eventKey('events/c/a/id/', 999999)).toBe('events/c/a/id/999999.json');
  });
});

describe('seqFromKey', () => {
  it('parses padded seq from key suffix', () => {
    expect(seqFromKey('events/c/a/id/000001.json')).toBe(1);
    expect(seqFromKey('events/c/a/id/012345.json')).toBe(12345);
  });

  it('returns null for unpadded or non-event keys', () => {
    expect(seqFromKey('events/c/a/id/1.json')).toBeNull();
    expect(seqFromKey('events/c/a/id/state.json')).toBeNull();
    expect(seqFromKey('')).toBeNull();
  });
});

describe('isTerminalEvent', () => {
  it('returns true for completed, failed, killed', () => {
    expect(isTerminalEvent(mkEvent('investigation.completed'))).toBe(true);
    expect(isTerminalEvent(mkEvent('investigation.failed'))).toBe(true);
    expect(isTerminalEvent(mkEvent('investigation.killed'))).toBe(true);
  });

  it('returns false for non-terminal events', () => {
    expect(isTerminalEvent(mkEvent('investigation.started'))).toBe(false);
    expect(isTerminalEvent(mkEvent('phase.started'))).toBe(false);
    expect(isTerminalEvent(mkEvent('heartbeat'))).toBe(false);
    expect(isTerminalEvent(mkEvent('log'))).toBe(false);
    expect(isTerminalEvent(mkEvent('report.ready'))).toBe(false);
    expect(isTerminalEvent(mkEvent('evidence.ready'))).toBe(false);
  });

  it('terminal set matches the expected three types', () => {
    expect(Array.from(TERMINAL_EVENT_TYPES).sort()).toEqual([
      'investigation.completed',
      'investigation.failed',
      'investigation.killed',
    ]);
  });
});
