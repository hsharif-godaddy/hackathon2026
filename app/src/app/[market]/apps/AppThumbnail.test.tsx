/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import AppThumbnail from './AppThumbnail';

// Mock the hook to control loading/error/data states
const mockUseAppThumbnail = vi.fn();

vi.mock('@/hooks/useAppThumbnail', () => ({
  useAppThumbnail: (siteId: string, enabled?: boolean, agentUrl?: string) =>
    mockUseAppThumbnail(siteId, enabled, agentUrl),
}));

describe('AppThumbnail', () => {
  const mockSiteId = 'test-site-123';
  const mockSiteName = 'Test Application';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('renders loading state correctly', () => {
    it('should show loading placeholder while fetching', () => {
      mockUseAppThumbnail.mockReturnValue({
        data: undefined,
        isLoading: true,
        isError: false,
      });

      renderWithProviders(
        <AppThumbnail siteId={mockSiteId} siteName={mockSiteName} />
      );

      expect(screen.getByTestId('app-thumbnail-loading')).toBeInTheDocument();
    });
  });

  describe('renders thumbnail when image loads successfully', () => {
    it('should display thumbnail image with correct alt text', () => {
      mockUseAppThumbnail.mockReturnValue({
        data: 'blob:mock-url',
        isLoading: false,
        isError: false,
      });

      renderWithProviders(
        <AppThumbnail siteId={mockSiteId} siteName={mockSiteName} size="md" />
      );

      const img = screen.getByAltText(`Screenshot of ${mockSiteName}`);
      expect(img).toBeInTheDocument();
      expect(img).toHaveAttribute('src', 'blob:mock-url');
    });

    it('should render thumbnail container with proper test id', () => {
      mockUseAppThumbnail.mockReturnValue({
        data: 'blob:mock-url',
        isLoading: false,
        isError: false,
      });

      renderWithProviders(
        <AppThumbnail siteId={mockSiteId} siteName={mockSiteName} />
      );

      expect(screen.getByTestId('app-thumbnail')).toBeInTheDocument();
    });
  });

  describe('renders fallback icon when image fails to load', () => {
    it('should show fallback icon when data is null', () => {
      mockUseAppThumbnail.mockReturnValue({
        data: null,
        isLoading: false,
        isError: false,
      });

      renderWithProviders(
        <AppThumbnail siteId={mockSiteId} siteName={mockSiteName} />
      );

      expect(screen.getByTestId('app-thumbnail-fallback')).toBeInTheDocument();
      expect(screen.queryByAltText(`Screenshot of ${mockSiteName}`)).not.toBeInTheDocument();
    });

    it('should show fallback icon on error', () => {
      mockUseAppThumbnail.mockReturnValue({
        data: undefined,
        isLoading: false,
        isError: true,
      });

      renderWithProviders(
        <AppThumbnail siteId={mockSiteId} siteName={mockSiteName} />
      );

      expect(screen.getByTestId('app-thumbnail-fallback')).toBeInTheDocument();
    });
  });

  describe('handles different sizes correctly', () => {
    beforeEach(() => {
      mockUseAppThumbnail.mockReturnValue({
        data: null,
        isLoading: false,
        isError: false,
      });
    });

    it('should render with xs size', () => {
      renderWithProviders(
        <AppThumbnail siteId={mockSiteId} siteName={mockSiteName} size="xs" />
      );

      expect(screen.getByTestId('app-thumbnail-fallback')).toBeInTheDocument();
    });

    it('should render with sm size', () => {
      renderWithProviders(
        <AppThumbnail siteId={mockSiteId} siteName={mockSiteName} size="sm" />
      );

      expect(screen.getByTestId('app-thumbnail-fallback')).toBeInTheDocument();
    });

    it('should render with md size', () => {
      renderWithProviders(
        <AppThumbnail siteId={mockSiteId} siteName={mockSiteName} size="md" />
      );

      expect(screen.getByTestId('app-thumbnail-fallback')).toBeInTheDocument();
    });

    it('should render with lg size', () => {
      renderWithProviders(
        <AppThumbnail siteId={mockSiteId} siteName={mockSiteName} size="lg" />
      );

      expect(screen.getByTestId('app-thumbnail-fallback')).toBeInTheDocument();
    });

    it('should render without size prop (default)', () => {
      renderWithProviders(
        <AppThumbnail siteId={mockSiteId} siteName={mockSiteName} />
      );

      expect(screen.getByTestId('app-thumbnail-fallback')).toBeInTheDocument();
    });
  });

  describe('passes props to useAppThumbnail', () => {
    it('should call useAppThumbnail with enabled true and undefined agentUrl by default', () => {
      mockUseAppThumbnail.mockReturnValue({
        data: null,
        isLoading: false,
        isError: false,
      });

      renderWithProviders(
        <AppThumbnail siteId={mockSiteId} siteName={mockSiteName} />
      );

      expect(mockUseAppThumbnail).toHaveBeenCalledWith(mockSiteId, true, undefined);
    });

    it('should pass agentUrl to useAppThumbnail when provided', () => {
      mockUseAppThumbnail.mockReturnValue({
        data: null,
        isLoading: false,
        isError: false,
      });

      renderWithProviders(
        <AppThumbnail
          siteId={mockSiteId}
          siteName={mockSiteName}
          agentUrl="https://app.agent.example.com"
        />
      );

      expect(mockUseAppThumbnail).toHaveBeenCalledWith(
        mockSiteId,
        true,
        'https://app.agent.example.com'
      );
    });
  });
});
