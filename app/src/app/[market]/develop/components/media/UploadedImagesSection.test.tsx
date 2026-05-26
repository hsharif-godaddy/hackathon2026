// @vitest-environment jsdom
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import type { MediaSlot } from './types';
import { UploadedImagesSection } from './UploadedImagesSection';

const mockAppId = 'app-123';
const mockUseSwitchboard = vi.hoisted(() => vi.fn(() => true));

vi.mock('@/config/dynamic-api', () => ({
  dynamicApiConfigService: {
    getConfigForSite: vi
      .fn()
      .mockResolvedValue({ agentUrl: 'https://agent.example.com/apps/app-123' }),
  },
}));

vi.mock('@/lib/jwt-regeneration', () => ({
  regenerateToken: vi.fn().mockResolvedValue({ token: 'mock-token' }),
}));

vi.mock('@/lib/request-context', () => ({
  logger: { error: vi.fn(), info: vi.fn() },
}));

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: mockUseSwitchboard,
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

const makeSlot = (overrides: Partial<MediaSlot>): MediaSlot => ({
  mediaType: 'image',
  currentUrl: '',
  searchQuery: '',
  alternatives: [],
  userModified: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  lastUpdated: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const makeRect = ({
  top,
  left,
  width,
  height,
}: {
  top: number;
  left: number;
  width: number;
  height: number;
}) =>
  ({
    x: left,
    y: top,
    top,
    left,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  }) as DOMRect;

describe('UploadedImagesSection', () => {
  const mockOnSelectImage = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSwitchboard.mockReturnValue(true);
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
        expect(screen.getAllByRole('button')).toHaveLength(5); // upload placeholder + select/delete per photo
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

    it('hides delete controls when uploaded image deletion is disabled', async () => {
      mockUseSwitchboard.mockReturnValue(false);
      mockFetchSuccess([makeFile('photo-a.jpg', 'Photo A', '/signed/photo-a.jpg')]);

      renderWithProviders(
        <UploadedImagesSection
          appId={mockAppId}
          onSelectImage={mockOnSelectImage}
          slotUploads={[
            {
              url: '/airo-assets/uploads/photo-b.jpg',
              displayUrl: '/preview/photo-b.jpg',
              sourceFilename: 'photo-b.jpg',
            },
          ]}
        />
      );

      await waitFor(() => expect(screen.getByAltText('Photo A')).toBeInTheDocument());
      expect(screen.getByTestId('uploaded-image-tile-photo-b.jpg')).toBeInTheDocument();
      expect(screen.queryByTestId('uploaded-image-delete-photo-a.jpg')).not.toBeInTheDocument();
      expect(screen.queryByTestId('uploaded-image-delete-photo-b.jpg')).not.toBeInTheDocument();
      expect(screen.getAllByRole('button')).toHaveLength(3);
    });
  });

  describe('delete button', () => {
    it('opens a confirmation modal and does not delete until confirmed', async () => {
      mockFetchSuccess([makeFile('photo-a.jpg', 'Photo A', '/signed/photo-a.jpg')]);

      const { user } = renderWithProviders(
        <UploadedImagesSection appId={mockAppId} onSelectImage={mockOnSelectImage} />
      );

      await waitFor(() => expect(screen.getByAltText('Photo A')).toBeInTheDocument());
      await user.click(screen.getByTestId('uploaded-image-delete-photo-a.jpg'));

      const dialog = screen.getByRole('dialog', { name: 'builder_common_confirm' });
      expect(dialog).toBe(screen.getByTestId('upload-delete-confirmation-card'));
      expect(screen.getByTestId('upload-delete-panel-overlay')).toBeInTheDocument();
      expect(screen.getByTestId('uploaded-image-tile-photo-a.jpg')).toHaveAttribute(
        'data-delete-target',
        'true'
      );
      expect(within(dialog).getByText('Before delete...')).toBeInTheDocument();
      expect(
        within(dialog).getByText('Are you sure you want to delete this image?')
      ).toBeInTheDocument();
      expect(global.fetch).toHaveBeenCalledTimes(1);

      await user.click(within(dialog).getByRole('button', { name: 'builder_common_cancel' }));

      expect(
        screen.queryByRole('dialog', { name: 'builder_common_confirm' })
      ).not.toBeInTheDocument();
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('cuts the panel overlay around the image being deleted', async () => {
      mockFetchSuccess([makeFile('photo-a.jpg', 'Photo A', '/signed/photo-a.jpg')]);
      const getBoundingClientRectSpy = vi
        .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
        .mockImplementation(function getMockRect(this: HTMLElement) {
          if (this.hasAttribute('data-media-delete-boundary')) {
            return makeRect({ top: 0, left: 0, width: 300, height: 500 });
          }
          if (this.getAttribute('data-delete-target') === 'true') {
            return makeRect({ top: 100, left: 100, width: 80, height: 80 });
          }
          return makeRect({ top: 0, left: 0, width: 0, height: 0 });
        });

      const { user } = renderWithProviders(
        <div data-media-delete-boundary>
          <UploadedImagesSection appId={mockAppId} onSelectImage={mockOnSelectImage} />
        </div>
      );

      await waitFor(() => expect(screen.getByAltText('Photo A')).toBeInTheDocument());
      await user.click(screen.getByTestId('uploaded-image-delete-photo-a.jpg'));

      const overlay = screen.getByTestId('upload-delete-panel-overlay');
      await waitFor(() => expect(overlay.children).toHaveLength(4));
      expect((overlay.children[0] as HTMLElement).style.height).toBe('96px');
      expect((overlay.children[1] as HTMLElement).style.width).toBe('96px');
      expect((overlay.children[2] as HTMLElement).style.left).toBe('184px');
      expect((overlay.children[3] as HTMLElement).style.top).toBe('184px');

      getBoundingClientRectSpy.mockRestore();
    });

    it('extends the panel overlay to the outer media panel boundary', async () => {
      mockFetchSuccess([makeFile('photo-a.jpg', 'Photo A', '/signed/photo-a.jpg')]);
      const getBoundingClientRectSpy = vi
        .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
        .mockImplementation(function getMockRect(this: HTMLElement) {
          if (this.hasAttribute('data-media-delete-overlay-boundary')) {
            return makeRect({ top: 10, left: 0, width: 440, height: 700 });
          }
          if (this.hasAttribute('data-media-delete-boundary')) {
            return makeRect({ top: 20, left: 16, width: 400, height: 500 });
          }
          if (this.getAttribute('data-delete-target') === 'true') {
            return makeRect({ top: 100, left: 100, width: 80, height: 80 });
          }
          return makeRect({ top: 0, left: 0, width: 0, height: 0 });
        });

      const { user } = renderWithProviders(
        <div data-media-delete-overlay-boundary>
          <div data-media-delete-boundary>
            <UploadedImagesSection appId={mockAppId} onSelectImage={mockOnSelectImage} />
          </div>
        </div>
      );

      await waitFor(() => expect(screen.getByAltText('Photo A')).toBeInTheDocument());
      await user.click(screen.getByTestId('uploaded-image-delete-photo-a.jpg'));

      expect(screen.getByTestId('upload-delete-panel-overlay')).toHaveStyle({
        top: '10px',
        left: '0px',
        width: '440px',
        height: '700px',
      });
      expect(screen.getByTestId('upload-delete-confirmation-card')).toHaveStyle({
        left: '32px',
        bottom: '264px',
        width: '368px',
      });

      getBoundingClientRectSpy.mockRestore();
    });

    it('shows other media slots that use the deleted image', async () => {
      mockFetchSuccess([makeFile('photo-a.jpg', 'Photo A', '/signed/photo-a.jpg')]);

      const { user } = renderWithProviders(
        <UploadedImagesSection
          appId={mockAppId}
          slotName="pages/home/hero"
          onSelectImage={mockOnSelectImage}
          mediaManifest={{
            'pages/home/hero': makeSlot({
              currentUrl: '/airo-assets/uploads/home-hero.jpg',
              uploadSources: { '/airo-assets/uploads/home-hero.jpg': 'photo-a.jpg' },
            }),
            'components/footer/logo': makeSlot({
              currentUrl: '/airo-assets/uploads/footer-logo.jpg',
              uploadSources: { '/airo-assets/uploads/footer-logo.jpg': 'photo-a.jpg' },
            }),
            'sections/about/background': makeSlot({
              currentUrl: '/airo-assets/uploads/other.jpg',
              alternatives: ['/airo-assets/uploads/photo-a.jpg'],
            }),
          }}
        />
      );

      await waitFor(() => expect(screen.getByAltText('Photo A')).toBeInTheDocument());
      await user.click(screen.getByTestId('uploaded-image-delete-photo-a.jpg'));

      const dialog = screen.getByRole('dialog', { name: 'builder_common_confirm' });
      expect(within(dialog).getByText('This image is also used in:')).toBeInTheDocument();
      expect(within(dialog).getByRole('list')).toHaveClass('list-none');
      expect(within(dialog).getByText('Footer Logo')).toBeInTheDocument();
      expect(within(dialog).getByText('About Background')).toBeInTheDocument();
      expect(within(dialog).queryByText('Home Hero')).not.toBeInTheDocument();
      expect(
        within(dialog).getByRole('button', { name: 'Only remove in this slot' })
      ).toBeInTheDocument();
      expect(within(dialog).getByRole('button', { name: 'Delete everywhere' })).toBeInTheDocument();
    });

    it('removes a shared upload from only the active slot', async () => {
      const onDeleteSuccess = vi.fn();
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            files: [makeFile('photo-a.jpg', 'Photo A', '/signed/photo-a.jpg')],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            success: true,
            affectedSlots: ['pages/home/hero'],
            removedUrls: ['/airo-assets/uploads/home-hero.jpg'],
            chatUploadDeleted: false,
          }),
        });

      const { user } = renderWithProviders(
        <UploadedImagesSection
          appId={mockAppId}
          slotName="pages/home/hero"
          onSelectImage={mockOnSelectImage}
          onDeleteSuccess={onDeleteSuccess}
          mediaManifest={{
            'pages/home/hero': makeSlot({
              currentUrl: '/airo-assets/uploads/home-hero.jpg',
              uploadSources: { '/airo-assets/uploads/home-hero.jpg': 'photo-a.jpg' },
            }),
            'components/footer/logo': makeSlot({
              currentUrl: '/airo-assets/uploads/footer-logo.jpg',
              uploadSources: { '/airo-assets/uploads/footer-logo.jpg': 'photo-a.jpg' },
            }),
          }}
        />
      );

      await waitFor(() => expect(screen.getByAltText('Photo A')).toBeInTheDocument());
      await user.click(screen.getByTestId('uploaded-image-delete-photo-a.jpg'));
      await user.click(
        within(screen.getByRole('dialog', { name: 'builder_common_confirm' })).getByRole('button', {
          name: 'Only remove in this slot',
        })
      );

      await waitFor(() => {
        expect(
          screen.queryByRole('dialog', { name: 'builder_common_confirm' })
        ).not.toBeInTheDocument();
      });
      expect(screen.getByAltText('Photo A')).toBeInTheDocument();
      expect(global.fetch).toHaveBeenLastCalledWith(
        'https://agent.example.com/media/app-123/slots/pages/home/hero/uploads/photo-a.jpg',
        expect.objectContaining({
          method: 'DELETE',
          headers: { Authorization: 'Bearer mock-token' },
        })
      );
      expect(onDeleteSuccess).toHaveBeenCalledWith(
        expect.objectContaining({
          affectedSlots: ['pages/home/hero'],
          chatUploadDeleted: false,
        })
      );
    });

    it('deletes an upload, removes it from the grid, and reports affected slots', async () => {
      const onDeleteSuccess = vi.fn();
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            files: [makeFile('photo-a.jpg', 'Photo A', '/signed/photo-a.jpg')],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            success: true,
            affectedSlots: ['hero'],
            removedUrls: ['/airo-assets/uploads/hero-photo.jpg'],
          }),
        });

      const { user } = renderWithProviders(
        <UploadedImagesSection
          appId={mockAppId}
          onSelectImage={mockOnSelectImage}
          onDeleteSuccess={onDeleteSuccess}
        />
      );

      await waitFor(() => expect(screen.getByAltText('Photo A')).toBeInTheDocument());
      await user.click(screen.getByTestId('uploaded-image-delete-photo-a.jpg'));
      await user.click(
        within(screen.getByRole('dialog', { name: 'builder_common_confirm' })).getByRole('button', {
          name: 'builder_common_delete',
        })
      );

      await waitFor(() => {
        expect(screen.queryByAltText('Photo A')).not.toBeInTheDocument();
      });
      expect(global.fetch).toHaveBeenLastCalledWith(
        'https://agent.example.com/media/app-123/uploads/photo-a.jpg',
        expect.objectContaining({
          method: 'DELETE',
          headers: { Authorization: 'Bearer mock-token' },
        })
      );
      expect(onDeleteSuccess).toHaveBeenCalledWith(
        expect.objectContaining({
          affectedSlots: ['hero'],
        })
      );
      expect(mockOnSelectImage).not.toHaveBeenCalled();
    });

    it('shows conflict feedback and keeps the upload visible', async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            files: [makeFile('photo-a.jpg', 'Photo A', '/signed/photo-a.jpg')],
          }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 409,
          json: async () => ({ error: 'Cannot delete upload because it is in use' }),
        });

      const { user } = renderWithProviders(
        <UploadedImagesSection appId={mockAppId} onSelectImage={mockOnSelectImage} />
      );

      await waitFor(() => expect(screen.getByAltText('Photo A')).toBeInTheDocument());
      await user.click(screen.getByTestId('uploaded-image-delete-photo-a.jpg'));
      await user.click(
        within(screen.getByRole('dialog', { name: 'builder_common_confirm' })).getByRole('button', {
          name: 'builder_common_delete',
        })
      );

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent(
          'Cannot delete upload because it is in use'
        );
      });
      expect(screen.getByAltText('Photo A')).toBeInTheDocument();
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
        <UploadedImagesSection
          appId={mockAppId}
          onSelectImage={mockOnSelectImage}
          isDisabled={false}
        />
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
      global.fetch = vi
        .fn()
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
        <UploadedImagesSection
          appId={mockAppId}
          slotName="hero"
          onSelectImage={mockOnSelectImage}
        />
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
