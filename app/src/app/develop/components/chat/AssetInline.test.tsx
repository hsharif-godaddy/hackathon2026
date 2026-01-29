import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

import { ImageAsset, MediaType, PDFAsset, VideoAsset } from '@/app/develop/components/chat/AssetManagerModal';
import { renderWithProviders } from '@/tests/test-utils';
import AssetInline, { AssetInlineList, AssetMode } from './AssetInline';

const mockDevelopStore = {
  setIsAssetManagerOpen: vi.fn(),
};

vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: (selector: any) => selector(mockDevelopStore),
}));

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: (feature: string) => {
    if (feature === 'appbuilder-image-manager') return { data: true };
    return { data: false };
  },
}));

const mockImageAsset: ImageAsset = {
  imageUrl: 'https://example.com/image.jpg',
  filename: 'test.jpg',
  mediaType: MediaType.IMAGE,
  sourceType: 'gc',
  contentType: 'image/jpeg',
  size: 12345,
  dimensions: {
    width: 800,
    height: 600,
  },
  thumbnailUrl: 'https://example.com/thumb.jpg',
};

describe('AssetInline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render without crashing', function render() {
    renderWithProviders(
      <AssetInline asset={mockImageAsset} onClear={vi.fn()} />
    );

    expect(screen.getByAltText('test.jpg')).toBeInTheDocument();
  });

  it('should render image with correct src and alt', function renderImage() {
    renderWithProviders(
      <AssetInline asset={mockImageAsset} onClear={vi.fn()} />
    );

    const image = screen.getByAltText('test.jpg');
    expect(image).toBeInTheDocument();
    expect(image).toHaveAttribute('src', 'https://example.com/image.jpg');
  });

  it('should render clear button when mode is edit', function renderClearEdit() {
    renderWithProviders(
      <AssetInline asset={mockImageAsset} onClear={vi.fn()} mode={AssetMode.EDIT} />
    );

    const clearButton = screen.getByTitle('builder_chatpane_clear_asset');
    expect(clearButton).toBeInTheDocument();
  });

  it('should not render clear button when mode is preview', function renderClearPreview() {
    renderWithProviders(
      <AssetInline asset={mockImageAsset} onClear={vi.fn()} mode={AssetMode.PREVIEW} />
    );

    const clearButton = screen.queryByTitle('builder_chatpane_clear_asset');
    expect(clearButton).not.toBeInTheDocument();
  });

  it('should not render clear button when mode is undefined', function renderClearUndefined() {
    renderWithProviders(
      <AssetInline asset={mockImageAsset} onClear={vi.fn()} />
    );

    const clearButton = screen.queryByTitle('builder_chatpane_clear_asset');
    expect(clearButton).not.toBeInTheDocument();
  });

  it('should call onClear when clear button clicked', async function clearClick() {
    const onClear = vi.fn();
    const { user } = renderWithProviders(
      <AssetInline asset={mockImageAsset} onClear={onClear} mode={AssetMode.EDIT} />
    );

    const clearButton = screen.getByTitle('builder_chatpane_clear_asset');
    await user.click(clearButton);

    expect(onClear).toHaveBeenCalledOnce();
  });


  it('should handle protocol-relative URLs', function protocolRelative() {
    const assetWithProtocolRelative = {
      ...mockImageAsset,
      imageUrl: '//example.com/image.jpg',
    };

    renderWithProviders(
      <AssetInline asset={assetWithProtocolRelative} onClear={vi.fn()} />
    );

    const image = screen.getByAltText('test.jpg');
    expect(image).toHaveAttribute('src', 'https://example.com/image.jpg');
  });

  it('should use filename for IMAGE alt text', function imageFilename() {
    renderWithProviders(
      <AssetInline asset={mockImageAsset} onClear={vi.fn()} />
    );

    expect(screen.getByAltText('test.jpg')).toBeInTheDocument();
  });

  it('should use translation key for IMAGE when filename is missing', function imageNoFilename() {
    const assetWithoutFilename = {
      ...mockImageAsset,
      filename: undefined,
    } as any;

    renderWithProviders(
      <AssetInline asset={assetWithoutFilename} onClear={vi.fn()} />
    );

    expect(screen.getByAltText('builder_chatpane_asset_image')).toBeInTheDocument();
  });

  it('should use translation key for VIDEO alt text', function videoAlt() {
    const videoAsset: VideoAsset = {
      imageUrl: 'https://example.com/video.jpg',
      mediaType: MediaType.VIDEO,
      sourceType: 'gc',
      videoUrl: 'https://example.com/video.mp4',
      id: 'video-123',
      urlHash: 'abc123',
      width: 1920,
      height: 1080,
    };

    renderWithProviders(
      <AssetInline asset={videoAsset} onClear={vi.fn()} />
    );

    expect(screen.getByAltText('builder_chatpane_asset_video')).toBeInTheDocument();
  });

  it('should use filename for PDF alt text', function pdfFilename() {
    const pdfAsset: PDFAsset = {
      imageUrl: 'https://example.com/pdf.jpg',
      filename: 'document.pdf',
      mediaType: MediaType.PDF,
      sourceType: 'gc',
      contentType: 'application/pdf',
      size: 54321,
      thumbnailUrl: 'https://example.com/pdf-thumb.jpg',
    };

    renderWithProviders(
      <AssetInline asset={pdfAsset} onClear={vi.fn()} />
    );

    expect(screen.getByText('document.pdf')).toBeInTheDocument();
  });

  it('should use translation key for PDF when filename is missing', function pdfNoFilename() {
    const pdfAssetWithoutFilename = {
      imageUrl: 'https://example.com/pdf.jpg',
      mediaType: MediaType.PDF,
      sourceType: 'gc',
      contentType: 'application/pdf',
      size: 54321,
      thumbnailUrl: 'https://example.com/pdf-thumb.jpg',
      filename: undefined,
    } as any;

    renderWithProviders(
      <AssetInline asset={pdfAssetWithoutFilename} onClear={vi.fn()} />
    );

    expect(screen.getByText('builder_chatpane_asset_pdf')).toBeInTheDocument();
  });

  it('should render with customAsset prop', function renderCustomAsset() {
    const customAsset = {
      imageUrl: 'https://example.com/custom.jpg',
      mediaType: MediaType.IMAGE,
    };

    renderWithProviders(
      <AssetInline customAsset={customAsset} onClear={vi.fn()} />
    );

    const image = screen.getByAltText('builder_chatpane_asset_image');
    expect(image).toBeInTheDocument();
    expect(image).toHaveAttribute('src', 'https://example.com/custom.jpg');
  });

  it('should use customAsset.imageAlt when provided', function customAssetImageAlt() {
    const customAsset = {
      imageUrl: 'https://example.com/custom.jpg',
      imageAlt: 'Custom alt text',
      mediaType: MediaType.IMAGE,
    };

    renderWithProviders(
      <AssetInline customAsset={customAsset} onClear={vi.fn()} />
    );

    expect(screen.getByAltText('Custom alt text')).toBeInTheDocument();
  });

  it('should fall back to translation key when customAsset.imageAlt is not provided', function customAssetNoImageAlt() {
    const customAsset = {
      imageUrl: 'https://example.com/custom.jpg',
      mediaType: MediaType.IMAGE,
    };

    renderWithProviders(
      <AssetInline customAsset={customAsset} onClear={vi.fn()} />
    );

    expect(screen.getByAltText('builder_chatpane_asset_image')).toBeInTheDocument();
  });

  it('should handle protocol-relative URLs with customAsset', function customAssetProtocolRelative() {
    const customAsset = {
      imageUrl: '//example.com/custom.jpg',
      mediaType: MediaType.IMAGE,
    };

    renderWithProviders(
      <AssetInline customAsset={customAsset} onClear={vi.fn()} />
    );

    const image = screen.getByAltText('builder_chatpane_asset_image');
    expect(image).toHaveAttribute('src', 'https://example.com/custom.jpg');
  });

  it('should return null when neither asset nor customAsset is provided', function noAsset() {
    const { container } = renderWithProviders(
      <AssetInline onClear={vi.fn()} />
    );

    expect(container.firstChild).toBeNull();
  });

  it('should render VIDEO customAsset', function customAssetVideo() {
    const customAsset = {
      imageUrl: 'https://example.com/video-thumb.jpg',
      mediaType: MediaType.VIDEO,
    };

    renderWithProviders(
      <AssetInline customAsset={customAsset} onClear={vi.fn()} />
    );

    expect(screen.getByAltText('builder_chatpane_asset_video')).toBeInTheDocument();
  });

  it('should render PDF customAsset', function customAssetPdf() {
    const customAsset = {
      imageUrl: 'https://example.com/pdf-thumb.jpg',
      mediaType: MediaType.PDF,
    };

    renderWithProviders(
      <AssetInline customAsset={customAsset} onClear={vi.fn()} />
    );

    expect(screen.getByText('builder_chatpane_asset_pdf')).toBeInTheDocument();
  });
});

describe('AssetInlineList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render add button when mode is edit', function renderAddEdit() {
    renderWithProviders(
      <AssetInlineList
        assets={[mockImageAsset]}
        onClearAsset={vi.fn()}
        mode={AssetMode.EDIT}
      />
    );

    const buttons = screen.getAllByRole('button');
    // Should have clear button for the asset
    expect(buttons.length).toBe(1);
  });

  it('should not render add button when mode is preview', function renderAddPreview() {
    renderWithProviders(
      <AssetInlineList
        assets={[mockImageAsset]}
        onClearAsset={vi.fn()}
        mode={AssetMode.PREVIEW}
      />
    );

    const buttons = screen.queryAllByRole('button');
    expect(buttons.length).toBe(0);
  });


  it('should pass mode prop to AssetInline components', function passMode() {
    renderWithProviders(
      <AssetInlineList
        assets={[mockImageAsset]}
        onClearAsset={vi.fn()}
        mode={AssetMode.PREVIEW}
      />
    );

    const clearButton = screen.queryByTitle('builder_chatpane_clear_asset');
    expect(clearButton).not.toBeInTheDocument();
  });

  it('should default to preview mode when mode is not provided', function defaultMode() {
    renderWithProviders(
      <AssetInlineList
        assets={[mockImageAsset]}
        onClearAsset={vi.fn()}
      />
    );

    const buttons = screen.queryAllByRole('button');
    expect(buttons.length).toBe(0);
  });
});

