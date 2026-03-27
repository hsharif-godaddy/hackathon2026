/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/tests/test-utils';

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: vi.fn(() => ({ data: false, isLoading: false })),
}));

vi.mock('./SinglePlanUpgradeContainer', () => ({
  default: (props: { source?: string }) => (
    <div data-testid="single-plan-upgrade">{props.source}</div>
  ),
}));

vi.mock('./HigherPlansUpgradeContainer', () => ({
  default: (props: { source?: string }) => (
    <div data-testid="higher-plans-upgrade">{props.source}</div>
  ),
}));

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
});
