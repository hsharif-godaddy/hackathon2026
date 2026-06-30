import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockSetAttribute = vi.fn();
const mockGetActiveSpan = vi.fn();
const mockGetSwitchboardValue = vi.fn();

vi.mock('@opentelemetry/api', () => ({
  trace: {
    getActiveSpan: mockGetActiveSpan,
  },
}));

// Controlled rollout config for all tests.
// Path is relative to THIS test file: __tests__/ → lib/ → src/ → config/
vi.mock('../../config/feature-rollouts.js', () => ({
  ROLLOUTS: {
    'feature-a': { description: 'Feature A', rolloutPercent: 50, enabled: true },
    'feature-b': { description: 'Feature B', rolloutPercent: 50, enabled: true },
    'disabled-feature': { description: 'Disabled', rolloutPercent: 100, enabled: false },
    'zero-percent': { description: 'Zero rollout', rolloutPercent: 0, enabled: true },
    'full-rollout': { description: 'Full rollout', rolloutPercent: 100, enabled: true },
  },
}));

// Default: Switchboard is not configured (-1 = no override, fall back to ROLLOUTS).
vi.mock('../../services/switchboard.js', () => ({
  getSwitchboardValue: mockGetSwitchboardValue,
}));

// Import after mocks are in place
const { isFeatureEnabled, recordRolloutsOnSpan } = await import('../feature-rollouts.js');

describe('feature-rollouts', function suite() {
  beforeEach(function setup() {
    mockGetActiveSpan.mockReturnValue({ setAttribute: mockSetAttribute });
    // Default: no Switchboard override
    mockGetSwitchboardValue.mockReturnValue(-1);
  });

  afterEach(function cleanup() {
    vi.clearAllMocks();
  });

  describe('#isFeatureEnabled — code config (no Switchboard override)', function codeConfigTests() {
    it('is deterministic — same inputs always produce same result', function determinism() {
      const appId = 'abc1234xyz';
      const first = isFeatureEnabled('feature-a', appId);
      const second = isFeatureEnabled('feature-a', appId);
      expect(first).toBe(second);
    });

    it('returns false when enabled flag is false regardless of rolloutPercent', function masterSwitch() {
      // disabled-feature has rolloutPercent: 100 but enabled: false
      expect(isFeatureEnabled('disabled-feature', 'abc1234xyz')).toBe(false);
    });

    it('returns false for unknown feature names', function unknown() {
      expect(isFeatureEnabled('non-existent-feature', 'abc1234xyz')).toBe(false);
    });

    it('returns false for any appId when rolloutPercent is 0', function zeroRollout() {
      const appIds = Array.from({ length: 50 }, (_, i) => `app${String(i).padStart(7, '0')}`);
      expect(appIds.every(id => !isFeatureEnabled('zero-percent', id))).toBe(true);
    });

    it('returns true for any appId when rolloutPercent is 100 and enabled', function fullRollout() {
      const appIds = Array.from({ length: 50 }, (_, i) => `app${String(i).padStart(7, '0')}`);
      expect(appIds.every(id => isFeatureEnabled('full-rollout', id))).toBe(true);
    });

    it('distributes approximately half of apps into the 50% cohort', function distribution() {
      // Use realistic 10-char alphanumeric appIds
      const appIds = Array.from({ length: 200 }, (_, i) => {
        const n = String(i).padStart(6, '0');
        return `ab${n}xy`; // 10 chars
      });
      const enabledCount = appIds.filter(id => isFeatureEnabled('feature-a', id)).length;
      // Expect between 35% and 65% enabled (generous range for a hash-based check)
      expect(enabledCount).toBeGreaterThan(70);
      expect(enabledCount).toBeLessThan(130);
    });

    it('assigns independent buckets per feature — same appId yields different results for different features', function featurePrefixIsolation() {
      const appIds = Array.from({ length: 100 }, (_, i) => {
        const n = String(i).padStart(6, '0');
        return `ab${n}xy`;
      });

      let agreementCount = 0;
      for (const id of appIds) {
        if (isFeatureEnabled('feature-a', id) === isFeatureEnabled('feature-b', id)) {
          agreementCount++;
        }
      }
      // Independent hashes should agree ~50% of the time; two-sided bound (30–90)
      // confirms neither full correlation nor full anti-correlation.
      expect(agreementCount).toBeGreaterThan(30);
      expect(agreementCount).toBeLessThan(90);
    });

    it('records "enabled" on the active OTel span when feature is on', function otelEnabled() {
      isFeatureEnabled('full-rollout', 'abc1234xyz');
      expect(mockSetAttribute).toHaveBeenCalledWith('rollout.full-rollout', 'enabled');
    });

    it('records "disabled" on the active OTel span when feature is off', function otelDisabled() {
      isFeatureEnabled('zero-percent', 'abc1234xyz');
      expect(mockSetAttribute).toHaveBeenCalledWith('rollout.zero-percent', 'disabled');
    });

    it('does not throw when there is no active span', function noSpan() {
      mockGetActiveSpan.mockReturnValue(undefined);
      expect(() => isFeatureEnabled('full-rollout', 'abc1234xyz')).not.toThrow();
    });
  });

  describe('#isFeatureEnabled — Switchboard overrides', function sbTests() {
    it('Switchboard override percent wins over ROLLOUTS config', function sbOverrideWins() {
      // ROLLOUTS has feature-a at 50%, but Switchboard says 100%
      mockGetSwitchboardValue.mockReturnValue(100);
      const appIds = Array.from({ length: 50 }, (_, i) => `app${String(i).padStart(7, '0')}`);
      expect(appIds.every(id => isFeatureEnabled('feature-a', id))).toBe(true);
    });

    it('Switchboard 0 acts as kill-switch even when ROLLOUTS has rolloutPercent: 100 and enabled: true', function sbKillSwitch() {
      mockGetSwitchboardValue.mockReturnValue(0);
      const appIds = Array.from({ length: 50 }, (_, i) => `app${String(i).padStart(7, '0')}`);
      expect(appIds.every(id => !isFeatureEnabled('full-rollout', id))).toBe(true);
    });

    it('Switchboard -1 falls back to ROLLOUTS config', function sbAbsentFallback() {
      // Default mock already returns -1; full-rollout has rolloutPercent: 100 in ROLLOUTS
      mockGetSwitchboardValue.mockReturnValue(-1);
      const appIds = Array.from({ length: 50 }, (_, i) => `app${String(i).padStart(7, '0')}`);
      expect(appIds.every(id => isFeatureEnabled('full-rollout', id))).toBe(true);
    });

    it('Switchboard override enables a feature that is disabled in ROLLOUTS', function sbEnablesDisabled() {
      // disabled-feature has enabled: false in ROLLOUTS, but Switchboard sets 100%
      mockGetSwitchboardValue.mockReturnValue(100);
      const appIds = Array.from({ length: 50 }, (_, i) => `app${String(i).padStart(7, '0')}`);
      expect(appIds.every(id => isFeatureEnabled('disabled-feature', id))).toBe(true);
    });

    it('passes the correct Switchboard flag name for the feature', function sbFlagName() {
      isFeatureEnabled('feature-a', 'abc1234xyz');
      expect(mockGetSwitchboardValue).toHaveBeenCalledWith('rollout.feature-a', -1);
    });

    it('records OTel span attribute correctly when Switchboard overrides to 0', function sbKillSwitchOtel() {
      mockGetSwitchboardValue.mockReturnValue(0);
      isFeatureEnabled('full-rollout', 'abc1234xyz');
      expect(mockSetAttribute).toHaveBeenCalledWith('rollout.full-rollout', 'disabled');
    });

    it('records OTel span attribute correctly when Switchboard overrides to 100', function sbFullRolloutOtel() {
      mockGetSwitchboardValue.mockReturnValue(100);
      isFeatureEnabled('zero-percent', 'abc1234xyz');
      expect(mockSetAttribute).toHaveBeenCalledWith('rollout.zero-percent', 'enabled');
    });
  });

  describe('#recordRolloutsOnSpan', function recordTests() {
    it('records span attributes for every registered rollout', function allRollouts() {
      recordRolloutsOnSpan('abc1234xyz');
      const recordedNames = mockSetAttribute.mock.calls.map(([attr]: [string]) => attr);
      expect(recordedNames).toContain('rollout.feature-a');
      expect(recordedNames).toContain('rollout.feature-b');
      expect(recordedNames).toContain('rollout.disabled-feature');
      expect(recordedNames).toContain('rollout.zero-percent');
      expect(recordedNames).toContain('rollout.full-rollout');
    });

    it('records exactly one attribute per rollout', function onePerRollout() {
      recordRolloutsOnSpan('abc1234xyz');
      const rolloutAttrs = mockSetAttribute.mock.calls
        .map(([attr]: [string]) => attr)
        .filter((attr: string) => attr.startsWith('rollout.'));
      // 5 rollouts in the mock config → 5 attributes
      expect(new Set(rolloutAttrs).size).toBe(5);
    });

    it('does not throw when there is no active span', function noSpan() {
      mockGetActiveSpan.mockReturnValue(undefined);
      expect(() => recordRolloutsOnSpan('abc1234xyz')).not.toThrow();
    });
  });
});
