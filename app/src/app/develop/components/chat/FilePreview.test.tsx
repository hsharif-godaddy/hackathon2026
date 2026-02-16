import '@testing-library/jest-dom';

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import FilePreview from './FilePreview';

describe('FilePreview', () => {
  it('should render image thumbnail', () => {
    const file = {
      uploadId: 'upload_123',
      fileId: 'file_1',
      filename: 'photo.png',
      mimeType: 'image/png',
      size: 1024,
      url: 'https://agent.example.com/files/uploads/test-app/photo.png'
    };

    renderWithProviders(<FilePreview file={file} />);

    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('src', file.url);
    expect(img).toHaveAttribute('alt', file.filename);
  });

  it('should render file icon for non-images', () => {
    const file = {
      uploadId: 'upload_123',
      fileId: 'file_1',
      filename: 'data.json',
      mimeType: 'application/json',
      size: 512,
      url: 'https://agent.example.com/files/uploads/test-app/data.json'
    };

    renderWithProviders(<FilePreview file={file} />);

    expect(screen.getByText('data.json')).toBeInTheDocument();
    expect(screen.getByText('JSON')).toBeInTheDocument();
  });

  it('should call onRemove when remove button clicked', () => {
    const mockOnRemove = vi.fn();
    const file = {
      uploadId: 'upload_123',
      fileId: 'file_1',
      filename: 'test.png',
      mimeType: 'image/png',
      size: 1024,
      url: 'https://agent.example.com/files/uploads/test-app/test.png'
    };

    renderWithProviders(<FilePreview file={file} onRemove={mockOnRemove} />);

    const removeButton = screen.getByRole('button');
    fireEvent.click(removeButton);

    expect(mockOnRemove).toHaveBeenCalled();
  });

  it('should not render remove button when onRemove not provided', () => {
    const file = {
      uploadId: 'upload_123',
      fileId: 'file_1',
      filename: 'test.png',
      mimeType: 'image/png',
      size: 1024,
      url: 'https://agent.example.com/files/uploads/test-app/test.png'
    };

    renderWithProviders(<FilePreview file={file} />);

    const buttons = screen.queryAllByRole('button');
    expect(buttons).toHaveLength(0);
  });

  it('should render PDF file preview', () => {
    const file = {
      uploadId: 'upload_123',
      fileId: 'file_1',
      filename: 'document.pdf',
      mimeType: 'application/pdf',
      size: 2048,
      url: 'https://agent.example.com/files/uploads/test-app/document.pdf'
    };

    renderWithProviders(<FilePreview file={file} />);

    expect(screen.getByText('document.pdf')).toBeInTheDocument();
    expect(screen.getByText('PDF')).toBeInTheDocument();
  });

  it('should render font file preview', () => {
    const file = {
      uploadId: 'upload_123',
      fileId: 'file_1',
      filename: 'roboto.woff2',
      mimeType: 'font/woff2',
      size: 3072,
      url: 'https://agent.example.com/files/uploads/test-app/roboto.woff2'
    };

    renderWithProviders(<FilePreview file={file} />);

    expect(screen.getByText('roboto.woff2')).toBeInTheDocument();
    expect(screen.getByText('WOFF2')).toBeInTheDocument();
  });
});
