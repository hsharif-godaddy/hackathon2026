// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildExperimentsLineFromSwitchboard, useExperimentsLine } from '@/components/feedback/experimentsLine';
import { renderHookWithProviders } from '@/tests/test-utils';

const mockUseGasketData = vi.hoisted(() => vi.fn(() => ({ switchboard: {} as Record<string, unknown> })));

vi.mock('@/hooks/useGasketData', () => ({
  useGasketData: () => mockUseGasketData(),
}));

describe('experimentsLine', function experimentsLineSuite() {
  describe('#buildExperimentsLineFromSwitchboard', function buildSuite() {
    it('returns empty string when switchboard is undefined', function emptyUndefined() {
      expect(buildExperimentsLineFromSwitchboard(undefined)).toBe('');
    });

    it('returns empty string when switchboard is empty', function emptyObject() {
      expect(buildExperimentsLineFromSwitchboard({})).toBe('');
    });

    it('skips boolean feature flags and includes only cohort assignments', function filtersPrimitives() {
      expect(
        buildExperimentsLineFromSwitchboard({
          'appbuilder-chat-gauge': true,
          'exp-b': { cohortId: 'treatment' },
          'exp-a': { cohortId: 'control' },
        }),
      ).toBe(
        '<https://hivemind.gdcorp.tools/experiments/exp-a|exp-a>: control\n'
        + '<https://hivemind.gdcorp.tools/experiments/exp-b|exp-b>: treatment',
      );
    });

    it('skips objects without a non-empty cohortId string', function skipsInvalid() {
      expect(
        buildExperimentsLineFromSwitchboard({
          'bad-empty': { cohortId: '' },
          'bad-missing': {},
          'bad-null': { cohortId: null },
          'bad-number': { cohortId: 42 },
          'ok': { cohortId: 'treatment' },
        }),
      ).toBe('<https://hivemind.gdcorp.tools/experiments/ok|ok>: treatment');
    });

    it('skips non-signal cohort ids', function skipsNonSignal() {
      expect(
        buildExperimentsLineFromSwitchboard({
          'ineligible-exp': { cohortId: 'ineligible' },
          'unassigned-exp': { cohortId: 'unassigned' },
          'not-bucketed-exp': { cohortId: 'not_bucketed' },
          'control-exp': { cohortId: 'control' },
          'treatment-exp': { cohortId: 'treatment' },
        }),
      ).toBe(
        '<https://hivemind.gdcorp.tools/experiments/control-exp|control-exp>: control\n'
        + '<https://hivemind.gdcorp.tools/experiments/treatment-exp|treatment-exp>: treatment',
      );
    });
  });

  describe('#useExperimentsLine', function hookSuite() {
    beforeEach(() => {
      mockUseGasketData.mockReset();
      mockUseGasketData.mockReturnValue({
        switchboard: {
          'aab_recommended_plan_uppdcx': { cohortId: 'control' },
          'airo-app-builder-chat-gauge': { cohortId: 'control' },
        },
      });
    });

    it('joins hivemind cohorts from gasket switchboard in sorted key order', function sortedJoin() {
      const { result } = renderHookWithProviders(() => useExperimentsLine());

      expect(result.current).toBe(
        '<https://hivemind.gdcorp.tools/experiments/aab_recommended_plan_uppdcx|aab_recommended_plan_uppdcx>: control\n'
        + '<https://hivemind.gdcorp.tools/experiments/airo-app-builder-chat-gauge|airo-app-builder-chat-gauge>: control',
      );
    });

    it('updates when switchboard reference changes', function updatesOnChange() {
      const { result, rerender } = renderHookWithProviders(() => useExperimentsLine());

      expect(result.current).toContain('aab_recommended_plan_uppdcx');

      mockUseGasketData.mockReturnValue({
        switchboard: {
          'airo-app-builder-chat-gauge': { cohortId: 'treatment' },
        },
      });
      rerender();

      expect(result.current).toBe(
        '<https://hivemind.gdcorp.tools/experiments/airo-app-builder-chat-gauge|airo-app-builder-chat-gauge>: treatment',
      );
    });
  });
});
