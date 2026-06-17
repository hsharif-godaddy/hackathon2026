/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { DkimStatusBadge } from '@/app/[market]/develop/components/settings/components/DkimStatusBadge';
import { useDkimStatusQuery } from '@/hooks/useDkimStatusQuery';
import { useSwitchboard } from '@/hooks/useSwitchboard';
import { renderWithProviders } from '@/tests/test-utils';
import { logImpressionEvent } from '@/utils/instrumentation';

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: vi.fn(() => true),
}));

vi.mock('@/hooks/useDkimStatusQuery', () => ({
  useDkimStatusQuery: vi.fn(() => ({
    data: null,
    isLoading: false,
    isError: false,
  })),
}));

vi.mock('@/utils/instrumentation', () => ({
  generateClickEID: vi.fn((id: string) => `${id}.click`),
  logClickEvent: vi.fn(() => vi.fn()),
  logImpressionEvent: vi.fn(() => vi.fn()),
}));

describe('DkimStatusBadge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset implementations to test-suite defaults after clearAllMocks
    vi.mocked(useSwitchboard).mockReturnValue(true as any);
    vi.mocked(useDkimStatusQuery).mockReturnValue({
      data: null,
      isLoading: false,
      isError: false,
    } as any);
  });

  describe('feature-flag gate', () => {
    it('renders nothing and fires no impression when flag is off', () => {
      vi.mocked(useSwitchboard).mockReturnValue(false);

      const { container } = renderWithProviders(
        <DkimStatusBadge appId="app-1" domain="example.com" />
      );

      expect(container.innerHTML).toBe('');
      expect(logImpressionEvent).not.toHaveBeenCalled();
    });

    it('renders nothing and fires no impression while flag is loading (undefined)', () => {
      vi.mocked(useSwitchboard).mockReturnValue(undefined);

      const { container } = renderWithProviders(
        <DkimStatusBadge appId="app-1" domain="example.com" />
      );

      expect(container.innerHTML).toBe('');
      expect(logImpressionEvent).not.toHaveBeenCalled();
    });
  });

  describe('loading state', () => {
    it('renders nothing and fires no impression while query is loading', () => {
      vi.mocked(useDkimStatusQuery).mockReturnValue({
        data: null,
        isLoading: true,
        isError: false,
      } as any);

      const { container } = renderWithProviders(
        <DkimStatusBadge appId="app-1" domain="example.com" />
      );

      expect(container.innerHTML).toBe('');
      expect(logImpressionEvent).not.toHaveBeenCalled();
    });
  });

  describe('three-way state derivation', () => {
    it('renders active tag and fires dkim_active when dkimValid is true', async () => {
      vi.mocked(useDkimStatusQuery).mockReturnValue({
        data: { dkimValid: true },
        isLoading: false,
        isError: false,
      } as any);

      renderWithProviders(<DkimStatusBadge appId="app-1" domain="example.com" />);

      expect(screen.getByText('builder_dkim_status_active')).toBeInTheDocument();
      await waitFor(() => {
        expect(logImpressionEvent).toHaveBeenCalledWith('settings.domains.dkim_active');
      });
    });

    it('renders pending tag and fires dkim_pending when dkimValid is false (data exists)', async () => {
      vi.mocked(useDkimStatusQuery).mockReturnValue({
        data: { dkimValid: false },
        isLoading: false,
        isError: false,
      } as any);

      renderWithProviders(<DkimStatusBadge appId="app-1" domain="example.com" />);

      expect(screen.getByText('builder_dkim_status_pending')).toBeInTheDocument();
      await waitFor(() => {
        expect(logImpressionEvent).toHaveBeenCalledWith('settings.domains.dkim_pending');
      });
    });

    it('renders unavailable tag and fires dkim_unavailable when data is null (pending vs unavailable boundary)', async () => {
      // data === null → unavailable; data.dkimValid === false → pending: these are distinct states
      vi.mocked(useDkimStatusQuery).mockReturnValue({
        data: null,
        isLoading: false,
        isError: false,
      } as any);

      renderWithProviders(<DkimStatusBadge appId="app-1" domain="example.com" />);

      expect(screen.getByText('builder_dkim_status_unavailable')).toBeInTheDocument();
      await waitFor(() => {
        expect(logImpressionEvent).toHaveBeenCalledWith('settings.domains.dkim_unavailable');
      });
    });

    it('renders unavailable tag and fires dkim_unavailable when query errors', async () => {
      vi.mocked(useDkimStatusQuery).mockReturnValue({
        data: null,
        isLoading: false,
        isError: true,
      } as any);

      renderWithProviders(<DkimStatusBadge appId="app-1" domain="example.com" />);

      expect(screen.getByText('builder_dkim_status_unavailable')).toBeInTheDocument();
      await waitFor(() => {
        expect(logImpressionEvent).toHaveBeenCalledWith('settings.domains.dkim_unavailable');
      });
    });
  });

  describe('fire-once ref guard', () => {
    it('fires dkim_active exactly once when re-rendered with the same domain and state', async () => {
      vi.mocked(useDkimStatusQuery).mockReturnValue({
        data: { dkimValid: true },
        isLoading: false,
        isError: false,
      } as any);

      const { rerender } = renderWithProviders(
        <DkimStatusBadge appId="app-1" domain="example.com" />
      );

      await waitFor(() => {
        expect(logImpressionEvent).toHaveBeenCalledWith('settings.domains.dkim_active');
      });

      // Re-render with identical inputs — ref guard must suppress the duplicate fire
      rerender(<DkimStatusBadge appId="app-1" domain="example.com" />);

      await waitFor(() => {
        const activeCalls = vi.mocked(logImpressionEvent).mock.calls.filter(
          ([eid]) => eid === 'settings.domains.dkim_active',
        );
        expect(activeCalls).toHaveLength(1);
      });
    });

    it('re-fires when domain changes to a new domain:state key', async () => {
      vi.mocked(useDkimStatusQuery).mockReturnValue({
        data: { dkimValid: true },
        isLoading: false,
        isError: false,
      } as any);

      const { rerender } = renderWithProviders(
        <DkimStatusBadge appId="app-1" domain="first.com" />
      );

      await waitFor(() => {
        expect(logImpressionEvent).toHaveBeenCalledWith('settings.domains.dkim_active');
      });

      // Different domain — new key re-arms the guard and fires again
      rerender(<DkimStatusBadge appId="app-1" domain="second.com" />);

      await waitFor(() => {
        const activeCalls = vi.mocked(logImpressionEvent).mock.calls.filter(
          ([eid]) => eid === 'settings.domains.dkim_active',
        );
        expect(activeCalls).toHaveLength(2);
      });
    });
  });
});
