// @vitest-environment jsdom
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import { UploadedImagesSection } from './UploadedImagesSection';

const mockAppId = 'app-123';

vi.mock('@/config/dynamic-api', () => ({
  dynamicApiConfigService: {
    getConfigForSite: vi.fn().mockResolvedValue({ agentUrl: 'https://agent.example.com/apps/app-123' }),
  },
}));

vi.mock('@/lib/jwt-regeneration', () => ({
  regenerateToken: vi.fn().mockResolvedValue({ token: 'mock-token' }),
}));

vi.mock('@/lib/request-context', () => ({
  logger: { error: vi.fn(), info: vi.fn() },
}));

const makeFile = (filename: string, originalName: string, signedUrl?: string) => ({
  id: filename,
  filename,
  originalName,
  mimeType: 'image/jpeg',
  size: 1024,
  signedUrl,
});

const mockFetchSuccess = (files: ReturnType<typeof makeFile>[]) => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ files }),
  });
};

describe('UploadedImagesSection', () => {
  const mockOnSelectImage = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('#grid layout', () => {
    it('renders all uploads in grid', async () => {
      mockFetchSuccess([
        makeFile('photo-a.jpg', 'Photo A', '/signed/photo-a.jpg'),
        makeFile('photo-b.jpg', 'Photo B', '/signed/photo-b.jpg'),
      ]);

      renderWithProviders(
        <UploadedImagesSection appId={mockAppId} onSelectImage={mockOnSelectImage} layout="grid" />
      );

      await waitFor(() => {
        expect(screen.getByAltText('Photo A')).toBeInTheDocument();
        expect(screen.getByAltText('Photo B')).toBeInTheDocument();
      });
    });

    it('renders null when no uploads returned', async () => {
      mockFetchSuccess([]);

      const { container } = renderWithProviders(
        <UploadedImagesSection appId={mockAppId} onSelectImage={mockOnSelectImage} layout="grid" />
      );

      await waitFor(() => {
        expect(container.firstChild).toBeNull();
      });
    });

    it('renders null silently on fetch error', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: false });

      const { container } = renderWithProviders(
        <UploadedImagesSection appId={mockAppId} onSelectImage={mockOnSelectImage} layout="grid" />
      );

      await waitFor(() => {
        expect(container.firstChild).toBeNull();
      });
    });

    it('calls onSelectImage with the file when clicked', async () => {
      mockFetchSuccess([makeFile('photo-a.jpg', 'Photo A', '/signed/photo-a.jpg')]);

      const { user } = renderWithProviders(
        <UploadedImagesSection appId={mockAppId} onSelectImage={mockOnSelectImage} layout="grid" />
      );

      await waitFor(() => expect(screen.getByAltText('Photo A')).toBeInTheDocument());
      await user.click(screen.getByRole('button'));

      expect(mockOnSelectImage).toHaveBeenCalledWith(
        expect.objectContaining({ filename: 'photo-a.jpg' })
      );
    });

    it('shows filename fallback when no signedUrl', async () => {
      mockFetchSuccess([makeFile('photo-a.jpg', 'Photo A')]);

      renderWithProviders(
        <UploadedImagesSection appId={mockAppId} onSelectImage={mockOnSelectImage} layout="grid" />
      );

      await waitFor(() => {
        expect(screen.getByText('Photo A')).toBeInTheDocument();
      });
    });
  });

  describe('#horizontal layout', () => {
    it('shows correct upload count', async () => {
      mockFetchSuccess([
        makeFile('photo-a.jpg', 'Photo A', '/signed/photo-a.jpg'),
        makeFile('photo-b.jpg', 'Photo B', '/signed/photo-b.jpg'),
        makeFile('photo-c.jpg', 'Photo C', '/signed/photo-c.jpg'),
      ]);

      renderWithProviders(
        <UploadedImagesSection
          appId={mockAppId}
          onSelectImage={mockOnSelectImage}
          layout="horizontal"
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Your Uploads (3)')).toBeInTheDocument();
      });
    });
  });
});
