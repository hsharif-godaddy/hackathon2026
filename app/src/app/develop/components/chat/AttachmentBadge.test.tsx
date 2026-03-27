/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import { MediaType } from './AssetTypes';
import AttachmentBadge, { AttachmentList } from './AttachmentBadge';

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string) => key,
}));

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

  it('should display thumbnail for IMAGE media type with imageUrl', function thumbnail() {
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

    renderWithProviders(<AttachmentBadge asset={asset} />);

    const thumbnail = screen.getByRole('img', { name: 'test.jpg' });
    expect(thumbnail).toBeInTheDocument();
    expect(thumbnail).toHaveAttribute('src', 'https://example.com/file.jpg');
  });

  it('should open modal when image thumbnail is clicked', async function openModal() {
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

    const { user } = renderWithProviders(<AttachmentBadge asset={asset} />);

    await user.click(screen.getByRole('button'));

    const modalImages = screen.getAllByRole('img', { name: 'test.jpg' });
    expect(modalImages.length).toBeGreaterThanOrEqual(2);
  });

  it('should fall back to icon when image fails to load', function fallback() {
    const asset = {
      imageUrl: 'https://example.com/broken.jpg',
      filename: 'broken.jpg',
      mediaType: MediaType.IMAGE,
      sourceType: 'gc' as const,
      contentType: 'image/jpeg',
      size: 1024,
      dimensions: { width: 800, height: 600 },
      thumbnailUrl: 'https://example.com/thumb.jpg',
    };

    const { container } = renderWithProviders(<AttachmentBadge asset={asset} />);

    fireEvent.error(screen.getByRole('img', { name: 'broken.jpg' }));

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(container.querySelector('svg')).toBeInTheDocument();
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

  it('should display translated fallback when filename is missing', function fallbackFilename() {
    const asset = {
      imageUrl: 'https://example.com/file.jpg',
      mediaType: MediaType.IMAGE,
      sourceType: 'gc' as const,
      contentType: 'image/jpeg',
      dimensions: { width: 800, height: 600 },
      thumbnailUrl: 'https://example.com/thumb.jpg',
    };

    renderWithProviders(<AttachmentBadge asset={asset} />);

    expect(screen.getByText('builder_common_attachment_default')).toBeInTheDocument();
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
