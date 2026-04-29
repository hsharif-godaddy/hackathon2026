// @vitest-environment jsdom
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';

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

vi.mock('@/utils/image-compression', () => ({
  compressImageFile: vi.fn().mockImplementation((f: File) => Promise.resolve(f)),
}));

vi.mock('@/utils/instrumentation', () => ({
  logImpressionEvent: vi.fn().mockReturnValue(() => {}),
  generateClickEID: vi.fn().mockReturnValue(''),
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

  describe('grid layout', () => {
    it('renders all uploads in grid with upload placeholder', async () => {
      mockFetchSuccess([
        makeFile('photo-a.jpg', 'Photo A', '/signed/photo-a.jpg'),
        makeFile('photo-b.jpg', 'Photo B', '/signed/photo-b.jpg'),
      ]);

      renderWithProviders(
        <UploadedImagesSection appId={mockAppId} onSelectImage={mockOnSelectImage} />
      );

      await waitFor(() => {
        expect(screen.getByAltText('Photo A')).toBeInTheDocument();
        expect(screen.getByAltText('Photo B')).toBeInTheDocument();
        expect(screen.getAllByRole('button')).toHaveLength(3); // 2 photos + upload placeholder
      });
    });

    it('renders only the upload placeholder when no uploads returned', async () => {
      mockFetchSuccess([]);

      renderWithProviders(
        <UploadedImagesSection appId={mockAppId} onSelectImage={mockOnSelectImage} />
      );

      await waitFor(() => {
        expect(screen.getAllByRole('button')).toHaveLength(1);
      });
    });

    it('renders null silently on fetch error', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: false });

      const { container } = renderWithProviders(
        <UploadedImagesSection appId={mockAppId} onSelectImage={mockOnSelectImage} />
      );

      await waitFor(() => {
        expect(container.firstChild).toBeNull();
      });
    });

    it('calls onSelectImage with the file when clicked', async () => {
      mockFetchSuccess([makeFile('photo-a.jpg', 'Photo A', '/signed/photo-a.jpg')]);

      const { user } = renderWithProviders(
        <UploadedImagesSection appId={mockAppId} onSelectImage={mockOnSelectImage} />
      );

      await waitFor(() => expect(screen.getByAltText('Photo A')).toBeInTheDocument());
      await user.click(screen.getByAltText('Photo A').closest('button')!);

      expect(mockOnSelectImage).toHaveBeenCalledWith(
        expect.objectContaining({ filename: 'photo-a.jpg' })
      );
    });

    it('shows filename fallback when no signedUrl', async () => {
      mockFetchSuccess([makeFile('photo-a.jpg', 'Photo A')]);

      renderWithProviders(
        <UploadedImagesSection appId={mockAppId} onSelectImage={mockOnSelectImage} />
      );

      await waitFor(() => {
        expect(screen.getByText('Photo A')).toBeInTheDocument();
      });
    });
  });

  describe('upload button', () => {
    it('upload placeholder button is disabled when isDisabled=true', async () => {
      mockFetchSuccess([]);

      renderWithProviders(
        <UploadedImagesSection appId={mockAppId} onSelectImage={mockOnSelectImage} isDisabled />
      );

      await waitFor(() => {
        const [uploadBtn] = screen.getAllByRole('button');
        expect(uploadBtn).toBeDisabled();
      });
    });

    it('upload placeholder button is enabled when isDisabled=false', async () => {
      mockFetchSuccess([]);

      renderWithProviders(
        <UploadedImagesSection appId={mockAppId} onSelectImage={mockOnSelectImage} isDisabled={false} />
      );

      await waitFor(() => {
        const [uploadBtn] = screen.getAllByRole('button');
        expect(uploadBtn).not.toBeDisabled();
      });
    });

    it('upload image buttons are disabled when isDisabled=true', async () => {
      mockFetchSuccess([makeFile('photo-a.jpg', 'Photo A', '/signed/photo-a.jpg')]);

      renderWithProviders(
        <UploadedImagesSection appId={mockAppId} onSelectImage={mockOnSelectImage} isDisabled />
      );

      await waitFor(() => {
        const buttons = screen.getAllByRole('button');
        // All buttons (upload + image) should be disabled
        buttons.forEach((btn) => expect(btn).toBeDisabled());
      });
    });

    it('does not call onSelectImage when isDisabled=true and image clicked', async () => {
      mockFetchSuccess([makeFile('photo-a.jpg', 'Photo A', '/signed/photo-a.jpg')]);

      const { user } = renderWithProviders(
        <UploadedImagesSection appId={mockAppId} onSelectImage={mockOnSelectImage} isDisabled />
      );

      await waitFor(() => expect(screen.getByAltText('Photo A')).toBeInTheDocument());
      await user.click(screen.getByAltText('Photo A').closest('button')!);

      expect(mockOnSelectImage).not.toHaveBeenCalled();
    });

    it('calls onUploadSuccess after a successful device upload', async () => {
      const onUploadSuccess = vi.fn();
      mockFetchSuccess([]);

      // First call: list fetch; second call: upload POST
      global.fetch = vi.fn()
        .mockResolvedValueOnce({ ok: true, json: async () => ({ files: [] }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) });

      const { user } = renderWithProviders(
        <UploadedImagesSection
          appId={mockAppId}
          slotName="hero"
          onSelectImage={mockOnSelectImage}
          onUploadSuccess={onUploadSuccess}
        />
      );

      await waitFor(() => expect(screen.getAllByRole('button')).toHaveLength(1));

      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
      const fakeFile = new File([jpegBytes], 'photo.jpg', { type: 'image/jpeg' });

      await user.upload(fileInput, fakeFile);

      await waitFor(() => expect(onUploadSuccess).toHaveBeenCalledTimes(1));
    });

    it('shows an error when file type is not allowed', async () => {
      mockFetchSuccess([]);

      renderWithProviders(
        <UploadedImagesSection appId={mockAppId} slotName="hero" onSelectImage={mockOnSelectImage} />
      );

      await waitFor(() => expect(screen.getAllByRole('button')).toHaveLength(1));

      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      const fakeFile = new File(['data'], 'doc.pdf', { type: 'application/pdf' });

      // Use fireEvent.change to bypass the accept attribute filter in userEvent
      Object.defineProperty(fileInput, 'files', { value: [fakeFile], configurable: true });
      fireEvent.change(fileInput);

      await waitFor(() => {
        // t() returns the key in tests; the error is set via t('builder_mediaslot_error_type')
        expect(screen.getByText('builder_mediaslot_error_type')).toBeInTheDocument();
      });
    });
  });
});
