/**
 * @vitest-environment jsdom
 */
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
    shouldShowPaywall: false,
    isPaywallLoading: false,
    isPublishLimitLoading: false,
  })),
}));

vi.mock('@/hooks/usePurgeCache', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/usePurgeCache')>();
  return {
    ...actual,
    usePurgeCache: vi.fn(() => ({
      trigger: vi.fn(),
      status: PurgeStatus.IDLE,
      errorCode: null,
    })),
  };
});

vi.mock('@/app/[market]/develop/components/utils', () => ({
  useAppIdFromParams: vi.fn(() => 'test-app-123'),
}));

vi.mock('@/utils/instrumentation', () => ({
  generateClickEID: vi.fn((eid: string) => `appbuilder.${eid}.click`),
  logAiroHQEvent: vi.fn(() => vi.fn()),
}));

vi.mock('@/components/providers/AuthProvider', () => ({
  useAuthContext: () => ({ authState: null }),
}));

import { useDownloadApp } from '@/hooks/useDownloadApp';
import { usePaywallModal } from '@/hooks/usePaywallModal';
import { PurgeErrorCode, PurgeStatus, usePurgeCache } from '@/hooks/usePurgeCache';
import { generateClickEID, logAiroHQEvent } from '@/utils/instrumentation';

describe('ProjectPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render without crashing', () => {
    renderWithProviders(<ProjectPanel />);

    expect(screen.getByRole('button', { name: /builder_settings_project_download_button/i })).toBeInTheDocument();
  });

  describe('Download button tracking', () => {
    it('should have correct EID attribute on download button', () => {
      renderWithProviders(<ProjectPanel />);

      const downloadButton = screen.getByRole('button', { name: /builder_settings_project_download_button/i });
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
        shouldShowPaywall: false,
        isPaywallLoading: false,
        isPublishLimitLoading: false,
      });

      renderWithProviders(<ProjectPanel />);

      const downloadButton = screen.getByRole('button', { name: /builder_settings_project_download_button/i });
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

    it('should trigger download after paywall check', async () => {
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
        shouldShowPaywall: false,
        isPaywallLoading: false,
        isPublishLimitLoading: false,
      });

      renderWithProviders(<ProjectPanel />);

      const downloadButton = screen.getByRole('button', { name: /builder_settings_project_download_button/i });
      await user.click(downloadButton);

      await waitFor(() => {
        expect(mockCheckAndShowPaywall).toHaveBeenCalled();
        // download() is called without args - appId is passed to hook initialization
        expect(mockDownload).toHaveBeenCalled();
      });
    });

    it('should show downloading state when download is in progress', () => {
      vi.mocked(useDownloadApp).mockReturnValue({
        download: vi.fn(),
        isDownloading: true,
        error: null,
      });

      renderWithProviders(<ProjectPanel />);

      const downloadButton = screen.getByRole('button', { name: /builder_settings_project_download_downloading/i });
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
        shouldShowPaywall: false,
        isPaywallLoading: false,
        isPublishLimitLoading: false,
      });

      renderWithProviders(<ProjectPanel />);

      const downloadButton = screen.getByRole('button', { name: /builder_settings_project_download_button/i });
      expect(downloadButton).not.toBeDisabled();
    });
  });

  describe('Purge Cache button', () => {
    it('should render purge cache button', () => {
      renderWithProviders(<ProjectPanel />);

      expect(screen.getByRole('button', { name: /Purge Cache/i })).toBeInTheDocument();
    });

    it('should have correct EID attribute on purge cache button', () => {
      renderWithProviders(<ProjectPanel />);

      const purgeButton = screen.getByRole('button', { name: /Purge Cache/i });
      expect(purgeButton).toHaveAttribute('data-eid', 'appbuilder.settings.project.purge_cache.click');
    });

    it('should call trigger when purge cache button is clicked', async () => {
      const user = userEvent.setup();
      const mockTrigger = vi.fn();

      vi.mocked(usePurgeCache).mockReturnValue({
        trigger: mockTrigger,
        status: PurgeStatus.IDLE,
        errorCode: null,
      });

      renderWithProviders(<ProjectPanel />);

      await user.click(screen.getByRole('button', { name: /Purge Cache/i }));

      await waitFor(() => {
        expect(mockTrigger).toHaveBeenCalled();
      });
    });

    it('should log analytics event when purge cache button is clicked', async () => {
      const user = userEvent.setup();

      renderWithProviders(<ProjectPanel />);

      await user.click(screen.getByRole('button', { name: /Purge Cache/i }));

      await waitFor(() => {
        expect(logAiroHQEvent).toHaveBeenCalledWith({
          category: 'click',
          recommendation_task: 'builder_project_purge_cache',
          recommendation_type: 'purge_cache',
          recommendation_id: 'test-app-123',
        });
      });
    });

    it('should show purging state and disable button when starting', () => {
      vi.mocked(usePurgeCache).mockReturnValue({
        trigger: vi.fn(),
        status: PurgeStatus.STARTING,
        errorCode: null,
      });

      renderWithProviders(<ProjectPanel />);

      const purgeButton = screen.getByRole('button', { name: /Purging/i });
      expect(purgeButton).toBeDisabled();
    });

    it('should show purging state and disable button when polling', () => {
      vi.mocked(usePurgeCache).mockReturnValue({
        trigger: vi.fn(),
        status: PurgeStatus.POLLING,
        errorCode: null,
      });

      renderWithProviders(<ProjectPanel />);

      const purgeButton = screen.getByRole('button', { name: /Purging/i });
      expect(purgeButton).toBeDisabled();
    });

    it('should show success alert when purge succeeds', async () => {
      vi.mocked(usePurgeCache).mockReturnValue({
        trigger: vi.fn(),
        status: PurgeStatus.SUCCESS,
        errorCode: null,
      });

      renderWithProviders(<ProjectPanel />);

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent('Cache purged successfully');
      });
    });

    it('should show error alert when purge fails', async () => {
      vi.mocked(usePurgeCache).mockReturnValue({
        trigger: vi.fn(),
        status: PurgeStatus.FAILURE,
        errorCode: PurgeErrorCode.JOB_FAILED,
      });

      renderWithProviders(<ProjectPanel />);

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent('Cache purge failed');
      });
    });
  });
});
