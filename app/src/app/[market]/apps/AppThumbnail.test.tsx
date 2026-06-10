/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import AppThumbnail from './AppThumbnail';

vi.mock('@/lib/request-context', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe('AppThumbnail', () => {
  const mockSiteName = 'Test Application';
  const mockUrl = 'https://shots.example/preview-desktop.png';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('renders the screenshot when a URL is provided', () => {
    it('displays an img with the screenshot URL and alt text', () => {
      renderWithProviders(
        <AppThumbnail siteName={mockSiteName} size="md" screenshotUrl={mockUrl} />
      );

      const img = screen.getByAltText(`Screenshot of ${mockSiteName}`);
      expect(img).toBeInTheDocument();
      expect(img).toHaveAttribute('src', mockUrl);
      expect(screen.getByTestId('app-thumbnail')).toBeInTheDocument();
    });
  });

  describe('renders the fallback tile', () => {
    it('shows the code-icon fallback when no screenshotUrl is provided', () => {
      renderWithProviders(<AppThumbnail siteName={mockSiteName} />);

      expect(screen.getByTestId('app-thumbnail-fallback')).toBeInTheDocument();
      expect(
        screen.queryByAltText(`Screenshot of ${mockSiteName}`)
      ).not.toBeInTheDocument();
    });

    it('falls back to the code-icon tile when the image fails to load', async () => {
      const { logger } = await import('@/lib/request-context');

      renderWithProviders(
        <AppThumbnail siteName={mockSiteName} screenshotUrl={mockUrl} />
      );

      const img = screen.getByAltText(`Screenshot of ${mockSiteName}`);
      fireEvent.error(img);

      expect(screen.getByTestId('app-thumbnail-fallback')).toBeInTheDocument();
      expect(
        screen.queryByAltText(`Screenshot of ${mockSiteName}`)
      ).not.toBeInTheDocument();
      // Abnormal failures are logged so they surface in Loki (404s silent would be nice,
      // but we have no status code here — log all onError events for observability).
      expect(logger.warn).toHaveBeenCalledWith(
        'app-thumbnail.image.load.failed',
        expect.objectContaining({ siteName: mockSiteName, screenshotUrl: mockUrl }),
      );
    });
  });

  describe('URL change after error resets the fallback', () => {
    it('shows the new image when screenshotUrl changes after an error (via key remount)', () => {
      const urlB = 'https://shots.example/new-app.png';

      // Simulate what the call sites do: key={screenshotUrl}. With urlA the
      // component mounts, image errors, fallback shows. When the key changes
      // to urlB React unmounts + remounts, fresh state, new image shows.
      const { rerender } = renderWithProviders(
        <AppThumbnail key={mockUrl} siteName={mockSiteName} screenshotUrl={mockUrl} />
      );

      fireEvent.error(screen.getByAltText(`Screenshot of ${mockSiteName}`));
      expect(screen.getByTestId('app-thumbnail-fallback')).toBeInTheDocument();

      // key changes → remount → no error state
      rerender(<AppThumbnail key={urlB} siteName={mockSiteName} screenshotUrl={urlB} />);

      const img = screen.getByAltText(`Screenshot of ${mockSiteName}`);
      expect(img).toHaveAttribute('src', urlB);
      expect(screen.queryByTestId('app-thumbnail-fallback')).not.toBeInTheDocument();
    });

    it('stays on the fallback when the same URL is re-rendered after an error', () => {
      const { rerender } = renderWithProviders(
        <AppThumbnail key={mockUrl} siteName={mockSiteName} screenshotUrl={mockUrl} />
      );

      fireEvent.error(screen.getByAltText(`Screenshot of ${mockSiteName}`));
      expect(screen.getByTestId('app-thumbnail-fallback')).toBeInTheDocument();

      // Same key → no remount → error state persists
      rerender(<AppThumbnail key={mockUrl} siteName={mockSiteName} screenshotUrl={mockUrl} />);
      expect(screen.getByTestId('app-thumbnail-fallback')).toBeInTheDocument();
    });
  });

  describe('handles different sizes (fallback tile)', () => {
    it.each(['xs', 'sm', 'md', 'lg'] as const)('renders with %s size', (size) => {
      renderWithProviders(<AppThumbnail siteName={mockSiteName} size={size} />);
      expect(screen.getByTestId('app-thumbnail-fallback')).toBeInTheDocument();
    });

    it('renders without a size prop (default)', () => {
      renderWithProviders(<AppThumbnail siteName={mockSiteName} />);
      expect(screen.getByTestId('app-thumbnail-fallback')).toBeInTheDocument();
    });
  });
});
