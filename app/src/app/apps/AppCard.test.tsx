import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { renderWithProviders } from '@/tests/test-utils';
import { createMockSite, mockRouter, mockInstrumentation } from '@/tests/mocks';
import AppCard, { AppCardEmptyState } from './AppCard';
import { appFetch } from '@/lib/gasket-config';
import { useSitesStore } from '@/stores/useSitesStore';

vi.mock('@/lib/gasket-config');
vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter(),
}));
vi.mock('@/utils/instrumentation', () => mockInstrumentation());

describe('AppCard', () => {
  const mockSite = createMockSite();

  beforeEach(() => {
    vi.clearAllMocks();
    useSitesStore.setState({
      allSites: [],
      sitesById: {},
      isLoadingAll: false,
      loadingById: {},
      error: null,
      lastFetchedAll: null,
    });
  });

  describe('renders site information correctly', () => {
    it('should display site name', () => {
      renderWithProviders(<AppCard site={mockSite} />);

      expect(screen.getByText('Test Application')).toBeInTheDocument();
    });

    it('should display initial prompt', () => {
      renderWithProviders(<AppCard site={mockSite} />);

      expect(screen.getByText('Build a todo app')).toBeInTheDocument();
    });

    it('should display created date', () => {
      renderWithProviders(<AppCard site={mockSite} />);

      expect(screen.getByText(/Created/)).toBeInTheDocument();
    });

    it('should display default name when name is empty', () => {
      const siteWithoutName = createMockSite({ name: '' });
      renderWithProviders(<AppCard site={siteWithoutName} />);

      expect(screen.getByText('Untitled App')).toBeInTheDocument();
    });
  });

  describe('renders status correctly', () => {
    it('should display running status', () => {
      renderWithProviders(<AppCard site={mockSite} />);

      expect(screen.getByText('Running')).toBeInTheDocument();
    });

    it('should display creating status', () => {
      const creatingSite = createMockSite({ status: 'creating' });
      renderWithProviders(<AppCard site={creatingSite} />);

      expect(screen.getByText('Creating')).toBeInTheDocument();
    });

    it('should display created status', () => {
      const createdSite = createMockSite({ status: 'created' });
      renderWithProviders(<AppCard site={createdSite} />);

      expect(screen.getByText('Creating')).toBeInTheDocument();
    });

    it('should display failed status', () => {
      const failedSite = createMockSite({ status: 'failed' });
      renderWithProviders(<AppCard site={failedSite} />);

      expect(screen.getByText('Failed')).toBeInTheDocument();
    });

    it('should display error status', () => {
      const errorSite = createMockSite({ status: 'error' });
      renderWithProviders(<AppCard site={errorSite} />);

      expect(screen.getByText('Failed')).toBeInTheDocument();
    });

    it('should display stopped status', () => {
      const stoppedSite = createMockSite({ status: 'stopped' });
      renderWithProviders(<AppCard site={stoppedSite} />);

      expect(screen.getByText('Stopped')).toBeInTheDocument();
    });
  });

  describe('renders action buttons correctly', () => {
    it('should show preview button when site is running', () => {
      renderWithProviders(<AppCard site={mockSite} />);

      const previewButton = screen.getByRole('link', { name: /Preview/i });
      expect(previewButton).toBeInTheDocument();
      expect(previewButton).toHaveAttribute('href', mockSite.preview_url);
    });

    it('should show edit button when site is running', () => {
      renderWithProviders(<AppCard site={mockSite} />);

      expect(screen.getByRole('button', { name: /Edit/i })).toBeInTheDocument();
    });

    it('should not show preview button when site is not running', () => {
      const stoppedSite = createMockSite({ status: 'stopped' });
      renderWithProviders(<AppCard site={stoppedSite} />);

      expect(screen.queryByRole('link', { name: /Preview/i })).not.toBeInTheDocument();
    });

    it('should not show edit button when site is not running', () => {
      const stoppedSite = createMockSite({ status: 'stopped' });
      renderWithProviders(<AppCard site={stoppedSite} />);

      expect(screen.queryByRole('button', { name: /Edit/i })).not.toBeInTheDocument();
    });

    it('should show visit button when site has published URL', async () => {
      vi.mocked(appFetch).mockResolvedValue({
        ok: true,
        json: async () => createMockSite({
          published_url: 'https://published.test/app',
          variants: ['publish'],
        }),
      } as Response);

      renderWithProviders(<AppCard site={mockSite} />);

      await waitFor(() => {
        const visitButton = screen.getByRole('link', { name: /Visit/i });
        expect(visitButton).toBeInTheDocument();
        expect(visitButton).toHaveAttribute('href', 'https://published.test/app');
      });
    });

    it('should always show delete button', () => {
      renderWithProviders(<AppCard site={mockSite} />);

      expect(screen.getByRole('button', { name: /Delete app Test Application/i })).toBeInTheDocument();
    });
  });

  describe('handles delete confirmation flow', () => {
    it('should show confirmation alert when delete is clicked', async () => {
      const { user } = renderWithProviders(<AppCard site={mockSite} />);

      const deleteButton = screen.getByRole('button', { name: /Delete app Test Application/i });
      await user.click(deleteButton);

      expect(screen.getByText(/Are you sure you want to delete "Test Application"/)).toBeInTheDocument();
    });

    it('should hide confirmation alert when cancel is clicked', async () => {
      const { user } = renderWithProviders(<AppCard site={mockSite} />);

      const deleteButton = screen.getByRole('button', { name: /Delete app Test Application/i });
      await user.click(deleteButton);

      const cancelButton = screen.getByRole('button', { name: /Cancel/i });
      await user.click(cancelButton);

      expect(screen.queryByText(/Are you sure you want to delete/)).not.toBeInTheDocument();
    });

    it('should call deleteSite when confirm is clicked', async () => {
      const deleteSite = vi.fn().mockResolvedValue(true);
      useSitesStore.setState({ deleteSite });

      const { user } = renderWithProviders(<AppCard site={mockSite} />);

      const deleteButton = screen.getByRole('button', { name: /Delete app Test Application/i });
      await user.click(deleteButton);

      const confirmButton = screen.getByRole('button', { name: /^Delete$/i });
      await user.click(confirmButton);

      await waitFor(() => {
        expect(deleteSite).toHaveBeenCalledWith('test-site-123');
      });
    });

    it('should show deleting state while delete is in progress', async () => {
      const deleteSite = vi.fn(() => new Promise(() => {}));
      useSitesStore.setState({ deleteSite });

      const { user } = renderWithProviders(<AppCard site={mockSite} />);

      const deleteButton = screen.getByRole('button', { name: /Delete app Test Application/i });
      await user.click(deleteButton);

      const confirmButton = screen.getByRole('button', { name: /^Delete$/i });
      await user.click(confirmButton);

      await waitFor(() => {
        expect(screen.getByText('Deleting...')).toBeInTheDocument();
      });
    });
  });

  describe('fetches site details on mount', () => {
    it('should fetch site details to check for published URL', async () => {
      vi.mocked(appFetch).mockResolvedValue({
        ok: true,
        json: async () => mockSite,
      } as Response);

      renderWithProviders(<AppCard site={mockSite} />);

      await waitFor(() => {
        expect(appFetch).toHaveBeenCalledWith(`/api/sites/${mockSite.id}`);
      });
    });

    it('should not show visit button if fetch fails', async () => {
      vi.mocked(appFetch).mockRejectedValue(new Error('Network error'));

      renderWithProviders(<AppCard site={mockSite} />);

      await waitFor(() => {
        expect(appFetch).toHaveBeenCalled();
      });

      expect(screen.queryByRole('link', { name: /Visit/i })).not.toBeInTheDocument();
    });
  });

  describe('renders thumbnail', () => {
    it('should render AppThumbnail component', async () => {
      renderWithProviders(<AppCard site={mockSite} />);

      await waitFor(() => {
        expect(screen.getByTestId('app-thumbnail-loading')).toBeInTheDocument();
      });
    });
  });
});

describe('AppCardEmptyState', () => {
  it('should render create new app text', () => {
    renderWithProviders(<AppCardEmptyState />);

    expect(screen.getByText('Create a new app')).toBeInTheDocument();
  });
});
