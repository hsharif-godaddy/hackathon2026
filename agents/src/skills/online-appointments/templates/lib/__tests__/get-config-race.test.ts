/**
 * Regression test: concurrent getConfig() calls must not trigger multiple loadConfig() calls.
 *
 * Before the fix, two near-simultaneous getConfig() calls would each call loadConfig()
 * because the result was only cached after the first resolved. The fix caches the
 * promise itself so all callers share the same in-flight load.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../appointments.config', () => ({
  config: {
    serviceName: 'Test Service',
    duration: 60,
    businessHoursStart: '09:00',
    businessHoursEnd: '17:00',
    workingDays: [1, 2, 3, 4, 5],
    currency: 'USD',
  },
}));

describe('getConfig race condition', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('concurrent calls share a single loadConfig() invocation', async () => {
    const mod = await import('../appointments');
    const spy = vi.spyOn(await import('../appointments.config'), 'config', 'get');

    const [result1, result2] = await Promise.all([
      mod.getConfig(),
      mod.getConfig(),
    ]);

    expect(result1).toBe(result2);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
