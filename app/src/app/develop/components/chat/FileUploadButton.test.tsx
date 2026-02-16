import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import FileUploadButton from '@/app/develop/components/chat/FileUploadButton';

// Mock global fetch
global.fetch = vi.fn();

// Mock getFileUploadAgent
vi.mock('@/lib/file-agent', () => ({
  getFileUploadAgent: vi.fn().mockResolvedValue({
    token: 'mock-token',
    uploadUrl: 'http://localhost:4000/files/upload'
  })
}));

describe('FileUploadButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render upload button', () => {
    render(<FileUploadButton appId="test-app" onFilesUploaded={() => {}} />);

    const button = screen.getByRole('button');
    expect(button).toBeInTheDocument();
  });

  it('should open file picker when clicked', () => {
    render(<FileUploadButton appId="test-app" onFilesUploaded={() => {}} />);

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

    render(<FileUploadButton appId="test-app" onFilesUploaded={mockOnFilesUploaded} />);

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
  });

  it('should handle upload errors', async () => {
    vi.mocked(global.fetch).mockRejectedValue(new Error('Upload failed'));

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(<FileUploadButton appId="test-app" onFilesUploaded={() => {}} />);

    const fileInput = screen.getByTestId('file-input') as HTMLInputElement;
    const file = new File(['content'], 'test.png', { type: 'image/png' });

    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalled();
    });

    consoleSpy.mockRestore();
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

    render(<FileUploadButton appId="test-app" onFilesUploaded={() => {}} />);

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
    render(<FileUploadButton appId="test-app" onFilesUploaded={() => {}} disabled={true} />);

    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
  });
});
