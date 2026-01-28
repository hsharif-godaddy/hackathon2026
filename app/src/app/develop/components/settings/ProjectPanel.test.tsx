import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';

import { renderWithProviders } from '@/tests/test-utils';
import ProjectPanel from './ProjectPanel';

// Mock hooks and utilities
vi.mock('@/hooks/useDownloadApp', () => ({
  useDownloadApp: vi.fn(() => ({
    download: vi.fn(),
    isDownloading: false,
    error: null,
  })),
}));

vi.mock('@/hooks/usePaywallModal', () => ({
  usePaywallModal: vi.fn(() => ({
    checkAndShowPaywall: vi.fn((callback) => callback()),
    PaywallModal: () => null,
    isPolling: false,
    shouldShowPaywall: false,
  })),
}));

vi.mock('@/app/develop/components/utils', () => ({
  useAppIdFromParams: vi.fn(() => 'test-app-123'),
}));

vi.mock('@/utils/instrumentation', () => ({
  generateClickEID: vi.fn((eid: string) => `appbuilder.${eid}.click`),
  logAiroHQEvent: vi.fn(() => vi.fn()),
}));

import { useDownloadApp } from '@/hooks/useDownloadApp';
import { usePaywallModal } from '@/hooks/usePaywallModal';
import { generateClickEID, logAiroHQEvent } from '@/utils/instrumentation';

describe('ProjectPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render without crashing', () => {
    renderWithProviders(<ProjectPanel />);

    expect(screen.getByRole('button', { name: /Download Files/i })).toBeInTheDocument();
  });

  describe('Download button tracking', () => {
    it('should have correct EID attribute on download button', () => {
      renderWithProviders(<ProjectPanel />);

      const downloadButton = screen.getByRole('button', { name: /Download Files/i });
      expect(downloadButton).toHaveAttribute('data-eid', 'appbuilder.settings.project.app_download.click');
    });

    it('should call generateClickEID with correct parameters', () => {
      renderWithProviders(<ProjectPanel />);

      expect(generateClickEID).toHaveBeenCalledWith('settings.project.app_download');
    });

    it('should log AiroHQ analytics event when download button is clicked', async () => {
      const user = userEvent.setup();
      const mockDownload = vi.fn();
      const mockCheckAndShowPaywall = vi.fn((callback) => callback());

      vi.mocked(useDownloadApp).mockReturnValue({
        download: mockDownload,
        isDownloading: false,
        error: null,
      });

      vi.mocked(usePaywallModal).mockReturnValue({
        checkAndShowPaywall: mockCheckAndShowPaywall,
        PaywallModal: () => null,
        isPolling: false,
        shouldShowPaywall: false,
        isPaywallLoading: false,
      });

      renderWithProviders(<ProjectPanel />);

      const downloadButton = screen.getByRole('button', { name: /Download Files/i });
      await user.click(downloadButton);

      await waitFor(() => {
        expect(logAiroHQEvent).toHaveBeenCalledWith({
          category: 'click',
          recommendation_task: 'builder_project_downloaded',
          recommendation_type: 'download',
          recommendation_id: 'test-app-123',
        });
      });
    });

    it('should trigger download with correct appId after paywall check', async () => {
      const user = userEvent.setup();
      const mockDownload = vi.fn();
      const mockCheckAndShowPaywall = vi.fn((callback) => callback());

      vi.mocked(useDownloadApp).mockReturnValue({
        download: mockDownload,
        isDownloading: false,
        error: null,
      });

      vi.mocked(usePaywallModal).mockReturnValue({
        checkAndShowPaywall: mockCheckAndShowPaywall,
        PaywallModal: () => null,
        isPolling: false,
        shouldShowPaywall: false,
        isPaywallLoading: false,
      });

      renderWithProviders(<ProjectPanel />);

      const downloadButton = screen.getByRole('button', { name: /Download Files/i });
      await user.click(downloadButton);

      await waitFor(() => {
        expect(mockCheckAndShowPaywall).toHaveBeenCalled();
        expect(mockDownload).toHaveBeenCalledWith('test-app-123');
      });
    });

    it('should show downloading state when download is in progress', () => {
      vi.mocked(useDownloadApp).mockReturnValue({
        download: vi.fn(),
        isDownloading: true,
        error: null,
      });

      renderWithProviders(<ProjectPanel />);

      const downloadButton = screen.getByRole('button', { name: /Downloading.../i });
      expect(downloadButton).toBeDisabled();
    });

    it('should disable download button when polling after purchase', () => {
      vi.mocked(usePaywallModal).mockReturnValue({
        checkAndShowPaywall: vi.fn(),
        PaywallModal: () => null,
        isPolling: true,
        shouldShowPaywall: false,
        isPaywallLoading: false,
      });

      renderWithProviders(<ProjectPanel />);

      // When polling, button text changes to "Downloading..." so we need to find it differently
      const downloadButton = screen.getByRole('button', { name: /Downloading/i });
      expect(downloadButton).toBeDisabled();
    });

    it('should enable download button when not loading and has appId', () => {
      vi.mocked(useDownloadApp).mockReturnValue({
        download: vi.fn(),
        isDownloading: false,
        error: null,
      });

      vi.mocked(usePaywallModal).mockReturnValue({
        checkAndShowPaywall: vi.fn(),
        PaywallModal: () => null,
        isPolling: false,
        shouldShowPaywall: false,
        isPaywallLoading: false,
      });

      renderWithProviders(<ProjectPanel />);

      const downloadButton = screen.getByRole('button', { name: /Download Files/i });
      expect(downloadButton).not.toBeDisabled();
    });
  });
});
