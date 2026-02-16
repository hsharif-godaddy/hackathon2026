import '@testing-library/jest-dom';

import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import { MediaType } from './AssetTypes';
import AttachmentBadge, { AttachmentList } from './AttachmentBadge';

describe('AttachmentBadge', () => {
  it('should render badge with filename and size', () => {
    const asset = {
      imageUrl: 'https://example.com/file.jpg',
      filename: 'test-image.jpg',
      mediaType: MediaType.IMAGE,
      sourceType: 'gc' as const,
      contentType: 'image/jpeg',
      size: 12345,
      dimensions: { width: 800, height: 600 },
      thumbnailUrl: 'https://example.com/thumb.jpg',
    };

    renderWithProviders(<AttachmentBadge asset={asset} />);

    expect(screen.getByText('test-image.jpg')).toBeInTheDocument();
    expect(screen.getByText('12.1 KB')).toBeInTheDocument();
  });

  it('should display image icon for IMAGE media type', () => {
    const asset = {
      imageUrl: 'https://example.com/file.jpg',
      filename: 'test.jpg',
      mediaType: MediaType.IMAGE,
      sourceType: 'gc' as const,
      contentType: 'image/jpeg',
      size: 1024,
      dimensions: { width: 800, height: 600 },
      thumbnailUrl: 'https://example.com/thumb.jpg',
    };

    const { container } = renderWithProviders(<AttachmentBadge asset={asset} />);

    // Check that an icon is rendered (UXCore icons render as SVGs)
    const icon = container.querySelector('svg');
    expect(icon).toBeInTheDocument();
  });

  it('should display video icon for VIDEO media type', () => {
    const asset = {
      imageUrl: 'https://example.com/file.mp4',
      filename: 'test.mp4',
      mediaType: MediaType.VIDEO,
      sourceType: 'gc' as const,
      contentType: 'video/mp4',
      size: 1024,
      thumbnailUrl: 'https://example.com/thumb.jpg',
    };

    const { container } = renderWithProviders(<AttachmentBadge asset={asset} />);

    const icon = container.querySelector('svg');
    expect(icon).toBeInTheDocument();
  });

  it('should display attachment icon for PDF media type', () => {
    const asset = {
      imageUrl: 'https://example.com/file.pdf',
      filename: 'test.pdf',
      mediaType: MediaType.PDF,
      sourceType: 'gc' as const,
      contentType: 'application/pdf',
      size: 1024,
    };

    const { container } = renderWithProviders(<AttachmentBadge asset={asset} />);

    const icon = container.querySelector('svg');
    expect(icon).toBeInTheDocument();
  });

  it('should display attachment icon for FILE media type', () => {
    const asset = {
      imageUrl: 'https://example.com/file.txt',
      filename: 'test.txt',
      mediaType: MediaType.FILE,
      sourceType: 'gc' as const,
      contentType: 'text/plain',
      size: 1024,
    };

    const { container } = renderWithProviders(<AttachmentBadge asset={asset} />);

    const icon = container.querySelector('svg');
    expect(icon).toBeInTheDocument();
  });

  it('should format file size in KB for small files', () => {
    const asset = {
      imageUrl: 'https://example.com/file.jpg',
      filename: 'test.jpg',
      mediaType: MediaType.IMAGE,
      sourceType: 'gc' as const,
      contentType: 'image/jpeg',
      size: 5120, // 5 KB
      dimensions: { width: 800, height: 600 },
      thumbnailUrl: 'https://example.com/thumb.jpg',
    };

    renderWithProviders(<AttachmentBadge asset={asset} />);

    expect(screen.getByText('5.0 KB')).toBeInTheDocument();
  });

  it('should format file size in MB for large files', () => {
    const asset = {
      imageUrl: 'https://example.com/file.jpg',
      filename: 'test.jpg',
      mediaType: MediaType.IMAGE,
      sourceType: 'gc' as const,
      contentType: 'image/jpeg',
      size: 2097152, // 2 MB
      dimensions: { width: 800, height: 600 },
      thumbnailUrl: 'https://example.com/thumb.jpg',
    };

    renderWithProviders(<AttachmentBadge asset={asset} />);

    expect(screen.getByText('2.0 MB')).toBeInTheDocument();
  });

  it('should display "Attachment" when filename is missing', () => {
    const asset = {
      imageUrl: 'https://example.com/file.jpg',
      mediaType: MediaType.IMAGE,
      sourceType: 'gc' as const,
      contentType: 'image/jpeg',
      dimensions: { width: 800, height: 600 },
      thumbnailUrl: 'https://example.com/thumb.jpg',
    };

    renderWithProviders(<AttachmentBadge asset={asset} />);

    expect(screen.getByText('Attachment')).toBeInTheDocument();
  });

  it('should not display file size when size is missing', () => {
    const asset = {
      imageUrl: 'https://example.com/file.jpg',
      filename: 'test.jpg',
      mediaType: MediaType.IMAGE,
      sourceType: 'gc' as const,
      contentType: 'image/jpeg',
      dimensions: { width: 800, height: 600 },
      thumbnailUrl: 'https://example.com/thumb.jpg',
    };

    renderWithProviders(<AttachmentBadge asset={asset} />);

    expect(screen.getByText('test.jpg')).toBeInTheDocument();
    // File size should not be rendered
    expect(screen.queryByText(/KB|MB/)).not.toBeInTheDocument();
  });

  it('should apply custom className', () => {
    const asset = {
      imageUrl: 'https://example.com/file.jpg',
      filename: 'test.jpg',
      mediaType: MediaType.IMAGE,
      sourceType: 'gc' as const,
      contentType: 'image/jpeg',
      size: 1024,
      dimensions: { width: 800, height: 600 },
      thumbnailUrl: 'https://example.com/thumb.jpg',
    };

    const { container } = renderWithProviders(
      <AttachmentBadge asset={asset} className="custom-class" />
    );

    const badge = container.firstChild;
    expect(badge).toHaveClass('custom-class');
  });
});

describe('AttachmentList', () => {
  it('should render multiple attachment badges', () => {
    const assets = [
      {
        imageUrl: 'https://example.com/file1.jpg',
        filename: 'test1.jpg',
        mediaType: MediaType.IMAGE,
        sourceType: 'gc' as const,
        contentType: 'image/jpeg',
        size: 1024,
        dimensions: { width: 800, height: 600 },
        thumbnailUrl: 'https://example.com/thumb1.jpg',
      },
      {
        imageUrl: 'https://example.com/file2.jpg',
        filename: 'test2.jpg',
        mediaType: MediaType.IMAGE,
        sourceType: 'gc' as const,
        contentType: 'image/jpeg',
        size: 2048,
        dimensions: { width: 800, height: 600 },
        thumbnailUrl: 'https://example.com/thumb2.jpg',
      },
    ];

    renderWithProviders(<AttachmentList assets={assets} />);

    expect(screen.getByText('test1.jpg')).toBeInTheDocument();
    expect(screen.getByText('test2.jpg')).toBeInTheDocument();
  });

  it('should return null for empty assets array', () => {
    const { container } = renderWithProviders(<AttachmentList assets={[]} />);

    expect(container.firstChild).toBeNull();
  });

  it('should apply custom className', () => {
    const assets = [
      {
        imageUrl: 'https://example.com/file1.jpg',
        filename: 'test1.jpg',
        mediaType: MediaType.IMAGE,
        sourceType: 'gc' as const,
        contentType: 'image/jpeg',
        size: 1024,
        dimensions: { width: 800, height: 600 },
        thumbnailUrl: 'https://example.com/thumb1.jpg',
      },
    ];

    const { container } = renderWithProviders(
      <AttachmentList assets={assets} className="custom-list-class" />
    );

    const list = container.firstChild;
    expect(list).toHaveClass('custom-list-class');
  });
});
