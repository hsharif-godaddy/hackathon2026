/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';

import FileUploadButton from '@/app/[market]/develop/components/chat/FileUploadButton';
import { renderWithProviders } from '@/tests/test-utils';

// Mock global fetch
global.fetch = vi.fn();

// Mock getFileUploadAgent
vi.mock('@/lib/file-agent', () => ({
  getFileUploadAgent: vi.fn().mockResolvedValue({
    token: 'mock-token',
    uploadUrl: 'http://localhost:4000/files/upload'
  })
}));

const mockLogImpressionEvent = vi.fn(function () { return vi.fn(); });
vi.mock('@/utils/instrumentation', () => ({
  logImpressionEvent: (...args: unknown[]) => mockLogImpressionEvent(...args),
}));

describe('FileUploadButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLogImpressionEvent.mockClear();
  });

  it('should render upload button', () => {
    renderWithProviders(<FileUploadButton appId="test-app" onFilesUploaded={() => {}} />);

    const button = screen.getByRole('button');
    expect(button).toBeInTheDocument();
  });

  it('should open file picker when clicked', () => {
    renderWithProviders(<FileUploadButton appId="test-app" onFilesUploaded={() => {}} />);

    const button = screen.getByRole('button');
    const fileInput = screen.getByTestId('file-input') as HTMLInputElement;

    const clickSpy = vi.spyOn(fileInput, 'click');

    fireEvent.click(button);

    expect(clickSpy).toHaveBeenCalled();
  });

  it('should upload selected files', async () => {
    const mockOnFilesUploaded = vi.fn();
    const mockData = {
      uploadId: 'upload_123',
      files: [
        { id: 'file_1', filename: 'test.png', originalName: 'test.png', size: 1024, mimeType: 'image/png', uploadedAt: new Date().toISOString() }
      ]
    };

    const mockResponse = {
      ok: true,
      json: async () => mockData
    } as Response;

    vi.mocked(global.fetch).mockResolvedValue(mockResponse);

    renderWithProviders(<FileUploadButton appId="test-app" onFilesUploaded={mockOnFilesUploaded} />);

    const fileInput = screen.getByTestId('file-input') as HTMLInputElement;
    const file = new File(['content'], 'test.png', { type: 'image/png' });

    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('http://localhost:4000/files/upload', expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Authorization': 'Bearer mock-token'
        })
      }));
    });

    expect(mockOnFilesUploaded).toHaveBeenCalledWith(mockData.files);
    expect(mockLogImpressionEvent).toHaveBeenCalledWith('uploads.file.success');
  });

  it('should call onUploadError with message on upload failure', async () => {
    const mockOnUploadError = vi.fn();
    vi.mocked(global.fetch).mockRejectedValue(new Error('Network failure'));

    renderWithProviders(<FileUploadButton appId="test-app" onFilesUploaded={() => {}} onUploadError={mockOnUploadError} />);

    const fileInput = screen.getByTestId('file-input') as HTMLInputElement;
    const file = new File(['content'], 'test.png', { type: 'image/png' });

    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(mockOnUploadError).toHaveBeenCalledWith('Network failure');
      expect(mockLogImpressionEvent).toHaveBeenCalledWith('uploads.file.failed');
    });
  });

  it('should reject files exceeding 25MB with error message', async () => {
    const mockOnUploadError = vi.fn();
    renderWithProviders(<FileUploadButton appId="test-app" onFilesUploaded={() => {}} onUploadError={mockOnUploadError} />);

    const fileInput = screen.getByTestId('file-input') as HTMLInputElement;
    const largeFile = new File(['x'.repeat(100)], 'huge.png', { type: 'image/png' });
    Object.defineProperty(largeFile, 'size', { value: 26 * 1024 * 1024 });

    fireEvent.change(fileInput, { target: { files: [largeFile] } });

    await waitFor(() => {
      expect(mockOnUploadError).toHaveBeenCalledWith('builder_chatfiles_error_file_too_large');
    });

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('should reject multiple oversized files with plural error key', async () => {
    const mockOnUploadError = vi.fn();
    renderWithProviders(<FileUploadButton appId="test-app" onFilesUploaded={() => {}} onUploadError={mockOnUploadError} />);

    const fileInput = screen.getByTestId('file-input') as HTMLInputElement;
    const largeA = new File(['a'], 'big1.png', { type: 'image/png' });
    const largeB = new File(['b'], 'big2.png', { type: 'image/png' });
    Object.defineProperty(largeA, 'size', { value: 26 * 1024 * 1024 });
    Object.defineProperty(largeB, 'size', { value: 30 * 1024 * 1024 });

    fireEvent.change(fileInput, { target: { files: [largeA, largeB] } });

    await waitFor(() => {
      expect(mockOnUploadError).toHaveBeenCalledWith('builder_chatfiles_error_files_too_large');
    });

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('should reject more than 5 files with error message', async () => {
    const mockOnUploadError = vi.fn();
    renderWithProviders(<FileUploadButton appId="test-app" onFilesUploaded={() => {}} onUploadError={mockOnUploadError} />);

    const fileInput = screen.getByTestId('file-input') as HTMLInputElement;
    const files = Array.from({ length: 6 }, (_, i) =>
      new File(['content'], `file${i}.png`, { type: 'image/png' })
    );

    fireEvent.change(fileInput, { target: { files } });

    await waitFor(() => {
      expect(mockOnUploadError).toHaveBeenCalledWith('builder_chatfiles_error_max_files');
    });

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('should parse error response from server', async () => {
    const mockOnUploadError = vi.fn();
    vi.mocked(global.fetch).mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'File size exceeds 10MB limit' })
    } as Response);

    renderWithProviders(<FileUploadButton appId="test-app" onFilesUploaded={() => {}} onUploadError={mockOnUploadError} />);

    const fileInput = screen.getByTestId('file-input') as HTMLInputElement;
    const file = new File(['content'], 'test.png', { type: 'image/png' });

    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(mockOnUploadError).toHaveBeenCalledWith('File size exceeds 10MB limit');
    });
  });

  it('should reset file input after successful upload', async () => {
    const mockData = {
      uploadId: 'upload_123',
      files: [
        { id: 'file_1', filename: 'test.png', originalName: 'test.png', size: 1024, mimeType: 'image/png', uploadedAt: new Date().toISOString() }
      ]
    };

    const mockResponse = {
      ok: true,
      json: async () => mockData
    } as Response;

    vi.mocked(global.fetch).mockResolvedValue(mockResponse);

    renderWithProviders(<FileUploadButton appId="test-app" onFilesUploaded={() => {}} />);

    const fileInput = screen.getByTestId('file-input') as HTMLInputElement;
    const file = new File(['content'], 'test.png', { type: 'image/png' });

    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });

    // File input should be reset
    expect(fileInput.value).toBe('');
  });

  it('should be disabled when disabled prop is true', () => {
    renderWithProviders(<FileUploadButton appId="test-app" onFilesUploaded={() => {}} disabled={true} />);

    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
  });

  it('should log timeout impression event on upload timeout', async () => {
    const mockOnUploadError = vi.fn();
    const abortError = new DOMException('The operation was aborted.', 'AbortError');
    vi.mocked(global.fetch).mockRejectedValue(abortError);

    renderWithProviders(<FileUploadButton appId="test-app" onFilesUploaded={() => {}} onUploadError={mockOnUploadError} />);

    const fileInput = screen.getByTestId('file-input') as HTMLInputElement;
    const file = new File(['content'], 'test.png', { type: 'image/png' });

    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(mockOnUploadError).toHaveBeenCalled();
      expect(mockLogImpressionEvent).toHaveBeenCalledWith('uploads.file.timeout');
    });
  });
});
