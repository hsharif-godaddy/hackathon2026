/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import { getEffectiveCreditsSpent } from '@/utils/credits';

vi.mock('@ux/box', () => ({
  default: ({ children }: any) => <div>{children}</div>,
}));
vi.mock('@ux/button', () => ({
  default: ({ text, onClick, type, disabled, ...props }: any) => (
    <button type={type || 'button'} onClick={onClick} disabled={disabled} {...props}>{text}</button>
  ),
}));
vi.mock('@ux/checkbox', () => ({
  default: ({ label, ...props }: any) => <input type="checkbox" aria-label={label} {...props} />,
}));
vi.mock('@ux/radio', () => ({
  default: ({ label, id, ...props }: any) => <input type="radio" id={id} aria-label={label} {...props} />,
}));
vi.mock('@ux/spinner', () => ({
  default: () => <div data-testid="spinner" />,
}));
vi.mock('@ux/text', () => ({
  default: {
    label: ({ text: t, children, ...props }: any) => <label {...props}>{t ?? children}</label>,
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
}));
vi.mock('@ux/text-input', () => ({
  default: ({ label, ...props }: any) => <textarea aria-label={label} {...props} />,
}));

vi.mock('@/components/providers/AuthProvider', () => ({
  useAuthContext: vi.fn(),
}));
vi.mock('@/components/feedback/utils', () => ({
  getBaseUrl: vi.fn(() => 'https://example.com/'),
  getFullStorySessionUrl: vi.fn(() => Promise.resolve(null)),
}));
const mockUseGasketData = vi.hoisted(() => vi.fn(() => ({ switchboard: {} as Record<string, unknown> })));

vi.mock('@/hooks/useGasketData', () => ({
  useGasketData: () => mockUseGasketData(),
}));
vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock('@/lib/journeyTracker', () => ({
  JourneyTracker: { current: () => ({ trackMilestone: vi.fn() }) },
}));
vi.mock('@/lib/request-context', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/logging', () => ({
  shipAnalyticsLog: vi.fn(),
}));
vi.mock('@/lib/slack-webhook', () => ({
  formatSlackBlockMessage: vi.fn((msg: any) => msg),
}));
vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: vi.fn(),
}));
vi.mock('@/stores/useSitesStore', () => ({
  useSitesStore: vi.fn(),
}));
vi.mock('@/utils/is-local-dev', () => ({
  isLocalDev: vi.fn(() => true),
}));

import { buildExperimentsLineFromSwitchboard } from '@/components/feedback/experimentsLine';
import { useAuthContext } from '@/components/providers/AuthProvider';
import { EXPERIMENT_IDS } from '@/config/experiments';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import { useSitesStore } from '@/stores/useSitesStore';
import { FeedbackForm } from './FeedbackForm';

describe('FeedbackForm subscription info calculation', function subscriptionCalculationTests() {
  describe('multiple grants calculation', function multipleGrantsTests() {
    it('should calculate total spent with capping for multiple grants', function testMultipleGrants() {
      const grants = [
        { creditsSpent: 1500, creditsMax: 1500 }, // At limit
        { creditsSpent: 52, creditsMax: 50 },     // Over limit
        { creditsSpent: 30, creditsMax: 250 },    // Under limit
      ];

      const totalSpent = grants.reduce(
        (sum, grant) => sum + getEffectiveCreditsSpent(grant.creditsSpent, grant.creditsMax),
        0
      );
      const totalMax = grants.reduce((sum, grant) => sum + (grant.creditsMax || 0), 0);

      // 1500 (capped at 1500) + 50 (capped at 50) + 30 = 1580
      expect(totalSpent).toBe(1580);
      // 1500 + 50 + 250 = 1800
      expect(totalMax).toBe(1800);

      // Display format: "1580/1800" (NOT "220/1800" which would be max - spent)
      const display = `${totalSpent}/${totalMax}`;
      expect(display).toBe('1580/1800');
    });

    it('should handle the original bug scenario from JIRA', function testJiraBugScenario() {
      // Original bug: 52 spent / 50 max was displaying as "-2/50"
      const grants = [
        { creditsSpent: 52, creditsMax: 50 },
      ];

      const totalSpent = grants.reduce(
        (sum, grant) => sum + getEffectiveCreditsSpent(grant.creditsSpent, grant.creditsMax),
        0
      );
      const totalMax = grants.reduce((sum, grant) => sum + (grant.creditsMax || 0), 0);

      // Should display "50/50", not "-2/50"
      expect(totalSpent).toBe(50);
      expect(totalMax).toBe(50);

      const display = `${totalSpent}/${totalMax}`;
      expect(display).toBe('50/50');

      // OLD BUG LOGIC (what we fixed):
      // const remaining = totalMax - totalSpent; // 50 - 52 = -2
      // const buggyDisplay = `${remaining}/${totalMax}`; // "-2/50" ❌
      // expect(buggyDisplay).toBe('-2/50'); // This was the bug!
    });

    it('should handle mixed null/undefined values in grants', function testMixedNullValues() {
      const grants = [
        { creditsSpent: null, creditsMax: 100 },
        { creditsSpent: 30, creditsMax: null },
        { creditsSpent: undefined, creditsMax: undefined },
        { creditsSpent: 50, creditsMax: 200 },
      ];

      const totalSpent = grants.reduce(
        (sum, grant) => sum + getEffectiveCreditsSpent(grant.creditsSpent, grant.creditsMax),
        0
      );
      const totalMax = grants.reduce((sum, grant) => sum + (grant.creditsMax || 0), 0);

      // 0 + 0 + 0 + 50 = 50
      expect(totalSpent).toBe(50);
      // 100 + 0 + 0 + 200 = 300
      expect(totalMax).toBe(300);
    });
  });
});

describe('FeedbackForm experimentsLine in Slack payload', function experimentsLineTests() {
  const minimalConfig = {
    pk: 'test#feedback',
    title: 'Test',
    fields: [],
    onlyOneResponseAllowed: false,
  };

  function makeFetchMock(captured: { slack?: any }) {
    return vi.fn().mockImplementation(async (url: string, options?: RequestInit) => {
      if (typeof url === 'string' && url.includes('slack-webhook')) {
        captured.slack = JSON.parse((options?.body ?? 'null') as string);
        return { ok: true, json: async () => ({ success: true }) };
      }
      return { ok: false };
    });
  }

  beforeEach(function setup() {
    mockUseGasketData.mockReset();
    mockUseGasketData.mockReturnValue({
      switchboard: {
        [EXPERIMENT_IDS.recommendedPlan]: { cohortId: 'control' },
        [EXPERIMENT_IDS.chatGauge]: { cohortId: 'control' },
      },
    });
    vi.mocked(useAuthContext).mockReturnValue({
      authState: { authType: 'basic' } as any,
      isAuthenticated: true,
      isLoading: false,
      needsReauth: false,
      config: null,
      gasketConfig: null,
      configLoading: false,
      configError: null,
      getUserEmail: vi.fn(),
      getUserInfo: vi.fn(() => ({ customerId: 'cust-1', shopperId: '12345678' })),
      handleSignIn: vi.fn(),
      handleSignOut: vi.fn(),
      authType: 'jwt',
      isMockAuth: false,
      mockAuth: null,
    });
    vi.mocked(useDevelopPageStore).mockReturnValue('test-app-123');
    vi.mocked(useSitesStore).mockReturnValue(() => null);
  });

  it('should include hivemind cohorts from gasket switchboard in Experiments field', async function cohortsInSlack() {
    const captured: { slack?: any } = {};
    global.fetch = makeFetchMock(captured) as any;

    renderWithProviders(
      <FeedbackForm config={minimalConfig} onClose={vi.fn()} onSubmitSuccess={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'builder_common_submit' }));

    await waitFor(() => {
      expect(captured.slack).toBeDefined();
    });

    const { rightFields } = captured.slack.blockMessage.twoColumnSection;
    const experimentsField = rightFields.find((f: any) => f.label === 'Experiments');
    expect(experimentsField).toBeDefined();
    expect(experimentsField?.value).toBe(
      buildExperimentsLineFromSwitchboard({
        [EXPERIMENT_IDS.recommendedPlan]: { cohortId: 'control' },
        [EXPERIMENT_IDS.chatGauge]: { cohortId: 'control' },
      }),
    );
  });

  it('should reflect chat-gauge treatment cohort in Experiments field', async function chatGaugeTreatment() {
    mockUseGasketData.mockReturnValue({
      switchboard: {
        [EXPERIMENT_IDS.recommendedPlan]: { cohortId: 'control' },
        [EXPERIMENT_IDS.chatGauge]: { cohortId: 'treatment' },
      },
    });

    const captured: { slack?: any } = {};
    global.fetch = makeFetchMock(captured) as any;

    renderWithProviders(
      <FeedbackForm config={minimalConfig} onClose={vi.fn()} onSubmitSuccess={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'builder_common_submit' }));

    await waitFor(() => {
      expect(captured.slack).toBeDefined();
    });

    const { rightFields } = captured.slack.blockMessage.twoColumnSection;
    const experimentsField = rightFields.find((f: any) => f.label === 'Experiments');
    expect(experimentsField).toBeDefined();
    expect(experimentsField?.value).toBe(
      buildExperimentsLineFromSwitchboard({
        [EXPERIMENT_IDS.recommendedPlan]: { cohortId: 'control' },
        [EXPERIMENT_IDS.chatGauge]: { cohortId: 'treatment' },
      }),
    );
  });
});
