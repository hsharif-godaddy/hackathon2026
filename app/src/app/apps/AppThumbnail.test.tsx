import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { renderWithProviders } from '@/tests/test-utils';
import { mockURLMethods } from '@/tests/mocks';
import AppThumbnail from './AppThumbnail';
import { buildDynamicApiUrl } from '@/config/dynamic-api';
import { agentFetch } from '@/lib/agent-fetch';

vi.mock('@/config/dynamic-api');
vi.mock('@/lib/agent-fetch');

describe('AppThumbnail', () => {
  const mockSiteId = 'test-site-123';
  const mockSiteName = 'Test Application';

  beforeEach(() => {
    vi.clearAllMocks();
    mockURLMethods();
    vi.mocked(buildDynamicApiUrl).mockResolvedValue(`https://api.test/screenshot/${mockSiteId}`);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('renders loading state correctly', () => {
    it('should show loading placeholder with icon', async () => {
      vi.mocked(agentFetch).mockImplementation(() =>
        new Promise(() => {})
      );

      renderWithProviders(
        <AppThumbnail siteId={mockSiteId} siteName={mockSiteName} />
      );

      expect(screen.getByTestId('app-thumbnail-loading')).toBeInTheDocument();
    });
  });

  describe('renders thumbnail when image loads successfully', () => {
    it('should display thumbnail image with correct alt text', async () => {
      const mockBlob = new Blob(['fake-image-data'], { type: 'image/png' });

      vi.mocked(agentFetch).mockResolvedValue({
        ok: true,
        status: 200,
        blob: async () => mockBlob,
      } as Response);

      renderWithProviders(
        <AppThumbnail siteId={mockSiteId} siteName={mockSiteName} size="md" />
      );

      await waitFor(() => {
        const img = screen.getByAltText(`Screenshot of ${mockSiteName}`);
        expect(img).toBeInTheDocument();
        expect(img).toHaveAttribute('src', 'blob:mock-url');
      });
    });

    it('should create object URL from blob', async () => {
      const mockBlob = new Blob(['fake-image-data'], { type: 'image/png' });

      vi.mocked(agentFetch).mockResolvedValue({
        ok: true,
        status: 200,
        blob: async () => mockBlob,
      } as Response);

      renderWithProviders(
        <AppThumbnail siteId={mockSiteId} siteName={mockSiteName} />
      );

      await waitFor(() => {
        expect(global.URL.createObjectURL).toHaveBeenCalledWith(mockBlob);
      });
    });
  });

  describe('renders fallback icon when image fails to load', () => {
    it('should show fallback icon on 404 response', async () => {
      vi.mocked(agentFetch).mockResolvedValue({
        ok: false,
        status: 404,
      } as Response);

      renderWithProviders(
        <AppThumbnail siteId={mockSiteId} siteName={mockSiteName} />
      );

      await waitFor(() => {
        expect(screen.getByTestId('app-thumbnail-fallback')).toBeInTheDocument();
        expect(screen.queryByAltText(`Screenshot of ${mockSiteName}`)).not.toBeInTheDocument();
      });
    });

    it('should show fallback icon on network error', async () => {
      vi.mocked(agentFetch).mockRejectedValue(new Error('Network error'));

      renderWithProviders(
        <AppThumbnail siteId={mockSiteId} siteName={mockSiteName} />
      );

      await waitFor(() => {
        expect(screen.getByTestId('app-thumbnail-fallback')).toBeInTheDocument();
      });
    });

    it('should show fallback icon on non-ok response', async () => {
      vi.mocked(agentFetch).mockResolvedValue({
        ok: false,
        status: 500,
      } as Response);

      renderWithProviders(
        <AppThumbnail siteId={mockSiteId} siteName={mockSiteName} />
      );

      await waitFor(() => {
        expect(screen.getByTestId('app-thumbnail-fallback')).toBeInTheDocument();
      });
    });
  });

  describe('handles different sizes correctly', () => {
    it('should render with xs size', async () => {
      vi.mocked(agentFetch).mockResolvedValue({
        ok: false,
        status: 404,
      } as Response);

      renderWithProviders(
        <AppThumbnail siteId={mockSiteId} siteName={mockSiteName} size="xs" />
      );

      await waitFor(() => {
        expect(screen.getByTestId('app-thumbnail-fallback')).toBeInTheDocument();
      });
    });

    it('should render with sm size', async () => {
      vi.mocked(agentFetch).mockResolvedValue({
        ok: false,
        status: 404,
      } as Response);

      renderWithProviders(
        <AppThumbnail siteId={mockSiteId} siteName={mockSiteName} size="sm" />
      );

      await waitFor(() => {
        expect(screen.getByTestId('app-thumbnail-fallback')).toBeInTheDocument();
      });
    });

    it('should render with md size by default', async () => {
      vi.mocked(agentFetch).mockResolvedValue({
        ok: false,
        status: 404,
      } as Response);

      renderWithProviders(
        <AppThumbnail siteId={mockSiteId} siteName={mockSiteName} />
      );

      await waitFor(() => {
        expect(screen.getByTestId('app-thumbnail-fallback')).toBeInTheDocument();
      });
    });

    it('should render with lg size', async () => {
      vi.mocked(agentFetch).mockResolvedValue({
        ok: false,
        status: 404,
      } as Response);

      renderWithProviders(
        <AppThumbnail siteId={mockSiteId} siteName={mockSiteName} size="lg" />
      );

      await waitFor(() => {
        expect(screen.getByTestId('app-thumbnail-fallback')).toBeInTheDocument();
      });
    });
  });

  describe('cleans up resources on unmount', () => {
    it('should revoke object URL when component unmounts', async () => {
      const mockBlob = new Blob(['fake-image-data'], { type: 'image/png' });

      vi.mocked(agentFetch).mockResolvedValue({
        ok: true,
        status: 200,
        blob: async () => mockBlob,
      } as Response);

      const { unmount } = renderWithProviders(
        <AppThumbnail siteId={mockSiteId} siteName={mockSiteName} />
      );

      await waitFor(() => {
        expect(global.URL.createObjectURL).toHaveBeenCalled();
      });

      unmount();

      expect(global.URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
    });

    it('should cancel pending requests on unmount', async () => {
      let resolvePromise: (value: Response) => void;
      const pendingPromise = new Promise<Response>((resolve) => {
        resolvePromise = resolve;
      });

      vi.mocked(agentFetch).mockReturnValue(pendingPromise);

      const { unmount } = renderWithProviders(
        <AppThumbnail siteId={mockSiteId} siteName={mockSiteName} />
      );

      unmount();

      const mockBlob = new Blob(['fake-image-data'], { type: 'image/png' });
      resolvePromise!({
        ok: true,
        status: 200,
        blob: async () => mockBlob,
      } as Response);

      await waitFor(() => {
        expect(global.URL.createObjectURL).not.toHaveBeenCalled();
      });
    });
  });

  describe('passes correct props to agentFetch', () => {
    it('should call agentFetch with correct parameters', async () => {
      vi.mocked(agentFetch).mockResolvedValue({
        ok: false,
        status: 404,
      } as Response);

      renderWithProviders(
        <AppThumbnail siteId={mockSiteId} siteName={mockSiteName} />
      );

      await waitFor(() => {
        expect(buildDynamicApiUrl).toHaveBeenCalledWith('screenshot', mockSiteId);
        expect(agentFetch).toHaveBeenCalledWith(
          `https://api.test/screenshot/${mockSiteId}`,
          {
            method: 'GET',
            siteId: mockSiteId,
          }
        );
      });
    });
  });
});
