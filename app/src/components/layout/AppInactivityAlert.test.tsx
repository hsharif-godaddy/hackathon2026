import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import { SubscriptionPlan } from '@/types/credits';
import AppInactivityAlert from './AppInactivityAlert';

const mockUseSwitchboard = vi.fn();
const mockUseSubscription = vi.fn();

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: () => mockUseSwitchboard(),
}));

vi.mock('@/hooks/useSubscription', () => ({
  useSubscription: () => mockUseSubscription(),
}));

describe('AppInactivityAlert', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: grants enabled, no subscription (Free user)
    mockUseSwitchboard.mockReturnValue({ data: true, isLoading: false });
    mockUseSubscription.mockReturnValue({ data: undefined, isLoading: false });
  });

  describe('rendering behavior', () => {
    it('should render alert for free users', () => {
      mockUseSubscription.mockReturnValue({ data: undefined, isLoading: false });

      renderWithProviders(<AppInactivityAlert />);

      expect(screen.getByText('builder_layout_inactivity_alert_title')).toBeInTheDocument();
      expect(screen.getByText('builder_layout_inactivity_alert')).toBeInTheDocument();
    });

    it('should render as highlight alert', () => {
      const { container } = renderWithProviders(<AppInactivityAlert />);

      const alert = container.querySelector('[role="alert"]');
      expect(alert).toBeInTheDocument();
    });
  });

  describe('loading states', () => {
    it('should not render when subscription is loading', () => {
      mockUseSubscription.mockReturnValue({ data: undefined, isLoading: true });

      const { container } = renderWithProviders(<AppInactivityAlert />);

      expect(container.firstChild).toBeNull();
    });

    it('should not render when grants feature flag is loading', () => {
      mockUseSwitchboard.mockReturnValue({ data: undefined, isLoading: true });

      const { container } = renderWithProviders(<AppInactivityAlert />);

      expect(container.firstChild).toBeNull();
    });

    it('should not render when both subscription and grants are loading', () => {
      mockUseSubscription.mockReturnValue({ data: undefined, isLoading: true });
      mockUseSwitchboard.mockReturnValue({ data: undefined, isLoading: true });

      const { container } = renderWithProviders(<AppInactivityAlert />);

      expect(container.firstChild).toBeNull();
    });
  });

  describe('paid plan behavior with grants enabled', () => {
    beforeEach(() => {
      mockUseSwitchboard.mockReturnValue({ data: true, isLoading: false });
    });

    it('should not render for Starter plan users', () => {
      mockUseSubscription.mockReturnValue({
        data: { plan: SubscriptionPlan.Starter },
        isLoading: false,
      });

      const { container } = renderWithProviders(<AppInactivityAlert />);

      expect(container.firstChild).toBeNull();
    });

    it('should not render for Professional plan users', () => {
      mockUseSubscription.mockReturnValue({
        data: { plan: SubscriptionPlan.Professional },
        isLoading: false,
      });

      const { container } = renderWithProviders(<AppInactivityAlert />);

      expect(container.firstChild).toBeNull();
    });

    it('should not render for Ultimate plan users', () => {
      mockUseSubscription.mockReturnValue({
        data: { plan: SubscriptionPlan.Ultimate },
        isLoading: false,
      });

      const { container } = renderWithProviders(<AppInactivityAlert />);

      expect(container.firstChild).toBeNull();
    });
  });

  describe('paid plan behavior with grants disabled (legacy)', () => {
    beforeEach(() => {
      mockUseSwitchboard.mockReturnValue({ data: false, isLoading: false });
    });

    it('should not render for AiroPlus users (considered paid when grants disabled)', () => {
      mockUseSubscription.mockReturnValue({
        data: { plan: SubscriptionPlan.AiroPlus },
        isLoading: false,
      });

      const { container } = renderWithProviders(<AppInactivityAlert />);

      expect(container.firstChild).toBeNull();
    });

    it('should not render for Starter plan users', () => {
      mockUseSubscription.mockReturnValue({
        data: { plan: SubscriptionPlan.Starter },
        isLoading: false,
      });

      const { container } = renderWithProviders(<AppInactivityAlert />);

      expect(container.firstChild).toBeNull();
    });

    it('should not render for Professional plan users', () => {
      mockUseSubscription.mockReturnValue({
        data: { plan: SubscriptionPlan.Professional },
        isLoading: false,
      });

      const { container } = renderWithProviders(<AppInactivityAlert />);

      expect(container.firstChild).toBeNull();
    });

    it('should not render for Ultimate plan users', () => {
      mockUseSubscription.mockReturnValue({
        data: { plan: SubscriptionPlan.Ultimate },
        isLoading: false,
      });

      const { container } = renderWithProviders(<AppInactivityAlert />);

      expect(container.firstChild).toBeNull();
    });
  });

  describe('free/no subscription behavior', () => {
    it('should render for Free plan users', () => {
      mockUseSubscription.mockReturnValue({
        data: { plan: SubscriptionPlan.Free },
        isLoading: false,
      });

      renderWithProviders(<AppInactivityAlert />);

      expect(screen.getByText('builder_layout_inactivity_alert_title')).toBeInTheDocument();
    });

    it('should render for None plan users', () => {
      mockUseSubscription.mockReturnValue({
        data: { plan: SubscriptionPlan.None },
        isLoading: false,
      });

      renderWithProviders(<AppInactivityAlert />);

      expect(screen.getByText('builder_layout_inactivity_alert_title')).toBeInTheDocument();
    });

    it('should render when subscription data is undefined', () => {
      mockUseSubscription.mockReturnValue({ data: undefined, isLoading: false });

      renderWithProviders(<AppInactivityAlert />);

      expect(screen.getByText('builder_layout_inactivity_alert_title')).toBeInTheDocument();
    });

    it('should render when subscription plan is null', () => {
      mockUseSubscription.mockReturnValue({
        data: { plan: null },
        isLoading: false,
      });

      renderWithProviders(<AppInactivityAlert />);

      expect(screen.getByText('builder_layout_inactivity_alert_title')).toBeInTheDocument();
    });
  });

  describe('grants flag edge cases', () => {
    it('should treat undefined grants flag as enabled (default true)', () => {
      mockUseSwitchboard.mockReturnValue({ data: undefined, isLoading: false });
      mockUseSubscription.mockReturnValue({
        data: { plan: SubscriptionPlan.AiroPlus },
        isLoading: false,
      });

      // When grants flag is undefined but not loading, it defaults to true (isGrantsEnabled ?? true)
      // So AiroPlus should NOT be considered paid, and alert should show
      renderWithProviders(<AppInactivityAlert />);

      expect(screen.getByText('builder_layout_inactivity_alert_title')).toBeInTheDocument();
    });

    it('should not render for Starter when grants flag is undefined', () => {
      mockUseSwitchboard.mockReturnValue({ data: undefined, isLoading: false });
      mockUseSubscription.mockReturnValue({
        data: { plan: SubscriptionPlan.Starter },
        isLoading: false,
      });

      // Starter is always paid regardless of grants flag
      const { container } = renderWithProviders(<AppInactivityAlert />);

      expect(container.firstChild).toBeNull();
    });
  });
});
