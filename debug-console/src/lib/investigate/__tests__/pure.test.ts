/**
 * Unit tests for the pure functions in the investigate/ module. These
 * functions gate zombie-takeover and S3 key routing; regressing them
 * would silently corrupt lock acquisition or cross-customer artifacts.
 *
 * Mocking-free by design — same rationale as feedback-s3-pure.test.ts:
 * keep the pure kernel of the feature covered so refactors can't drift
 * without turning something red.
 */
import { describe, expect, it } from 'vitest';

import { isStaleHeartbeat, isTerminal } from '../state';
import { keysFor, keysForSummary, keysForSummaryPointer } from '../types';
import type { InvestigationState } from '../types';

function mkState(overrides: Partial<InvestigationState> = {}): InvestigationState {
  return {
    investigationId: 'inv-test',
    appId: 'app123',
    customerId: 'cust-uuid',
    status: 'running',
    startedAt: new Date().toISOString(),
    startedBy: 'skilaru',
    updatedAt: new Date().toISOString(),
    heartbeatAt: new Date().toISOString(),
    phase: 'phase-0-gather',
    lastEvent: null,
    input: { feedback: 'test' },
    resultKey: null,
    reportFilename: null,
    completedAt: null,
    durationMs: null,
    lambdaRequestId: null,
    error: null,
    ...overrides,
  };
}

describe('isTerminal', () => {
  it('returns true for completed', () => {
    expect(isTerminal('completed')).toBe(true);
  });
  it('returns true for failed', () => {
    expect(isTerminal('failed')).toBe(true);
  });
  it('returns true for killed', () => {
    expect(isTerminal('killed')).toBe(true);
  });
  it('returns false for running', () => {
    expect(isTerminal('running')).toBe(false);
  });
  it('returns false for pending', () => {
    expect(isTerminal('pending')).toBe(false);
  });
});

describe('isStaleHeartbeat', () => {
  it('returns false for a fresh heartbeat (just now)', () => {
    expect(isStaleHeartbeat(mkState({ heartbeatAt: new Date().toISOString() }))).toBe(false);
  });

  it('returns true for a heartbeat older than the stale threshold', () => {
    // Threshold is 60s; pick something safely past it.
    const twoMinutesAgo = new Date(Date.now() - 120_000).toISOString();
    expect(isStaleHeartbeat(mkState({ heartbeatAt: twoMinutesAgo }))).toBe(true);
  });

  it('returns true when heartbeatAt is missing/empty', () => {
    // Cast through unknown because the field is typed as string; the
    // runtime guard is defensive for malformed/old state documents.
    expect(isStaleHeartbeat(mkState({ heartbeatAt: '' as unknown as string }))).toBe(true);
  });

  it('returns true when heartbeatAt is unparseable garbage', () => {
    expect(isStaleHeartbeat(mkState({ heartbeatAt: 'not-a-date' }))).toBe(true);
  });
});

describe('keysFor', () => {
  it('builds the active stateKey and resultKey and the history prefix', () => {
    const keys = keysFor('cust-uuid', 'app123');
    expect(keys.stateKey).toBe('active/cust-uuid/app123/state.json');
    expect(keys.resultKey).toBe('active/cust-uuid/app123/result.md');
    expect(keys.historyPrefix).toBe('history/cust-uuid/app123/');
    expect(keys.tracePrefix).toBe('active/cust-uuid/app123/');
  });

  it('URL-encodes customerId and appId so path traversal/illegal chars are neutralized', () => {
    // A customerId that contains a slash would otherwise escape the
    // `active/` prefix and could read/write into another customer's
    // space. encodeURIComponent turns it into %2F.
    const keys = keysFor('a/b', 'app/with/slashes');
    expect(keys.stateKey).toBe('active/a%2Fb/app%2Fwith%2Fslashes/state.json');
    expect(keys.historyPrefix).toBe('history/a%2Fb/app%2Fwith%2Fslashes/');
  });

  it('URL-encodes spaces and special characters', () => {
    const keys = keysFor('cust id', 'app+id?x');
    expect(keys.stateKey).toBe('active/cust%20id/app%2Bid%3Fx/state.json');
  });
});

describe('keysForSummary', () => {
  it('builds yyyy-mm-dd partitioned key', () => {
    expect(keysForSummary('2026-05-14', 'inv-2026-05-14-deadbeef'))
      .toBe('summaries/2026-05-14/inv-2026-05-14-deadbeef.json');
  });

  it('rejects malformed dates', () => {
    expect(() => keysForSummary('2026/05/14', 'inv-x')).toThrow(/yyyy-mm-dd/);
    expect(() => keysForSummary('not-a-date', 'inv-x')).toThrow(/yyyy-mm-dd/);
  });

  it('rejects malformed investigationIds', () => {
    expect(() => keysForSummary('2026-05-14', '../../etc/passwd')).toThrow(/investigationId/);
    expect(() => keysForSummary('2026-05-14', '')).toThrow(/investigationId/);
  });
});

describe('keysForSummaryPointer', () => {
  it('builds pointer key under _meta', () => {
    expect(keysForSummaryPointer('inv-2026-05-14-deadbeef'))
      .toBe('summaries/_meta/inv-2026-05-14-deadbeef.pointer.json');
  });
});
