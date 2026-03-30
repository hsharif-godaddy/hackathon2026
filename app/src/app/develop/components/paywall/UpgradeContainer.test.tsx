/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

import { EXPERIMENT_IDS } from '@/config/experiments';
import { useIsInCohort } from '@/hooks/useHivemind';
import { renderWithProviders } from '@/tests/test-utils';
import { SubscriptionPlan } from '@/types/credits';

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: vi.fn(() => ({ data: false, isLoading: false })),
}));

vi.mock('./SinglePlanUpgradeContainer', () => ({
  default: (props: { source?: string }) => (
    <div data-testid="single-plan-upgrade">{props.source}</div>
  ),
}));

vi.mock('./HigherPlansUpgradeContainer', () => ({
  default: (props: { source?: string; recommendedPlan?: string }) => (
    <div data-testid="higher-plans-upgrade">
      <span data-testid="recommended-plan">{props.recommendedPlan ?? ''}</span>
      <span data-testid="higher-plans-source">{props.source ?? ''}</span>
    </div>
  ),
}));

vi.mock('@/hooks/useHivemind', () => ({
  useIsInCohort: vi.fn(() => false),
}));

vi.mock('@/utils/instrumentation', () => ({
  logImpressionEvent: vi.fn(() => vi.fn()),
}));

vi.mock('@/lib/logging', () => ({
  shipAnalyticsLog: vi.fn(() => vi.fn()),
}));

import { shipAnalyticsLog } from '@/lib/logging';
import { logImpressionEvent } from '@/utils/instrumentation';
import UpgradeContainer from './UpgradeContainer';

describe('UpgradeContainer', function upgradeContainerTests() {
  beforeEach(function setup() {
    vi.clearAllMocks();
  });

  it('should render SinglePlanUpgradeContainer when flag is off', async function renderSinglePlan() {
    const { useSwitchboard } = await import('@/hooks/useSwitchboard');
    vi.mocked(useSwitchboard).mockReturnValue({ data: false, isLoading: false } as ReturnType<typeof useSwitchboard>);

    const { container } = renderWithProviders(
      <UpgradeContainer
        source="test"
        onClose={vi.fn()}
      />
    );

    expect(container.querySelector('[data-testid="single-plan-upgrade"]')).toBeInTheDocument();
    expect(container.querySelector('[data-testid="higher-plans-upgrade"]')).not.toBeInTheDocument();
  });

  it('should render HigherPlansUpgradeContainer when flag is on', async function renderHigherPlans() {
    const { useSwitchboard } = await import('@/hooks/useSwitchboard');
    vi.mocked(useSwitchboard).mockReturnValue({ data: true, isLoading: false } as ReturnType<typeof useSwitchboard>);

    const { container } = renderWithProviders(
      <UpgradeContainer
        source="test"
        onClose={vi.fn()}
      />
    );

    expect(container.querySelector('[data-testid="higher-plans-upgrade"]')).toBeInTheDocument();
    expect(container.querySelector('[data-testid="single-plan-upgrade"]')).not.toBeInTheDocument();
    expect(screen.getByTestId('recommended-plan')).toHaveTextContent(SubscriptionPlan.Professional);
  });

  it('should render SinglePlanUpgradeContainer when flag is undefined (loading)', async function renderDefaultWhileLoading() {
    const { useSwitchboard } = await import('@/hooks/useSwitchboard');
    vi.mocked(useSwitchboard).mockReturnValue({ data: undefined, isLoading: true } as ReturnType<typeof useSwitchboard>);

    const { container } = renderWithProviders(
      <UpgradeContainer
        source="test"
        onClose={vi.fn()}
      />
    );

    expect(container.querySelector('[data-testid="single-plan-upgrade"]')).toBeInTheDocument();
    expect(container.querySelector('[data-testid="higher-plans-upgrade"]')).not.toBeInTheDocument();
  });

  it('should pass all props through to the rendered component', async function passProps() {
    const { useSwitchboard } = await import('@/hooks/useSwitchboard');
    vi.mocked(useSwitchboard).mockReturnValue({ data: false, isLoading: false } as ReturnType<typeof useSwitchboard>);

    const { container } = renderWithProviders(
      <UpgradeContainer
        source="my-source"
        onClose={vi.fn()}
      />
    );

    expect(container.querySelector('[data-testid="single-plan-upgrade"]')).toHaveTextContent('my-source');
  });

  it('forwards SubscriptionPlan.Ultimate to HigherPlansUpgradeContainer when Hivemind treatment', async function cohortTreatmentUltimate() {
    const { useSwitchboard } = await import('@/hooks/useSwitchboard');
    vi.mocked(useSwitchboard).mockReturnValue({ data: true, isLoading: false } as ReturnType<typeof useSwitchboard>);
    vi.mocked(useIsInCohort).mockReturnValue(true);

    renderWithProviders(
      <UpgradeContainer source="test" onClose={vi.fn()} />
    );

    expect(useIsInCohort).toHaveBeenCalledWith(EXPERIMENT_IDS.recommendedPlan, 'treatment');
    expect(screen.getByTestId('higher-plans-upgrade')).toBeInTheDocument();
    expect(screen.getByTestId('recommended-plan')).toHaveTextContent(SubscriptionPlan.Ultimate);
  });

  it('forwards SubscriptionPlan.Professional to HigherPlansUpgradeContainer when not in treatment (control)', async function cohortControlProfessional() {
    const { useSwitchboard } = await import('@/hooks/useSwitchboard');
    vi.mocked(useSwitchboard).mockReturnValue({ data: true, isLoading: false } as ReturnType<typeof useSwitchboard>);
    vi.mocked(useIsInCohort).mockReturnValue(false);

    renderWithProviders(
      <UpgradeContainer source="test" onClose={vi.fn()} />
    );

    expect(useIsInCohort).toHaveBeenCalledWith(EXPERIMENT_IDS.recommendedPlan, 'treatment');
    expect(screen.getByTestId('higher-plans-upgrade')).toBeInTheDocument();
    expect(screen.getByTestId('recommended-plan')).toHaveTextContent(SubscriptionPlan.Professional);
  });

  it('logs paywall.upgrade.view on mount via logImpressionEvent and shipAnalyticsLog', function paywallViewOnMount() {
    renderWithProviders(
      <UpgradeContainer source="test" onClose={vi.fn()} />
    );

    expect(logImpressionEvent).toHaveBeenCalledWith('paywall.upgrade.view');
    expect(shipAnalyticsLog).toHaveBeenCalledWith('paywall.upgrade.view', {});
  });
});
