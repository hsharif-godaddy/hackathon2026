import { describe, it, expect } from 'vitest';

import {
  DEFAULT_MAX_NETWORK_FAILURES,
  NetworkFailureLog,
  type NetworkFailure,
} from '../network-failures.js';

function failure(overrides: Partial<NetworkFailure> = {}): NetworkFailure {
  return {
    url: 'https://preview.local/src/main.tsx',
    detail: 'HTTP 500',
    isRateLimit: false,
    ...overrides,
  };
}

describe('NetworkFailureLog', () => {
  it('records distinct failures in first-occurrence order', () => {
    const log = new NetworkFailureLog();
    log.record(failure({ url: 'a', detail: 'HTTP 500' }));
    log.record(failure({ url: 'b', detail: 'HTTP 502' }));

    expect(log.toArray().map((f) => f.url)).toEqual(['a', 'b']);
    expect(log.size).toBe(2);
  });

  it('collapses repeats of the same url+detail (retry re-fires)', () => {
    const log = new NetworkFailureLog();
    // Same failing sub-resource re-observed across ~6 readiness reloads.
    const added = [
      log.record(failure()),
      log.record(failure()),
      log.record(failure()),
    ];

    expect(added).toEqual([true, false, false]);
    expect(log.size).toBe(1);
    expect(log.wasCapped).toBe(false);
  });

  it('treats same url with a different status as distinct', () => {
    const log = new NetworkFailureLog();
    log.record(failure({ url: 'x', detail: 'HTTP 500' }));
    log.record(failure({ url: 'x', detail: 'HTTP 503' }));

    expect(log.size).toBe(2);
  });

  it('caps the distinct set and reports wasCapped', () => {
    const log = new NetworkFailureLog(3);
    for (let i = 0; i < 10; i++) {
      log.record(failure({ url: `https://preview.local/r${i}`, detail: 'HTTP 500' }));
    }

    expect(log.size).toBe(3);
    expect(log.wasCapped).toBe(true);
    expect(log.toArray().map((f) => f.url)).toEqual([
      'https://preview.local/r0',
      'https://preview.local/r1',
      'https://preview.local/r2',
    ]);
  });

  it('does not flag wasCapped when exactly at the cap', () => {
    const log = new NetworkFailureLog(2);
    log.record(failure({ url: 'a' }));
    log.record(failure({ url: 'b' }));

    expect(log.size).toBe(2);
    expect(log.wasCapped).toBe(false);
  });

  it('defaults the cap to DEFAULT_MAX_NETWORK_FAILURES', () => {
    const log = new NetworkFailureLog();
    for (let i = 0; i < DEFAULT_MAX_NETWORK_FAILURES + 25; i++) {
      log.record(failure({ url: `https://preview.local/r${i}` }));
    }

    expect(log.size).toBe(DEFAULT_MAX_NETWORK_FAILURES);
    expect(log.wasCapped).toBe(true);
  });
});
