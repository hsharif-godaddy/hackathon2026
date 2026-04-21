/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import ChatAttachmentMenu from './ChatAttachmentMenu';

vi.mock('@/utils/instrumentation', () => ({
  logClickEvent: vi.fn(() => vi.fn()),
  logImpressionEvent: vi.fn(() => vi.fn()),
}));

vi.mock('@/lib/logging', () => ({
  shipAnalyticsLog: vi.fn(),
}));

vi.mock('@/lib/request-context', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock getFileUploadAgent
vi.mock('@/lib/file-agent', () => ({
  getFileUploadAgent: vi.fn().mockResolvedValue({
    token: 'mock-token',
    uploadUrl: 'http://localhost:4000/files/upload'
  })
}))

const mockCompressImageFiles = vi.fn(async (files: File[]) => files)
vi.mock('@/utils/image-compression', () => ({
  compressImageFiles: (...args: unknown[]) => mockCompressImageFiles(...args as [File[]]),
}));

const mockGetDisplayMedia = vi.fn();

// Mock FileReferenceModal
vi.mock('@/app/[market]/develop/components/chat/FileReferenceModal', () => ({
  default: ({ isOpen, onClose, onFilesSelected }: any) => {
    if (!isOpen) return null;
    return (
      <div data-testid="file-reference-modal">
        <button onClick={() => onFilesSelected(['test.txt'])}>Select Files</button>
        <button onClick={onClose}>Close</button>
      </div>
    );
  },
}));

describe('ChatAttachmentMenu', () => {
  const defaultProps = {
    appId: 'test-app-123',
    onStageFiles: vi.fn(),
    onScreenshotCaptured: vi.fn(),
    onFileReferencesSelected: vi.fn(),
    onUploadError: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks()
    mockCompressImageFiles.mockImplementation(async (files: File[]) => files);

    // Mock navigator.mediaDevices.getDisplayMedia
    Object.defineProperty(navigator, 'mediaDevices', {
      writable: true,
      value: {
        getDisplayMedia: mockGetDisplayMedia,
      },
    });

    // Mock fetch for file uploads
    global.fetch = vi.fn();
  });

  it('should render attachment menu button', () => {
    renderWithProviders(<ChatAttachmentMenu {...defaultProps} />);

    const button = screen.getByTestId('chat-attachment-menu-trigger');
    expect(button).toBeInTheDocument();
  });

  it('should disable button when disabled prop is true', () => {
    renderWithProviders(<ChatAttachmentMenu {...defaultProps} disabled={true} />);

    const button = screen.getByTestId('chat-attachment-menu-trigger');
    expect(button).toBeDisabled();
  });

  it('should open popover when button is clicked', async () => {
    const { user } = renderWithProviders(<ChatAttachmentMenu {...defaultProps} />);

    const button = screen.getByTestId('chat-attachment-menu-trigger');
    await user.click(button);

    await waitFor(() => {
      expect(screen.getByText('builder_chatfiles_file')).toBeInTheDocument();
      expect(screen.getByText('builder_chatfiles_screenshot')).toBeInTheDocument();
      expect(screen.getByText('builder_chatfiles_attach')).toBeInTheDocument();
    });
  });

  it('should show file reference modal when "Reference a file" is clicked', async () => {
    const { user } = renderWithProviders(<ChatAttachmentMenu {...defaultProps} />);

    const button = screen.getByTestId('chat-attachment-menu-trigger');
    await user.click(button);

    await waitFor(() => {
      expect(screen.getByText('builder_chatfiles_file')).toBeInTheDocument();
    });

    const referenceButton = screen.getByText('builder_chatfiles_file');
    await user.click(referenceButton);

    await waitFor(() => {
      expect(screen.getByTestId('file-reference-modal')).toBeInTheDocument();
    });
  });

  it('should call onFileReferencesSelected when files are selected in modal', async () => {
    const onFileReferencesSelected = vi.fn();
    const { user } = renderWithProviders(
      <ChatAttachmentMenu {...defaultProps} onFileReferencesSelected={onFileReferencesSelected} />
    );

    const button = screen.getByTestId('chat-attachment-menu-trigger');
    await user.click(button);

    await waitFor(() => {
      expect(screen.getByText('builder_chatfiles_file')).toBeInTheDocument();
    });

    const referenceButton = screen.getByText('builder_chatfiles_file');
    await user.click(referenceButton);

    await waitFor(() => {
      expect(screen.getByTestId('file-reference-modal')).toBeInTheDocument();
    });

    const selectButton = screen.getByText('Select Files');
    await user.click(selectButton);

    await waitFor(() => {
      expect(onFileReferencesSelected).toHaveBeenCalledWith(['test.txt']);
      expect(screen.queryByTestId('file-reference-modal')).not.toBeInTheDocument();
    });
  });

  it('should trigger file input when "Attach a file" is clicked', async () => {
    const { user } = renderWithProviders(<ChatAttachmentMenu {...defaultProps} />);

    const button = screen.getByTestId('chat-attachment-menu-trigger');
    await user.click(button);

    await waitFor(() => {
      expect(screen.getByText('builder_chatfiles_attach')).toBeInTheDocument();
    });

    const fileInput = screen.getByTestId('file-input');
    const clickSpy = vi.fn();
    fileInput.click = clickSpy;

    const attachButton = screen.getByText('builder_chatfiles_attach');
    await user.click(attachButton);

    expect(clickSpy).toHaveBeenCalled();
  });

  it('should call onStageFiles when file is selected (no immediate upload)', async () => {
    const onStageFiles = vi.fn();

    const { user } = renderWithProviders(
      <ChatAttachmentMenu {...defaultProps} onStageFiles={onStageFiles} />
    );

    const fileInput = screen.getByTestId('file-input') as HTMLInputElement;
    const file = new File(['test'], 'test.jpg', { type: 'image/jpeg' });

    await user.upload(fileInput, file);

    await waitFor(() => {
      expect(onStageFiles).toHaveBeenCalledWith([file]);
    });

    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockCompressImageFiles).not.toHaveBeenCalled();
  });

  it('should call onUploadError when validation fails (oversized file)', async () => {
    const onUploadError = vi.fn();
    const onStageFiles = vi.fn();
    const bigBuffer = new ArrayBuffer(11 * 1024 * 1024);
    const hugeFile = new File([bigBuffer], 'huge.jpg', { type: 'image/jpeg' });

    const { user } = renderWithProviders(
      <ChatAttachmentMenu {...defaultProps} onStageFiles={onStageFiles} onUploadError={onUploadError} />
    );

    const fileInput = screen.getByTestId('file-input') as HTMLInputElement;

    await user.upload(fileInput, hugeFile);

    await waitFor(() => {
      expect(onUploadError).toHaveBeenCalled();
    });
    expect(onStageFiles).not.toHaveBeenCalled();
  });

  it('should reset file input after staging files', async () => {
    const { user } = renderWithProviders(<ChatAttachmentMenu {...defaultProps} />);

    const fileInput = screen.getByTestId('file-input') as HTMLInputElement;
    const file = new File(['test'], 'test.jpg', { type: 'image/jpeg' });

    await user.upload(fileInput, file);

    await waitFor(() => {
      expect(fileInput.value).toBe('');
    });
  });

  it('should have correct file input accept attribute', () => {
    renderWithProviders(<ChatAttachmentMenu {...defaultProps} />);

    const fileInput = screen.getByTestId('file-input');
    expect(fileInput).toHaveAttribute('accept', 'image/*,video/*,audio/*,.pdf,.json,.xml,.yaml,.yml,.txt,.md,.csv,.ttf,.otf,.woff,.woff2,.mp3,.wav,.m4a,.js,.ts,.jsx,.tsx,.css,.html');
  });

  it('should allow multiple file selection', () => {
    renderWithProviders(<ChatAttachmentMenu {...defaultProps} />);

    const fileInput = screen.getByTestId('file-input');
    expect(fileInput).toHaveAttribute('multiple');
  });

  it('should disable attachment button when isCapturing is true', async () => {
    const mockStream = {
      getVideoTracks: () => [{} as MediaStreamTrack],
      getTracks: () => [{
        stop: vi.fn()
      } as unknown as MediaStreamTrack],
    };

    mockGetDisplayMedia.mockImplementation(() =>
      new Promise((resolve) => {
        setTimeout(() => resolve(mockStream), 100);
      })
    );

    const { user } = renderWithProviders(<ChatAttachmentMenu {...defaultProps} />);

    const button = screen.getByTestId('chat-attachment-menu-trigger');
    await user.click(button);

    await waitFor(() => {
      expect(screen.getByText('builder_chatfiles_screenshot')).toBeInTheDocument();
    });

    const screenshotButton = screen.getByText('builder_chatfiles_screenshot');
    await user.click(screenshotButton);

    // Check that the main attachment button is disabled during capture
    await waitFor(() => {
      expect(button).toBeDisabled();
    });
  });

  it('should not call onUploadError when screenshot is cancelled by user', async () => {
    const onUploadError = vi.fn();

    const cancelError = new Error('User cancelled');
    cancelError.name = 'NotAllowedError';
    mockGetDisplayMedia.mockRejectedValueOnce(cancelError);

    const { user } = renderWithProviders(
      <ChatAttachmentMenu {...defaultProps} onUploadError={onUploadError} />
    );

    const button = screen.getByTestId('chat-attachment-menu-trigger');
    await user.click(button);

    await waitFor(() => {
      expect(screen.getByText('builder_chatfiles_screenshot')).toBeInTheDocument();
    });

    const screenshotButton = screen.getByText('builder_chatfiles_screenshot');
    await user.click(screenshotButton);

    await waitFor(() => {
      expect(onUploadError).not.toHaveBeenCalled();
    });
  });

  it('should hide screenshot button when getDisplayMedia is not available', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      writable: true,
      value: {},
    });

    const { user } = renderWithProviders(<ChatAttachmentMenu {...defaultProps} />);

    const button = screen.getByTestId('chat-attachment-menu-trigger');
    await user.click(button);

    await waitFor(() => {
      expect(screen.getByText('builder_chatfiles_file')).toBeInTheDocument();
      expect(screen.getByText('builder_chatfiles_attach')).toBeInTheDocument();
      expect(screen.queryByText('builder_chatfiles_screenshot')).not.toBeInTheDocument();
    });
  });

  it('should close popover when option is selected', async () => {
    const { user } = renderWithProviders(<ChatAttachmentMenu {...defaultProps} />);

    const button = screen.getByTestId('chat-attachment-menu-trigger');
    await user.click(button);

    await waitFor(() => {
      expect(screen.getByText('builder_chatfiles_file')).toBeInTheDocument();
    });

    const referenceButton = screen.getByText('builder_chatfiles_file');
    await user.click(referenceButton);

    await waitFor(() => {
      expect(screen.queryByText('builder_chatfiles_screenshot')).not.toBeInTheDocument();
    });
  });

  describe('staging (upload on send)', () => {
    it('does not compress or fetch when picking a file', async () => {
      const { user } = renderWithProviders(<ChatAttachmentMenu {...defaultProps} />);

      const fileInput = screen.getByTestId('file-input') as HTMLInputElement;
      const file = new File(['test'], 'photo.jpg', { type: 'image/jpeg' });

      await user.upload(fileInput, file);

      await waitFor(() => {
        expect(defaultProps.onStageFiles).toHaveBeenCalledWith([file]);
      });
      expect(mockCompressImageFiles).not.toHaveBeenCalled();
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });
});
